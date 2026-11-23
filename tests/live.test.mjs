import {test} from 'node:test';
import assert from 'node:assert/strict';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import bundled from '../data/schedule.json' with {type:'json'};
import {serviceActive,pacificDate} from '../public/model.js';
import {getLiveSnapshot} from '../lib/live.mjs';
import coordinates from '../data/station-coordinates.json' with {type:'json'};
import {zipSync,strToU8} from 'fflate';

function scheduleArchive() {
 const table=rows=>rows.map(row=>row.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
 const source=Object.entries(bundled.trips).filter(([,t])=>serviceActive(bundled,t.service,'20261122')&&t.route==='1');
 const selected=Array.from({length:120},(_,i)=>[String(i),source[i%source.length][1]]);
 const stops=[['stop_id','stop_name','stop_lat','stop_lon','location_type','parent_station','platform_code']];
 for(const [id,point] of Object.entries(coordinates))stops.push(['station_'+id,bundled.stationNames[id],...point,'1','','']);
 const platforms=new Set();for(const [,t] of selected)for(const s of t.stops)if(!platforms.has(s[4])){platforms.add(s[4]);stops.push(['platform_'+s[4],bundled.stationNames[s[0]],...coordinates[s[0]],'0','station_'+s[0],s[4].split('-').at(-1)])}
 const trips=[['route_id','service_id','trip_id','trip_headsign']],times=[['trip_id','arrival_time','departure_time','stop_id','stop_sequence']];
 const clock=s=>[Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');
 for(const [id,t] of selected){trips.push(['route_511',t.service,'trip_'+id,t.headsign]);for(const s of t.stops)times.push(['trip_'+id,clock(s[1]),clock(s[2]),'platform_'+s[4],s[3]])}
 const objects=items=>{const headers=Object.keys(items[0]);return [headers,...items.map(o=>headers.map(k=>o[k]))]};
 const files={'stops.txt':stops,'trips.txt':trips,'stop_times.txt':times,'routes.txt':[['route_id','route_short_name','route_color'],['route_511','Yellow-S','FFFF33']],'calendar.txt':objects(bundled.calendar),'calendar_dates.txt':objects(bundled.exceptions),'feed_info.txt':[['feed_version'],['test-511']]};
 return {bytes:zipSync(Object.fromEntries(Object.entries(files).map(([name,rows])=>[name,strToU8(table(rows))]))),selected};
}

test('The complete feed adapter preserves source age across network failures',async()=>{
 const originalFetch=globalThis.fetch,originalNow=Date.now;
 let clock=Date.parse('2026-11-22T18:00:00Z'),failed=false;
 Date.now=()=>clock;
 const id=Object.keys(bundled.trips).find(id=>serviceActive(bundled,bundled.trips[id].service,pacificDate(clock))&&bundled.trips[id].route==='1'&&bundled.trips[id].stops.length>5);
 const trip=bundled.trips[id],stamp=Math.floor(clock/1000);
 const message={header:{gtfsRealtimeVersion:'2.0',timestamp:stamp},entity:[{id:'fixture',tripUpdate:{trip:{tripId:id,startDate:'20261122'},stopTimeUpdate:trip.stops.map((s,i)=>({stopId:s[4],stopSequence:s[3],arrival:{time:stamp-30+i*90},departure:{time:stamp-20+i*90}}))}}]};
 const bytes=GtfsRealtimeBindings.transit_realtime.FeedMessage.encode(message).finish();
 const alertBytes=GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:'2.0',timestamp:stamp},entity:[]}).finish();
 globalThis.fetch=async url=>{
  if(String(url).endsWith('.zip'))return new Response('unavailable',{status:503});
  if(failed)return new Response('Cloudflare challenge',{status:403});
  return new Response(String(url).includes('tripupdate')?bytes:alertBytes,{headers:{'Content-Type':'application/x-protobuf'}});
 };
 try{
  const live=await getLiveSnapshot();assert.equal(live.trips.status,'live');assert.equal(live.trips.counts.matchedTrips,1);assert.equal(live.trips.counts.positionedTrips,1);assert.ok(Object.keys(live.trips.departures).length>0);
  failed=true;clock+=21000;
  const recovering=await getLiveSnapshot();assert.equal(recovering.trips.timestamp,stamp);assert.equal(recovering.trips.status,'live');assert.match(recovering.trips.error,/403/);
  clock+=91000;
  const stale=await getLiveSnapshot();assert.equal(stale.trips.status,'stale');assert.equal(stale.trips.timestamp,stamp);assert.equal(stale.trips.counts.positionedTrips,0);assert.deepEqual(stale.trips.departures,{});
  assert.match(stale.schedule.warning,/last verified/);
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});

test('511 uses its matching schedule and keeps tokens out of response payloads',async()=>{
 const originalFetch=globalThis.fetch,originalNow=Date.now;
 let clock=Date.parse('2026-11-22T18:00:00Z'),calls=0;Date.now=()=>clock;
 const archive=scheduleArchive(),[id,trip]=archive.selected[0],stamp=clock/1000;
 const message={header:{gtfsRealtimeVersion:'2.0',timestamp:stamp},entity:[{id:'fixture',tripUpdate:{trip:{tripId:'trip_'+id,startDate:'20261122'},stopTimeUpdate:trip.stops.map((s,i)=>({stopId:'platform_'+s[4],stopSequence:s[3],arrival:{time:stamp-30+i*90},departure:{time:stamp-20+i*90}}))}}]};
 const bytes=GtfsRealtimeBindings.transit_realtime.FeedMessage.encode(message).finish();
 const alerts=GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:'2.0',timestamp:stamp},entity:[]}).finish();
 const apiKey='test-token-not-a-real-credential';
 globalThis.fetch=async url=>{calls++;assert.equal(new URL(url).hostname,'api.511.org');assert.equal(new URL(url).searchParams.get('api_key'),apiKey);return new Response(String(url).includes('datafeeds')?archive.bytes:String(url).includes('tripupdates')?bytes:alerts)};
 try{
  const live=await getLiveSnapshot({apiKey});assert.equal(live.provider,'511');assert.equal(live.trips.status,'live');assert.equal(live.trips.counts.matchedTrips,1);assert.equal(live.trips.trains[0].line,'yellow');assert.ok(coordinates[live.trips.trains[0].stops[0].station]);assert.ok(!JSON.stringify(live).includes(apiKey));
  const before=calls;clock+=21000;await getLiveSnapshot({apiKey});assert.equal(calls,before,'A browser refresh must not bypass upstream cache intervals');
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});
