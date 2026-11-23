import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTrips,upcomingStops,trainDelay,serviceGaps} from '../public/model.js';
const now=Date.parse('2026-11-22T18:00:00Z'),stamp=now/1000;
const schedule={parents:{'A-1':'A','B-1':'B','C-1':'C','A-2':'A'},platformCodes:{'A-1':'1','A-2':'2','B-1':'1','C-1':'3'},stationNames:{A:'Alpha',B:'Bravo',C:'Charlie'},calendar:[{service_id:'s',start_date:'20260101',end_date:'20261231',sunday:'1'}],exceptions:[],trips:{t:{route:'1',service:'s',directionId:'1',stops:[['A',36000,36010,1,'A-1'],['B',36100,36110,2,'B-1'],['C',36200,36210,3,'C-1']]}}};
const normalize=updates=>normalizeTrips({header:{timestamp:stamp},entity:[{tripUpdate:{trip:{tripId:'t'},stopTimeUpdate:updates}}]},schedule,now);
test('Reported delays preserve zero and negative values while missing delay stays unknown',()=>{
 const value=normalize([{stopId:'A-2',departure:{time:stamp+20,delay:0,uncertainty:30}},{stopId:'B-1',arrival:{time:stamp+80,delay:-25}},{stopId:'C-1',arrival:{time:stamp+150}}]);
 const train=value.trains[0];assert.equal(train.directionId,1);assert.equal(train.stops[0].platform,'2');assert.equal(train.stops[0].platformSource,'reported');assert.equal(train.stops[0].departureDelay,0);assert.equal(train.stops[1].arrivalDelay,-25);assert.equal(train.stops[2].arrivalDelay,null);assert.equal(value.departures.A[0].delay,0);assert.equal(value.departures.A[0].scheduledTime,36010);
 assert.equal(trainDelay(train,now).seconds,0);assert.equal(trainDelay(train,now).uncertainty,30);assert.equal(trainDelay(train,now+30000).seconds,-25);
});
test('Upcoming stops exclude passed/skipped stops, retain unpredicted later stops, and do not invent ETAs',()=>{
 const train={timestamp:stamp,stops:[{station:'past',arrival:stamp-60,departure:stamp-50},{station:'skip',arrival:stamp+10,skipped:true},{station:'next',arrival:stamp+30,departure:stamp+40,arrivalDelay:90,platform:'2'},{station:'later',arrival:null,departure:null}]};
 const stops=upcomingStops(train,now);assert.deepEqual(stops.map(s=>s.station),['next','later']);assert.equal(stops[0].time,stamp+30);assert.equal(stops[1].time,null);assert.equal(trainDelay(train,now).seconds,90);
 assert.equal(upcomingStops(train,now+35000)[0].atStation,true);assert.equal(upcomingStops({...train,timestamp:stamp-91},now).length,0);assert.equal(trainDelay({...train,cancelled:true},now),null);
});
test('A NO_DATA stop never exposes a delay, time, or fabricated on-time state',()=>{
 const value=normalize([{stopId:'A-1',scheduleRelationship:2,arrival:{time:stamp+20,delay:0}}]);assert.equal(value.trains[0].stops[0].arrival,null);assert.equal(value.trains[0].stops[0].arrivalDelay,null);assert.equal(trainDelay(value.trains[0],now),null);assert.equal(value.departures.A,undefined);
});
const departure=(id,minutes,scheduled,extra={})=>({id,line:'yellow',routeId:'1',directionId:0,headsign:'Antioch',terminal:'ANTC',time:stamp+minutes*60,scheduledTime:scheduled,serviceDate:'20261122',timestamp:stamp,...extra});
test('Gap clocks compare distinct trains on the same route and direction against their schedule',()=>{
 const first=departure('a',2,36000),second=departure('b',20,36600);
 const [gap]=serviceGaps([second,first,{...first}],now);assert.equal(gap.seconds,1080);assert.equal(gap.scheduledSeconds,600);assert.equal(gap.next.id,'a');
 assert.equal(serviceGaps([departure('a',2,36000),departure('b',22,37200)],now).length,0,'Normal 20-minute service is not a warning');
 assert.equal(serviceGaps([first,{...second,directionId:1}],now).length,0,'Opposite directions do not combine');
 assert.equal(serviceGaps([first,{...second,routeId:'2'}],now).length,0,'Direction IDs are scoped to their route');
 assert.equal(serviceGaps([first,{...second,timestamp:stamp-91}],now).length,0,'Stale predictions never create gap warnings');
 assert.equal(serviceGaps([first,{...second,time:null}],now).length,0);
});
test('Unknown schedules need a 20-minute gap and incomplete predictions make no claim',()=>{
 assert.equal(serviceGaps([departure('a',2,null),departure('b',14,null)],now).length,0);
 const [gap]=serviceGaps([departure('a',2,null),departure('b',24,null)],now);assert.equal(gap.seconds,1320);assert.equal(gap.scheduledSeconds,null);
 assert.equal(serviceGaps([departure('a',2,36000)],now).length,0);
 assert.equal(serviceGaps([departure('a',2,36000),departure('b',20,36600)],now+91000).length,0);
});
