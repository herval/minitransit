import {test} from 'node:test';
import assert from 'node:assert/strict';
import {busHubName,busHubPriority,stationRadius,clusterVehicles} from '../public/map-overview.js';
import {createMapGeometry,createCorridors} from '../public/regional-geometry.js';

const stop=(name,agencies=['AC'])=>({name,agencies,lines:['AC:1','AC:2'],major:true});
test('bus overview names real transfer hubs without promoting every school terminus',()=>{
 assert.equal(busHubName(stop('Broadway & 14th St (12th St BART)')),'12th St BART');
 assert.equal(busHubName(stop('Skyline High School')),null);
 assert.equal(busHubName(stop('Eastmont Transit Center')),'Eastmont Transit Center');
 assert.equal(busHubName(stop('Shared station',['AC','BA'])),'Shared');
 assert.ok(busHubPriority(stop('12th St BART'))>busHubPriority(stop('Skyline High School')));
});
test('stop radii stay bounded even where many bus routes share a hub',()=>{
 for(const lanes of [1,8,40,123]){
  assert.ok(stationRadius(stop('12th St BART'),{bus:true,lanes})<=4.5);
  assert.ok(stationRadius(stop('Shared station',['AC','BA']),{lanes})<=8);
 }
 assert.equal(stationRadius(stop('Local stop'),{bus:true}),2.8);
 assert.ok(stationRadius(stop('Local stop'),{bus:true,selected:true})>stationRadius(stop('Local stop'),{bus:true}));
});
test('vehicle grouping preserves every bus, respects distance, and is stable across input order',()=>{
 const points=[{id:'a',x:0,y:0},{id:'b',x:4,y:2},{id:'c',x:200,y:0},{id:'d',x:204,y:1},{id:'e',x:500,y:400}];
 const groups=clusterVehicles(points,24);
 assert.deepEqual(groups.map(g=>g.members.map(p=>p.id)),[['a','b'],['c','d'],['e']]);
 assert.deepEqual(clusterVehicles([...points].reverse(),24),groups);
 assert.deepEqual(groups.flatMap(g=>g.members.map(p=>p.id)).sort(),points.map(p=>p.id).sort());
 assert.equal(groups[0].x,2);assert.equal(groups[0].y,1);
 const chain=clusterVehicles(Array.from({length:30},(_,i)=>({id:String(i).padStart(2,'0'),x:i*15,y:0})),24);
 for(const group of chain)for(const a of group.members)for(const b of group.members)assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<=48,'A cluster cannot chain across the city');
 assert.deepEqual(clusterVehicles([],24),[]);
});
test('shared bus corridors use one centered track while rails retain their centered lanes',()=>{
 const network={stations:{a:{x:0,y:0},b:{x:100,y:50}},lines:{'AC:1':{mode:'bus',agency:'AC'},'AC:2':{mode:'bus',agency:'AC'},'BA:red':{mode:'train',agency:'BA'},'BA:yellow':{mode:'train',agency:'BA'}},edges:[{a:'a',b:'b',lines:['AC:1','AC:2','BA:red','BA:yellow']}]};
 const geometry=createMapGeometry(network,2),bus=geometry.shapes.filter(s=>s.mode==='bus');
 assert.deepEqual(bus[0].points,bus[1].points);
 assert.deepEqual(bus[0].points[0],network.stations.a);assert.deepEqual(bus[0].points.at(-1),network.stations.b);
 const corridors=createCorridors(network,new Set(['AC:1','AC:2']));assert.equal(corridors.length,1);assert.deepEqual(corridors[0].points,bus[0].points);
 assert.notDeepEqual(geometry.shapes.find(s=>s.line==='BA:red').points,geometry.shapes.find(s=>s.line==='BA:yellow').points);
 assert.deepEqual(createCorridors(network,new Set()),[]);
});
