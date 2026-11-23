import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import {getSchedule} from './schedule.mjs';
import {normalizeTrips, normalizeAlerts, sourceState, ALERT_MAX_AGE} from '../public/model.js';

const DIRECT={trips:'https://api.bart.gov/gtfsrt/tripupdate.aspx',alerts:'https://api.bart.gov/gtfsrt/alerts.aspx',schedule:'https://www.bart.gov/dev/schedules/google_transit.zip'};
const ALTERNATE={trips:'https://api.511.org/transit/tripupdates?agency=BA',alerts:'https://api.511.org/transit/servicealerts?agency=BA',schedule:'https://api.511.org/transit/datafeeds?operator_id=BA'};
const feeds=new Map();
let cached,cachedAt=0,pending,cachedProvider;

export async function readFeed(url,label='BART') {
  let response;
  try{response=await fetch(url,{signal:AbortSignal.timeout(10000),headers:{Accept:'application/x-protobuf, application/octet-stream;q=0.9, */*;q=0.1'}});}
  catch{throw new Error(`${label} feed connection failed`);}
  if(!response.ok){
    const retrySeconds=Number(response.headers.get('Retry-After'));
    throw Object.assign(new Error(`${label} returned HTTP ${response.status}`),{status:response.status,retryAfterMs:Number.isFinite(retrySeconds)?retrySeconds*1000:0});
  }
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(!bytes.length||bytes[0]===60)throw new Error(`${label} returned a web page instead of transit data`);
  let feed;
  try{feed=GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);}catch{throw new Error(`${label} returned an invalid transit feed`);}
  if(!Number(feed.header?.timestamp))throw new Error(`${label} did not provide a source timestamp`);
  return feed;
}

async function managedFeed(key,url,label,ttl) {
  if(!feeds.has(key))feeds.set(key,{feed:null,fetchedAt:null,nextAttemptAt:0,error:null,pending:null});
  const state=feeds.get(key);
  if(state.pending)return state.pending;
  if(Date.now()<state.nextAttemptAt)return state;
  state.pending=(async()=>{
    try{
      const feed=await readFeed(url,label);
      state.feed=GtfsRealtimeBindings.transit_realtime.FeedMessage.toObject(feed,{longs:Number,enums:Number});state.fetchedAt=Date.now();state.error=null;
      state.nextAttemptAt=Date.now()+ttl;
    }catch(error){
      state.error=error.message;
      const wait=error.status===403?300000:error.status===429?Math.max(60000,error.retryAfterMs||0):ttl;
      state.nextAttemptAt=Date.now()+Math.max(ttl,wait);
    }
    return state;
  })().finally(()=>{state.pending=null;});
  return state.pending;
}

export async function getLiveSnapshot({apiKey}={}) {
  const provider=apiKey?'511':'BART',now=Date.now();
  if(cached&&provider===cached.provider&&now>=cachedAt&&now-cachedAt<20000)return {...cached,serverTime:now};
  if(pending&&provider===cachedProvider)return pending.then(value=>({...value,serverTime:Date.now()}));
  cachedProvider=provider;
  pending=(async()=>{
    const sources=apiKey?ALTERNATE:DIRECT;
    const withKey=url=>apiKey?url+'&api_key='+encodeURIComponent(apiKey):url;
    // 511's default token limit is 60 requests/hour. Share predictions for 75s
    // and alerts for 10 minutes; browser refreshes cannot force upstream calls.
    const [scheduleResult,tripsResult,alertsResult]=await Promise.allSettled([
      getSchedule({apiKey}),
      managedFeed(provider+':trips',withKey(sources.trips),provider,apiKey?75000:20000),
      managedFeed(provider+':alerts',withKey(sources.alerts),provider,apiKey?600000:120000)
    ]);
    if(scheduleResult.status!=='fulfilled'||!scheduleResult.value.schedule)throw new Error('A matching transit schedule is unavailable');
    const {schedule,warning}=scheduleResult.value,now=Date.now();
    const tripState=tripsResult.status==='fulfilled'?tripsResult.value:{feed:null,error:'Prediction feed connection failed'};
    const alertState=alertsResult.status==='fulfilled'?alertsResult.value:{feed:null,error:'Alert feed connection failed'};
    const tripData=tripState.feed?normalizeTrips(tripState.feed,schedule,now):{timestamp:null,trains:[],departures:{},cancelled:[],counts:{tripUpdates:0,matchedTrips:0,unmatchedTrips:0,inactiveTrips:0,positionedTrips:0}};
    const alertData=alertState.feed?normalizeAlerts(alertState.feed,schedule,now):{timestamp:null,items:[]};
    cached={serverTime:now,provider,pollAfterMs:20000,
      trips:{...tripData,status:sourceState(tripData.timestamp,now),fetchedAt:tripState.fetchedAt||null,error:tripState.error||null},
      alerts:{...alertData,status:sourceState(alertData.timestamp,now,ALERT_MAX_AGE),fetchedAt:alertState.fetchedAt||null,error:alertState.error||null},
      schedule:{builtAt:schedule.builtAt,version:schedule.feed.feed_version,warning,calendarEnd:schedule.calendar.reduce((max,c)=>c.end_date>max?c.end_date:max,'')},
      needs511Token:!apiKey&&Boolean(tripState.error),sources};
    cachedAt=Date.now();return cached;
  })().finally(()=>{pending=null;});
  return pending;
}
