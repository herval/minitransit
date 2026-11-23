import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNetworkGeometry} from '../public/geometry.js';

const coordinates={A:{x:0,y:0},B:{x:0,y:100},C:{x:0,y:200},D:{x:100,y:100},E:{x:200,y:100}};
const routes=[
  {id:'red',laneOrder:-3.5,ids:['A','B','C']},
  {id:'blue',laneOrder:10.5,ids:['A','B','D','E']},
  {id:'orange',laneOrder:-3.5,ids:['C','B','A']}
];

function pointAt(geometry,distance){
  for(let i=1;i<geometry.points.length;i++){
    const a=geometry.points[i-1],b=geometry.points[i],length=Math.hypot(b.x-a.x,b.y-a.y);
    if(distance<=length+1e-7){const t=length?distance/length:0;return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}}
    distance-=length;
  }
  return geometry.points.at(-1);
}

test('lane bundles stay centered when routes split or run in opposite directions',()=>{
  const network=buildNetworkGeometry(routes,coordinates);
  for(const bundle of network.bundles){
    const offsets=Object.values(bundle.lanes);
    assert.equal(offsets.reduce((sum,value)=>sum+value,0),0);
    if(offsets.length===1)assert.deepEqual(offsets,[0]);
  }
  assert.deepEqual(Object.values(network.bundles.find(edge=>edge.a==='A'&&edge.b==='B').lanes),[-7,0,7]);
  assert.deepEqual(Object.values(network.bundles.find(edge=>edge.a==='B'&&edge.b==='C').lanes),[-3.5,3.5]);
  const blue=network.routes.get('blue');
  assert.ok(blue.points.filter(point=>point.x>0).every(point=>point.y===100),'The single-line branch runs through its station centerline');
});

test('every station distance resolves to the exact station center, including airport branches',()=>{
  const network=buildNetworkGeometry(routes,coordinates,{branches:[{line:'red',ids:['C','D']},{line:'blue',ids:['C','D']}]});
  for(const geometry of [...network.routes.values(),...network.branches]){
    for(const id of geometry.ids){
      const point=pointAt(geometry,geometry.distances[id]),expected=coordinates[id];
      assert.ok(Math.hypot(point.x-expected.x,point.y-expected.y)<1e-6,`${geometry.line} at ${id}`);
    }
    assert.ok(geometry.points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)));
  }
});
