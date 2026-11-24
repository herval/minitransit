import {AGENCIES, AGENCY_BY_ID, project, REGIONAL_MAX_AGE} from './networks.js';
import {sourceState, trainDelay, serviceGaps} from './model.js';
import {createMapGeometry, createCorridors, locateTrain, remainingStops, pointAt} from './regional-geometry.js';
import {waterPath} from './water.js';
import {busHubName,busHubPriority,stationRadius,clusterVehicles} from './map-overview.js';

const $ = selector => document.querySelector(selector), NS = 'http://www.w3.org/2000/svg';
const attributes = new WeakMap();
function attr(el, name, value) {
  value = String(value);
  let cache = attributes.get(el);
  if (!cache) attributes.set(el, cache = Object.create(null));
  if (cache[name] !== value) { el.setAttribute(name, value); cache[name] = value; }
}
function text(el, value) { value = String(value); if (el.textContent !== value) el.textContent = value; }
function html(el, value) { if (el.__html !== value) { el.innerHTML = value; el.__html = value; } }
function make(tag, values = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(values)) attr(el, key, value);
  parent?.append(el); return el;
}
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const map = $('#map'), routesLayer = $('#routes'), stationsLayer = $('#stations'), labelsLayer = $('#station-labels'), trainsLayer = $('#trains'), clustersLayer = $('#bus-clusters'), cuesLayer = $('#map-cues');
const canvas = document.createElement('canvas'), measure = canvas.getContext('2d');
const widths = new Map(), colors = new Map(), clockFormatter = new Intl.DateTimeFormat('en-GB', {timeZone:'America/Los_Angeles', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
let network, geometry, snapshot, focus = 'all', line = 'all', buses = false, labels = true;
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches, selected = null, followed = null, clockOffset = 0, trigger = null;
let view = {x:-450, y:0, w:1700, h:2500}, viewport, scale = 1, userMoved = false, cameraOverview = false;
let activeLines = new Set(), contextLines = new Set(), activeStations = [], activeTrains = [], geometryKey = '', geometryRevision = 0;
let stationNodes = new Map(), routeNodes = new Map(), trains = new Map(), cueNodes = new Map(), clusterNodes = new Map(), lanes = new Map();
let labelOccupied = [], upcomingRows = new Map(), viewportRevision = '', frameHandle = 0;
const corridorCache=new Map(),clusterRows=new Map();let clusterSelection=[];
let cameraDirty = false, geometryDirty = true, stationsDirty = true, vehiclesDirty = true, cuesDirty = true, tickDue = true;
let geometryTimer, pollTimer, fetching = false, etag = '', lastFrame = 0, statusRevision = '';
const stationDetails = new Map(), trainDetails = new Map(), detailRequests = new Map();
const now = () => Date.now() + clockOffset;
const fresh = stamp => sourceState(stamp, now(), REGIONAL_MAX_AGE) === 'live';
const enabledAgency = id => focus === 'all' ? id !== 'AC' || buses : id === focus;
const enabledLine = id => activeLines.has(id);
const enabledStation = station => station.public !== false && station.lines.some(enabledLine);
const busOverview = () => line === 'all';
const busStop = stop => focus === 'AC' || stop.agencies.every(id=>id==='AC');
const age = stamp => { if (!stamp) return 'unavailable'; const seconds = Math.max(0, Math.floor(now()/1000-stamp)); return seconds < 60 ? seconds+'s ago' : Math.floor(seconds/60)+'m '+seconds%60+'s ago'; };
const eta = time => time == null ? '—' : Math.max(0, Math.ceil((time-now()/1000)/60)) === 0 ? 'Now' : Math.ceil((time-now()/1000)/60)+'m';
function color(hex) {
  if (colors.has(hex)) return colors.get(hex);
  let result = hex;
  if (document.documentElement.dataset.theme === 'night') {
    const rgb = hex.replace('#','').match(/../g)?.map(value => parseInt(value,16));
    if (rgb?.length === 3 && Math.max(...rgb) < 175) result = '#'+rgb.map(value => Math.round(value*.65+255*.35).toString(16).padStart(2,'0')).join('');
  }
  colors.set(hex, result); return result;
}
function message(value) { $('#map-message').hidden = !value; text($('#map-message'), value); }
// viewBox changes never resize this element. Read its screen rectangle once,
// before SVG writes, and invalidate it only when the browser viewport changes.
function bounds() { return viewport ??= map.getBoundingClientRect(); }
function refreshViewport() {
  const previous=viewport,next=map.getBoundingClientRect(); viewport=next;
  if (!network || previous&&previous.width===next.width&&previous.height===next.height) return;
  if (network.projectionAngle!==(innerWidth<=650?0:25)) { projectNetwork();buildMap();fit();return; }
  if (!userMoved) { fit();return; }
  const cx=view.x+view.w/2,cy=view.y+view.h/2,width=next.width/scale,height=next.height/scale;
  view={x:cx-width/2,y:cy-height/2,w:width,h:height};geometryDirty=cameraDirty=true;requestFrame();
}
function screen(point) {
  const rect = bounds();
  return {x:(point.x-view.x)*scale+(rect.width-view.w*scale)/2, y:(point.y-view.y)*scale+(rect.height-view.h*scale)/2};
}
function inView(point, margin = 30) {
  const p = screen(point), rect = bounds();
  return p.x >= -margin && p.x <= rect.width+margin && p.y >= -margin && p.y <= rect.height+margin;
}
function requestFrame() { if (!frameHandle) frameHandle = requestAnimationFrame(animate); }
function invalidate() { requestFrame(); }
function scope() {
  const allowed=Object.values(network.lines).filter(meta=>enabledAgency(meta.agency));
  activeLines = new Set(allowed.filter(meta => line === 'all' || line === meta.id).map(meta => meta.id));
  contextLines = new Set(line==='all'?[]:allowed.filter(meta=>!activeLines.has(meta.id)).map(meta=>meta.id));
  const priority=stop=>(focus==='AC'&&busOverview()?busHubPriority(stop):0)+Number(stop.major)*10+stop.agencies.length;
  activeStations = Object.values(network.stations).filter(enabledStation).sort((a,b) => priority(b)-priority(a) || a.id.localeCompare(b.id));
  activeTrains = [...trains.values()].filter(train => enabledLine(train.raw.line));
  for (const train of activeTrains) train.delay=trainDelay(train.raw,now());
  for (const train of trains.values()) if (train.el && !enabledLine(train.raw.line)) { train.el.remove(); train.el=train.body=train.shape=null; }
  geometryDirty = stationsDirty = vehiclesDirty = cuesDirty = true; statusRevision = ''; viewportRevision = '';
}
function fit({overview = cameraOverview} = {}) {
  if (!activeStations.length) return;
  userMoved=false; cameraOverview=overview;
  const xs = activeStations.map(stop => stop.x), ys = activeStations.map(stop => stop.y), rect = bounds(), mobile = innerWidth <= 650;
  const width = Math.max(14, Math.max(...xs)-Math.min(...xs)), height = Math.max(14, Math.max(...ys)-Math.min(...ys));
  const top = mobile ? 155 : 180, bottom = mobile ? 190 : 165;
  const opening = !overview && line === 'all';
  const magnification = opening ? focus === 'all' ? 3.5 : focus === 'AC' ? 16 : 2 : 1;
  const k = Math.min((rect.width-(mobile?65:140))/width, (rect.height-top-bottom)/height)*magnification;
  let center = {x:(Math.max(...xs)+Math.min(...xs))/2,y:(Math.max(...ys)+Math.min(...ys))/2};
  if (opening) {
    // Start the regional map on the central Bay and AC Transit on downtown Oakland.
    const anchor = {all:[37.79,-122.35],AC:[37.804,-122.271]}[focus];
    center = anchor ? project(...anchor,network.projectionAngle) : {
      x:xs.reduce((a,b)=>a+b,0)/xs.length,
      y:ys.reduce((a,b)=>a+b,0)/ys.length
    };
  }
  view = {x:center.x-rect.width/k/2, y:center.y-(top+(rect.height-top-bottom)/2)/k, w:rect.width/k, h:rect.height/k};
  clearTimeout(geometryTimer); geometryTimer = null; drawView(true);
}
function pathData(points){return points.map((p,i)=>(i?'L':'M')+Math.round(p.x*1000)/1000+','+Math.round(p.y*1000)/1000).join(' ');}
function corridors(lines){
  if(!lines.size)return new Map();
  const key=[...lines].join(',');
  if(!corridorCache.has(key)){
    const groups=new Map();
    for(const shape of createCorridors(network,lines)){
      const kind=shape.mode==='bus'?'bus':shape.mode==='ferry'?'ferry':'rail';
      if(!groups.has(kind))groups.set(kind,new Set());groups.get(kind).add(pathData(shape.points));
    }
    if(corridorCache.size>=8)corridorCache.delete(corridorCache.keys().next().value);
    corridorCache.set(key,new Map([...groups].map(([kind,paths])=>[kind,[...paths].join(' ')])));
  }
  return corridorCache.get(key);
}
function rebuildGeometry() {
  const key = [...activeLines].join(',')+'|'+[...contextLines].join(',')+'|'+scale.toFixed(7);
  if (!geometryDirty && geometryKey === key) return;
  if (geometryKey !== key) {
    geometry = createMapGeometry(network, scale, {lines:activeLines});
    geometryKey = key; geometryRevision++;
    const paths = new Map(); lanes = new Map();
    for(const [kind,d]of corridors(contextLines))paths.set('context:'+kind,{d,kind,context:true});
    if(busOverview()){
      const busLines=new Set([...activeLines].filter(id=>network.lines[id].mode==='bus'));
      const d=busLines.size?corridors(busLines).get('bus'):null;
      if(d)paths.set('bus-overview',{d,kind:'bus',overview:true});
    }
    for (const shape of geometry.shapes) {
      if(shape.mode==='bus'&&busOverview())continue;
      if (!paths.has(shape.line)) paths.set(shape.line,{parts:[],kind:shape.mode});
      paths.get(shape.line).parts.push(pathData(shape.points));
    }
    for (const edge of network.edges) {
      const count = edge.lines.filter(id=>enabledLine(id)&&network.lines[id].mode!=='bus').length;
      if (count) for (const id of [edge.a,edge.b]) lanes.set(id, Math.max(lanes.get(id)||1, count));
    }
    for (const [id,el] of routeNodes) if (!paths.has(id)) { el.remove(); routeNodes.delete(id); }
    for (const [id,value] of paths) {
      const meta = network.lines[id]; let el = routeNodes.get(id);
      if (!el) { el = make('path', {}, routesLayer); routeNodes.set(id,el); }
      attr(el,'class','route '+value.kind+(value.context?' context':'')+(value.overview?' overview':''));
      if(meta)attr(el,'data-line',id);
      attr(el,'d',value.d??value.parts.join(' ')); attr(el,'stroke',meta?color(meta.color):'var(--corridor)');
      routesLayer.append(el);
    }
  }
  geometryDirty = false; stationsDirty = vehiclesDirty = cuesDirty = true;
}
function drawView(commitGeometry = true) {
  if (!network) return;
  const rect = bounds(); scale = Math.min(rect.width/view.w,rect.height/view.h)||1;
  if (commitGeometry || !geometry) rebuildGeometry();
  attr(map,'viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
  const revision = [view.x,view.y,view.w,view.h,scale,focus,line,labels,selected,geometryRevision].join('|');
  if (revision !== viewportRevision) { viewportRevision = revision; stationsDirty = vehiclesDirty = cuesDirty = true; }
  cameraDirty = false;
  if (stationsDirty) layoutStations();
  renderVehicles(performance.now());
  if (cuesDirty) renderCues();
}
function overlaps(box, occupied) { return occupied.some(other => box.x < other.x+other.w && box.x+box.w > other.x && box.y < other.y+other.h && box.y+box.h > other.y); }
function labelWidth(stop,name=stop.name.replace(/ Station$/i,'')) {
  const key = (stop.major?'700:':'500:')+name;
  if (!widths.has(key)) { measure.font=(stop.major?'700':'500')+' 12px DM Sans, sans-serif'; widths.set(key,measure.measureText(name).width+9); }
  return widths.get(key);
}
function createStation(stop) {
  const el = make('g', {class:'station'+(stop.agencies.length>1?' transfer':''), transform:`translate(${stop.x} ${stop.y})`, tabindex:0, role:'button', 'aria-label':stop.name+', '+stop.agencies.map(id=>AGENCY_BY_ID[id].short).join(', '), 'data-station':stop.id, visibility:'visible'}, stationsLayer);
  text(make('title',{},el),stop.name);
  return {el, hit:make('circle',{class:'hit'},el), shape:make('circle',{class:'node'},el), label:null, data:stop};
}
function layoutStations() {
  if (!network) return;
  const rect = bounds(), visible = new Set();
  const occupied = [{x:0,y:0,w:Math.min(360,rect.width*.65),h:155},{x:rect.width-300,y:0,w:300,h:100},{x:0,y:rect.height-155,w:rect.width,h:155}];
  const detail = focus !== 'all' && focus !== 'AC' || scale > (focus === 'all' ? 3 : 1.3);
  const mobile=innerWidth<=650,quiet=busOverview(),nearby=scale>=18;
  const busCells=new Set(),hubNames=new Set(),busBudget=quiet&&!nearby?(mobile?6:14):(mobile?40:120),labelBudget=quiet?(mobile?8:18):(mobile?14:30);let busStops=0,busLabels=0;
  const chosen = selected && network.stations[selected];
  const ordered = chosen && enabledStation(chosen) ? [chosen,...activeStations.filter(stop=>stop.id!==selected)] : activeStations;
  for (const stop of ordered) {
    const bus=busStop(stop),hub=bus?busHubName(stop):null,chosenStop=stop.id===selected;
    if(bus&&quiet&&!nearby&&!hub&&!chosenStop)continue;
    if (!bus&&!stop.major && !detail && !chosenStop) continue;
    const p = screen(stop);
    if (p.x < -20 || p.x > rect.width+20 || p.y < 90 || p.y > rect.height-100) continue;
    if(bus&&!chosenStop){
      const spacing=quiet&&!nearby?70:20,cell=Math.floor(p.x/spacing)+':'+Math.floor(p.y/spacing);
      if(busStops>=busBudget||busCells.has(cell)||quiet&&hub&&hubNames.has(hub))continue;
      busCells.add(cell);
    }
    const radius=stationRadius(stop,{bus,selected:chosenStop,lanes:lanes.get(stop.id)||1})/scale;
    const name=bus&&quiet&&hub?hub:stop.name.replace(/ Station$/i,'');
    let placement;
    if (labels&&(!bus||busLabels<labelBudget||chosenStop)) {
      const width=labelWidth(stop,name), offset=Math.max(bus&&quiet?14:10,radius*scale+5);
      for (const [dx,dy] of [[offset,-7],[-width-offset,-7],[-width/2,-offset-14],[-width/2,offset]]) {
        const box={x:p.x+dx-3,y:p.y+dy-3,w:width+6,h:22};
        if (box.x<9 || box.x+width>rect.width-8 || overlaps(box,occupied)) continue;
        placement={dx,dy,box}; break;
      }
      if (!placement && chosenStop) placement={dx:10,dy:-7,box:{x:p.x+7,y:p.y-10,w:width+6,h:22}};
    }
    if(bus&&quiet&&!nearby&&labels&&!placement&&!chosenStop)continue;
    if(bus){busStops++;if(hub)hubNames.add(hub);}
    visible.add(stop.id); let node = stationNodes.get(stop.id);
    if (!node) { node=createStation(stop); stationNodes.set(stop.id,node); }
    attr(node.shape,'r',radius); attr(node.hit,'r',Math.max(11/scale,radius));
    attr(node.el,'class','station'+(stop.agencies.length>1?' transfer':'')+(chosenStop?' selected':'')+(bus&&quiet?' bus-overview':''));
    if (placement) {
      occupied.push(placement.box);if(bus)busLabels++;
      if (!node.label)node.label=make('text',{visibility:'visible'},labelsLayer);
      attr(node.label,'class','station-label'+(stop.major?' major':''));text(node.label,name);
      attr(node.label,'transform',`translate(${stop.x+placement.dx/scale} ${stop.y+(placement.dy+12)/scale})`); attr(node.label,'font-size',12/scale);
    } else if (node.label) { node.label.remove(); node.label=null; }
  }
  for (const [id,node] of stationNodes) if (!visible.has(id)) { node.el.remove(); node.label?.remove(); stationNodes.delete(id); }
  labelOccupied=occupied; stationsDirty=false; cuesDirty=true;
}
function buildMap() {
  routesLayer.replaceChildren(); stationsLayer.replaceChildren(); labelsLayer.replaceChildren(); trainsLayer.replaceChildren(); clustersLayer.replaceChildren();cuesLayer.replaceChildren();
  stationNodes.clear(); routeNodes.clear(); cueNodes.clear();clusterNodes.clear();corridorCache.clear();
  for (const train of trains.values()) train.el=train.body=train.shape=null;
  geometry=null; geometryKey=''; viewportRevision='';
  $('#water').replaceChildren();
  make('path',{class:'water',d:waterPath(network.projectionAngle),'fill-rule':'nonzero'},$('#water'));
  buildTabs(); buildLineSelect(); scope(); updateControls();
}
function buildTabs() {
  const nav=$('#network-tabs'); nav.replaceChildren();
  for (const agency of [{id:'all',short:'Bay Area',name:'All rail and ferries',color:'#89969e'},...AGENCIES]) {
    const button=document.createElement('button'); button.className='network-tab'; button.dataset.network=agency.id; button.title=agency.name;
    button.style.setProperty('--network-color',agency.color);
    const dot=document.createElement('span'); dot.className='network-dot'; dot.setAttribute('aria-hidden','true'); button.append(dot,document.createTextNode(agency.short));
    button.addEventListener('click',()=>chooseNetwork(agency.id)); nav.append(button);
  }
}
function buildLineSelect() {
  const select=$('#line-select'); select.replaceChildren(new Option(focus==='AC'?'Overview · choose a route':focus==='all'?(buses?'All networks':'All rail & ferries'):'All '+AGENCY_BY_ID[focus].short+' routes','all'));
  if (focus!=='all') for (const meta of Object.values(network.lines).filter(meta=>meta.agency===focus).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}))) select.add(new Option(meta.name,meta.id));
  select.value=line;
}
function updateControls() {
  for (const button of document.querySelectorAll('[data-network]')) attr(button,'aria-pressed',button.dataset.network===focus);
  attr($('#buses'),'aria-pressed',buses); text($('#buses'),buses?'− Buses':'+ Buses');
  text($('#view-name'),focus==='all'?'Bay Area, in motion.':AGENCY_BY_ID[focus].name+', in motion.');
  const focused=line!=='all',quiet=busOverview()&&(focus==='AC'||focus==='all'&&buses);
  document.body.classList.toggle('route-focused',focused);$('#route-clear').hidden=!focused;
  text($('#network-caption'),focused?'Route '+network.lines[line].name+' · '+activeStations.length+' stops':focus==='AC'?'Bus overview · choose a route for detail':focus==='all'?(buses?'Rail, ferries & bus corridors':'Six rail & ferry networks · buses optional'):network.counts[focus].stations+' stops · '+AGENCY_BY_ID[focus].name);
  text($('#explore-hint'),quiet?'Choose a route · numbers group nearby buses':focused?'Tap a stop or vehicle for details':'Drag to explore · fit to see the whole network');
  text($('#cue-note'),quiet?'Amber/red marks delays · route views show gap clocks':'Outlines show delays · clocks show gaps');
}
function chooseNetwork(id) {
  focus=id; line='all'; if (id==='AC') buses=true; followed=null;selected=null;
  closePanel(false); buildLineSelect(); scope(); updateControls();userMoved=true;drawView(true);
  $('#network-tabs [data-network="'+id+'"]').scrollIntoView({block:'nearest',inline:'nearest'}); renderStatus();
}
function chooseLine(id){
  if(id!=='all'&&!network.lines[id])return;
  line=id;selected=null;followed=null;
  if(id!=='all'){focus=network.lines[id].agency;if(focus==='AC')buses=true;}
  closePanel(false);buildLineSelect();scope();updateControls();
  userMoved=true;drawView(true);
  renderStatus();
}
function populateStations(query=$('#station-search').value) {
  if (!network) return;
  const search=query.trim().toLowerCase(), select=$('#station-select');
  const options=Object.values(network.stations).filter(stop=>stop.public!==false&&(search?(stop.name+' '+stop.agencies.map(id=>AGENCY_BY_ID[id].name).join(' ')).toLowerCase().includes(search):enabledStation(stop))).sort((a,b)=>a.name.localeCompare(b.name));
  const list=options.slice(0,250), chosen=network.stations[selected];
  if (chosen&&!list.some(stop=>stop.id===selected)) list.unshift(chosen);
  select.replaceChildren(); for (const stop of list) select.add(new Option(stop.name+' · '+stop.agencies.map(id=>AGENCY_BY_ID[id].short).join(' / '),stop.id));
  if (!list.length) select.add(new Option('No matching stops','')); select.value=selected||list[0]?.id||'';
}
function openPanel(mode) {
  trigger??=document.activeElement; $('#inspector').hidden=false; document.body.classList.add('inspector-open');
  $('#station-panel').hidden=mode!=='station'; $('#network-panel').hidden=mode!=='network';$('#cluster-panel').hidden=mode!=='cluster';
  text($('#panel-title'),mode==='station'?'At the platform':mode==='cluster'?'Nearby buses':'Service & data');
  for (const id of ['service','connection']) attr($('#'+id),'aria-expanded',mode==='network'); attr($('#station-finder'),'aria-expanded',mode==='station');
  if (mode==='network') { statusRevision=''; renderStatus(); }
}
function closePanel(restore=true) {
  $('#inspector').hidden=true; document.body.classList.remove('inspector-open');
  for (const id of ['service','connection','station-finder']) attr($('#'+id),'aria-expanded',false);
  if (restore&&trigger?.isConnected) trigger.focus({preventScroll:true}); trigger=null;
}
function chooseStation(id,keepTrain=false) {
  const stop=network.stations[id]; if (!stop) return;
  let changed=false;
  if (!enabledStation(stop)) { focus=stop.agencies.find(id=>id!=='AC')||'AC'; line='all'; if (focus==='AC') buses=true; buildLineSelect(); scope(); updateControls(); changed=true; }
  selected=id; if (!keepTrain) followed=null;
  const p=screen(stop), rect=bounds();
  if (changed||p.x<35||p.x>rect.width-35||p.y<160||p.y>rect.height-160) { const width=Math.min(view.w,400),height=width*rect.height/rect.width; view={x:stop.x-width/2,y:stop.y-height/2,w:width,h:height};userMoved=true; }
  stationsDirty=true; populateStations(); openPanel('station'); drawView(true); renderStation(); ensureDetails();
}
function chooseTrain(id) {
  const train=trains.get(id); if (!train) return;
  if(network.lines[train.raw.line].mode==='bus'&&busOverview()){
    focus=train.raw.agency;line=train.raw.line;buses=true;buildLineSelect();scope();updateControls();userMoved=true;drawView(true);
  }
  const stop=train.position?.to||train.raw.mapMotion?.anchor?.to||train.raw.mapMotion?.windows?.[0]?.to;
  if (stop) selected=stop; followed=id; stationsDirty=true;
  populateStations(); openPanel('station'); layoutStations(); renderStation(); renderCues(); ensureDetails();
}
function createTrain(train,compact=false) {
  const raw=train.raw, meta=network.lines[raw.line];
  const el=make('g',{class:'train',tabindex:0,role:'button','aria-label':AGENCY_BY_ID[raw.agency].short+' '+raw.headsign,'data-agency':raw.agency,'data-train':raw.id,visibility:'visible'},trainsLayer);
  const body=make('g',{},el);
  if(compact){
    make('circle',{r:11,fill:'transparent'},body);
    const shape=make('circle',{class:'vehicle-dot',r:2.8},body);
    Object.assign(train,{el,body,shape,renderKind:'dot'});return;
  }
  make('rect',{class:'vehicle-outline',x:-11,y:-6,width:22,height:12,rx:3},body);
  const path=meta.mode==='ferry'?'M-10 -4 L7 -4 L11 0 L7 4 L-10 4Z':meta.mode==='bus'?'M-8 -4 H8 V4 H-8Z':'M-10 -4 H10 V4 H-10Z';
  const shape=make('path',{class:'vehicle-body',d:path,fill:color(meta.color)},body); make('path',{class:'vehicle-window',d:'M3 -2 H6 V2 H3Z'},body);
  Object.assign(train,{el,body,shape,renderKind:'vehicle'});
}
function paintTrain(train,compact=false){
  if(train.el&&train.renderKind!==(compact?'dot':'vehicle')){train.el.remove();train.el=null;}
  if(!train.el)createTrain(train,compact);
  const position=train.position;
  attr(train.el,'class','train'+(compact?' bus-dot':'')+(!position?' stale':'')+(train.delay?.seconds>=60&&position?' late':'')+(train.delay?.seconds>=300&&position?' severe':''));
  attr(train.el,'transform',`translate(${train.last.x.toFixed(3)} ${train.last.y.toFixed(3)})`);
  attr(train.body,'transform',`scale(${(compact?1:focus==='all'?.6:1)/scale}) rotate(${compact?0:train.last.angle.toFixed(3)})`);
}
function paintCluster(group,used){
  const members=group.members.map(point=>point.train),id=JSON.stringify(members.map(train=>train.raw.id));used.add(id);
  let node=clusterNodes.get(id);
  if(!node){
    const el=make('g',{tabindex:0,role:'button','data-bus-cluster':id},clustersLayer),body=make('g',{},el);
    make('circle',{r:14,class:'cluster-hit'},body);const circle=make('circle',{r:9,class:'cluster-body'},body),label=make('text',{},body);
    node={el,body,circle,label};clusterNodes.set(id,node);
  }
  node.members=members.map(train=>train.raw.id);
  const live=members.some(train=>train.position),delay=Math.max(0,...members.map(train=>train.position?train.delay?.seconds||0:0));
  attr(node.el,'class','bus-cluster'+(!live?' stale':'')+(delay>=60?' late':'')+(delay>=300?' severe':''));
  attr(node.el,'aria-label',members.length+' buses nearby'+(!live?', last known positions':'')+'. Select to view individual buses.');
  attr(node.el,'data-count',members.length);attr(node.body,'transform',`translate(${group.x/scale} ${group.y/scale}) scale(${1/scale})`);
  attr(node.circle,'r',members.length>99?12:9);text(node.label,members.length);
}
function chooseBusCluster(id){
  const node=clusterNodes.get(id);if(!node)return;
  clusterSelection=[...node.members];openPanel('cluster');renderBusCluster();
}
function renderBusCluster(){
  const used=new Set();
  for(const id of clusterSelection){
    const train=trains.get(id);if(!train||!network.lines[train.raw.line])continue;used.add(id);
    let row=clusterRows.get(id);
    if(!row){const button=document.createElement('button');button.className='cluster-vehicle';button.dataset.train=id;
      const name=document.createElement('strong'),destination=document.createElement('span'),status=document.createElement('small');button.append(name,destination,status);button.onclick=()=>chooseTrain(id);$('#cluster-list').append(button);row={button,name,destination,status};clusterRows.set(id,row);}
    text(row.name,'Route '+network.lines[train.raw.line].name);text(row.destination,train.raw.headsign);
    text(row.status,!train.position?'Last known position':train.delay?.seconds>=60?'Reported delay +'+Math.round(train.delay.seconds/60)+'m':'Select for upcoming stops');
  }
  for(const [id,row]of clusterRows)if(!used.has(id)){row.button.remove();clusterRows.delete(id);}
  text($('#cluster-summary'),used.size?used.size+' buses in this group. Choose one to see its route and stops.':'These buses are no longer reported.');
}
function syncTrains() {
  const ids=new Set();
  for (const raw of snapshot.trips.trains) {
    ids.add(raw.id); let train=trains.get(raw.id);
    if (!train) { train={raw,el:null,last:null,position:null}; trains.set(raw.id,train); }
    train.raw=raw; train.reportedKey=null; train.delay=trainDelay(raw,now());
  }
  for (const [id,train] of trains) if (!ids.has(id)) { train.el?.remove(); trains.delete(id); }
  activeTrains=[...trains.values()].filter(train=>enabledLine(train.raw.line));
  const activeIds=new Set(activeTrains.map(train=>train.raw.id));
  for (const train of trains.values()) if (train.el&&!activeIds.has(train.raw.id)) { train.el.remove(); train.el=train.body=train.shape=null; }
  vehiclesDirty=cuesDirty=true;
}
function positionFor(train,stamp) {
  const anchor=train.raw.mapMotion?.anchor;
  if (anchor&&sourceState(anchor.timestamp,stamp,REGIONAL_MAX_AGE)==='live') {
    if (train.reportedKey!==anchor||train.reportedGeometry!==geometryRevision) {
      train.reported=locateTrain(train.raw,network,geometry,stamp); train.reportedKey=anchor; train.reportedGeometry=geometryRevision;
    }
    return train.reported;
  }
  return locateTrain(train.raw,network,geometry,stamp);
}
function renderVehicles(time) {
  if (!network||!geometry) return;
  const stamp=now(),busPoints=[],usedClusters=new Set(); let count=0;
  for (const train of activeTrains) {
    const position=positionFor(train,stamp);
    train.position=position;
    if (position&&(!paused||!train.last)) train.last=position;
    if (train.last?.from&&train.lastGeometry!==geometryRevision) {
      const projected=pointAt(geometry.path(train.raw.line,train.last.from,train.last.to),train.last.progress); if (projected) train.last={...train.last,...projected};
    }
    train.lastGeometry=geometryRevision;
    if (!train.last||!inView(train.last)) { if (train.el) { train.el.remove(); train.el=train.body=train.shape=null; } continue; }
    if(network.lines[train.raw.line].mode==='bus'&&busOverview()){
      const p=screen(train.last),rect=bounds();
      if(p.y<160||p.y>rect.height-155){train.el?.remove();train.el=train.body=train.shape=null;continue;}
      busPoints.push({id:train.raw.id,x:train.last.x*scale,y:train.last.y*scale,train});
    }else paintTrain(train);
    if (position) count++;
  }
  for(const group of clusterVehicles(busPoints,24)){
    if(group.members.length===1)paintTrain(group.members[0].train,true);
    else{
      for(const point of group.members){point.train.el?.remove();point.train.el=point.train.body=point.train.shape=null;}
      paintCluster(group,usedClusters);
    }
  }
  for(const [id,node]of clusterNodes)if(!usedClusters.has(id)){node.el.remove();clusterNodes.delete(id);}
  if(!$('#inspector').hidden&&!$('#cluster-panel').hidden)renderBusCluster();
  text($('#train-count'),count); vehiclesDirty=false;
}
function placeCue(point,value,preferred,occupied) {
  const p=screen(point),width=Math.max(28,value.length*6.5+12),rect=bounds();
  for (const [dx,dy] of preferred) {
    const box={x:p.x+dx-width/2-3,y:p.y+dy-12,w:width+6,h:24};
    if (box.x<5||box.y<5||box.x+box.w>rect.width-5||box.y+box.h>rect.height-5||overlaps(box,occupied)) continue;
    occupied.push(box); return {x:point.x+dx/scale,y:point.y+dy/scale,width};
  }
  return null;
}
function cue(key,position,value,severe,{train,station,leader}) {
  let node=cueNodes.get(key);
  if (!node) {
    const el=make('g',{tabindex:0,role:'button'},cuesLayer),line=make('path',{class:'cue-leader'},el),body=make('g',{},el),rect=make('rect',{},body),label=make('text',{},body);
    node={el,line,body,rect,label}; cueNodes.set(key,node);
  }
  attr(node.el,'class','cue-badge'+(severe?' severe':'')); attr(node.el,'aria-label',value);
  if (train) attr(node.el,'data-cue-train',train); else attr(node.el,'data-cue-station',station);
  attr(node.body,'transform',`translate(${position.x} ${position.y}) scale(${1/scale})`);
  attr(node.rect,'x',-position.width/2); attr(node.rect,'y',-10); attr(node.rect,'width',position.width); attr(node.rect,'height',20); attr(node.rect,'rx',10); text(node.label,value);
  attr(node.line,'d',leader?`M${leader.x} ${leader.y} L${position.x} ${position.y}`:'');
}
function renderCues() {
  if (!network) return;
  const occupied=labelOccupied.slice(), used=new Set(), offsets=[[28,-23],[-28,-23],[34,23],[-34,23],[0,-37],[0,35]];
  let displayed=0;
  for (const train of activeTrains.filter(train=>train.el&&train.position&&train.delay?.seconds>=60).sort((a,b)=>b.delay.seconds-a.delay.seconds)) {
    if(network.lines[train.raw.line].mode==='bus'&&busOverview())continue;
    if (focus==='all'&&displayed>=8) break;
    const value='+'+Math.round(train.delay.seconds/60)+'m',p=placeCue(train.last,value,offsets,occupied); if (!p) continue;
    const key='train:'+train.raw.id; used.add(key); cue(key,p,value,train.delay.seconds>=300,{train:train.raw.id,leader:train.last}); displayed++;
  }
  for (const gap of snapshot?.trips.gaps||[]) {
    if(network.lines[gap.line]?.mode==='bus'&&busOverview()&&gap.station!==selected)continue;
    const stop=network.stations[gap.station];
    if (!stop||!stationNodes.has(gap.station)||!enabledLine(gap.line)||!fresh(gap.timestamp)||gap.nextTime<now()/1000-15) continue;
    const value='◷ '+Math.round(gap.seconds/60)+'m',p=placeCue(stop,value,[[0,28],[32,-23],[-32,-23]],occupied); if (!p) continue;
    const key='station:'+gap.station; used.add(key); cue(key,p,value,false,{station:gap.station});
  }
  for (const [key,node] of cueNodes) if (!used.has(key)) { node.el.remove(); cueNodes.delete(key); }
  cuesDirty=false;
}
function detailRevision() { return [snapshot?.trips.timestamp,snapshot?.vehicles.timestamp,snapshot?.schedule.networkVersion].join('|'); }
async function detail(kind,id) {
  const store=kind==='train'?trainDetails:stationDetails, key=kind+':'+id, revision=detailRevision(), cached=store.get(id);
  if (cached?.revision===revision&&(!cached.error||Date.now()-cached.at<5000)) return cached;
  if (detailRequests.has(key)) return detailRequests.get(key);
  const task=(async()=>{
    try {
      const response=await fetch('/api/'+kind+'?id='+encodeURIComponent(id),{cache:'no-store',signal:AbortSignal.timeout(20000)});
      const value=await response.json();
      store.set(id,{revision,value:response.ok?value:null,error:response.ok?null:response.status===404?'missing':'unavailable',at:Date.now()});
    } catch { store.set(id,{revision,error:'unavailable',at:Date.now()}); }
    finally { detailRequests.delete(key); if (!$('#inspector').hidden&&!$('#station-panel').hidden) renderStation(); }
    return store.get(id);
  })();
  detailRequests.set(key,task); return task;
}
function ensureDetails() {
  if ($('#inspector').hidden||$('#station-panel').hidden) return;
  if (selected) detail('station',selected); if (followed) detail('train',followed);
}
function renderStation() {
  if (!network||!selected) return;
  const stop=network.stations[selected]; if (!stop) return;
  text($('#station-meta'),stop.agencies.map(id=>AGENCY_BY_ID[id].name).join(' · ')+' · live predictions when available');
  const entry=stationDetails.get(selected),departures=entry?.value?.departures||[], rows=departures.filter(value=>fresh(value.timestamp)&&value.time>=now()/1000-15).slice(0,12);
  const empty=!entry?'Loading departures…':entry.error?'Departures could not be loaded. Retrying shortly…':'No fresh departures are reported for this stop right now. Scheduled services may still operate.';
  html($('#departures'),rows.length?rows.map(value=>{
    const meta=network.lines[value.line]; if (!meta) return '';
    return `<div class="departure"><span class="route-dot" style="--route-color:${color(meta.color)}">${esc(meta.name.slice(0,2))}</span><div><h4>${esc(value.headsign)}</h4><small>${esc(AGENCY_BY_ID[meta.agency].short+' · '+meta.name+(value.platform?' · Platform '+value.platform:''))}</small></div><span class="eta">${eta(value.time)}<small>${value.delay>=60?'+'+Math.round(value.delay/60)+'m late':''}</small></span></div>`;
  }).join(''):`<p class="empty-state">${empty}</p>`);
  const gaps=serviceGaps(departures,now()); $('#gap-card').hidden=!gaps.length;
  html($('#gap-details'),gaps.slice(0,3).map(gap=>`<p><strong>${Math.round(gap.seconds/60)} min gap</strong> · ${esc(network.lines[gap.line]?.name||'')} toward ${esc(gap.headsign)}${gap.scheduledSeconds?' · '+Math.round(gap.scheduledSeconds/60)+' min scheduled':''}</p>`).join(''));
  renderTrainCard();
}
function renderTrainCard() {
  $('#train-card').hidden=!followed; if (!followed) return;
  const train=trains.get(followed), list=$('#upcoming-stops');
  if (!train) { text($('#train-name'),'Trip no longer reported'); text($('#train-detail'),'This trip left the latest feed.'); text($('#train-delay'),''); list.replaceChildren(); upcomingRows.clear(); $('#upcoming-empty').hidden=false; text($('#upcoming-empty'),'No current predictions.'); return; }
  if (list.dataset.train!==followed) { list.replaceChildren(); upcomingRows.clear(); list.dataset.train=followed; }
  const meta=network.lines[train.raw.line],entry=trainDetails.get(followed),full=entry?.value?.train;
  text($('#vehicle-label'),'Selected '+(meta.mode==='ferry'?'ferry':meta.mode==='bus'?'bus':'train')); text($('#train-name'),AGENCY_BY_ID[train.raw.agency].short+' · '+train.raw.headsign);
  text($('#train-detail'),train.position?`${train.raw.routeName||meta.name} · ${train.position.method} · source ${age(train.position.timestamp)}.`:'Location source stale or unavailable. The last position is frozen.');
  const delay=train.position?trainDelay(full||train.raw,now()):null;
  text($('#train-delay'),delay?(delay.seconds>=60?'Reported +'+Math.round(delay.seconds/60)+'m late':delay.seconds<0?'Reported early':'Reported on time')+' at '+(network.stations[delay.station]?.name||'next stop')+'.':'Delay not reported for the next stop.');
  attr($('#train-delay'),'class','train-delay'+(delay?.seconds>=300?' severe':delay?.seconds>=60?' late':''));
  const stops=full?remainingStops(full,train.position,now()):[],keys=new Set(); $('#upcoming-empty').hidden=!!stops.length;
  text($('#upcoming-empty'),!entry?'Loading upcoming stops…':entry.error==='missing'?'Trip no longer reported.':entry.error?'Stop details could not be loaded. Retrying shortly…':'No fresh upcoming-stop predictions.');
  stops.forEach((stop,index)=>{
    const key=stop.sequence+':'+stop.station; keys.add(key); let row=upcomingRows.get(key);
    if (!row) {
      const el=document.createElement('li'),button=document.createElement('button'),name=document.createElement('span'),detail=document.createElement('span'),time=document.createElement('span');
      button.className='upcoming-stop'; name.className='stop-name'; detail.className='stop-meta'; time.className='stop-eta'; button.append(name,detail,time); el.append(button); button.addEventListener('click',()=>chooseStation(stop.station));
      row={el,button,name,detail,time}; upcomingRows.set(key,row);
    }
    text(row.name,network.stations[stop.station]?.name||stop.station); text(row.detail,(stop.platform?(stop.platformSource==='scheduled'?'Scheduled platform ':'Platform ')+stop.platform:'Platform not reported')+(stop.time==null?' · ETA unavailable':'')); text(row.time,eta(stop.time));
    attr(row.button,'aria-label',row.name.textContent+', '+row.time.textContent+', '+row.detail.textContent); if (list.children[index]!==row.el) list.insertBefore(row.el,list.children[index]||null);
  });
  for (const [key,row] of upcomingRows) if (!keys.has(key)) { row.el.remove(); upcomingRows.delete(key); }
}
function activeAlerts() { return (snapshot?.alerts.items||[]).filter(alert=>focus==='all'?alert.agencies?.some(enabledAgency)||alert.lines.some(enabledLine):alert.agencies?.includes(focus)||alert.lines.some(enabledLine)); }
function renderStatus() {
  if (!snapshot) return;
  const live=fresh(snapshot.trips.timestamp)||fresh(snapshot.vehicles.timestamp), alerts=activeAlerts();
  text($('#connection-text'),live?'Live '+(focus==='all'?'Bay Area':AGENCY_BY_ID[focus].short):'Feed delayed'); attr($('#connection-dot'),'class','dot '+(live?'live':'stale'));
  $('#alert-count').hidden=!alerts.length; text($('#alert-count'),alerts.length);
  const date=new Date(now()); text($('.clock'),clockFormatter.format(date)); attr($('.clock'),'datetime',date.toISOString());
  if ($('#inspector').hidden||$('#network-panel').hidden) return;
  const revision=[etag,focus,line,live,sourceState(snapshot.alerts.timestamp,now(),900)].join('|');
  if (statusRevision!==revision) {
    statusRevision=revision;
    const count=Object.values(snapshot.trips.byAgency||{}).reduce((sum,value)=>sum+value.positioned,0);
    html($('#status-card'),`<h3>${live?'The Bay Area, in motion.':'Waiting for fresh transit data.'}</h3><p>${live?count+' reported or estimated vehicle positions across seven networks.':'Last positions stay frozen while the feeds recover.'} Choose a network to explore its routes.</p>`);
    html($('#network-health'),AGENCIES.map(agency=>{const count=snapshot.trips.byAgency?.[agency.id]||{}; return `<div class="health-row"><span>${esc(agency.name)}</span><span>${live?count.positioned||0:0} active · ${live?count.reported||0:0} reported</span></div>`;}).join(''));
    html($('#alerts-list'),sourceState(snapshot.alerts.timestamp,now(),900)==='live'?(alerts.length?alerts.map(alert=>`<article class="alert-item"><h4>${esc(alert.header)}</h4><p>${esc(alert.description)}</p></article>`).join(''):'<p class="empty-state">No active alerts are reported for this view.</p>'):'<p class="empty-state">Service alert source is stale or unavailable.</p>');
  }
  text($('#trip-age'),'Stop predictions · '+age(snapshot.trips.timestamp)+(snapshot.trips.error?' · fetch delayed':'')); text($('#vehicle-age'),'Vehicle locations · '+age(snapshot.vehicles.timestamp)+(snapshot.vehicles.error?' · fetch delayed':'')); text($('#alert-age'),'Service alerts · '+age(snapshot.alerts.timestamp));
  text($('#matching'),'All networks share the regional feed. Locations and predictions refresh about every 2½ minutes.'); text($('#schedule-note'),snapshot.schedule.warning||'');
}
function projectNetwork() { network.projectionAngle=innerWidth<=650?0:25; for (const stop of Object.values(network.stations)) Object.assign(stop,project(stop.lat,stop.lon,network.projectionAngle)); }
async function loadNetwork() {
  const response=await fetch('/api/network',{signal:AbortSignal.timeout(20000)}); if (!response.ok) throw Error('Network unavailable');
  network=await response.json(); projectNetwork(); trainDetails.clear(); stationDetails.clear(); buildMap();
}
async function poll() {
  if (fetching||!network) return;
  clearTimeout(pollTimer);
  if (document.hidden&&snapshot) { pollTimer=setTimeout(poll,20000); return; }
  fetching=true;
  try {
    const response=await fetch('/api/live',{cache:'no-store',headers:etag?{'If-None-Match':etag}:{},signal:AbortSignal.timeout(25000)});
    const stamp=Number(response.headers.get('X-Server-Time')); if (stamp>0) clockOffset=stamp-Date.now();
    if (response.status!==304) {
      if (!response.ok) throw Error('Feed unavailable');
      const value=await response.json();
      if (value.schedule.networkVersion!==network.builtAt) { await loadNetwork(); if (!userMoved) fit(); else drawView(true); }
      snapshot=value; if (!(stamp>0)) clockOffset=value.serverTime-Date.now(); etag=response.headers.get('ETag')||'';
      syncTrains(); statusRevision=''; message('');
    }
    for (const train of activeTrains) train.delay=trainDelay(train.raw,now());
    renderVehicles(performance.now()); renderStatus(); if (!$('#inspector').hidden&&!$('#station-panel').hidden) { renderStation(); ensureDetails(); } cuesDirty=true; renderCues(); requestFrame();
  } catch { if (!snapshot) message('The live feed is taking longer to connect. Retrying shortly…'); text($('#connection-text'),'Connection delayed'); attr($('#connection-dot'),'class','dot stale'); }
  finally { fetching=false; pollTimer=setTimeout(poll,20000); }
}
function animate(time) {
  frameHandle=0; if (document.hidden) return;
  if (cameraDirty) drawView(!geometryTimer);
  else if (geometryDirty&&!geometryTimer) drawView(true);
  else if (stationsDirty) layoutStations();
  const moving=!paused&&activeTrains.some(train=>!fresh(train.raw.mapMotion?.anchor?.timestamp)&&fresh(train.raw.timestamp)&&train.raw.mapMotion?.windows.some(window=>window.end>=now()/1000));
  if (vehiclesDirty||moving&&time-lastFrame>=32) { renderVehicles(time); lastFrame=time; }
  if (tickDue) {
    tickDue=false;
    for (const train of activeTrains) train.delay=trainDelay(train.raw,now());
    renderVehicles(time); renderStatus();
    if (!$('#inspector').hidden&&!$('#station-panel').hidden) { renderStation(); ensureDetails(); }
    cuesDirty=true;
  }
  if (cuesDirty) renderCues();
  if (moving||cameraDirty) requestFrame();
}
function localPoint(x,y) { const rect=bounds(); return {x:view.x+(x-rect.left-(rect.width-view.w*scale)/2)/scale,y:view.y+(y-rect.top-(rect.height-view.h*scale)/2)/scale}; }
function scheduleView(zooming=false) {
  cameraDirty=stationsDirty=vehiclesDirty=cuesDirty=true;
  if (zooming) {
    clearTimeout(geometryTimer);
    geometryTimer=setTimeout(()=>{geometryTimer=null;geometryDirty=true;requestFrame();},140);
  }
  requestFrame();
}
function zoom(factor,point) {
  userMoved=true;
  const p=point?localPoint(point.x,point.y):{x:view.x+view.w/2,y:view.y+view.h/2},width=Math.max(12,Math.min(6000,view.w*factor)),ratio=width/view.w;
  view={x:p.x-(p.x-view.x)*ratio,y:p.y-(p.y-view.y)*ratio,w:width,h:view.h*ratio}; scheduleView(true);
  scale=Math.min(bounds().width/view.w,bounds().height/view.h)||1;
}
const pointers=new Map(); let gesture;
function beginGesture() {
  const points=[...pointers.values()];
  gesture=points.length>1?{kind:'pinch',distance:Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y),anchor:localPoint((points[0].x+points[1].x)/2,(points[0].y+points[1].y)/2),view:{...view}}:points.length?{kind:'pan',point:points[0],view:{...view},moved:false}:null;
}
function activate(target) {
  const cluster=target.closest('[data-bus-cluster]'),station=target.closest('[data-station],[data-cue-station]'),train=target.closest('[data-train],[data-cue-train]');
  if(cluster)chooseBusCluster(cluster.dataset.busCluster);
  else if (station) chooseStation(station.dataset.station||station.dataset.cueStation);
  else if (train) chooseTrain(train.dataset.train||train.dataset.cueTrain);
}
map.addEventListener('click',event=>activate(event.target));
map.addEventListener('keydown',event=>{if ((event.key==='Enter'||event.key===' ')&&event.target.closest('.station,.train,.bus-cluster,.cue-badge')) { event.preventDefault(); activate(event.target); }});
map.addEventListener('pointerdown',event=>{if (event.button>0||event.target.closest('.station,.train,.bus-cluster,.cue-badge')) return; pointers.set(event.pointerId,{x:event.clientX,y:event.clientY}); map.setPointerCapture(event.pointerId); beginGesture();});
map.addEventListener('pointermove',event=>{
  if (!pointers.has(event.pointerId)||!gesture) return;
  userMoved=true;
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY}); const points=[...pointers.values()];
  if (gesture.kind==='pinch'&&points.length>1) {
    const width=Math.max(12,Math.min(6000,gesture.view.w*gesture.distance/Math.max(1,Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y))));
    view={x:0,y:0,w:width,h:gesture.view.h*width/gesture.view.w}; scale=Math.min(bounds().width/view.w,bounds().height/view.h);
    const center=localPoint((points[0].x+points[1].x)/2,(points[0].y+points[1].y)/2); view.x=gesture.anchor.x-center.x; view.y=gesture.anchor.y-center.y;
  } else { const dx=event.clientX-gesture.point.x,dy=event.clientY-gesture.point.y; gesture.moved||=Math.hypot(dx,dy)>5; view.x=gesture.view.x-dx/scale; view.y=gesture.view.y-dy/scale; }
  scheduleView(gesture.kind==='pinch');
});
map.addEventListener('pointerup',event=>{const tap=gesture?.kind==='pan'&&!gesture.moved;pointers.delete(event.pointerId);beginGesture();if(tap)closePanel(false);});
map.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);beginGesture();});
map.addEventListener('wheel',event=>{event.preventDefault();zoom(Math.exp(Math.max(-100,Math.min(100,event.deltaY))*.002),{x:event.clientX,y:event.clientY});},{passive:false});
$('#zoom-in').onclick=()=>zoom(.75); $('#zoom-out').onclick=()=>zoom(1/.75); $('#reset').onclick=()=>network&&fit({overview:true});
$('#buses').onclick=()=>{buses=!buses;focus='all';line='all';selected=null;followed=null;closePanel(false);buildLineSelect();scope();updateControls();drawView(true);};
$('#line-select').onchange=event=>chooseLine(event.target.value);
$('#route-clear').onclick=()=>chooseLine('all');
$('#labels').onclick=()=>{labels=!labels;attr($('#labels'),'aria-pressed',labels);attr($('#labels'),'aria-label',labels?'Hide station names':'Show station names');stationsDirty=true;layoutStations();renderCues();};
function togglePause() { paused=!paused;attr($('#pause'),'aria-pressed',paused);attr($('#pause'),'aria-label',paused?'Resume movement':'Pause movement');vehiclesDirty=true;requestFrame(); }
$('#pause').onclick=togglePause;attr($('#pause'),'aria-pressed',paused);attr($('#pause'),'aria-label',paused?'Resume movement':'Pause movement');$('#close-panel').onclick=()=>closePanel();
$('#station-select').onchange=event=>chooseStation(event.target.value);$('#station-search').oninput=()=>populateStations();
$('#station-finder').onclick=()=>{if(!network)return;selected??=activeStations[0]?.id;populateStations();openPanel('station');renderStation();ensureDetails();$('#station-search').focus();};
for (const id of ['service','connection','view-service']) $('#'+id).onclick=()=>openPanel('network');
$('#refresh').onclick=()=>{stationDetails.clear();trainDetails.clear();poll();ensureDetails();};
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closePanel();return;}if(event.target.closest('button,select,input,[role=button]'))return;if(event.code==='Space'){event.preventDefault();togglePause();}if(event.key.toLowerCase()==='l')$('#labels').click();});
new MutationObserver(()=>{
  colors.clear();for(const[id,el]of routeNodes)if(network.lines[id])attr(el,'stroke',color(network.lines[id].color));for(const train of activeTrains)if(train.shape&&train.renderKind!=='dot')attr(train.shape,'fill',color(network.lines[train.raw.line].color));
  statusRevision='';if(!$('#inspector').hidden&&!$('#station-panel').hidden)renderStation();renderStatus();
}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
new ResizeObserver(refreshViewport).observe(map);
addEventListener('resize',refreshViewport);
addEventListener('online',poll);document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshViewport();tickDue=true;vehiclesDirty=true;poll();requestFrame();}});
setInterval(()=>{if(!document.hidden){tickDue=true;requestFrame();}},1000);
async function start(){try{await loadNetwork();fit();await poll();requestFrame();}catch{message('Could not load the transit map. Retrying shortly…');setTimeout(start,10000);}}
document.fonts?.ready.then(()=>{widths.clear();if(network){stationsDirty=true;requestFrame();}});start();
