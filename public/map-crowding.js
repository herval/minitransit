import {sourceState} from './model.js';
import {REGIONAL_MAX_AGE} from './networks.js';

// Passenger patterns are categorical symbols, never passenger counts or percentages.
const dot=(x,y)=>`M${x-.65} ${y}a.65 .65 0 1 0 1.3 0a.65 .65 0 1 0-1.3 0`;
const dots=points=>points.map(([x,y])=>dot(x,y)).join('');
const dash='M-6 .45h5v-.9h-5Z';
const states=[
 ['EMPTY','Mostly empty','M-7-2.4H1v.65h-7.35v3.5H1v.65h-8Z'],
 ['MANY_SEATS_AVAILABLE','Many seats available',dots([[-5,0],[-1,0]])],
 ['FEW_SEATS_AVAILABLE','Few seats available',dots([[-6,-1.3],[-2,-1.3],[-4,1.3],[0,1.3]])],
 ['STANDING_ROOM_ONLY','Standing room only',dots([-6,-3,0].flatMap(x=>[[x,-1.3],[x,1.3]]))],
 ['CRUSHED_STANDING_ROOM_ONLY','Very crowded standing room',dots([-7,-4.5,-2,.5].flatMap(x=>[[x,-1.3],[x,1.3]]))],
 ['FULL','Full','M-7-2H1V2H-7Z'],
 ['NOT_ACCEPTING_PASSENGERS','Not accepting passengers','M-6-2.5l.7-.4 5 5-.7.4Z'],
 ['NO_DATA_AVAILABLE','Occupancy unknown',dash],
 ['NOT_BOARDABLE','Not boardable','M-6-2.5l.7-.4 5 5-.7.4ZM-1-2.5l-.7-.4-5 5 .7.4Z']
].map(([code,label,path],status)=>({status,code,label,path,known:status!==7}));
const unknown=states[7];

export function normalizeOccupancy(vehicle,timestamp){
 if(!Object.hasOwn(vehicle,'occupancyStatus')||!Number.isFinite(timestamp)||timestamp<=0)return null;
 const raw=vehicle.occupancyStatus,status=typeof raw==='string'?states.findIndex(s=>s.code===raw):raw;
 return Number.isInteger(status)&&states[status]?{status,timestamp}:null;
}

export function vehicleOccupancy(train,now){
 const value=train.occupancy,state=states[value?.status];
 const live=value&&sourceState(value.timestamp,now,REGIONAL_MAX_AGE)==='live';
 return {...(live&&state?state:unknown),timestamp:value?.timestamp??null,stale:!!value&&!live};
}

// Only the next departure for each route/direction contributes pressure. Retain
// short successor windows so passing a departure works even on HTTP 304s.
export function stationPressureWindows(departures,now){
 const seconds=now/1000,groups=new Map();
 for(const d of departures||[]){
  if(!d.line||d.cancelled||d.skipped||!Number.isFinite(d.time)||d.time<seconds-15||d.time>seconds+5400||sourceState(d.timestamp,now,d.maxAge??REGIONAL_MAX_AGE)!=='live')continue;
  const key=JSON.stringify([d.line,d.routeId??'',d.directionId??d.terminal??d.headsign??'']);
  if(!groups.has(key))groups.set(key,new Map());
  const group=groups.get(key),previous=group.get(d.id);
  if(!previous||d.time<previous.time)group.set(d.id,d);
 }
 const windows=[];
 for(const group of groups.values()){
  let after=null;
  for(const d of [...group.values()].sort((a,b)=>a.time-b.time)){
   if(after==null||after<d.timestamp+(d.maxAge??REGIONAL_MAX_AGE))windows.push({line:d.line,time:d.time,timestamp:d.timestamp,delay:Number.isFinite(d.delay)?d.delay:null,...(after==null?{}:{after})});
   after=d.time+15;
  }
 }
 return windows;
}

export function stationPressure(windows,now,enabledLine=()=>true){
 const seconds=now/1000;
 const active=(windows||[]).filter(w=>enabledLine(w.line)&&seconds<=w.time+15&&(w.after==null||seconds>w.after)&&sourceState(w.timestamp,now,REGIONAL_MAX_AGE)==='live');
 const known=active.filter(w=>Number.isFinite(w.delay));
 if(!known.length)return null;
 const worst=known.reduce((a,b)=>a.delay>=b.delay?a:b),delay=Math.max(0,worst.delay);
 return {...worst,seconds:delay,level:Math.min(1,delay/600),severity:delay>=300?'high':delay>=60?'building':'low',partial:known.length<active.length};
}

// A circular segment fills upward inside a fixed-size station marker.
export function pressureFillPath(radius,level){
 const r=Math.max(0,radius),f=Math.max(0,Math.min(1,level));
 if(!r||!f)return '';
 if(f===1)return `M0 ${-r}a${r} ${r} 0 1 1 0 ${r*2}a${r} ${r} 0 1 1 0 ${-r*2}Z`;
 const y=r*(1-2*f),x=Math.sqrt(Math.max(0,r*r-y*y));
 return `M${-x} ${y}H${x}A${r} ${r} 0 ${f>.5?1:0} 1 ${-x} ${y}Z`;
}
