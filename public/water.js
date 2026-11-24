import {project} from './networks.js';
import {WATER_POLYGONS} from './water-data.js';

const paths=new Map();
export function waterPath(angle=25){
 if(!paths.has(angle)){
  const path=WATER_POLYGONS.flatMap(polygon=>polygon.map(ring=>ring.map(([lon,lat],i)=>{
   const point=project(lat,lon,angle);
   return (i?'L':'M')+Math.round(point.x*1000)/1000+','+Math.round(point.y*1000)/1000;
  }).join('')+'Z')).join('');
  paths.set(angle,path);
 }
 return paths.get(angle);
}
