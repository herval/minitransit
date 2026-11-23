import {compactVehicle} from '../public/map-motion.js';
import {serviceGaps} from '../public/model.js';

export function compactSnapshot(full,network){
 if(!full.regional)return full;
 const {trains=[],departures={},cancelled,...health}=full.trips;
 const gaps=[];
 for(const [station,items]of Object.entries(departures)){
  const gap=serviceGaps(items,full.serverTime)[0];if(!gap)continue;
  gaps.push({station,line:gap.line,seconds:gap.seconds,scheduledSeconds:gap.scheduledSeconds,nextTime:gap.next.time,timestamp:Math.min(gap.next.timestamp,gap.following.timestamp)});
 }
 return {...full,format:'map-v1',trips:{...health,trains:trains.map(train=>compactVehicle(train,network)),gaps}};
}

// HTTP validators ignore response time: a clock tick is not new transit data.
export function stableSnapshot(value){const {serverTime,...rest}=value;return rest;}
