import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAppServer} from '../server.mjs';
import {fixture} from './fixtures/map-fixture.mjs';
import {motionAt} from '../public/map-motion.js';

async function serve(t,options){
  const server=await createAppServer(options);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return path=>fetch('http://127.0.0.1:'+server.address().port+path.url,{headers:path.headers||{}});
}

test('conditional map requests avoid resending unchanged data while updating the response clock',async t=>{
  const {network,full}=fixture();let current=full;
  const get=await serve(t,{snapshot:async()=>current,network:async()=>network});
  const first=await get({url:'/api/live'}),map=await first.json(),etag=first.headers.get('ETag');
  assert.equal(first.status,200);assert.equal(map.format,'map-v1');assert.ok(etag);assert.equal(map.trips.trains[0].stops,undefined);
  current={...current,serverTime:full.serverTime+181000};
  const cached=await get({url:'/api/live',headers:{'If-None-Match':etag}});
  assert.equal(cached.status,304);assert.equal(await cached.text(),'');assert.equal(Number(cached.headers.get('X-Server-Time')),current.serverTime);
  assert.equal(motionAt(map.trips.trains[0],Number(cached.headers.get('X-Server-Time'))),null,'304 cannot make an old location fresh');
  current={...current,trips:{...current.trips,trains:[{...current.trips.trains[0],headsign:'new destination'}]}};
  const changed=await get({url:'/api/live',headers:{'If-None-Match':etag}});assert.equal(changed.status,200);assert.notEqual(changed.headers.get('ETag'),etag);
});

test('full train and station details load only through their explicit endpoints',async t=>{
  const {network,full}=fixture();let calls=0;
  const get=await serve(t,{snapshot:async()=>{calls++;return full;},network:async()=>network});
  const map=await(await get({url:'/api/live'})).json();assert.equal(map.trips.departures,undefined);
  const train=await(await get({url:'/api/train?id='+encodeURIComponent(full.trips.trains[0].id)})).json();assert.equal(train.train.stops.length,3);assert.equal(train.train.stops[1].platform,'2');
  const station=await(await get({url:'/api/station?id=b'})).json();assert.equal(station.departures.length,2);
  assert.equal((await get({url:'/api/train?id=missing'})).status,404);assert.equal((await get({url:'/api/station?id=__proto__'})).status,404);
  assert.equal(calls,5);
});
