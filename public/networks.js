export const AGENCIES=[
 {id:'BA',name:'BART',short:'BART',color:'#edc63b',types:[1],mode:'train'},
 {id:'CT',name:'Caltrain',short:'Caltrain',color:'#ed5755',types:[2],mode:'train'},
 {id:'SF',name:'Muni rail',short:'Muni',color:'#b58ad8',types:[0],mode:'tram'},
 {id:'SC',name:'VTA light rail',short:'VTA',color:'#46b79a',types:[0],mode:'tram'},
 {id:'SB',name:'SF Bay Ferry',short:'Ferries',color:'#4cadd2',types:[4],mode:'ferry'},
 {id:'SA',name:'SMART',short:'SMART',color:'#9dac58',types:[2],mode:'train'},
 {id:'AC',name:'AC Transit',short:'AC Transit',color:'#df9d50',types:[3],mode:'bus'}
];
export const AGENCY_BY_ID=Object.fromEntries(AGENCIES.map(a=>[a.id,a]));
export const REGIONAL_MAX_AGE=180;
export function project(lat,lon,degrees=25){const x=(lon+122.35)*1100,y=(38.62-lat)*1400,angle=degrees*Math.PI/180;return{x:x*Math.cos(angle)+y*Math.sin(angle),y:y*Math.cos(angle)-x*Math.sin(angle)};}
export function routeLine(route){
 const agency=AGENCY_BY_ID[route.agency_id];if(!agency||!agency.types.includes(Number(route.route_type)))return null;
 if(agency.id==='CT')return 'CT:rail';
 if(agency.id==='BA')return 'BA:'+(route.route_short_name||route.route_id.split(':').at(-1)).replace(/-[NS]$/i,'').toLowerCase();
 if(agency.id==='SC')return 'SC:'+(route.route_short_name||'').replace(/^Event-/,'').replace(/ Line$/,'').toLowerCase();
 return route.route_id;
}
