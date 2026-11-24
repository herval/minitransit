import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WATER_POLYGONS,WATER_SOURCE} from '../public/water-data.js';
import {waterPath} from '../public/water.js';
import {project} from '../public/networks.js';

const {network}=JSON.parse(readFileSync(new URL('../data/regional-schedule.json',import.meta.url)));
const islands=[['Alcatraz',37.82667,-122.42333],['Angel Island',37.8614,-122.432],['Treasure Island',37.824,-122.371],['Yerba Buena Island',37.8108,-122.3653]];
const bays=[['Central Bay',37.82,-122.35],['South Bay',37.58,-122.2],['San Pablo Bay',38.07,-122.4],['Lake Merritt',37.801,-122.257]];

function inside([x,y],ring){
 let result=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [ax,ay]=ring[i],[bx,by]=ring[j];
  if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)result=!result;
 }
 return result;
}
const inWater=(lat,lon)=>WATER_POLYGONS.some(([outer,...holes])=>inside([lon,lat],outer)&&!holes.some(ring=>inside([lon,lat],ring)));

test('the bundled Bay shoreline keeps every actual BART station on land',()=>{
 const bart=Object.values(network.stations).filter(stop=>stop.agencies.includes('BA'));
 assert.equal(bart.length,50);
 for(const stop of bart)assert.equal(inWater(stop.lat,stop.lon),false,stop.name+' is incorrectly drawn underwater');
});

test('the shoreline includes bay water and preserves its island cutouts',()=>{
 for(const [name,lat,lon] of bays)assert.equal(inWater(lat,lon),true,name+' is missing its water backdrop');
 for(const [name,lat,lon] of islands)assert.equal(inWater(lat,lon),false,name+' lost its land cutout');
 const [west,south,east,north]=WATER_SOURCE.bounds;
 for(const polygon of WATER_POLYGONS)for(const ring of polygon){
  assert.deepEqual(ring[0],ring.at(-1),'Shoreline rings must close');
  for(const [lon,lat] of ring)assert.ok(lon>=west&&lon<=east&&lat>=south&&lat<=north,'Shoreline exceeds the bundled region');
 }
});

// Match SVG's nonzero fill rule, rather than only checking the source GeoJSON.
function winding([x,y],ring){
 let result=0;
 for(let i=0;i<ring.length-1;i++){
  const a=ring[i],b=ring[i+1],side=(b[0]-a[0])*(y-a[1])-(x-a[0])*(b[1]-a[1]);
  if(a[1]<=y&&b[1]>y&&side>0)result++;
  if(a[1]>y&&b[1]<=y&&side<0)result--;
 }
 return result;
}
test('rendered shorelines stay aligned with station coordinates in both screen projections',()=>{
 for(const angle of [0,25]){
  const rings=[...waterPath(angle).matchAll(/M([^Z]+)Z/g)].map(match=>match[1].split('L').map(pair=>pair.split(',').map(Number)));
  const wet=(lat,lon)=>{const p=project(lat,lon,angle);return rings.reduce((sum,ring)=>sum+winding([p.x,p.y],ring),0)!==0;};
  for(const stop of Object.values(network.stations).filter(s=>s.agencies.includes('BA')))assert.equal(wet(stop.lat,stop.lon),false,stop.name+' is underwater at '+angle+' degrees');
  for(const [name,lat,lon] of bays)assert.equal(wet(lat,lon),true,name+' shifted away from the station projection');
  for(const [name,lat,lon] of islands)assert.equal(wet(lat,lon),false,name+' is filled in the SVG');
 }
});
