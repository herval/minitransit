import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {zipSync,strToU8} from 'fflate';
import {parseRegionalSchedule,hydrateSchedule} from '../lib/regional-schedule.mjs';
import {normalizeTrips,upcomingStops} from '../public/model.js';
import {mergeVehicles} from '../lib/regional-live.mjs';
import {createMapGeometry,pointAt,locateTrain,remainingStops} from '../public/regional-geometry.js';

function archive(){
 const codes=[['BA',1],['CT',2],['SF',0],['SC',0],['SB',4],['SA',2],['AC',3]],routes=[['route_id','agency_id','route_short_name','route_type','route_color']],trips=[['route_id','service_id','trip_id','trip_headsign','direction_id']],stops=[['stop_id','stop_name','stop_lat','stop_lon','location_type','parent_station','platform_code']],times=[['trip_id','arrival_time','departure_time','stop_id','stop_sequence']];
 stops.push(['hub','Shared Hub','37.7','-122.4','1','','']);
 for(const[code,type]of codes){
  routes.push([code+':1',code,code==='BA'?'Yellow-N':code==='SC'?'Blue Line':code,type,'3399AA']);
  trips.push([code+':1','weekday',code+':trip','Terminus','0']);
  for(let i=0;i<3;i++){
   const id=code+':'+i;stops.push([id,code+' stop '+i,String(37.7-i*.02),String(-122.4+i*.02),'0',i===0?'hub':'',String(i+1)]);
   times.push([code+':trip','10:'+String(i*10).padStart(2,'0')+':00','10:'+String(i*10+1).padStart(2,'0')+':00',id,String(i*10+1)]);
  }
 }
 // Same local route/trip IDs in different agencies must remain distinct.
 routes.push(['SF:bus','SF','Bus','3','111111']);trips.push(['SF:bus','weekday','SF:ignored','Bus','0']);
 const csv=rows=>rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
 const files={'routes.txt':routes,'trips.txt':trips,'stops.txt':stops,'stop_times.txt':times,'calendar.txt':[['service_id','monday','tuesday','wednesday','thursday','friday','saturday','sunday','start_date','end_date'],['weekday','1','1','1','1','1','1','1','20260101','20271231']],'calendar_dates.txt':[['service_id','date','exception_type']],'feed_info.txt':[['feed_version'],['fixture']]};
 return zipSync(Object.fromEntries(Object.entries(files).map(([name,rows])=>[name,strToU8(csv(rows))])));
}
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'minitransit-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'regional.zip');await writeFile(path,Buffer.concat([archive(),Buffer.alloc(40)]));return parseRegionalSchedule(path);}

test('regional schedules filter modes, retain shared hubs and round-trip compact stop patterns',async t=>{
 const s=await fixture(t);assert.equal(Object.keys(s.trips).length,7);assert.equal(s.routes['SF:bus'],undefined);
 assert.equal(s.parents['CT:0'],'hub');assert.equal(s.parents['BA:0'],'hub');assert.ok(s.network.stations.hub.agencies.includes('SF'));
 assert.equal(s.routes['BA:1'].lineId,'BA:yellow');assert.equal(s.routes['CT:1'].lineId,'CT:rail');
 const copy=hydrateSchedule(JSON.parse(JSON.stringify(s)));assert.deepEqual(copy.trips['CT:trip'].stops,s.trips['CT:trip'].stops);assert.ok(!JSON.stringify(s.trips['CT:trip']).includes('"stops"'));
 assert.equal(copy.trips['CT:trip'].stops[1][3],11);assert.equal(s.platformCodes['CT:1'],'2');
});

test('reported locations merge with predictions, never duplicate trips or manufacture ETAs',async t=>{
 const s=await fixture(t),stamp=Date.parse('2026-11-23T18:00:00Z')/1000;
 const descriptor={tripId:'CT:trip',routeId:'CT:1',startDate:'20261123'};
 const trips=normalizeTrips({header:{timestamp:stamp},entity:[{tripUpdate:{trip:descriptor,timestamp:stamp,stopTimeUpdate:[]}}]},s,stamp*1000);
 mergeVehicles(trips,{header:{timestamp:stamp},entity:[{vehicle:{trip:descriptor,timestamp:stamp,position:{latitude:37.69,longitude:-122.39}}},{vehicle:{trip:{tripId:'unknown'},timestamp:stamp,position:{latitude:37.7,longitude:-122.4}}}]},s,stamp*1000);
 assert.equal(trips.trains.length,1);assert.equal(trips.trains[0].agency,'CT');assert.equal(trips.counts.reportedPositions,1);assert.deepEqual(upcomingStops(trips.trains[0],stamp*1000),[]);
 const geometry=createMapGeometry(s.network,2),position=locateTrain(trips.trains[0],s.network,geometry,stamp*1000);
 assert.ok(position);assert.match(position.method,/Reported/);const stops=remainingStops(trips.trains[0],position,stamp*1000);assert.ok(stops.length);assert.ok(stops.every(s=>s.time===null));
 assert.equal(locateTrain(trips.trains[0],s.network,geometry,(stamp+181)*1000),null);assert.deepEqual(remainingStops(trips.trains[0],position,(stamp+181)*1000),[]);
 const cancelled=normalizeTrips({header:{timestamp:stamp},entity:[{tripUpdate:{trip:{...descriptor,scheduleRelationship:3},timestamp:stamp}}]},s,stamp*1000);
 mergeVehicles(cancelled,{header:{timestamp:stamp},entity:[{vehicle:{trip:descriptor,timestamp:stamp,position:{latitude:37.69,longitude:-122.39}}}]},s,stamp*1000);
 assert.equal(cancelled.trains.length,0,'A vehicle fix cannot restore a cancelled trip');
});

test('regional geometry keeps every edge at station centers and follows the local corridor for expresses',async t=>{
 const s=await fixture(t),g=createMapGeometry(s.network,2);
 for(const shape of g.shapes){const a=s.network.stations[shape.a],b=s.network.stations[shape.b];assert.deepEqual({x:shape.points[0].x,y:shape.points[0].y},{x:a.x,y:a.y});assert.deepEqual({x:shape.points.at(-1).x,y:shape.points.at(-1).y},{x:b.x,y:b.y});}
 const path=g.path('CT:rail','hub','CT:2');assert.ok(path);const first=pointAt(path,0),last=pointAt(path,1);assert.equal(first.x,s.network.stations.hub.x);assert.ok(Math.abs(last.y-s.network.stations['CT:2'].y)<1e-8);
 assert.ok(g.path('CT:rail','CT:2','hub'));assert.equal(g.path('CT:rail','hub','nonexistent'),null);
});

test('looping routes match repeated stops by sequence instead of reusing a later prediction',async t=>{
 const s=await fixture(t),trip=s.trips['AC:trip'];s.patterns[trip.pattern][2][0]='hub';
 const stamp=Date.parse('2026-11-23T18:00:00Z')/1000;
 const live=normalizeTrips({header:{timestamp:stamp},entity:[{tripUpdate:{trip:{tripId:'AC:trip',routeId:'AC:1',startDate:'20261123'},stopTimeUpdate:[{stopId:'AC:0',stopSequence:1,departure:{time:stamp+60}},{stopId:'AC:0',stopSequence:21,departure:{time:stamp+1200}}]}}]},s,stamp*1000);
 assert.equal(live.trains[0].stops[0].departure,stamp+60);assert.equal(live.trains[0].stops[2].departure,stamp+1200);
});
