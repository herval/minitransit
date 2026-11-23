import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {compactSnapshot} from '../lib/map-data.mjs';
import {createMapGeometry,locateTrain} from '../public/regional-geometry.js';
import {trainDelay} from '../public/model.js';

// Supply a recorded full getRegionalSnapshot() response. No network calls.
const path=process.argv[2];
if(!path)throw new Error('Usage: node scripts/benchmark-map-data.mjs /path/to/full-snapshot.json');
const full=JSON.parse(await readFile(path,'utf8'));
const network=JSON.parse(await readFile(new URL('../data/regional-schedule.json',import.meta.url),'utf8')).network;
const compact=compactSnapshot(full,network),geometry=createMapGeometry(network,1);
let comparisons=0;
for(const offset of [0,15000,60000,120000,179000,181000]){
  for(let index=0;index<full.trips.trains.length;index++){
    const now=full.serverTime+offset,original=full.trips.trains[index],slim=compact.trips.trains[index];
    const a=locateTrain(original,network,geometry,now),b=locateTrain(slim,network,geometry,now);
    assert.equal(Boolean(a),Boolean(b),original.id+' position availability');
    if(a)assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<.001,original.id+' position');
    assert.deepEqual(trainDelay(original,now),trainDelay(slim,now),original.id+' delay');
    comparisons++;
  }
}
const before=Buffer.from(JSON.stringify(full)),after=Buffer.from(JSON.stringify(compact));
console.log(JSON.stringify({vehicles:full.trips.trains.length,comparisons,fullBytes:before.length,compactBytes:after.length,gzipBefore:gzipSync(before).length,gzipAfter:gzipSync(after).length,reductionPercent:Number((100*(1-after.length/before.length)).toFixed(1))},null,2));
