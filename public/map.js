import {AGENCIES,AGENCY_BY_ID,project,REGIONAL_MAX_AGE} from './networks.js';
import {sourceState,trainDelay,serviceGaps} from './model.js';
import {createMapGeometry,locateTrain,remainingStops} from './regional-geometry.js';
const $=s=>document.querySelector(s),NS='http://www.w3.org/2000/svg';
const make=(tag,attrs={},parent)=>{const el=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);parent?.append(el);return el;};
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const now=()=>Date.now()+clockOffset;
let network,geometry,snapshot,focus='all',line='all',buses=false,labels=true,paused=matchMedia('(prefers-reduced-motion: reduce)').matches,selected=null,followed=null,clockOffset=0,fetching=false,timer,scale=1,lastTick=0,trigger=null;
let view={x:-450,y:0,w:1700,h:2500},stationNodes=new Map(),routeNodes=[],trains=new Map(),cues=[],occupied=[],upcomingRows=new Map();
const canvas=document.createElement('canvas'),measure=canvas.getContext('2d');measure.font='500 12px DM Sans, sans-serif';
const enabledAgency=id=>focus==='all'?(id!=='AC'||buses):id===focus;
const enabledLine=id=>!!network?.lines[id]&&enabledAgency(network.lines[id].agency)&&(line==='all'||id===line);
const enabledStation=s=>s.public!==false&&s.lines.some(enabledLine);
const fresh=t=>sourceState(t,now(),REGIONAL_MAX_AGE)==='live';
const age=stamp=>{if(!stamp)return'unavailable';const seconds=Math.max(0,Math.floor(now()/1000-stamp));return seconds<60?seconds+'s ago':Math.floor(seconds/60)+'m '+seconds%60+'s ago';};
const eta=time=>time==null?'—':Math.max(0,Math.ceil((time-now()/1000)/60))===0?'Now':Math.ceil((time-now()/1000)/60)+'m';
function color(hex){if(document.documentElement.dataset.theme!=='night')return hex;const rgb=hex.replace('#','').match(/../g)?.map(v=>parseInt(v,16));if(!rgb||rgb.length!==3)return hex;return Math.max(...rgb)<175?'#'+rgb.map(v=>Math.round(v*.65+255*.35).toString(16).padStart(2,'0')).join(''):hex;}
function message(text){$('#map-message').hidden=!text;$('#map-message').textContent=text;}
function bounds(){return $('#map').getBoundingClientRect();}
function screen(point){const rect=bounds();return{x:(point.x-view.x)*scale+(rect.width-view.w*scale)/2,y:(point.y-view.y)*scale+(rect.height-view.h*scale)/2};}
function fit(){
 const stops=Object.values(network.stations).filter(enabledStation);if(!stops.length)return;
 const xs=stops.map(s=>s.x),ys=stops.map(s=>s.y),rect=bounds(),mobile=innerWidth<=650;
 const w=Math.max(14,Math.max(...xs)-Math.min(...xs)),h=Math.max(14,Math.max(...ys)-Math.min(...ys));
 const top=mobile?155:180,bottom=mobile?190:165,k=Math.min((rect.width-(mobile?65:140))/w,(rect.height-top-bottom)/h);
 view={x:(Math.max(...xs)+Math.min(...xs))/2-rect.width/k/2,y:(Math.max(...ys)+Math.min(...ys))/2-(top+(rect.height-top-bottom)/2)/k,w:rect.width/k,h:rect.height/k};drawView(true);
}
function drawView(rebuild=true){
 $('#map').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);const rect=bounds();scale=Math.min(rect.width/view.w,rect.height/view.h)||1;
 if(network&&rebuild){geometry=createMapGeometry(network,scale);routeNodes.forEach((el,i)=>{const shape=geometry.shapes[i];el.setAttribute('d',shape.points.map((p,j)=>(j?'L':'M')+p.x+','+p.y).join(' '));});}
 layoutStations();renderVehicles(performance.now());renderCues();
}
function overlaps(rect){return occupied.some(r=>rect.x<r.x+r.w&&rect.x+rect.w>r.x&&rect.y<r.y+r.h&&rect.y+rect.h>r.y);}
function layoutStations(){
 if(!network)return;occupied=[];
 const rect=bounds();occupied.push({x:0,y:0,w:Math.min(360,rect.width*.65),h:155},{x:rect.width-300,y:0,w:300,h:100},{x:0,y:rect.height-155,w:rect.width,h:155});
 const ordered=[...stationNodes].sort(([,a],[,b])=>(Number(b.data.id===selected)*100+Number(b.data.major)*10+b.data.agencies.length)-(Number(a.data.id===selected)*100+Number(a.data.major)*10+a.data.agencies.length));
 for(const[id,node]of ordered){
  const s=node.data,p=screen(s),active=enabledStation(s),detail=focus!=='all'&&focus!=='AC'||scale>1.3;
  const visible=active&&(s.major||detail||id===selected)&&p.x>-20&&p.x<rect.width+20&&p.y>90&&p.y<rect.height-100;
  node.el.setAttribute('visibility',visible?'visible':'hidden');node.el.setAttribute('tabindex',visible?'0':'-1');node.el.setAttribute('aria-hidden',String(!visible));node.label.setAttribute('visibility','hidden');node.el.classList.toggle('selected',id===selected);
  const radius=Math.max(s.agencies.length>1?6.5:s.major?5.5:3.5,((node.lanes||1)-1)*1.5+2.3)/scale;node.shape.setAttribute('r',radius);node.hit.setAttribute('r',Math.max(11/scale,radius));
  if(!visible||!labels)continue;
  measure.font=(s.major?'700':'500')+' 12px DM Sans, sans-serif';
  const name=s.name.replace(/ Station$/i,''),w=measure.measureText(name).width+9,h=17,offset=Math.max(10,radius*scale+4),positions=[[offset,-7],[-w-offset,-7],[-w/2,-offset-14],[-w/2,offset]];
  let placement=null;
  for(const[dx,dy]of positions){const box={x:p.x+dx,y:p.y+dy,w,h};if(box.x<9||box.x+w>rect.width-8||overlaps(box))continue;placement={dx,dy,box};break;}
  if(!placement&&id!==selected)continue;
  placement??={dx:10,dy:-7,box:{x:p.x+10,y:p.y-7,w,h}};
  occupied.push(placement.box);node.label.setAttribute('transform',`translate(${s.x+placement.dx/scale} ${s.y+(placement.dy+12)/scale})`);node.label.setAttribute('font-size',12/scale);node.label.setAttribute('visibility','visible');
 }
}
function buildMap(){
 $('#routes').replaceChildren();$('#stations').replaceChildren();$('#trains').replaceChildren();$('#station-labels').replaceChildren();$('#map-cues').replaceChildren();stationNodes.clear();trains.clear();routeNodes=[];cues=[];
 geometry=createMapGeometry(network,scale);
 const lanes=new Map();for(const e of network.edges)for(const id of [e.a,e.b])lanes.set(id,Math.max(lanes.get(id)||1,e.lines.length));
 for(const shape of geometry.shapes){const meta=network.lines[shape.line];routeNodes.push(make('path',{class:'route '+shape.mode,stroke:color(meta.color),'data-line':shape.line},$('#routes')));}
 for(const s of Object.values(network.stations)){
  const el=make('g',{class:'station'+(s.agencies.length>1?' transfer':''),transform:`translate(${s.x} ${s.y})`,tabindex:0,role:'button','aria-label':s.name+', '+s.agencies.map(a=>AGENCY_BY_ID[a].short).join(', '),'data-station':s.id},$('#stations'));
  make('title',{},el).textContent=s.name;
  const hit=make('circle',{class:'hit'},el),shape=make('circle',{class:'node'},el),label=make('text',{class:'station-label'+(s.major?' major':'')},$('#station-labels'));label.textContent=s.name.replace(/ Station$/i,'');
  const select=()=>chooseStation(s.id);el.addEventListener('click',select);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});stationNodes.set(s.id,{el,shape,label,hit,data:s,lanes:lanes.get(s.id)});
 }
 $('#water').replaceChildren();const coast=[[-122.49,37.82],[-122.43,37.93],[-122.51,38.02],[-122.49,38.10],[-122.28,38.13],[-122.04,38.06],[-122.17,37.96],[-122.32,37.86],[-122.30,37.80],[-122.24,37.75],[-122.12,37.64],[-121.96,37.47],[-122.04,37.43],[-122.18,37.48],[-122.32,37.62],[-122.39,37.75]].map(([lon,lat])=>project(lat,lon,network.projectionAngle));
 make('path',{class:'water',d:coast.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' ')+'Z'},$('#water'));
 buildTabs();buildLineSelect();updateVisibility();
}
function buildTabs(){
 const nav=$('#network-tabs');nav.replaceChildren();
 for(const a of [{id:'all',short:'Bay Area',name:'All rail and ferries',color:'#89969e'},...AGENCIES]){
  const button=document.createElement('button');button.className='network-tab';button.dataset.network=a.id;button.title=a.name;button.setAttribute('aria-pressed',String(focus===a.id));button.style.setProperty('--network-color',a.color);
  const dot=document.createElement('span');dot.className='network-dot';dot.setAttribute('aria-hidden','true');button.append(dot,document.createTextNode(a.short));button.addEventListener('click',()=>chooseNetwork(a.id));nav.append(button);
 }
}
function buildLineSelect(){
 const select=$('#line-select');select.replaceChildren(new Option(focus==='all'?(buses?'All networks':'All rail & ferries'):'All '+AGENCY_BY_ID[focus].short+' routes','all'));
 if(focus!=='all')for(const l of Object.values(network.lines).filter(l=>l.agency===focus).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})))select.add(new Option(l.name,l.id));
 select.value=line;
}
function chooseNetwork(id){focus=id;line='all';if(id==='AC')buses=true;followed=null;closePanel(false);buildLineSelect();updateVisibility();fit();$('#network-tabs [data-network="'+id+'"]').scrollIntoView({block:'nearest',inline:'nearest'});renderStatus();}
function updateVisibility(){
 if(!network)return;
 routeNodes.forEach((el,i)=>{const shape=geometry.shapes[i];el.style.display=enabledLine(shape.line)?'':'none';el.setAttribute('stroke',color(network.lines[shape.line].color));});
 for(const button of document.querySelectorAll('[data-network]'))button.setAttribute('aria-pressed',String(button.dataset.network===focus));
 $('#buses').setAttribute('aria-pressed',String(buses));$('#buses').textContent=buses?'− Buses':'+ Buses';
 $('#view-name').textContent=focus==='all'?'Bay Area, in motion.':AGENCY_BY_ID[focus].name+', in motion.';
 $('#network-caption').textContent=focus==='all'?(buses?'Seven networks · rail, ferries & buses':'Six rail & ferry networks · buses optional'):network.counts[focus].stations+' stops · '+(focus==='AC'?'bus network':AGENCY_BY_ID[focus].name);
 layoutStations();populateStations();renderCues();renderVehicles(performance.now());
}
function populateStations(query=$('#station-search').value){
 if(!network)return;
 const select=$('#station-select'),search=query.trim().toLowerCase();
 const options=Object.values(network.stations).filter(s=>s.public!==false&&(search?(s.name+' '+s.agencies.map(a=>AGENCY_BY_ID[a].name).join(' ')).toLowerCase().includes(search):enabledStation(s))).sort((a,b)=>a.name.localeCompare(b.name));
 const chosen=network.stations[selected];const list=options.slice(0,250);if(chosen&&!list.some(s=>s.id===selected))list.unshift(chosen);
 select.replaceChildren();for(const s of list)select.add(new Option(s.name+' · '+s.agencies.map(a=>AGENCY_BY_ID[a].short).join(' / '),s.id));
 if(!list.length)select.add(new Option('No matching stops',''));select.value=selected||list[0]?.id||'';
}
function openPanel(mode){trigger??=document.activeElement;$('#inspector').hidden=false;document.body.classList.add('inspector-open');$('#station-panel').hidden=mode!=='station';$('#network-panel').hidden=mode!=='network';$('#panel-title').textContent=mode==='station'?'At the platform':'Service & data';for(const id of ['service','connection'])$('#'+id).setAttribute('aria-expanded',String(mode==='network'));$('#station-finder').setAttribute('aria-expanded',String(mode==='station'));}
function closePanel(restore=true){$('#inspector').hidden=true;document.body.classList.remove('inspector-open');for(const id of ['service','connection','station-finder'])$('#'+id).setAttribute('aria-expanded','false');if(restore&&trigger?.isConnected)trigger.focus({preventScroll:true});trigger=null;}
function chooseStation(id,keepTrain=false){const s=network.stations[id];if(!s)return;let changed=false;if(!enabledStation(s)){focus=s.agencies.find(a=>a!=='AC')||'AC';line='all';if(focus==='AC')buses=true;buildLineSelect();updateVisibility();changed=true;}selected=id;if(!keepTrain)followed=null;const p=screen(s),r=bounds();if(changed||p.x<35||p.x>r.width-35||p.y<160||p.y>r.height-160){const w=Math.min(view.w,400),h=w*r.height/r.width;view={x:s.x-w/2,y:s.y-h/2,w,h};drawView();}populateStations();openPanel('station');renderStation();layoutStations();renderCues();}
function chooseTrain(id){const t=trains.get(id);if(!t)return;const stop=t.raw.stops[t.position?.nextIndex??0];if(stop)selected=stop.station;followed=id;populateStations();openPanel('station');renderStation();layoutStations();}
function addTrain(raw){
 const meta=network.lines[raw.line];if(!meta)return null;
 const el=make('g',{class:'train',tabindex:0,role:'button','aria-label':AGENCY_BY_ID[raw.agency].short+' '+raw.headsign,'data-agency':raw.agency},$('#trains'));
 const body=make('g',{},el);make('rect',{class:'vehicle-outline',x:-11,y:-6,width:22,height:12,rx:3},body);
 const shape=meta.mode==='ferry'?'M-10 -4 L7 -4 L11 0 L7 4 L-10 4Z':meta.mode==='bus'?'M-8 -4 H8 V4 H-8Z':'M-10 -4 H10 V4 H-10Z';
 make('path',{class:'vehicle-body',d:shape,fill:color(meta.color)},body);make('path',{class:'vehicle-window',d:'M3 -2 H6 V2 H3Z'},body);
 el.addEventListener('click',()=>chooseTrain(raw.id));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseTrain(raw.id);}});
 return{raw,el,body,last:null,position:null};
}
function syncTrains(){
 const ids=new Set();for(const raw of snapshot.trips.trains){ids.add(raw.id);let t=trains.get(raw.id);if(!t){t=addTrain(raw);if(t)trains.set(raw.id,t);}if(t)t.raw=raw;}
 for(const[id,t]of trains)if(!ids.has(id)){t.el.remove();trains.delete(id);}
}
function renderVehicles(time){
 if(!network||!geometry)return;let count=0;
 for(const t of trains.values()){
  if(!enabledLine(t.raw.line)){t.el.setAttribute('visibility','hidden');t.el.setAttribute('tabindex','-1');continue;}
  const position=locateTrain(t.raw,network,geometry,now());
  if(position){if(!paused||!t.last)t.last=position;t.position=position;}else t.position=null;
  if(!t.last){t.el.setAttribute('visibility','hidden');t.el.setAttribute('tabindex','-1');continue;}
  const freshPosition=!!position;t.el.classList.toggle('stale',!freshPosition);t.el.setAttribute('visibility','visible');t.el.setAttribute('tabindex','0');
  t.el.setAttribute('transform',`translate(${t.last.x} ${t.last.y})`);t.body.setAttribute('transform',`scale(${(focus==='all'?.6:1)/scale}) rotate(${t.last.angle})`);
  t.body.querySelector('.vehicle-body').setAttribute('fill',color(network.lines[t.raw.line].color));
  const delay=freshPosition?trainDelay(t.raw,now()):null;t.delay=delay;t.el.classList.toggle('late',delay?.seconds>=60);t.el.classList.toggle('severe',delay?.seconds>=300);
  if(freshPosition)count++;
 }
 $('#train-count').textContent=count;
}
function badge(x,y,text,severe,onClick){
 const width=Math.max(28,text.length*6.5+12),el=make('g',{class:'cue-badge'+(severe?' severe':''),transform:`translate(${x} ${y}) scale(${1/scale})`,tabindex:0,role:'button','aria-label':text},$('#map-cues'));
 make('rect',{x:-width/2,y:-10,width,height:20,rx:10},el);make('text',{},el).textContent=text;el.addEventListener('click',onClick);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onClick();}});return el;
}
function placeCue(point,text,preferred){
 const p=screen(point),width=Math.max(28,text.length*6.5+12),rect=bounds();
 for(const[dx,dy]of preferred){const box={x:p.x+dx-width/2-3,y:p.y+dy-12,w:width+6,h:24};if(box.x<5||box.x+box.w>rect.width-5||overlaps(box))continue;occupied.push(box);return{x:point.x+dx/scale,y:point.y+dy/scale};}return null;
}
function renderCues(){
 if(!network)return;$('#map-cues').replaceChildren();layoutStations();
 const offsets=[[28,-23],[-28,-23],[34,23],[-34,23],[0,-37],[0,35]];
 let displayed=0;for(const t of [...trains.values()].sort((a,b)=>(b.delay?.seconds||0)-(a.delay?.seconds||0))){
  if(!t.position||!enabledLine(t.raw.line)||!(t.delay?.seconds>=60))continue;
  if(focus==='all'&&displayed>=8)break;
  const text='+'+Math.round(t.delay.seconds/60)+'m',p=placeCue(t.last,text,offsets);if(!p)continue;
  make('path',{class:'cue-leader',d:`M${t.last.x} ${t.last.y} L${p.x} ${p.y}`},$('#map-cues'));badge(p.x,p.y,text,t.delay.seconds>=300,()=>chooseTrain(t.raw.id));displayed++;
 }
 for(const[id,list]of Object.entries(snapshot?.trips.departures||{})){
  const s=network.stations[id];if(!s||!enabledStation(s)||stationNodes.get(id)?.el.getAttribute('visibility')!=='visible')continue;
  const gap=serviceGaps(list.filter(d=>enabledLine(d.line)),now())[0];if(!gap)continue;
  const text='◷ '+Math.round(gap.seconds/60)+'m',p=placeCue(s,text,[[0,28],[32,-23],[-32,-23]]);if(p)badge(p.x,p.y,text,false,()=>chooseStation(id));
 }
}
function renderStation(){
 if(!network||!selected)return;
 const station=network.stations[selected];if(!station)return;
 $('#station-meta').textContent=station.agencies.map(a=>AGENCY_BY_ID[a].name).join(' · ')+' · live predictions when available';
 const rows=(snapshot?.trips.departures[selected]||[]).filter(d=>fresh(d.timestamp)&&d.time>=now()/1000-15).slice(0,12);
 $('#departures').innerHTML=rows.length?rows.map(d=>{const l=network.lines[d.line];return `<div class="departure"><span class="route-dot" style="--route-color:${color(l.color)}">${esc(l.name.slice(0,2))}</span><div><h4>${esc(d.headsign)}</h4><small>${esc(AGENCY_BY_ID[l.agency].short+' · '+l.name+(d.platform?' · Platform '+d.platform:''))}</small></div><span class="eta">${eta(d.time)}<small>${d.delay>=60?'+'+Math.round(d.delay/60)+'m late':''}</small></span></div>`;}).join(''):'<p class="empty-state">No fresh departures are reported for this stop right now. Scheduled services may still operate.</p>';
 const gaps=serviceGaps(rows,now());$('#gap-card').hidden=!gaps.length;$('#gap-details').innerHTML=gaps.slice(0,3).map(g=>`<p><strong>${Math.round(g.seconds/60)} min gap</strong> · ${esc(network.lines[g.line]?.name||'')} toward ${esc(g.headsign)}${g.scheduledSeconds?' · '+Math.round(g.scheduledSeconds/60)+' min scheduled':''}</p>`).join('');
 renderTrainCard();
}
function renderTrainCard(){
 $('#train-card').hidden=!followed;if(!followed)return;
 const t=trains.get(followed),list=$('#upcoming-stops');
 if(!t){$('#train-name').textContent='Trip no longer reported';$('#train-detail').textContent='This trip left the latest feed.';$('#train-delay').textContent='';list.replaceChildren();upcomingRows.clear();$('#upcoming-empty').hidden=false;$('#upcoming-empty').textContent='No current predictions.';return;}
 if(list.dataset.train!==followed){list.replaceChildren();upcomingRows.clear();list.dataset.train=followed;}
 const meta=network.lines[t.raw.line];$('#vehicle-label').textContent='Selected '+(meta.mode==='ferry'?'ferry':meta.mode==='bus'?'bus':'train');$('#train-name').textContent=AGENCY_BY_ID[t.raw.agency].short+' · '+t.raw.headsign;
 $('#train-detail').textContent=t.position?`${t.raw.routeName||meta.name} · ${t.position.method} · source ${age(t.position.timestamp)}.`:'Location source stale or unavailable. The last position is frozen.';
 const delay=t.position?trainDelay(t.raw,now()):null;$('#train-delay').textContent=delay?(delay.seconds>=60?'Reported +'+Math.round(delay.seconds/60)+'m late':delay.seconds<0?'Reported early':'Reported on time')+' at '+(network.stations[delay.station]?.name||'next stop')+'.':'Delay not reported for the next stop.';$('#train-delay').className='train-delay'+(delay?.seconds>=300?' severe':delay?.seconds>=60?' late':'');
 const stops=remainingStops(t.raw,t.position,now()),keys=new Set();$('#upcoming-empty').hidden=!!stops.length;$('#upcoming-empty').textContent='No fresh upcoming-stop predictions.';
 stops.forEach((stop,index)=>{const key=stop.sequence+':'+stop.station;keys.add(key);let row=upcomingRows.get(key);
  if(!row){const el=document.createElement('li'),button=document.createElement('button'),name=document.createElement('span'),detail=document.createElement('span'),time=document.createElement('span');button.className='upcoming-stop';name.className='stop-name';detail.className='stop-meta';time.className='stop-eta';button.append(name,detail,time);el.append(button);button.addEventListener('click',()=>chooseStation(stop.station));row={el,button,name,detail,time};upcomingRows.set(key,row);}
  row.name.textContent=network.stations[stop.station]?.name||stop.station;row.detail.textContent=(stop.platform?(stop.platformSource==='scheduled'?'Scheduled platform ':'Platform ')+stop.platform:'Platform not reported')+(stop.time==null?' · ETA unavailable':'');row.time.textContent=eta(stop.time);row.button.setAttribute('aria-label',row.name.textContent+', '+row.time.textContent+', '+row.detail.textContent);if(list.children[index]!==row.el)list.insertBefore(row.el,list.children[index]||null);
 });
 for(const[key,row]of upcomingRows)if(!keys.has(key)){row.el.remove();upcomingRows.delete(key);}
}
function activeAlerts(){return(snapshot?.alerts.items||[]).filter(a=>focus==='all'?a.agencies?.some(enabledAgency)||a.lines.some(enabledLine):a.agencies?.includes(focus)||a.lines.some(enabledLine));}
function renderStatus(){
 if(!snapshot)return;const live=fresh(snapshot.trips.timestamp)||fresh(snapshot.vehicles.timestamp),alerts=activeAlerts(),count=Object.values(snapshot.trips.byAgency||{}).reduce((sum,a)=>sum+a.positioned,0);
 $('#connection-text').textContent=live?'Live '+(focus==='all'?'Bay Area':AGENCY_BY_ID[focus].short):'Feed delayed';$('#connection-dot').className='dot '+(live?'live':'stale');
 $('#alert-count').hidden=!alerts.length;$('#alert-count').textContent=alerts.length;
 $('#status-card').innerHTML=`<h3>${live?'The Bay Area, in motion.':'Waiting for fresh transit data.'}</h3><p>${live?count+' reported or estimated vehicle positions across seven networks.':'Last positions stay frozen while the feeds recover.'} Choose a network to explore its routes.</p>`;
 $('#network-health').innerHTML=AGENCIES.map(a=>{const list=[...trains.values()].filter(t=>t.raw.agency===a.id),reported=list.filter(t=>t.raw.position&&fresh(t.raw.position.timestamp)).length,positioned=list.filter(t=>t.raw.position&&fresh(t.raw.position.timestamp)||sourceState(t.raw.timestamp,now(),180)==='live'&&t.raw.stops.some(s=>(s.departure??s.arrival)>=now()/1000)).length;return `<div class="health-row"><span>${esc(a.name)}</span><span>${live?positioned:0} active · ${live?reported:0} reported</span></div>`;}).join('');
 $('#alerts-list').innerHTML=sourceState(snapshot.alerts.timestamp,now(),900)==='live'?(alerts.length?alerts.map(a=>`<article class="alert-item"><h4>${esc(a.header)}</h4><p>${esc(a.description)}</p></article>`).join(''):'<p class="empty-state">No active alerts are reported for this view.</p>'):'<p class="empty-state">Service alert source is stale or unavailable.</p>';
 $('#trip-age').textContent='Stop predictions · '+age(snapshot.trips.timestamp)+(snapshot.trips.error?' · fetch delayed':'');$('#vehicle-age').textContent='Vehicle locations · '+age(snapshot.vehicles.timestamp)+(snapshot.vehicles.error?' · fetch delayed':'');$('#alert-age').textContent='Service alerts · '+age(snapshot.alerts.timestamp);$('#matching').textContent='All networks share the regional feed. Locations and predictions refresh about every 2½ minutes.';$('#schedule-note').textContent=snapshot.schedule.warning||'';
 const date=new Date(now());$('.clock').textContent=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);$('.clock').setAttribute('datetime',date.toISOString());
}
function projectNetwork(){network.projectionAngle=innerWidth<=650?0:25;for(const s of Object.values(network.stations))Object.assign(s,project(s.lat,s.lon,network.projectionAngle));}
async function loadNetwork(){const r=await fetch('/api/network',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Network unavailable');network=await r.json();projectNetwork();buildMap();}
async function poll(){
 if(fetching||!network)return;fetching=true;clearTimeout(timer);
 try{const response=await fetch('/api/live',{cache:'no-store',signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('Feed unavailable');const value=await response.json();if(value.schedule.networkVersion!==network.builtAt)await loadNetwork();snapshot=value;clockOffset=snapshot.serverTime-Date.now();syncTrains();message('');renderVehicles(performance.now());renderStatus();renderStation();renderCues();}
 catch{if(!snapshot)message('The live feed is taking longer to connect. Retrying shortly…');$('#connection-text').textContent='Connection delayed';$('#connection-dot').className='dot stale';}
 finally{fetching=false;timer=setTimeout(poll,20000);}
}
function animate(time){renderVehicles(time);if(time-lastTick>1000){lastTick=time;renderStatus();if(!$('#inspector').hidden)renderStation();renderCues();}requestAnimationFrame(animate);}
function localPoint(x,y){const rect=bounds();return{x:view.x+(x-rect.left-(rect.width-view.w*scale)/2)/scale,y:view.y+(y-rect.top-(rect.height-view.h*scale)/2)/scale};}
function zoom(factor,point){const p=point?localPoint(point.x,point.y):{x:view.x+view.w/2,y:view.y+view.h/2},w=Math.max(12,Math.min(6000,view.w*factor)),ratio=w/view.w;view={x:p.x-(p.x-view.x)*ratio,y:p.y-(p.y-view.y)*ratio,w,h:view.h*ratio};drawView();}
const pointers=new Map();let gesture;
function beginGesture(){const p=[...pointers.values()];gesture=p.length>1?{kind:'pinch',distance:Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y),anchor:localPoint((p[0].x+p[1].x)/2,(p[0].y+p[1].y)/2),view:{...view}}:p.length?{kind:'pan',point:p[0],view:{...view},moved:false}:null;}
$('#map').addEventListener('pointerdown',e=>{if(e.button>0||e.target.closest('.station,.train,.cue-badge'))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});$('#map').setPointerCapture(e.pointerId);beginGesture();});
$('#map').addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId)||!gesture)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const p=[...pointers.values()];if(gesture.kind==='pinch'&&p.length>1){const w=Math.max(12,Math.min(6000,gesture.view.w*gesture.distance/Math.max(1,Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y))));view={x:0,y:0,w,h:gesture.view.h*w/gesture.view.w};scale=Math.min(bounds().width/view.w,bounds().height/view.h);const c=localPoint((p[0].x+p[1].x)/2,(p[0].y+p[1].y)/2);view.x=gesture.anchor.x-c.x;view.y=gesture.anchor.y-c.y;}else{const dx=e.clientX-gesture.point.x,dy=e.clientY-gesture.point.y;gesture.moved||=Math.hypot(dx,dy)>5;view.x=gesture.view.x-dx/scale;view.y=gesture.view.y-dy/scale;}drawView(gesture.kind==='pinch');});
$('#map').addEventListener('pointerup',e=>{const tap=gesture?.kind==='pan'&&!gesture.moved;pointers.delete(e.pointerId);beginGesture();if(tap)closePanel(false);});$('#map').addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);beginGesture();});
$('#map').addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(Math.max(-100,Math.min(100,e.deltaY))*.002),{x:e.clientX,y:e.clientY});},{passive:false});
$('#zoom-in').onclick=()=>zoom(.75);$('#zoom-out').onclick=()=>zoom(1.33);$('#reset').onclick=()=>network&&fit();
 $('#buses').onclick=()=>{buses=!buses;focus='all';line='all';buildLineSelect();updateVisibility();fit();};$('#line-select').onchange=e=>{line=e.target.value;updateVisibility();fit();};
