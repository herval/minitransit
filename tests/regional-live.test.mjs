import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import G from 'gtfs-realtime-bindings';
import {hydrateSchedule} from '../lib/regional-schedule.mjs';
import {getRegionalSnapshot} from '../lib/regional-live.mjs';
import {serviceActive} from '../public/model.js';

test('all networks share bounded upstream requests and old source timestamps survive failures',async()=>{
 const originalFetch=globalThis.fetch,originalNow=Date.now;
 const schedule=hydrateSchedule(JSON.parse(await readFile(new URL('../data/regional-schedule.json',import.meta.url),'utf8')));
 const [id,trip]=Object.entries(schedule.trips).find(([,t])=>schedule.routes[t.route].agency_id==='BA'&&serviceActive(schedule,t.service,'20261123'));
 let clock=Date.parse('2026-11-23T18:00:00Z'),calls=0,failed=false;Date.now=()=>clock;
 const stamp=clock/1000,encode=value=>G.transit_realtime.FeedMessage.encode(value).finish();
 const updates=encode({header:{gtfsRealtimeVersion:'2.0',timestamp:stamp},entity:[{id:'fixture',tripUpdate:{trip:{tripId:id,routeId:trip.route,startDate:'20261123'},timestamp:stamp,stopTimeUpdate:trip.stops.map((s,i)=>({stopId:s[4],arrival:{time:stamp-20+i*60},departure:{time:stamp-10+i*60}}))}}]});
 const empty=encode({header:{gtfsRealtimeVersion:'2.0',timestamp:stamp},entity:[]});
 globalThis.fetch=async url=>{calls++;assert.equal(new URL(url).searchParams.get('agency'),'RG');assert.equal(new URL(url).searchParams.get('api_key'),'fixture-secret');if(failed)return new Response('failure',{status:503});return new Response(String(url).includes('tripupdates')?updates:empty);};
 try{
  const [a,b]=await Promise.all([getRegionalSnapshot({apiKey:'fixture-secret'}),getRegionalSnapshot({apiKey:'fixture-secret'})]);
  assert.equal(calls,3,'Concurrent visitors share three regional requests');assert.equal(a.trips.status,'live');assert.equal(a.trips.trains.length,b.trips.trains.length);assert.ok(!JSON.stringify(a).includes('fixture-secret'));
  clock+=21000;await getRegionalSnapshot({apiKey:'fixture-secret'});assert.equal(calls,3,'Browser refresh cannot bypass upstream cache');
  failed=true;clock+=150000;const failure=await getRegionalSnapshot({apiKey:'fixture-secret'});assert.equal(calls,5,'Alerts retain their longer cache');assert.equal(failure.trips.timestamp,stamp);assert.equal(failure.trips.status,'live');
  clock+=31000;const stale=await getRegionalSnapshot({apiKey:'fixture-secret'});assert.equal(calls,5);assert.equal(stale.trips.status,'stale');assert.equal(stale.trips.timestamp,stamp);assert.equal(stale.trips.counts.positionedTrips,0);assert.deepEqual(stale.trips.departures,{});
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});
