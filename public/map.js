import {inferSegment,sourceState,TRIP_MAX_AGE,ALERT_MAX_AGE,upcomingStops,trainDelay,serviceGaps} from '/model.js';
import {buildNetworkGeometry} from '/geometry.js';
const NS='http://www.w3.org/2000/svg';
const $=s=>document.querySelector(s);
const make=(tag,attrs={},parent)=>{const e=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));if(parent)parent.appendChild(e);return e};
const stationData=[
 ['EMBR','Embarcadero',350,400,'square',true,-18,-24],['MONT','Montgomery Street',325,425,'circle',false],['POWL','Powell Street',300,450,'circle',true,-21,-13],['CIVC','Civic Center / UN Plaza',275,475,'circle',false],['16TH','16th Street / Mission',250,500,'circle',false],['24TH','24th Street / Mission',225,525,'circle',true,-21,-13],['GLEN','Glen Park',200,550,'circle',false],['BALB','Balboa Park',175,575,'circle',false],['DALY','Daly City',150,600,'diamond',true,-18,29],['COLM','Colma',150,640,'circle',false],['SSAN','South San Francisco',185,675,'circle',false],['SBRN','San Bruno',220,710,'circle',false],['SFIA','SFO Airport',300,710,'diamond',true,18,4],['MLBR','Millbrae',255,745,'diamond',true,19,5],
 ['WOAK','West Oakland',535,400,'circle',true,-15,32],['12TH','12th Street / Oakland City Center',620,360,'circle',false],['19TH','19th Street Oakland',620,320,'circle',false],['MCAR','MacArthur',620,280,'square',true,22,6],['ASHB','Ashby',575,235,'circle',false],['DBRK','Downtown Berkeley',530,190,'circle',true,-20,4],['NBRK','North Berkeley',530,150,'circle',false],['PLZA','El Cerrito Plaza',530,110,'circle',false],['DELN','El Cerrito del Norte',530,70,'circle',false],['RICH','Richmond',530,30,'diamond',true,-20,5],
 ['ROCK','Rockridge',665,235,'circle',false],['ORIN','Orinda',710,190,'circle',false],['LAFY','Lafayette',755,145,'circle',false],['WCRK','Walnut Creek',800,100,'circle',true,-12,-24],['PHIL','Pleasant Hill',845,100,'circle',false],['CONC','Concord',890,100,'circle',true,0,32],['NCON','North Concord',935,100,'circle',false],['PITT','Pittsburg / Bay Point',980,100,'square',false],['PCTR','Pittsburg Center',1025,100,'circle',false],['ANTC','Antioch',1070,100,'diamond',true,0,-24],
 ['LAKE','Lake Merritt',655,435,'circle',true,22,5],['FTVL','Fruitvale',690,470,'circle',false],['COLS','Coliseum',725,505,'square',true,21,-10],['OAKL','OAK Airport',660,570,'diamond',false],['SANL','San Leandro',760,540,'circle',false],['BAYF','Bay Fair',795,575,'square',true,-18,9],['CAST','Castro Valley',855,575,'circle',false],['WDUB','West Dublin / Pleasanton',915,575,'circle',false],['DUBL','Dublin / Pleasanton',975,575,'diamond',true,0,-24],['HAYW','Hayward',795,615,'circle',false],['SHAY','South Hayward',795,655,'circle',false],['UCTY','Union City',835,695,'circle',false],['FRMT','Fremont',875,735,'circle',true,21,5],['WARM','Warm Springs / South Fremont',915,775,'circle',false],['MLPT','Milpitas',955,815,'circle',false],['BERY','Berryessa / North San Jose',995,855,'diamond',true,-18,-22]
];
const stations=Object.fromEntries(stationData.map(s=>[s[0],{id:s[0],name:s[1],x:s[2],y:s[3],shape:s[4],major:s[5],dx:s[6]??18,dy:s[7]??5}]));
const coords={...stations,_WYE:{x:620,y:400}};
const sf=['DALY','BALB','GLEN','24TH','16TH','CIVC','POWL','MONT','EMBR','WOAK','_WYE'];
const north=['12TH','19TH','MCAR'];
const rich=['ASHB','DBRK','NBRK','PLZA','DELN','RICH'];
const south=['LAKE','FTVL','COLS','SANL','BAYF','HAYW','SHAY','UCTY','FRMT','WARM','MLPT','BERY'];
const definitions=[
 {id:'yellow',name:'Yellow',color:'#edc63b',laneOrder:-10.5,ids:['SFIA','SBRN','SSAN','COLM',...sf,...north,'ROCK','ORIN','LAFY','WCRK','PHIL','CONC','NCON','PITT','PCTR','ANTC'],ends:['SFO Airport','Antioch']},
 {id:'red',name:'Red',color:'#e94e48',laneOrder:-3.5,ids:['MLBR','SBRN','SSAN','COLM',...sf,...north,...rich],ends:['Millbrae','Richmond']},
 {id:'blue',name:'Blue',color:'#3989c6',laneOrder:10.5,ids:[...sf,...south.slice(0,5),'CAST','WDUB','DUBL'],ends:['Daly City','Dublin / Pleasanton']},
 {id:'green',name:'Green',color:'#36a578',laneOrder:3.5,ids:[...sf,...south],ends:['Daly City','Berryessa']},
 {id:'orange',name:'Orange',color:'#ed8b38',laneOrder:-3.5,ids:['RICH',...rich.slice(0,-1).reverse(),'MCAR','19TH','12TH','_WYE',...south],ends:['Richmond','Berryessa']}
];
// This module is appended to map.js by the build preparation script.
let focusLine='all',selectedStation='EMBR',paused=matchMedia('(prefers-reduced-motion: reduce)').matches,labels=true,followed=null,inspectorTrigger=null,selectedGapKey=null;
let snapshot=null,clockOffset=0,fetching=false,pollTimer=null,lastStatus='',lastPanelUpdate=0;
const trains=new Map(),gapsByStation=new Map(),upcomingRows=new Map();
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const now=()=>Date.now()+clockOffset;
const empty=(parent,text)=>{const p=document.createElement('p');p.className='empty-state';p.textContent=text;parent.appendChild(p)};
const setHTML=(el,html)=>{if(el.innerHTML!==html)el.innerHTML=html};
const network=buildNetworkGeometry(definitions,coords,{branches:[
 {line:'yellow',ids:['SFIA','MLBR']},
 {line:'red',ids:['SFIA','MLBR']},
 {line:'red',ids:['SBRN','SFIA']},
 {line:'yellow',ids:['SBRN','MLBR']}
]});
function drawRoute(geometry,attributes={}){
 return make('path',{d:geometry.points.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' '),class:'route',...attributes},$('#routes'));
}
definitions.forEach(r=>{
 r.geometry=network.routes.get(r.id);r.points=r.geometry.points;r.distances=r.geometry.distances;
 r.path=drawRoute(r.geometry,{stroke:r.color,'data-route':r.id});r.length=r.path.getTotalLength();
 r.branches=network.branches.filter(branch=>branch.line===r.id).map(branch=>({...branch,path:drawRoute(branch,{stroke:r.color,'data-airport-line':r.id})}));
});
make('path',{d:'M725 505 L660 570',stroke:'#a0a6a9','stroke-dasharray':'3 7',class:'route connector'},$('#routes'));
const friendly={MONT:'Montgomery St',POWL:'Powell St','16TH':'16th St / Mission','24TH':'24th St / Mission','12TH':'12th St','19TH':'19th St',WARM:'Warm Springs',BERY:'Berryessa / North San José',OAKL:'Oakland Airport'};
const sfLabels=new Set(['MONT','POWL','CIVC','16TH','24TH','GLEN','BALB','DALY','COLM','SSAN']);
const richLabels=new Set(['RICH','DELN','PLZA','NBRK','DBRK','ASHB']);
const angledLabels=new Set(['WCRK','PHIL','CONC','NCON','PITT','PCTR','ANTC','CAST','WDUB','DUBL']);
function labelPosition(id,phone=false){
 let position={x:24,y:6,anchor:'start',angle:0};
 if(sfLabels.has(id)||richLabels.has(id)||['SBRN','OAKL','BAYF','BERY'].includes(id))position={x:-24,y:6,anchor:'end',angle:0};
 if(angledLabels.has(id))position={x:4,y:-24,anchor:'start',angle:-45};
 if(id==='CAST')position={x:4,y:-56,anchor:'start',angle:-45,leader:'M0 -18 L0 -45 L4 -48'};
 if(id==='EMBR')position={x:-24,y:-24,anchor:'end',angle:0};
 if(id==='WOAK')position={x:0,y:-28,anchor:'middle',angle:0};
 if(id==='MLBR')position={x:24,y:18,anchor:'start',angle:0};
 if(phone){
  if(sfLabels.has(id))position={x:24,y:6,anchor:'start',angle:0};
  if(['12TH','19TH','MCAR'].includes(id))position={x:-24,y:6,anchor:'end',angle:0};
  if(id==='ROCK')position={x:30,y:-66,anchor:'end',angle:0,leader:'M0 -18 L0 -48 L15 -60'};
  if(id==='WOAK')position={x:-24,y:-25,anchor:'end',angle:0};
  if(id==='SBRN')position={x:12,y:42,anchor:'end',angle:0,leader:'M-12 12 L-28 17 L-72 17'};
  if(id==='LAKE')position={x:-24,y:22,anchor:'end',angle:0};
  if(id==='FTVL')position={x:-24,y:30,anchor:'end',angle:0};
 }
 return position;
}
stationData.forEach(([id])=>{
 const s=stations[id],g=make('g',{class:'station'+(id===selectedStation?' selected':''),transform:`translate(${s.x} ${s.y})`,tabindex:0,role:'button','aria-label':s.name+' station, show live departures','data-station':id},$('#stations'));
 make('title',{},g).textContent=s.name;make('circle',{class:'hit',r:23},g);make('circle',{class:'selection',r:21},g);
 if(['RICH','ANTC','SFIA','DUBL','OAKL','BERY'].includes(id))make('path',{class:'node',d:'M0 -15 L14 11 L-14 11Z'},g);
 else if(s.shape==='circle')make('circle',{class:'node',r:12.5},g);
 else make('rect',{class:'node',x:-12,y:-12,width:24,height:24,rx:0,transform:s.shape==='diamond'?'rotate(45)':''},g);
 s.leader=make('path',{class:'label-leader'},g);
 const label=make('text',{class:'station-label'+(s.major?' major':''),'data-label':id},g);label.textContent=friendly[id]||s.name;s.label=label;
 g.addEventListener('click',()=>chooseStation(id));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseStation(id)}});s.el=g;s.gapBadge=createCueBadge('gap',()=>{if(s.gapBadge.gap)chooseStation(id,{gapKey:s.gapBadge.gap.key})});
});
Object.values(stations).sort((a,b)=>a.name.localeCompare(b.name)).forEach(s=>{const opt=document.createElement('option');opt.value=s.id;opt.textContent=s.name;$('#station-select').appendChild(opt)});
function openInspector(mode,trigger=document.activeElement){
 const wasHidden=$('#inspector').hidden;
 if(wasHidden)inspectorTrigger=trigger;
 $('#inspector').hidden=false;document.body.classList.add('inspector-open');
 $('#station-panel').hidden=mode!=='station';$('#network-panel').hidden=mode!=='network';
 $('#panel-title').textContent=mode==='station'?'At the platform':'Service & data';
 $('#station-finder').setAttribute('aria-expanded',mode==='station');
 for(const id of ['service','connection'])$('#'+id).setAttribute('aria-expanded',mode==='network');
 if(wasHidden||mode==='network')$('#close-panel').focus({preventScroll:true});
}
function closeInspector(){
 $('#inspector').hidden=true;document.body.classList.remove('inspector-open');
 for(const id of ['service','connection','station-finder'])$('#'+id).setAttribute('aria-expanded','false');
 if(inspectorTrigger?.isConnected)inspectorTrigger.focus({preventScroll:true});layoutCues();
}
function chooseStation(id,{open=true,keepTrain=false,gapKey=null}={}){
 if(!stations[id])return;selectedGapKey=gapKey;
 stations[selectedStation].el.classList.remove('selected');selectedStation=id;stations[id].el.classList.add('selected');$('#station-select').value=id;
 if(!keepTrain){followed=null;$('#train-card').hidden=true;for(const t of trains.values())t.el.classList.remove('followed')}
 if(open)openInspector('station',stations[id].el);
 renderDepartures();renderStatus();layoutCues();
}
function predictionStatus(){return snapshot?sourceState(snapshot.trips.timestamp,now()):'unavailable'}
function renderDepartures(){
 renderGapCard();const ds=$('#departures');ds.replaceChildren();
 const available=definitions.filter(r=>r.ids.includes(selectedStation)||(['red','yellow'].includes(r.id)&&['SFIA','MLBR'].includes(selectedStation)));
 $('#station-meta').textContent=available.length?`${available.length} ${available.length===1?'line':'lines'} · live departures`:'Airport connector · no live arrivals';
 if(selectedStation==='OAKL'){empty(ds,'BART does not publish live arrivals for the airport connector.');return}
 if(!snapshot){empty(ds,'Connecting to BART…');return}
 if(predictionStatus()!=='live'){empty(ds,'Fresh departure predictions are unavailable. Retrying automatically.');return}
 const items=(snapshot.trips.departures[selectedStation]||[]).filter(d=>d.time>=now()/1000-15&&sourceState(d.timestamp,now())==='live').slice(0,6);
 if(!items.length){empty(ds,['PCTR','ANTC'].includes(selectedStation)?'BART publishes limited matching data for this branch. No verified departure is available.':'No verified departures in the next 90 minutes.');return}
 items.forEach(d=>{
  const route=definitions.find(r=>r.id===d.line);if(!route)return;
  const row=document.createElement('div');row.className='departure';
  const seconds=d.time-now()/1000;const eta=seconds<=20?'Due':Math.ceil(seconds/60);
  row.innerHTML=`<span class="route-dot" style="background:${route.color}"></span><div><div class="destination">${esc(d.headsign)}</div><div class="direction">${route.name} line${d.platform?' · platform '+esc(d.platform):''}</div></div><span class="eta">${eta}${typeof eta==='number'?'<small>min</small>':''}</span>`;
  ds.appendChild(row);
 });
}
function ageLabel(timestamp){if(!timestamp)return 'Unavailable';const age=Math.max(0,Math.floor(now()/1000-timestamp));return age<60?`${age}s ago`:`${Math.floor(age/60)}m ${age%60}s ago`}
function renderStatus(){
 const status=predictionStatus(),alertsStatus=snapshot?sourceState(snapshot.alerts.timestamp,now(),ALERT_MAX_AGE):'unavailable';
 $('#connection').className='connection '+status;
 $('#connection-text').textContent=!snapshot?'Connecting':status==='live'?(snapshot.trips.error?'Reconnecting':'Live BART'):status==='stale'?'Source stale':'Feed unavailable';
 document.body.classList.toggle('stale-feed',status!=='live');
 $('#map-key-text').textContent=status==='live'?(paused?'Motion paused · estimates':'Estimated train positions'):status==='stale'?'Source stale · motion frozen':'Waiting for live data';
 $('#train-count').textContent=status==='live'?snapshot.trips.counts.positionedTrips:'—';
 const advisoryCount=alertsStatus==='live'?snapshot.alerts.items.length:null;
 $('#advisory-count').hidden=advisoryCount===0||!snapshot;
 $('#advisory-count').textContent=advisoryCount===null?'!':String(advisoryCount);
 $('#service').setAttribute('aria-label',advisoryCount===null?'Service and data status. Alert feed unavailable':`Service and data status. ${advisoryCount} active ${advisoryCount===1?'advisory':'advisories'}`);
 $('#trip-age').textContent=ageLabel(snapshot?.trips.timestamp);$('#alert-age').textContent=ageLabel(snapshot?.alerts.timestamp);
 $('#trip-age').title=snapshot?.trips.fetchedAt?'Last fetched '+new Date(snapshot.trips.fetchedAt).toISOString():'';
 $('#alert-age').title=snapshot?.alerts.fetchedAt?'Last fetched '+new Date(snapshot.alerts.fetchedAt).toISOString():'';
 const c=$('#status-card');c.className='status-card'+(status!=='live'?' stale':'');
 if(!snapshot)setHTML(c,'<h3>Connecting to the source</h3><p>No train estimates are shown until BART provides a fresh feed.</p>');
 else if(status!=='live')setHTML(c,`<h3>${status==='stale'?'Source data is stale':'The live feed is unavailable'}</h3><p>${esc(snapshot.trips.error||'The source timestamp is outside the freshness window.')} Estimates ${trains.size?'are frozen':'will appear when fresh data returns'}.</p>`);
 else if(alertsStatus!=='live')setHTML(c,'<h3>Departures are live</h3><p>Service-alert data is unavailable or stale. The absence of alert markers does not establish normal service.</p>');
 else if(snapshot.alerts.items.length)setHTML(c,`<h3>${snapshot.alerts.items.length} active service ${snapshot.alerts.items.length===1?'advisory':'advisories'}</h3><p>Read BART’s notices below. Markers follow the scope reported in each alert.</p>`);
 else setHTML(c,'<h3>No active advisories reported</h3><p>BART’s current alert feed contains no active notices.</p>');
 const list=$('#alerts-list');list.replaceChildren();
 if(alertsStatus==='live'){
  const items=snapshot.alerts.items;
  items.slice(0,8).forEach(a=>{const el=document.createElement('article');el.className='alert-item';el.innerHTML=`${a.header?'<h4>'+esc(a.header)+'</h4>':''}<p>${esc(a.description||'See BART for details.')}</p>`;list.appendChild(el)});
 }
 $('#matching').textContent=snapshot?`${snapshot.trips.counts.matchedTrips} matched trips · ${snapshot.trips.counts.unmatchedTrips} unmatched · ${snapshot.trips.counts.positionedTrips} position estimates at last refresh.`:'Matching BART trips to the schematic.';
 $('#schedule-note').textContent=snapshot?.schedule.warning||'';
 if(snapshot?.provider==='511'){$('#data-source-link').href='https://511.org/open-data/transit';$('#data-source-link').textContent='511.org';}
 renderAlerts(alertsStatus);
 if(status!==lastStatus){lastStatus=status;$('#announcer').textContent=$('#connection-text').textContent;applyFocus(focusLine);renderDepartures()}
}
function renderAlerts(status){
 const overlay=$('#alert-overlay');overlay.replaceChildren();overlay.removeAttribute('hidden');
 if(status!=='live')return;
 const marked=new Set();
 for(const a of snapshot.alerts.items){
  // A broad route alert gets a line badge in the notices; it must not invent a location.
  for(const id of a.stations){const s=stations[id];if(!s||marked.has(id))continue;marked.add(id);make('circle',{class:'delay-halo',cx:s.x,cy:s.y,r:29,style:`transform-origin:${s.x}px ${s.y}px`},overlay);}
 }
}
function createTrain(raw){
 const r=definitions.find(r=>r.id===raw.line);if(!r)return null;
 const el=make('g',{class:'train',tabindex:0,role:'button',visibility:'hidden','aria-label':`${r.name} line to ${raw.headsign}, estimated position`},$('#trains'));
 make('title',{},el).textContent=`${r.name} → ${raw.headsign} · estimated position`;
 make('rect',{class:'train-outline',x:-17,y:-10.5,width:34,height:21,rx:6},el);make('circle',{class:'train-hit',r:20},el);make('rect',{class:'car',x:-12,y:-5.5,width:24,height:11,rx:1,fill:r.color},el);make('rect',{class:'window',x:5,y:-2.5,width:3,height:5,rx:.5},el);
 const t={raw,route:r,el,segment:null,positioned:false,pos:null,delay:null,badge:null};
 const activate=()=>selectTrain(t);
 t.badge=createCueBadge('delay',activate);
 el.addEventListener('click',activate);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate()}});return t;
}
function acceptSnapshot(value){
 snapshot=value;
 const ids=new Set(value.trips.trains.map(t=>t.id));
 for(const [id,t] of trains)if(!ids.has(id)){t.el.remove();t.badge.el.remove();trains.delete(id)}
 for(const raw of value.trips.trains){if(trains.has(raw.id))trains.get(raw.id).raw=raw;else {const t=createTrain(raw);if(t)trains.set(raw.id,t)}}
 applyFocus(focusLine);renderStatus();refreshCues();renderDepartures();updateTrainCard();
}
async function poll(){
 if(fetching)return;fetching=true;$('#refresh').disabled=true;$('#refresh').textContent='Refreshing…';
 const began=Date.now();
 try{
  const response=await fetch('/api/live',{cache:'no-store',signal:AbortSignal.timeout(25000)});const data=await response.json();
  if(!response.ok||!data.trips)throw new Error(data.error||'The feed request failed');
  // A server timestamp is returned even when the cached feed is reused.
  clockOffset=data.serverTime-(began+Date.now())/2;acceptSnapshot(data);
 }catch(e){
  if(!snapshot){snapshot={trips:{timestamp:null,trains:[],departures:{},counts:{matchedTrips:0,unmatchedTrips:0,positionedTrips:0},error:e.message},alerts:{timestamp:null,items:[]},schedule:{warning:null}};renderStatus();renderDepartures()}
  else {snapshot.trips.error='Connection interrupted; retrying automatically.';renderStatus()}
 }finally{fetching=false;$('#refresh').disabled=false;$('#refresh').textContent='Refresh now';clearTimeout(pollTimer);pollTimer=setTimeout(poll,20000)}
}
function applyFocus(id){
 focusLine=id;
 document.querySelectorAll('[data-line]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.line===id));
 definitions.forEach(r=>r.path.style.opacity=id==='all'||r.id===id?'1':'.12');
 document.querySelectorAll('[data-airport-line]').forEach(p=>p.style.opacity=id==='all'||p.dataset.airportLine===id?'1':'.12');
 $('.connector').style.opacity=id==='all'?'1':'.12';
 const route=definitions.find(r=>r.id===id);
 for(const t of trains.values())t.el.style.opacity=id==='all'||t.route.id===id?(predictionStatus()==='live'?'1':'.3'):'.06';
 Object.values(stations).forEach(s=>s.el.style.opacity=!route||route.ids.includes(s.id)||(['red','yellow'].includes(id)&&['SFIA','MLBR'].includes(s.id))?'1':'.18');
 $('#line-caption').textContent=route?`${route.name} · ${route.ends.join(' / ')}`:'All lines';renderGapCard();layoutCues();
}
function positionAt(r,segment){
 const a=r.distances[segment.from],b=r.distances[segment.to];
 if(a!=null&&b!=null){const distance=a+(b-a)*segment.progress,p=r.path.getPointAtLength(distance),ahead=r.path.getPointAtLength(Math.max(0,Math.min(r.length,distance+(b>=a?2:-2))));return {x:p.x,y:p.y,angle:Math.atan2(ahead.y-p.y,ahead.x-p.x)*180/Math.PI};}
 const branch=r.branches.find(item=>item.ids.includes(segment.from)&&item.ids.includes(segment.to));
 if(branch){const progress=segment.from===branch.ids[0]?segment.progress:1-segment.progress,distance=progress*branch.length,p=branch.path.getPointAtLength(distance),ahead=branch.path.getPointAtLength(Math.max(0,Math.min(branch.length,distance+(segment.from===branch.ids[0]?2:-2))));return{x:p.x,y:p.y,angle:Math.atan2(ahead.y-p.y,ahead.x-p.x)*180/Math.PI}}
 return null;
}
function createCueBadge(kind,activate){
 const el=make('g',{class:'cue-badge '+kind+'-badge',role:'button',tabindex:-1,visibility:'hidden','aria-hidden':'true'},$('#map-cues'));
 const title=make('title',{},el),leader=make('path',{class:'cue-leader'},el),content=make('g',{class:'cue-content'},el),plate=make('rect',{class:'cue-plate',y:-10,height:20,rx:10},content);
 const clock=make('g',{class:'cue-clock'},content);make('circle',{r:5},clock);make('path',{d:'M0 -3V0L2 1'},clock);
 const text=make('text',{class:'cue-text',y:4,'text-anchor':'middle'},content);
 if(kind!=='gap')clock.setAttribute('display','none');
 el.addEventListener('click',activate);el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate()}});
 return{el,title,leader,content,plate,clock,text,kind,shown:false,gap:null};
}
function hideCue(badge){if(!badge)return;badge.shown=false;badge.el.setAttribute('visibility','hidden');badge.el.setAttribute('aria-hidden','true');badge.el.setAttribute('tabindex','-1')}
function refreshCues(){
 gapsByStation.clear();
 if(predictionStatus()==='live')for(const [id,items]of Object.entries(snapshot.trips.departures)){
  const gaps=serviceGaps(items,now());if(gaps.length)gapsByStation.set(id,gaps);
 }
 for(const t of trains.values()){
  t.delay=predictionStatus()==='live'?trainDelay(t.raw,now()):null;
  t.el.classList.toggle('late',t.delay?.seconds>=60);t.el.classList.toggle('severe',t.delay?.seconds>=300);
  t.el.setAttribute('aria-label',`${t.route.name} line to ${t.raw.headsign}, estimated position${t.delay?.seconds>=60?', '+delayText(t.delay.seconds):''}`);
 }
 renderGapCard();layoutCues();
}
// Place fixed-size labels in clear screen space, preserving station names.
function layoutCues(){
 const map=$('#map'),rect=map.getBoundingClientRect(),width=rect.width||innerWidth,height=rect.height||innerHeight,left=rect.left||0,top=rect.top||0;
 const scale=Math.min(width/vb.w,height/vb.h)||1,offsetX=left+(width-vb.w*scale)/2,offsetY=top+(height-vb.h*scale)/2;
 const screen=point=>({x:offsetX+(point.x-vb.x)*scale,y:offsetY+(point.y-vb.y)*scale});
 const occupied=[];
 for(const element of document.querySelectorAll('.hud,.controls,.route-palette,.map-caption,.phone-map-hint,.inspector:not([hidden])')){
  const box=element.getBoundingClientRect();if(box.width&&box.height)occupied.push({x:box.left-3,y:box.top-3,w:box.width+6,h:box.height+6});
 }
 for(const s of Object.values(stations)){
  const point=screen(s),radius=Math.max(13,16*scale);occupied.push({x:point.x-radius,y:point.y-radius,w:radius*2,h:radius*2});
  const style=getComputedStyle(s.label),box=s.label.getBoundingClientRect();
  if(style.visibility!=='hidden'&&Number(style.opacity)>0&&box.width)occupied.push({x:box.left-3,y:box.top-2,w:box.width+6,h:box.height+4});
  hideCue(s.gapBadge);
 }
 for(const t of trains.values()){
  hideCue(t.badge);
  if(t.pos&&t.el.getAttribute('visibility')==='visible'){const p=screen(t.pos),radius=Math.max(13,16*scale);occupied.push({x:p.x-radius,y:p.y-radius,w:radius*2,h:radius*2})}
 }
 if(predictionStatus()!=='live')return;
 const tasks=[];
 for(const t of trains.values())if(t.delay?.seconds>=60&&t.pos&&t.el.getAttribute('visibility')==='visible'&&(focusLine==='all'||t.route.id===focusLine)){
  tasks.push({badge:t.badge,anchor:t.pos,label:'+'+Math.max(1,Math.round(t.delay.seconds/60))+'m',description:`${t.route.name} to ${t.raw.headsign}. ${delayText(t.delay.seconds)} reported at ${stations[t.delay.station]?.name||t.delay.station}. Show upcoming stops.`,severe:t.delay.seconds>=300,priority:t.raw.id===followed?100000:t.delay.seconds+1000});
 }
 for(const [id,gaps]of gapsByStation){
  const s=stations[id],gap=gaps.find(g=>focusLine==='all'||g.line===focusLine);if(!s||!gap)continue;
  s.gapBadge.gap=gap;s.gapBadge.el.setAttribute('data-gap-station',id);
  tasks.push({badge:s.gapBadge,anchor:s,label:Math.round(gap.seconds/60)+'m gap',description:`${s.name}: predicted ${Math.round(gap.seconds/60)} minute gap on the ${gap.line} line toward ${gap.headsign}. Show departures.`,severe:false,priority:gap.seconds});
 }
 tasks.sort((a,b)=>b.priority-a.priority);
 const intersects=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
 for(const task of tasks){
  const {badge}=task,anchor=screen(task.anchor);
  if(anchor.x<left||anchor.x>left+width||anchor.y<top||anchor.y>top+height)continue;
  const w=Math.ceil(Math.max(badge.kind==='gap'?64:36,task.label.length*(badge.kind==='gap'?6.5:7)+(badge.kind==='gap'?28:16))),h=20;
  const candidates=badge.kind==='gap'?[[0,30],[0,-30],[56,0],[-56,0],[56,30],[-56,30],[56,-30],[-56,-30],[0,52],[0,-52],[80,16],[-80,16]]:[[0,-24],[0,24],[36,-24],[-36,-24],[42,24],[-42,24],[58,0],[-58,0],[0,-46],[0,46],[70,-22],[-70,-22]];
  const candidate=candidates.find(([dx,dy])=>{const box={x:anchor.x+dx-w/2-2,y:anchor.y+dy-h/2-2,w:w+4,h:h+4};return box.x>=left+8&&box.x+box.w<=left+width-8&&box.y>=top+8&&box.y+box.h<=top+height-8&&!occupied.some(other=>intersects(box,other))});
  if(!candidate)continue;
  const [dx,dy]=candidate;occupied.push({x:anchor.x+dx-w/2-2,y:anchor.y+dy-h/2-2,w:w+4,h:h+4});
  badge.shown=true;badge.el.setAttribute('visibility','visible');badge.el.setAttribute('aria-hidden','false');badge.el.setAttribute('tabindex','0');badge.el.setAttribute('aria-label',task.description);badge.title.textContent=task.description;
  badge.el.classList.toggle('severe',task.severe);badge.el.setAttribute('transform',`translate(${task.anchor.x} ${task.anchor.y})`);
  badge.content.setAttribute('transform',`translate(${dx/scale} ${dy/scale}) scale(${1/scale})`);
  badge.plate.setAttribute('x',-w/2);badge.plate.setAttribute('width',w);badge.text.textContent=task.label;badge.text.setAttribute('x',badge.kind==='gap'?7:0);
  badge.clock.setAttribute('transform',`translate(${-w/2+11} 0)`);
  const distance=Math.hypot(dx,dy),start=Math.min(.9,Math.max(12,16*scale)/distance);
  badge.leader.setAttribute('d',`M${dx*start/scale} ${dy*start/scale}L${dx/scale} ${dy/scale}`);badge.leader.setAttribute('stroke-width',1/scale);
 }
}

