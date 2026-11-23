import {project} from '../../public/networks.js';
export const stamp=Date.parse('2026-11-23T18:00:00Z')/1000;
export function fixture(){
  const stations=Object.fromEntries(['a','b','c'].map((id,index)=>[id,{id,name:id,lat:37.7-index*.02,lon:-122.4+index*.02,...project(37.7-index*.02,-122.4+index*.02),public:true}]));
  const network={builtAt:'fixture',stations,lines:{'BA:yellow':{id:'BA:yellow',agency:'BA',mode:'train',color:'#edc63b',name:'Yellow'}},edges:[{a:'a',b:'b',lines:['BA:yellow']},{a:'b',b:'c',lines:['BA:yellow']}]};
  const stops=[
    {station:'a',sequence:1,arrival:stamp-20,departure:stamp+10,arrivalDelay:0,departureDelay:0,scheduledArrival:36000,scheduledDeparture:36030},
    {station:'b',sequence:2,arrival:stamp+80,departure:stamp+90,arrivalDelay:120,departureDelay:150,arrivalUncertainty:20,platform:'2',platformSource:'reported',scheduledArrival:36100,scheduledDeparture:36110},
    {station:'c',sequence:3,arrival:stamp+4000,departure:stamp+4010,arrivalDelay:300,departureDelay:310,scheduledArrival:36200,scheduledDeparture:36210}
  ];
  const train={id:'20261123:BA:fixture:',line:'BA:yellow',agency:'BA',routeName:'Yellow',headsign:'c',timestamp:stamp,maxAge:180,stops};
  const full={regional:true,serverTime:stamp*1000,provider:'511',trips:{timestamp:stamp,status:'live',trains:[train],departures:{b:[{id:'first',line:train.line,routeId:'BA:1',directionId:0,serviceDate:'20261123',time:stamp+120,scheduledTime:36000,timestamp:stamp,maxAge:180},{id:'second',line:train.line,routeId:'BA:1',directionId:0,serviceDate:'20261123',time:stamp+1320,scheduledTime:36600,timestamp:stamp,maxAge:180}]},counts:{matchedTrips:1},byAgency:{}},vehicles:{timestamp:stamp,status:'live'},alerts:{timestamp:stamp,items:[]},schedule:{networkVersion:'fixture'}};
  return {network,train,full};
}
