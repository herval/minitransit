import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {gunzipSync} from 'node:zlib';
import {createAppServer} from '../server.mjs';

async function serve(t,options){
  const server=await createAppServer(options);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return (path,headers={},method='GET')=>new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.address().port,path,headers,method},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });
    req.on('error',reject);req.end();
  });
}

test('health checks and map assets work without contacting a transit feed',async t=>{
  let calls=0;
  const get=await serve(t,{snapshot:async()=>{calls++;throw new Error('offline');}});
  const health=await get('/healthz');
  assert.equal(health.status,200);assert.deepEqual(JSON.parse(health.body),{ok:true});
  const page=await get('/');
  assert.equal(page.status,200);assert.match(page.headers['content-type'],/^text\/html/);
  assert.match(page.body.toString(),/theme\.js/);assert.match(page.body.toString(),/map\.js/);
  for(const [path,type] of [['/map.js','text/javascript'],['/map.css','text/css'],['/favicon.svg','image/svg+xml']]){
    const asset=await get(path);assert.equal(asset.status,200);assert.ok(asset.headers['content-type'].startsWith(type));
  }
  for(const path of ['/server.mjs','/.env','/data/schedule.json','/%2e%2e%2fpackage.json'])assert.equal((await get(path)).status,404);
  assert.equal((await get('/%invalid')).status,400);
  const post=await get('/',{},'POST');assert.equal(post.status,405);assert.equal(post.headers.allow,'GET, HEAD');
  assert.equal(calls,0);
});

test('static responses support conditional requests, HEAD and negotiated compression',async t=>{
  const get=await serve(t,{}),plain=await get('/map.js');
  const compressed=await get('/map.js',{'Accept-Encoding':'gzip'});
  assert.equal(compressed.headers['content-encoding'],'gzip');assert.deepEqual(gunzipSync(compressed.body),plain.body);
  const disabled=await get('/map.js',{'Accept-Encoding':'gzip;q=0, *;q=1'});
  assert.equal(disabled.headers['content-encoding'],undefined);assert.deepEqual(disabled.body,plain.body);
  const cached=await get('/map.js',{'If-None-Match':plain.headers.etag});assert.equal(cached.status,304);assert.equal(cached.body.length,0);
  const head=await get('/map.js',{},'HEAD');assert.equal(head.status,200);assert.equal(Number(head.headers['content-length']),plain.body.length);assert.equal(head.body.length,0);
});

test('the live endpoint passes its server secret only to the adapter and hides failures',async t=>{
  const key='test-secret-never-published',snapshot={provider:'511',trips:{status:'live',trains:Array(30).fill({id:'fixture',line:'yellow'})}};
  let failing=false;
  const get=await serve(t,{apiKey:key,snapshot:async options=>{assert.equal(options.apiKey,key);if(failing)throw new Error('upstream URL contained '+key);return snapshot;}});
  const live=await get('/api/live',{'Accept-Encoding':'gzip'});
  assert.equal(live.status,200);assert.equal(live.headers['cache-control'],'no-store');
  assert.deepEqual(JSON.parse(gunzipSync(live.body)),snapshot);
  failing=true;
  const failure=await get('/api/live');assert.equal(failure.status,503);assert.ok(!failure.body.toString().includes(key));assert.match(JSON.parse(failure.body).error,/Retrying/);
});