$('#labels').onclick=()=>{labels=!labels;$('#labels').setAttribute('aria-pressed',String(labels));$('#labels').setAttribute('aria-label',labels?'Hide station names':'Show station names');layoutStations();};
function togglePause(){paused=!paused;$('#pause').setAttribute('aria-pressed',String(paused));$('#pause').setAttribute('aria-label',paused?'Resume movement':'Pause movement');}
$('#pause').onclick=togglePause;$('#pause').setAttribute('aria-pressed',String(paused));$('#pause').setAttribute('aria-label',paused?'Resume movement':'Pause movement');$('#close-panel').onclick=()=>closePanel();$('#station-select').onchange=e=>chooseStation(e.target.value);$('#station-search').oninput=()=>populateStations();$('#station-finder').onclick=()=>{if(!network)return;selected??=Object.values(network.stations).find(enabledStation)?.id;populateStations();openPanel('station');renderStation();$('#station-search').focus();};
for(const id of ['service','connection','view-service'])$('#'+id).onclick=()=>{openPanel('network');renderStatus();};$('#refresh').onclick=poll;
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closePanel();return;}if(e.target.closest('button,select,input,[role=button]'))return;if(e.code==='Space'){e.preventDefault();togglePause();}if(e.key.toLowerCase()==='l')$('#labels').click();});
new MutationObserver(()=>updateVisibility()).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});addEventListener('resize',()=>{if(!network)return;if(network.projectionAngle!==(innerWidth<=650?0:25)){projectNetwork();buildMap();if(snapshot)syncTrains();fit();}else drawView();});addEventListener('online',poll);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
async function start(){try{await loadNetwork();fit();await poll();requestAnimationFrame(animate);}catch{message('Could not load the transit map. Retrying shortly…');setTimeout(start,10000);}}
document.fonts?.ready.then(()=>{if(network)drawView(false);});start();
