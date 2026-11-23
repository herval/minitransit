import {project,REGIONAL_MAX_AGE} from './networks.js';
import {sourceState} from './model.js';

// Resolve a reported fix once on the server, not by scanning a full stop list
// on every browser animation frame. Rotation preserves this segment fraction.
export function reportedAnchor(train,network){
 const fix=train.position;if(!fix)return null;
 const point=project(fix.lat,fix.lon,network.projectionAngle??25);let best;
 for(let i=1;i<train.stops.length;i++){
  const a=network.stations[train.stops[i-1].station],b=network.stations[train.stops[i].station];
  if(!a||!b||a.id===b.id)continue;
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const progress=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(length||1)));
  const distance=Math.hypot(point.x-a.x-progress*dx,point.y-a.y-progress*dy);
  if(!best||distance<best.distance)best={from:a.id,to:b.id,progress,distance,nextIndex:i,timestamp:fix.timestamp};
 }
 if(!best||best.distance>=100)return null;
 const {distance,...anchor}=best;return anchor;
}

// These windows retain the same adjacency, dwell and bounded scheduled-time
// rules as inferSegment. They cover the source's entire remaining lifetime.
export function motionWindows(train){
 const windows=[],lo=train.timestamp-30,hi=train.timestamp+(train.maxAge??REGIONAL_MAX_AGE);
 const add=value=>{if(value.end>=lo&&value.start<=hi)windows.push(value);};
 train.stops.forEach((stop,i)=>{
  if(stop.arrival!=null&&stop.departure!=null&&stop.departure>=stop.arrival)add({from:stop.station,to:stop.station,start:stop.arrival,end:stop.departure,nextIndex:i});
  if(!i||stop.arrival==null)return;
  const previous=train.stops[i-1];if(previous.skipped||stop.skipped)return;
  let start=previous.departure;
  if(start==null&&previous.scheduledDeparture!=null&&stop.scheduledArrival!=null){const duration=stop.scheduledArrival-previous.scheduledDeparture;if(duration>0&&duration<=1200)start=stop.arrival-duration;}
  if(start!=null&&stop.arrival>start&&stop.arrival-start<=1800)add({from:previous.station,to:stop.station,start,end:stop.arrival,nextIndex:i});
 });
 return windows;
}

export function compactVehicle(train,network){
 const maxAge=train.maxAge??REGIONAL_MAX_AGE,lo=train.timestamp-30,hi=train.timestamp+maxAge;
 const predictions=train.stops.filter(s=>!s.skipped&&(s.departure??s.arrival)>=lo);
 const following=predictions.find(s=>(s.departure??s.arrival)>hi);
 const delays=predictions.filter(s=>s===following||(s.departure??s.arrival)<=hi).map(s=>({station:s.station,arrival:s.arrival,departure:s.departure,arrivalDelay:s.arrivalDelay,departureDelay:s.departureDelay,arrivalUncertainty:s.arrivalUncertainty,departureUncertainty:s.departureUncertainty}));
 return {id:train.id,line:train.line,agency:train.agency,headsign:train.headsign,routeName:train.routeName,vehicle:train.vehicle,timestamp:train.timestamp,maxAge,delayTimeline:delays,mapMotion:{anchor:reportedAnchor(train,network),windows:motionWindows(train)}};
}

export function motionAt(train,now){
 const anchor=train.mapMotion?.anchor;
 if(anchor&&sourceState(anchor.timestamp,now,train.maxAge??REGIONAL_MAX_AGE)==='live')return {...anchor,method:'Reported location · snapped to the schematic'};
 if(sourceState(train.timestamp,now,train.maxAge??REGIONAL_MAX_AGE)!=='live')return null;
 const seconds=now/1000,window=train.mapMotion?.windows.find(w=>seconds>=w.start&&seconds<=w.end);
 if(!window)return null;
 return {...window,progress:window.from===window.to?0:Math.max(0,Math.min(1,(seconds-window.start)/(window.end-window.start))),timestamp:train.timestamp,method:'Estimated between stop predictions'};
}