function selectTrain(t){
 for(const other of trains.values())other.el.classList.remove('followed');
 followed=t.raw.id;t.el.classList.add('followed');
 const next=t.segment?.to||upcomingStops(t.raw,now())[0]?.station;
 if(next)chooseStation(next,{open:false,keepTrain:true});
 $('#train-card').hidden=false;openInspector('station',t.el);$('#panel-title').textContent='Train details';updateTrainCard();layoutCues();
}
function etaText(time){if(time==null)return '—';const seconds=time-now()/1000;return seconds<=20?'Due':Math.ceil(seconds/60)+'m'}
function delayText(seconds){
 if(seconds==null)return 'Delay not reported';
 if(seconds===0)return 'Reported on time';
 const value=Math.abs(Math.round(seconds)),minutes=Math.floor(value/60),remainder=value%60;
 return `${minutes?minutes+'m ':''}${remainder||!minutes?remainder+'s ':''}${seconds>0?'late':'early'}`;
}
function renderGapCard(){
 const gaps=(gapsByStation.get(selectedStation)||[]).filter(g=>focusLine==='all'||g.line===focusLine);
 $('#gap-card').hidden=!gaps.length;
 setHTML($('#gap-details'),gaps.map(g=>{
  const route=definitions.find(r=>r.id===g.line),selected=selectedGapKey===g.key;
  return `<article class="gap-detail${selected?' chosen':''}"><h4><span class="route-dot" style="background:${route.color}"></span>${esc(route.name)} · ${esc(g.headsign)}</h4><p><strong>${Math.round(g.seconds/60)} min gap</strong> · next ${etaText(g.next.time)}, then ${etaText(g.following.time)}</p><p class="gap-comparison">${g.scheduledSeconds==null?'Schedule comparison unavailable.':Math.round(g.scheduledSeconds/60)+' min scheduled between these trains.'} Calculated from departure predictions.</p></article>`;
 }).join(''));
}
function updateTrainCard(){
 if(!followed)return;const t=trains.get(followed),list=$('#upcoming-stops'),emptyState=$('#upcoming-empty');
 if(list.dataset.train!==followed){list.replaceChildren();upcomingRows.clear();list.dataset.train=followed}
 if(!t){$('#train-name').textContent='Trip no longer reported';$('#train-detail').textContent='This trip is no longer in the latest feed.';$('#train-delay').textContent='';list.replaceChildren();upcomingRows.clear();emptyState.hidden=false;emptyState.textContent='No current stop predictions.';return}
 $('#train-name').textContent=`${t.route.name} · ${t.raw.headsign}`;
 const fresh=predictionStatus()==='live'&&sourceState(t.raw.timestamp,now())==='live',s=t.segment;
 $('#train-detail').textContent=!fresh?'Source stale or unavailable. The last estimated position is frozen.':s?`${s.from===s.to?'At':'Approaching'} ${stations[s.to]?.name||s.to}. Estimated position · source ${ageLabel(t.raw.timestamp)}.`:'Position cannot be resolved to a station interval.';
 const reported=fresh?trainDelay(t.raw,now()):null;
 $('#train-delay').textContent=!fresh?'Fresh delay information unavailable.':reported?`${delayText(reported.seconds)} at ${stations[reported.station]?.name||reported.station}${reported.uncertainty>0?' · timing uncertainty '+reported.uncertainty+'s':''}.`:'Delay not reported for the next stop.';
 $('#train-delay').className='train-delay'+(reported?.seconds>=300?' severe':reported?.seconds>=60?' late':'');
 const stops=fresh?upcomingStops(t.raw,now()):[],keys=new Set();
 emptyState.hidden=!!stops.length;emptyState.textContent=fresh?'No remaining stop predictions.':'Upcoming ETAs will return with fresh predictions.';
 stops.forEach((stop,index)=>{
  const key=stop.sequence+':'+stop.station;keys.add(key);let row=upcomingRows.get(key);
  if(!row){
   const el=document.createElement('li'),button=document.createElement('button'),name=document.createElement('span'),meta=document.createElement('span'),eta=document.createElement('span');
   button.className='upcoming-stop';name.className='stop-name';meta.className='stop-meta';eta.className='stop-eta';button.append(name,meta,eta);el.append(button);button.addEventListener('click',()=>chooseStation(stop.station));
   row={el,button,name,meta,eta};upcomingRows.set(key,row);
  }
  row.name.textContent=stations[stop.station]?.name||stop.station;
  const platform=stop.platform?`${stop.platformSource==='scheduled'?'Scheduled platform':'Platform'} ${stop.platform}`:'Platform not reported';
  row.meta.textContent=platform+(stop.station===t.raw.terminal?' · final stop':'')+(stop.time==null?' · ETA unavailable':'');
  row.eta.textContent=stop.atStation?'Now':etaText(stop.time);
  row.button.setAttribute('aria-label',`${row.name.textContent}, ${row.eta.textContent==='—'?'ETA unavailable':row.eta.textContent}, ${platform}. Show station departures.`);
  if(list.children[index]!==row.el)list.insertBefore(row.el,list.children[index]||null);
 });
 for(const [key,row]of upcomingRows)if(!keys.has(key)){row.el.remove();upcomingRows.delete(key)}
}
const clockFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function renderClock(){
 const date=new Date(now()),text=clockFormatter.format(date),[hour,minute]=text.split(':').map(Number);
 $('.clock').textContent=text;$('.clock').setAttribute('datetime',date.toISOString());
 $('#hour-hand').setAttribute('transform',`rotate(${(hour%12)*30+minute/2} 20 20)`);
 $('#minute-hand').setAttribute('transform',`rotate(${minute*6} 20 20)`);
}
function frame(time){
 if(predictionStatus()==='live')for(const t of trains.values()){
  // Reduced-motion users still get one position per trip, without interpolation.
  if(paused&&t.positioned)continue;
  const segment=inferSegment(t.raw,now());t.segment=segment;
  if(!segment){t.el.setAttribute('visibility','hidden');t.pos=null;hideCue(t.badge);continue}
  const pos=positionAt(t.route,segment);if(!pos){t.el.setAttribute('visibility','hidden');t.pos=null;hideCue(t.badge);continue}
  t.pos=pos;if(t.badge.shown)t.badge.el.setAttribute('transform',`translate(${pos.x} ${pos.y})`);t.positioned=true;t.el.setAttribute('visibility','visible');t.el.setAttribute('transform',`translate(${pos.x} ${pos.y}) rotate(${pos.angle})`);
 }
 if(time-lastPanelUpdate>1000){lastPanelUpdate=time;renderStatus();refreshCues();renderDepartures();updateTrainCard();renderClock()}
 requestAnimationFrame(frame);
}
let vb={x:-60,y:-150,w:1280,h:1120};const mobile=()=>innerWidth<=650;
function setView(overview=false){vb=mobile()&&!overview?{x:130,y:-65,w:510,h:980}:{x:-60,y:-150,w:1280,h:1120};drawView()}
function drawView(){
 const map=$('#map');map.setAttribute('viewBox',`${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
 const rect=map.getBoundingClientRect(),width=rect.width||innerWidth,height=rect.height||innerHeight;
 const scale=Math.min(width/vb.w,height/vb.h);map.style.setProperty('--station-font',`${Math.min(30,14/scale)}px`);
 const visibleLeft=vb.x-(width/scale-vb.w)/2,visibleRight=visibleLeft+width/scale;
 const visibleTop=vb.y-(height/scale-vb.h)/2,visibleBottom=visibleTop+height/scale;
 for(const s of Object.values(stations)){
  const p=labelPosition(s.id,mobile());
  s.leader.setAttribute('d',p.leader||'');
  s.label.setAttribute('x',p.x);s.label.setAttribute('y',p.y);s.label.setAttribute('text-anchor',p.anchor);
  s.label.setAttribute('transform',p.angle?`rotate(${p.angle} ${p.x} ${p.y})`:'');
  const visibility=s.x>=visibleLeft&&s.x<=visibleRight&&s.y>=visibleTop&&s.y<=visibleBottom?'visible':'hidden';s.label.style.visibility=visibility;s.leader.style.visibility=visibility;
 }
 layoutCues();
}
function pointInView(point,view=vb){
 const rect=$('#map').getBoundingClientRect(),scale=Math.min(rect.width/view.w,rect.height/view.h)||1;
 return{x:view.x+(point.x-rect.left-(rect.width-view.w*scale)/2)/scale,y:view.y+(point.y-rect.top-(rect.height-view.h*scale)/2)/scale};
}
function zoom(factor,point){
 const anchor=point?pointInView(point):{x:vb.x+vb.w/2,y:vb.y+vb.h/2},w=Math.max(300,Math.min(2200,vb.w*factor)),ratio=w/vb.w;
 vb={x:anchor.x-(anchor.x-vb.x)*ratio,y:anchor.y-(anchor.y-vb.y)*ratio,w,h:vb.h*ratio};drawView();
}
const pointers=new Map();let gesture=null;
function beginGesture(){
 const points=[...pointers.values()];
 if(points.length>=2){const [a,b]=points,center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};gesture={kind:'pinch',distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),anchor:pointInView(center),view:{...vb}};}
 else if(points.length===1)gesture={kind:'pan',start:points[0],view:{...vb},moved:false};
 else gesture=null;
}
$('#map').addEventListener('pointerdown',e=>{
 if(e.button>0||e.target.closest('.station,.train,.cue-badge'))return;
 pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});$('#map').setPointerCapture(e.pointerId);beginGesture();
});
$('#map').addEventListener('pointermove',e=>{
 if(!pointers.has(e.pointerId)||!gesture)return;
 pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const points=[...pointers.values()];
 if(gesture.kind==='pinch'&&points.length>=2){
  const [a,b]=points,center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y));
  const w=Math.max(300,Math.min(2200,gesture.view.w*gesture.distance/distance));
  vb={x:0,y:0,w,h:gesture.view.h*w/gesture.view.w};const local=pointInView(center);vb.x=gesture.anchor.x-local.x;vb.y=gesture.anchor.y-local.y;drawView();
 }else if(gesture.kind==='pan'){
  const rect=$('#map').getBoundingClientRect(),scale=Math.min(rect.width/gesture.view.w,rect.height/gesture.view.h)||1;
  const dx=e.clientX-gesture.start.x,dy=e.clientY-gesture.start.y;gesture.moved||=Math.hypot(dx,dy)>5;
  vb.x=gesture.view.x-dx/scale;vb.y=gesture.view.y-dy/scale;drawView();
 }
});
function endPointer(e){if(!pointers.has(e.pointerId))return;const tapped=gesture?.kind==='pan'&&!gesture.moved;pointers.delete(e.pointerId);beginGesture();if(tapped&&!$('#inspector').hidden)closeInspector()}
$('#map').addEventListener('pointerup',endPointer);
$('#map').addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);beginGesture()});
$('#map').addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(Math.max(-100,Math.min(100,e.deltaY))*.002),{x:e.clientX,y:e.clientY})},{passive:false});
$('#station-select').addEventListener('change',e=>chooseStation(e.target.value));
for(const button of document.querySelectorAll('[data-line]'))button.addEventListener('click',()=>applyFocus(button.dataset.line===focusLine?'all':button.dataset.line));
$('#zoom-in').addEventListener('click',()=>zoom(.8));$('#zoom-out').addEventListener('click',()=>zoom(1.25));$('#reset').addEventListener('click',()=>setView(true));$('#refresh').addEventListener('click',poll);
$('#close-panel').addEventListener('click',closeInspector);
$('#station-finder').addEventListener('click',()=>{openInspector('station',$('#station-finder'));$('#station-select').focus({preventScroll:true})});
for(const id of ['service','connection','view-service'])$('#'+id).addEventListener('click',()=>openInspector('network',$('#'+id)));
function pauseButton(){
 const button=$('#pause');button.setAttribute('aria-pressed',paused);button.setAttribute('aria-label',paused?'Resume train motion':'Pause train motion');button.title=paused?'Resume motion (Space)':'Pause motion (Space)';
}
function togglePause(){paused=!paused;pauseButton();renderStatus()}
function toggleLabels(){labels=!labels;document.body.classList.toggle('labels-on',labels);$('#labels').setAttribute('aria-pressed',labels);$('#labels').setAttribute('aria-label',labels?'Hide station names':'Show station names')}
$('#pause').addEventListener('click',togglePause);$('#labels').addEventListener('click',toggleLabels);
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!$('#inspector').hidden){e.preventDefault();closeInspector();return}
 if(e.target!==document.body&&e.target.closest('button,select,input,a,[role=button]'))return;
 if(e.code==='Space'){e.preventDefault();togglePause()}
 if(e.key.toLowerCase()==='l'){e.preventDefault();toggleLabels()}
});
let lastMobile=mobile();addEventListener('resize',()=>{if(lastMobile!==mobile()){lastMobile=mobile();setView()}else drawView()});
addEventListener('online',poll);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll()});
document.body.classList.toggle('labels-on',labels);setView();pauseButton();chooseStation('EMBR',{open:false});renderClock();requestAnimationFrame(frame);poll();
