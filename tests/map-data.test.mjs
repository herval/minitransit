import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compactSnapshot} from '../lib/map-data.mjs';
import {compactVehicle, motionAt} from '../public/map-motion.js';
import {trainDelay} from '../public/model.js';
import {createMapGeometry,locateTrain} from '../public/regional-geometry.js';
import {project} from '../public/networks.js';

import {fixture,stamp} from './fixtures/map-fixture.mjs';

test('compact motion preserves dwell, interpolation, sparse delays and source expiry',()=>{
  const {network,train}=fixture(),geometry=createMapGeometry(network,1),slim=compactVehicle(train,network);
  for(const offset of[-20,0,10,11,60,80,90,91,179,180,181]){
    const now=(stamp+offset)*1000,a=locateTrain(train,network,geometry,now),b=locateTrain(slim,network,geometry,now);
    assert.equal(Boolean(a),Boolean(b),'position at '+offset);
    if(a){assert.ok(Math.abs(a.x-b.x)<1e-8);assert.ok(Math.abs(a.y-b.y)<1e-8);}
    assert.deepEqual(trainDelay(slim,now),trainDelay(train,now),'delay at '+offset);
  }
  assert.equal(slim.stops,undefined);assert.equal(motionAt(slim,(stamp+181)*1000),null);
});

test('compact reported locations match the full trip in desktop and portrait projections',()=>{
  const {network,train}=fixture();train.position={lat:37.69,lon:-122.39,timestamp:stamp};
  const slim=compactVehicle(train,network);
  for(const angle of[25,0]){
    network.projectionAngle=angle;for(const station of Object.values(network.stations))Object.assign(station,project(station.lat,station.lon,angle));
    const geometry=createMapGeometry(network,2),a=locateTrain(train,network,geometry,stamp*1000),b=locateTrain(slim,network,geometry,stamp*1000);
    assert.ok(a&&b);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-8);assert.match(b.method,/Reported/);
  }
});

test('map responses contain lightweight gap cues and no full station departures or stop lists',()=>{
  const {full,network}=fixture(),value=compactSnapshot(full,network);
  assert.equal(value.format,'map-v1');assert.equal(value.trips.departures,undefined);assert.equal(value.trips.trains[0].stops,undefined);
  assert.equal(value.trips.gaps.length,1);assert.equal(value.trips.gaps[0].station,'b');assert.equal(value.trips.gaps[0].seconds,1200);
  assert.equal(full.trips.trains[0].stops.length,3,'Detailed data remains available server-side');
});

test('active-route geometry excludes hidden routes and keeps visible station anchors exact',()=>{
  const {network}=fixture();
  network.lines['CT:rail']={id:'CT:rail',agency:'CT',mode:'train'};
  for(const edge of network.edges)edge.lines.push('CT:rail');
  const geometry=createMapGeometry(network,2,{lines:new Set(['BA:yellow'])});
  assert.ok(geometry.shapes.length>0);assert.ok(geometry.shapes.every(shape=>shape.line==='BA:yellow'));
  assert.equal(geometry.path('CT:rail','a','c'),null);
  for(const shape of geometry.shapes){
    assert.equal(shape.points[0].x,network.stations[shape.a].x);
    assert.equal(shape.points.at(-1).y,network.stations[shape.b].y);
  }
});
