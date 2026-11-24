import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOccupancy,vehicleOccupancy,stationPressureWindows,stationPressure,pressureFillPath} from '../public/map-crowding.js';
import {compactSnapshot} from '../lib/map-data.mjs';
import {mergeVehicles} from '../lib/regional-live.mjs';
import {fixture,stamp} from './fixtures/map-fixture.mjs';
const now=stamp*1000;
const dep=(id,offset,delay,extra={})=>({id,line:'BA:yellow',routeId:'r',directionId:0,time:stamp+offset,timestamp:stamp,maxAge:180,delay,...extra});

test('occupancy preserves explicit empty and each reported category without fabricating counts',()=>{
 for(let status=0;status<=8;status++){
  const occupancy=normalizeOccupancy({occupancyStatus:status},stamp),state=vehicleOccupancy({occupancy},now);
  assert.equal(state.status,status);assert.equal(state.known,status!==7);assert.equal(occupancy.timestamp,stamp);
 }
 assert.equal(vehicleOccupancy({occupancy:normalizeOccupancy({occupancyStatus:0},stamp)},now).label,'Mostly empty');
 assert.equal(normalizeOccupancy({},stamp),null);
 assert.equal(normalizeOccupancy({occupancyStatus:null},stamp),null);
 assert.equal(normalizeOccupancy({occupancyStatus:99},stamp),null);
 assert.equal(normalizeOccupancy({occupancyStatus:0},NaN),null);
 assert.equal(normalizeOccupancy({occupancyStatus:'FEW_SEATS_AVAILABLE'},stamp).status,2);
 assert.equal(vehicleOccupancy({},now).known,false);
 assert.notEqual(vehicleOccupancy({occupancy:{status:5,timestamp:stamp}},now).label,vehicleOccupancy({occupancy:{status:6,timestamp:stamp}},now).label);
});

test('occupancy expires on its own report timestamp even with fresh stop predictions',()=>{
 const train={timestamp:stamp+181,occupancy:{status:2,timestamp:stamp}};
 assert.equal(vehicleOccupancy(train,now+180000).known,true);
 const expired=vehicleOccupancy(train,now+181000);assert.equal(expired.known,false);assert.equal(expired.stale,true);
 assert.equal(vehicleOccupancy({timestamp:stamp-200,occupancy:{status:0,timestamp:stamp}},now).known,true);
 assert.equal(vehicleOccupancy({occupancy:{status:0,timestamp:stamp+31}},now).known,false);
});

test('vehicle matching carries explicit occupancy independently of location availability',()=>{
 const schedule={regional:true,routes:{r:{lineId:'BA:yellow',agency_id:'BA'}},trips:{t:{route:'r',service:'s',directionId:0,stops:[['a',36000,36000,1,'a'],['b',36100,36100,2,'b']]}},calendar:[{service_id:'s',start_date:'20260101',end_date:'20261231',monday:'1'}],exceptions:[],parents:{},stationNames:{a:'a',b:'b'}};
 const train={id:'20261123:t:',tripId:'t',serviceDate:'20261123',timestamp:stamp,maxAge:180,stops:[]};
 const full={trains:[train],cancelled:[],counts:{}};
 mergeVehicles(full,{header:{timestamp:stamp},entity:[{vehicle:{trip:{tripId:'t',routeId:'r',startDate:'20261123'},occupancyStatus:0}}]},schedule,now);
 assert.equal(full.trains.length,1);assert.deepEqual(train.occupancy,{status:0,timestamp:stamp});assert.equal(train.position,undefined);
});

test('station pressure uses the next departure per direction, retaining unknown and on-time states',()=>{
 const windows=stationPressureWindows([dep('later',1000,1800),dep('first',120,0)],now);
 assert.equal(stationPressure(windows,now).seconds,0,'A distant delayed trip does not fill an on-time next departure');
 assert.equal(stationPressure(stationPressureWindows([dep('first',120,null),dep('later',1000,1800)],now),now),null,'Unknown next delay does not inherit a later delay');
 assert.equal(stationPressure(stationPressureWindows([dep('first',120,-30)],now),now).level,0);
 const other=dep('opposite',180,420,{directionId:1});
 const pressure=stationPressure(stationPressureWindows([dep('first',120,0),other],now),now);
 assert.equal(pressure.seconds,420);assert.equal(pressure.severity,'high');
});

test('pressure windows roll over on the client without loading full departures or refreshing a feed',()=>{
 const windows=stationPressureWindows([dep('first',20,120),dep('second',100,480),dep('third',600,0),dep('far',1200,1800)],now);
 assert.equal(windows.length,3,'Only windows that can become next before source expiry are retained');
 assert.equal(stationPressure(windows,now+35000).seconds,120);
 assert.equal(stationPressure(windows,now+35001).seconds,480);
 assert.equal(stationPressure(windows,now+116000).seconds,0,'Passing delayed services lowers pressure');
 assert.equal(stationPressure(windows,now+181000),null,'Unchanged responses cannot extend source freshness');
});

test('route focus, partial reports, invalid services and source recovery retain honest pressure',()=>{
 const values=[dep('a',120,600),dep('duplicate',240,900,{skipped:true}),dep('cancelled',120,1200,{cancelled:true}),dep('stale',120,1200,{timestamp:stamp-181}),dep('b',120,0,{line:'CT:rail',routeId:'c'}),dep('unknown',120,null,{directionId:1})];
 let windows=stationPressureWindows(values,now);
 assert.equal(stationPressure(windows,now).level,1);assert.equal(stationPressure(windows,now).partial,true);
 assert.equal(stationPressure(windows,now,line=>line==='CT:rail').level,0);
 assert.equal(stationPressure(windows,now,line=>line==='SF:N'),null);
 windows=stationPressureWindows([dep('a',120,60)],now);
 assert.equal(stationPressure(windows,now).level,.1,'A fresh reduced delay lowers fill');
 assert.equal(stationPressure(stationPressureWindows([dep('unknown',120,null)],now),now),null);
});

test('compact map carries bounded station pressure and independent occupancy, retaining full details server-side',()=>{
 const {full,network,train}=fixture();train.occupancy={status:0,timestamp:stamp-20};
 full.trips.departures.b=[dep('a',120,300),dep('b',1200,900)];
 full.trips.departures.a=[dep('unknown',120,null)];
 const map=compactSnapshot(full,network);
 assert.deepEqual(map.trips.trains[0].occupancy,train.occupancy);
 assert.equal(map.trips.departures,undefined);assert.equal(map.trips.pressure.b.length,2);
 assert.equal(map.trips.pressure.a,undefined,'Omitted all-unknown stations retain unknown semantics without extra payload');
 assert.equal(stationPressure(map.trips.pressure.b,now).seconds,300);
 assert.equal(map.trips.trains[0].stops,undefined);assert.equal(full.trips.departures.b.length,2);
});

test('station fill stays inside the original circle with empty and full boundaries',()=>{
 assert.equal(pressureFillPath(6,0),'');assert.equal(pressureFillPath(0,.5),'');
 for(const level of[.01,.1,.5,.9,1]){
  const path=pressureFillPath(6,level);assert.ok(path);assert.ok(!/NaN|Infinity/.test(path));
 }
 assert.equal(pressureFillPath(6,2),pressureFillPath(6,1));assert.equal(pressureFillPath(6,-1),'');
});
