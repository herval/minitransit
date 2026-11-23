import {project,REGIONAL_MAX_AGE} from './networks.js';
import {sourceState,inferSegment,upcomingStops} from './model.js';
import {motionAt} from './map-motion.js';

export function metrics(points){
 const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances.at(-1)+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
 return {points,distances,length:distances.at(-1)||0};
}
export function pointAt(path,fraction){
 if(!path?.points.length)return null;
 const distance=Math.max(0,Math.min(1,fraction))*path.length;
 let i=path.distances.findIndex((d,i)=>i&&d>=distance);if(i<1)i=Math.max(1,path.points.length-1);
 const a=path.points[i-1],b=path.points[i]||a,length=Math.hypot(b.x-a.x,b.y-a.y)||1,t=(distance-path.distances[i-1])/length;
 return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI};
}
function octilinear(a,b,straight){
 if(straight)return [a,b];
 const dx=b.x-a.x,dy=b.y-a.y;
 const bend=Math.abs(dx)>=Math.abs(dy)?{x:b.x-Math.sign(dx)*Math.abs(dy),y:a.y}:{x:a.x,y:b.y-Math.sign(dy)*Math.abs(dx)};
 return[a,bend,b].filter((p,i,all)=>!i||Math.hypot(p.x-all[i-1].x,p.y-all[i-1].y)>.001);
}
function offsetPath(points,offset){
 if(!offset)return points;
 const normals=points.slice(1).map((p,i)=>{const a=points[i],length=Math.hypot(p.x-a.x,p.y-a.y)||1;return{x:-(p.y-a.y)/length*offset,y:(p.x-a.x)/length*offset};});
 const shifted=points.map((p,i)=>{
  if(!i)return{x:p.x+normals[0].x,y:p.y+normals[0].y};
  if(i===points.length-1)return{x:p.x+normals.at(-1).x,y:p.y+normals.at(-1).y};
  const n=normals[i-1],m=normals[i],u={x:p.x-points[i-1].x,y:p.y-points[i-1].y},v={x:points[i+1].x-p.x,y:points[i+1].y-p.y};
  const cross=u.x*v.y-u.y*v.x;if(Math.abs(cross)<.001)return{x:p.x+(n.x+m.x)/2,y:p.y+(n.y+m.y)/2};
  const t=((m.x-n.x)*v.y-(m.y-n.y)*v.x)/cross;return{x:p.x+n.x+u.x*t,y:p.y+n.y+u.y*t};
 });
 return[points[0],...shifted,points.at(-1)];
}
export function createMapGeometry(network,scale=1,{lines:enabledLines}={}){
 const shapes=[],direct=new Map(),adjacency=new Map(),cache=new Map();
 const key=(a,b,line)=>[a,b].sort().join('|')+'|'+line;
 function neighbor(line,a,b){if(!adjacency.has(line))adjacency.set(line,new Map());const graph=adjacency.get(line);if(!graph.has(a))graph.set(a,[]);graph.get(a).push(b);}
 for(const edge of network.edges){
  const a=network.stations[edge.a],b=network.stations[edge.b];if(!a||!b)continue;
  const lines=edge.lines.filter(id=>!enabledLines||enabledLines.has(id)).sort();
  lines.forEach((id,index)=>{
   const line=network.lines[id],base=octilinear(a,b,line.mode==='ferry'),offset=(index-(lines.length-1)/2)*3/scale;
   const path=metrics(offsetPath(base,offset));
   const shape={...path,a:edge.a,b:edge.b,line:id,agency:line.agency,mode:line.mode};
   shapes.push(shape);direct.set(key(edge.a,edge.b,id),shape);neighbor(id,edge.a,edge.b);neighbor(id,edge.b,edge.a);
  });
 }
 function leg(line,from,to){
  const value=direct.get(key(from,to,line));if(!value)return null;
  return value.a===from?value.points:[...value.points].reverse();
 }
 function path(line,from,to){
  const id=line+'|'+from+'|'+to;if(cache.has(id))return cache.get(id);
  if(from===to&&network.stations[from])return metrics([network.stations[from],network.stations[from]]);
  let points=leg(line,from,to);
  if(!points){
   const graph=adjacency.get(line),queue=[from],previous=new Map([[from,null]]);
   for(let i=0;i<queue.length&&!previous.has(to);i++)for(const next of graph?.get(queue[i])||[])if(!previous.has(next)){previous.set(next,queue[i]);queue.push(next);}
   if(previous.has(to)){
    const nodes=[];for(let id=to;id!=null;id=previous.get(id))nodes.unshift(id);
    points=[];for(let i=1;i<nodes.length;i++)points.push(...leg(line,nodes[i-1],nodes[i]).slice(i===1?0:1));
   }
  }
  const result=points?metrics(points):null;cache.set(id,result);return result;
 }
 return {shapes,path};
}

export function locateTrain(train,network,geometry,now){
 if(train.mapMotion){
  const motion=motionAt(train,now);if(!motion)return null;
  const position=pointAt(geometry.path(train.line,motion.from,motion.to),motion.progress);
  return position?{...motion,...position}:null;
 }
 const fix=train.position;
 if(fix&&sourceState(fix.timestamp,now,REGIONAL_MAX_AGE)==='live'){
  const point=project(fix.lat,fix.lon,network.projectionAngle??25);let closest=null;
  for(let i=1;i<train.stops.length;i++){
   const a=network.stations[train.stops[i-1].station],b=network.stations[train.stops[i].station];if(!a||!b||a.id===b.id)continue;
   const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
   const fraction=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(length||1)));
   const distance=Math.hypot(point.x-a.x-fraction*dx,point.y-a.y-fraction*dy);
   if(!closest||distance<closest.distance)closest={a,b,fraction,distance,nextIndex:i};
  }
  if(closest&&closest.distance<100){
   const path=geometry.path(train.line,closest.a.id,closest.b.id),position=pointAt(path,closest.fraction);
   if(position)return {...position,method:'Reported location · snapped to the schematic',timestamp:fix.timestamp,nextIndex:closest.nextIndex};
  }
 }
 const segment=inferSegment(train,now);if(!segment)return null;
 const position=pointAt(geometry.path(train.line,segment.from,segment.to),segment.progress);
 return position?{...position,method:'Estimated between stop predictions',timestamp:train.timestamp,nextIndex:train.stops.findIndex(s=>s.station===segment.to)}:null;
}
export function remainingStops(train,position,now){
 const predicted=upcomingStops(train,now);if(predicted.length)return predicted;
 if(train.position&&sourceState(train.position.timestamp,now,REGIONAL_MAX_AGE)==='live'&&position?.nextIndex>=0)return train.stops.slice(position.nextIndex).filter(s=>!s.skipped).map(s=>({...s,time:null,atStation:false}));
 return [];
}
