import yauzl from 'yauzl';
import {parse} from 'csv-parse';
import {createWriteStream} from 'node:fs';
import {mkdtemp,rm,readFile,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {AGENCIES,AGENCY_BY_ID,routeLine,project} from '../public/networks.js';

// Read one CSV at a time. The regional ZIP expands to ~300 MB; never unzip it in memory.
export async function* table(path,name){
 const zip=await new Promise((resolve,reject)=>yauzl.open(path,{lazyEntries:true},(error,value)=>error?reject(error):resolve(value)));
 try{
  const entry=await new Promise((resolve,reject)=>{
   zip.on('error',reject);zip.on('end',()=>resolve(null));
   zip.on('entry',entry=>entry.fileName===name?resolve(entry):zip.readEntry());zip.readEntry();
  });
  if(!entry)return;
  const stream=await new Promise((resolve,reject)=>zip.openReadStream(entry,(error,value)=>error?reject(error):resolve(value)));
  const parser=parse({columns:true,bom:true,skip_empty_lines:true,relax_column_count:true});
  stream.on('error',error=>parser.destroy(error));stream.pipe(parser);
  for await(const row of parser)yield row;
 }finally{zip.close();}
}

const seconds=value=>value?value.split(':').reduce((sum,v)=>sum*60+Number(v),0):null;
export function hydrateSchedule(schedule){
 if(!schedule.patterns)return schedule;
 const getStops=function(){return schedule.patterns[this.pattern].map((s,i)=>[s[0],this.times[i*2],this.times[i*2+1],s[1],s[2]]);};
 for(const trip of Object.values(schedule.trips))Object.defineProperty(trip,'stops',{get:getStops,configurable:true});
 return schedule;
}
// Some 511 archives have a short trailer after their valid ZIP end record.
// Validate the central directory before removing that trailer from our scratch file.
async function trimZipTrailer(path){
 const file=await open(path,'r+');
 try{
  const {size}=await file.stat(),tail=Buffer.alloc(Math.min(size,65557));
  await file.read(tail,0,tail.length,size-tail.length);
  const index=tail.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if(index<0||index+22>tail.length)return;
  const end=size-tail.length+index+22+tail.readUInt16LE(index+20);
  if(end>=size||size-end>4096)return;
  const offset=tail.readUInt32LE(index+16),length=tail.readUInt32LE(index+12),signature=Buffer.alloc(4);
  if(offset+length!==size-tail.length+index)return;
  await file.read(signature,0,4,offset);
  if(signature.readUInt32LE()===0x02014b50)await file.truncate(end);
 }finally{await file.close();}
}
export async function parseRegionalSchedule(path){
 await trimZipTrailer(path);
 const routes={},trips={},rawStops={},parents={},stationNames={},platformCodes={},calendar=[],exceptions=[],patterns=[],patternIds=new Map();
 let feed={feed_version:''};
 for await(const r of table(path,'routes.txt')){
  const line=routeLine(r);if(!line)continue;
  routes[r.route_id]={...r,lineId:line};
 }
 for await(const t of table(path,'trips.txt'))if(routes[t.route_id])trips[t.trip_id]={route:t.route_id,service:t.service_id,headsign:t.trip_headsign,directionId:t.direction_id||null,stops:[]};
 const services=new Set(Object.values(trips).map(t=>t.service));
 for await(const s of table(path,'stops.txt'))rawStops[s.stop_id]={stop_id:s.stop_id,stop_name:s.stop_name,stop_lat:s.stop_lat,stop_lon:s.stop_lon,parent_station:s.parent_station,platform_code:s.platform_code};
 function station(id){
  const seen=new Set();while(rawStops[id]?.parent_station&&!seen.has(id)){seen.add(id);id=rawStops[id].parent_station;}return id;
 }
 for(const s of Object.values(rawStops)){
  parents[s.stop_id]=station(s.stop_id);
  if(s.platform_code)platformCodes[s.stop_id]=s.platform_code;
 }
 const used=new Set(),usedRaw=new Set();let previousTrip=null;
 function pack(t){
  if(!t||!Object.hasOwn(t,'stops')||!Array.isArray(t.stops))return;
  t.stops.sort((a,b)=>a[3]-b[3]);
  const pattern=t.stops.map(s=>[s[0],s[3],s[4]]),key=JSON.stringify(pattern);
  if(!patternIds.has(key)){patternIds.set(key,patterns.length);patterns.push(pattern);}
  t.pattern=patternIds.get(key);t.times=t.stops.flatMap(s=>[s[1],s[2]]);delete t.stops;
 }
 for await(const s of table(path,'stop_times.txt')){
  const trip=trips[s.trip_id];if(!trip)continue;
  if(previousTrip!==trip){pack(previousTrip);previousTrip=trip;}
  if(!trip.stops)trip.stops=patterns[trip.pattern].map((s,i)=>[s[0],trip.times[i*2],trip.times[i*2+1],s[1],s[2]]);
  const id=parents[s.stop_id]||s.stop_id;used.add(id);usedRaw.add(s.stop_id);
  trip.stops.push([id,seconds(s.arrival_time),seconds(s.departure_time),Number(s.stop_sequence),s.stop_id]);
 }
 pack(previousTrip);for(const t of Object.values(trips))if(t.stops)pack(t);
 const core=hydrateSchedule({patterns,trips});
 const stations={};
 for(const id of used){
  const s=rawStops[id];if(!s)continue;
  const lat=Number(s.stop_lat),lon=Number(s.stop_lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
  const name=s.stop_name.replace(/ (BART Station|Caltrain Station|Light Rail Station)$/i,'').replace(/^SMART /,'').replace(/\s+BART(?:\s*\/\s*Amtrak)?$/i,'').replace(/\s+Caltrain$/i,'').replace(/^Great Mall\/Milpitas$/,'Milpitas').replace(/ Ferry Terminal$/,' Ferry');
  stationNames[id]=name;stations[id]={id,name,lat,lon,...project(lat,lon),agencies:[],lines:[],major:false,public:!/NOT A PUBLIC STOP|Rail Yard/i.test(s.stop_name)};
 }
 // 511 already supplies shared MTC parent stations for most transfers. Merge
 // nearby same-name directional platforms only when no shared parent exists.
 const aliases={};
 const clean=name=>name.toLowerCase().replace(/\b(northbound|southbound|eastbound|westbound|nb|sb|eb|wb|station|caltrain|bart|smart|platform|stn)\b/g,'').replace(/[^a-z0-9]/g,'');
 const ordered=Object.values(stations).sort((a,b)=>Number(b.id.startsWith('mtc:'))-Number(a.id.startsWith('mtc:')));
 const groups=new Map();
 for(const s of ordered){
  const key=clean(s.name),group=groups.get(key)||[];
  const match=group.find(t=>Math.hypot((s.lat-t.lat)*111000,(s.lon-t.lon)*88000)<220);
  if(match)aliases[s.id]=match.id;else{group.push(s);groups.set(key,group);}
 }
 for(const [stop,id]of Object.entries(parents))parents[stop]=aliases[id]||id;
 for(const pattern of patterns)for(const s of pattern)s[0]=aliases[s[0]]||s[0];
 for(const t of Object.values(trips)){
  const route=routes[t.route],agency=route.agency_id;
  for(const s of t.stops){const station=stations[s[0]];if(!station)continue;if(!station.agencies.includes(agency))station.agencies.push(agency);if(!station.lines.includes(route.lineId))station.lines.push(route.lineId);}
 }
 for(const id of Object.keys(aliases)){delete stations[id];delete stationNames[id];}
 for(const [id,s]of Object.entries(stations))if(!s.agencies.length){delete stations[id];delete stationNames[id];}
 for await(const c of table(path,'calendar.txt'))if(services.has(c.service_id))calendar.push(c);
 for await(const c of table(path,'calendar_dates.txt'))if(services.has(c.service_id))exceptions.push(c);
 for await(const f of table(path,'feed_info.txt'))feed=f;
 const lines={};
 for(const route of Object.values(routes)){
  const a=AGENCY_BY_ID[route.agency_id],id=route.lineId;
  let name=route.route_short_name||route.route_long_name;
  if(a.id==='BA')name=name.replace(/-[NS]$/,'');if(a.id==='CT')name='Caltrain';if(a.id==='SC')name=name.replace(/^Event-/,'');
  const palette={yellow:'#edc63b',red:'#e94e48',blue:'#3989c6',green:'#36a578',orange:'#ed8b38'};
  const color=a.id==='BA'?(palette[id.split(':')[1]]||'#9da9ac'):a.id==='CT'?a.color:/^[a-f\d]{6}$/i.test(route.route_color)?'#'+route.route_color:a.color;
  lines[id]??={id,agency:a.id,name,color,mode:a.mode};
 }
 const edges=new Map();
 function add(a,b,line){
  if(a===b||!stations[a]||!stations[b])return;
  const [from,to]=[a,b].sort(),key=from+'|'+to;
  if(!edges.has(key))edges.set(key,{a:from,b:to,lines:[]});const edge=edges.get(key);if(!edge.lines.includes(line))edge.lines.push(line);
 }
 for(const t of Object.values(trips)){
  const line=routes[t.route].lineId;
  if(line==='CT:rail')continue;
  for(let i=1;i<t.stops.length;i++)add(t.stops[i-1][0],t.stops[i][0],line);
 }
 // Local and express Caltrain trips use the same rail corridor, rather than
 // drawing an extra straight chord for every skipped-stop express pattern.
 const peninsula=Object.values(stations).filter(s=>s.agencies.includes('CT')).sort((a,b)=>b.lat-a.lat);
 for(let i=1;i<peninsula.length;i++)add(peninsula[i-1].id,peninsula[i].id,'CT:rail');
 for(const t of Object.values(trips))for(const s of [t.stops[0],t.stops.at(-1)])if(s&&stations[s[0]])stations[s[0]].major=true;
 for(const s of Object.values(stations))s.major||=s.agencies.filter(a=>a!=='AC').length>1||s.lines.filter(l=>!l.startsWith('AC:')).length>2||/Diridon|Millbrae|Mountain View|Embarcadero|Powell|Santa Rosa|San Rafael|Larkspur|Milpitas|Oakland|San Francisco|Richmond|Antioch|San Jose|Berkeley/i.test(s.name);
 for(const id of Object.keys(parents))if(!usedRaw.has(id))delete parents[id];
 for(const id of Object.keys(platformCodes))if(!usedRaw.has(id))delete platformCodes[id];
 const counts=Object.fromEntries(AGENCIES.map(a=>[a.id,{routes:Object.values(routes).filter(r=>r.agency_id===a.id).length,stations:Object.values(stations).filter(s=>s.agencies.includes(a.id)).length,trips:Object.values(trips).filter(t=>routes[t.route].agency_id===a.id).length}]));
 if(AGENCIES.some(a=>!counts[a.id].stations||!counts[a.id].trips))throw new Error('Regional schedule is missing a requested network');
 const builtAt=new Date().toISOString();
 return {...core,regional:true,builtAt,feed,parents,platformCodes,stationNames,routes,calendar,exceptions,network:{builtAt,agencies:AGENCIES,stations,lines,edges:[...edges.values()],counts}};
}

let current,loading,pending,lastAttempt=0,warning=null;
export async function getRegionalSchedule({apiKey}={}){
 if(!current){loading??=readFile(new URL('../data/regional-schedule.json',import.meta.url),'utf8').then(text=>hydrateSchedule(JSON.parse(text)));current=await loading;loading=null;}
 if(apiKey&&!pending&&Date.now()-Math.max(lastAttempt,Date.parse(current.builtAt))>12*3600_000){
  lastAttempt=Date.now();
  pending=(async()=>{
   const dir=await mkdtemp(join(tmpdir(),'minitransit-'));
   try{
    const response=await fetch('https://api.511.org/transit/datafeeds?operator_id=RG&api_key='+encodeURIComponent(apiKey),{signal:AbortSignal.timeout(90000)});
    if(!response.ok)throw new Error('Schedule HTTP '+response.status);
    const path=join(dir,'regional.zip');await pipeline(Readable.fromWeb(response.body),createWriteStream(path));
    current=await parseRegionalSchedule(path);warning=null;
   }catch{warning='Schedule refresh unavailable; using the last verified regional schedule.';lastAttempt=Date.now()-12*3600_000+30*60_000;}
   finally{await rm(dir,{recursive:true,force:true});}
  })().finally(()=>{pending=null;});
 }
 return {schedule:current,warning};
}
