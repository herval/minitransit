import {unzipSync, strFromU8} from 'fflate';
import bundled from '../data/schedule.json' with {type:'json'};
import stationCoordinates from '../data/station-coordinates.json' with {type:'json'};

export const SCHEDULE_URL = 'https://www.bart.gov/dev/schedules/google_transit.zip';
const records=new Map([['BART',{current:bundled,lastCheck:0,inFlight:null,lastWarning:null}]]);

export function canonicalStation(stop) {
  if(bundled.stationNames[stop.stop_id])return stop.stop_id;
  const lat=Number(stop.stop_lat),lon=Number(stop.stop_lon);
  if(Number.isFinite(lat)&&Number.isFinite(lon)){
    let closest=null,distance=400;
    for(const [id,point] of Object.entries(stationCoordinates)){
      const d=Math.hypot((lat-point[0])*111000,(lon-point[1])*111000*Math.cos(lat*Math.PI/180));
      if(d<distance){closest=id;distance=d;}
    }
    if(closest)return closest;
  }
  return stop.stop_id;
}

// BART's fields contain quoted station names and headsigns with commas.
export function csv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/,'');
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(field||row.length){row.push(field);rows.push(row);}
  const headers=rows.shift()||[];
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])));
}

export function parseSchedule(buffer) {
  const files=unzipSync(new Uint8Array(buffer));
  const read=name=>{if(!files[name])throw new Error(`GTFS missing ${name}`);return csv(strFromU8(files[name]));};
  const stops=read('stops.txt'), parents={}, stationNames={}, platformCodes={}, trips={}, routes={};
  const mapped=Object.fromEntries(stops.map(s=>[s.stop_id,canonicalStation(s)]));
  for(const s of stops){
    const id=mapped[s.parent_station]||mapped[s.stop_id];parents[s.stop_id]=id;
    if(bundled.stationNames[id])stationNames[id]=bundled.stationNames[id];
    if(s.platform_code)platformCodes[s.stop_id]=s.platform_code;
  }
  for(const t of read('trips.txt'))trips[t.trip_id]={route:t.route_id,service:t.service_id,headsign:t.trip_headsign,directionId:t.direction_id||null,stops:[]};
  const seconds=s=>s.split(':').reduce((a,b)=>a*60+Number(b),0);
  for(const s of read('stop_times.txt'))if(trips[s.trip_id])trips[s.trip_id].stops.push([parents[s.stop_id]||s.stop_id,seconds(s.arrival_time),seconds(s.departure_time),Number(s.stop_sequence),s.stop_id]);
  for(const t of Object.values(trips))t.stops.sort((a,b)=>a[3]-b[3]);
  for(const r of read('routes.txt'))routes[r.route_id]=r;
  if(Object.keys(trips).length<100||Object.keys(stationNames).length<40)throw new Error('Incomplete GTFS schedule');
  return {builtAt:new Date().toISOString(),feed:files['feed_info.txt']?read('feed_info.txt')[0]:{feed_version:'unknown'},parents,platformCodes,stationNames,trips,routes,calendar:files['calendar.txt']?read('calendar.txt'):[],exceptions:files['calendar_dates.txt']?read('calendar_dates.txt'):[]};
}

export async function getSchedule({apiKey}={}) {
  const provider=apiKey?'511':'BART';
  if(!records.has(provider))records.set(provider,{current:null,lastCheck:0,inFlight:null,lastWarning:null});
  const record=records.get(provider);
  if(Date.now()-record.lastCheck<12*3600_000)return {schedule:record.current,warning:record.lastWarning};
  if(record.inFlight)return record.inFlight;
  record.inFlight=(async()=>{
    record.lastCheck=Date.now();
    try{
      const url=apiKey?'https://api.511.org/transit/datafeeds?operator_id=BA&api_key='+encodeURIComponent(apiKey):SCHEDULE_URL;
      const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error(`Schedule HTTP ${response.status}`);
      const fresh=parseSchedule(await response.arrayBuffer());record.current=fresh;record.lastWarning=null;
      return {schedule:record.current,warning:null};
    }catch{
      record.lastWarning='Schedule refresh is unavailable; using the last verified BART schedule.';
      record.lastCheck=Date.now()-12*3600_000+5*60_000;
      return {schedule:record.current,warning:record.lastWarning};
    }
  })().finally(()=>{record.inFlight=null;});
  return record.inFlight;
}
