import Gtfs from 'gtfs-realtime-bindings';
import {getRegionalSchedule} from './regional-schedule.mjs';
import {normalizeTrips,normalizeAlerts,sourceState,inferSegment} from '../public/model.js';
import {AGENCIES,REGIONAL_MAX_AGE} from '../public/networks.js';

const feeds=new Map();
const sources={trips:'https://api.511.org/transit/tripupdates?agency=RG',vehicles:'https://api.511.org/transit/vehiclepositions?agency=RG',alerts:'https://api.511.org/transit/servicealerts?agency=RG'};
const TTL={trips:150000,vehicles:150000,alerts:600000};
// 24 trip + 24 position + 6 alert requests/hour, shared by every visitor/network.
async function feed(kind,apiKey){
 if(!feeds.has(kind))feeds.set(kind,{value:null,fetchedAt:null,next:0,error:null,pending:null});
 const state=feeds.get(kind);if(state.pending)return state.pending;if(Date.now()<state.next)return state;
 state.pending=(async()=>{
  try{
   const response=await fetch(sources[kind]+'&api_key='+encodeURIComponent(apiKey),{signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Object.assign(new Error('511 returned HTTP '+response.status),{status:response.status,retry:Number(response.headers.get('Retry-After'))||0});
   const bytes=new Uint8Array(await response.arrayBuffer());
   const decoded=Gtfs.transit_realtime.FeedMessage.toObject(Gtfs.transit_realtime.FeedMessage.decode(bytes),{longs:Number,enums:Number});
   if(!Number(decoded.header?.timestamp))throw new Error('511 omitted the source timestamp');
   state.value=decoded;state.fetchedAt=Date.now();state.error=null;state.next=Date.now()+TTL[kind];
  }catch(error){state.error=error.status?error.message:'511 feed temporarily unavailable';state.next=Date.now()+Math.max(TTL[kind],error.status===429?Math.max(60000,(error.retry||0)*1000):0);}
  return state;
 })().finally(()=>{state.pending=null;});return state.pending;
}

export function mergeVehicles(tripData,vehicleFeed,schedule,now){
 const trains=tripData.trains,byTrip=new Map();
 for(const train of trains){const key=train.serviceDate+':'+train.tripId;if(!byTrip.has(key))byTrip.set(key,[]);byTrip.get(key).push(train);}
 let unmatched=0,matched=0;
 for(const entity of vehicleFeed?.entity||[]){
  const v=entity.vehicle,raw=v?.trip;if(!v||entity.isDeleted||!raw?.tripId)continue;
  const trip=schedule.trips[raw.tripId];if(!trip||!schedule.routes[trip.route])continue;
  if(Number(raw.scheduleRelationship)===3||Number(raw.scheduleRelationship)===7)continue;
  const stamp=Number(v.timestamp)||Number(vehicleFeed.header?.timestamp),position=v.position;
  if(!position||!Number.isFinite(position.latitude)||!Number.isFinite(position.longitude)||position.latitude<36.5||position.latitude>39||position.longitude< -124||position.longitude> -120)continue;
  const skeleton=normalizeTrips({header:{timestamp:stamp},entity:[{tripUpdate:{trip:raw,timestamp:stamp,stopTimeUpdate:[]}}]},schedule,now).trains[0];
  if(!skeleton){unmatched++;continue;}
  if(tripData.cancelled.some(id=>id===skeleton.id||(!raw.startTime&&id.startsWith(skeleton.serviceDate+':'+raw.tripId+':'))))continue;
  const candidates=byTrip.get(skeleton.serviceDate+':'+raw.tripId)||[];
  let train=candidates.find(t=>t.id===skeleton.id)||(candidates.length===1?candidates[0]:null);
  if(!train){train=skeleton;trains.push(train);byTrip.set(skeleton.serviceDate+':'+raw.tripId,[train]);}
  train.position={lat:position.latitude,lon:position.longitude,bearing:position.bearing??null,timestamp:stamp,stopSequence:v.currentStopSequence??null,station:schedule.parents[v.stopId]||null};
  train.vehicle=v.vehicle?.label||v.vehicle?.id||null;matched++;
 }
 const freshFix=t=>t.position&&sourceState(t.position.timestamp,now,REGIONAL_MAX_AGE)==='live';
 tripData.counts.positionedTrips=trains.filter(t=>freshFix(t)||inferSegment(t,now)).length;
 tripData.counts.reportedPositions=trains.filter(freshFix).length;
 tripData.counts.vehicleMatches=matched;tripData.counts.unmatchedVehicles=unmatched;
 return tripData;
}

let cached,cachedAt=0,pending;
export async function getRegionalSnapshot({apiKey}={}){
 if(!apiKey)throw new Error('A server-side 511 API token is required');
 if(cached&&Date.now()-cachedAt<20000)return {...cached,serverTime:Date.now()};
 if(pending)return pending.then(value=>({...value,serverTime:Date.now()}));
 pending=(async()=>{
  const {schedule,warning}=await getRegionalSchedule({apiKey});
  const [trip,vehicle,alert]=await Promise.all(['trips','vehicles','alerts'].map(kind=>feed(kind,apiKey)));
  const now=Date.now(),data=normalizeTrips(trip.value||{entity:[]},schedule,now);
  mergeVehicles(data,vehicle.value,schedule,now);
  const alerts=normalizeAlerts(alert.value||{entity:[]},schedule,now);
  const byAgency=Object.fromEntries(AGENCIES.map(a=>{
   const trains=data.trains.filter(t=>t.agency===a.id);
   return [a.id,{trips:trains.length,positioned:trains.filter(t=>t.position&&sourceState(t.position.timestamp,now,REGIONAL_MAX_AGE)==='live'||inferSegment(t,now)).length,reported:trains.filter(t=>t.position&&sourceState(t.position.timestamp,now,REGIONAL_MAX_AGE)==='live').length}];
  }));
  const state=(value,age)=>({timestamp:Number(value.value?.header?.timestamp)||null,status:sourceState(Number(value.value?.header?.timestamp),now,age),fetchedAt:value.fetchedAt,error:value.error});
  cached={serverTime:now,provider:'511',regional:true,pollAfterMs:20000,maxAgeSeconds:REGIONAL_MAX_AGE,
   trips:{...data,...state(trip,REGIONAL_MAX_AGE),byAgency},vehicles:state(vehicle,REGIONAL_MAX_AGE),alerts:{...alerts,...state(alert,900)},
   schedule:{builtAt:schedule.builtAt,warning,version:schedule.feed.feed_version||schedule.builtAt,networkVersion:schedule.network.builtAt},sources};
  cachedAt=now;return cached;
 })().finally(()=>{pending=null;});return pending;
}
export async function getLiveNetwork({apiKey}={}){return (await getRegionalSchedule({apiKey})).schedule.network;}
