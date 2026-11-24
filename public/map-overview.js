export function busHubName(stop){
 const connection=stop.name.match(/\(([^)]*(?:BART|Transit Center|Ferry|Amtrak)[^)]*)\)/i)?.[1];
 if(connection)return connection;
 if(stop.agencies.some(id=>id!=='AC')||/BART|Transit Center|Transit Terminal|Ferry|Amtrak|Park\s*(?:&|and)\s*Ride/i.test(stop.name))return stop.name.replace(/ Station$/i,'');
 return null;
}
export function busHubPriority(stop){
 const name=busHubName(stop);if(!name)return 0;
 return (stop.agencies.some(id=>id!=='AC')?1000:0)+(/BART/i.test(name)?500:200)+Math.min(stop.lines.length,20);
}
export function stationRadius(stop,{bus=false,selected=false,lanes=1}={}){
 if(selected)return 7;
 if(bus)return busHubName(stop)?4.5:2.8;
 return Math.min(8,Math.max(stop.agencies.length>1?6.5:stop.major?5.5:3.5,(lanes-1)*1.5+2.3));
}

// Points use world coordinates multiplied by the screen scale. Panning does
// not change membership. A bounded centroid avoids long chains of buses.
export function clusterVehicles(points,radius=24){
 const groups=[],cells=new Map(),cellKey=(x,y)=>Math.floor(x/radius)+':'+Math.floor(y/radius);
 const insert=group=>{const key=cellKey(group.x,group.y);if(!cells.has(key))cells.set(key,new Set());cells.get(key).add(group);group.cell=key;};
 for(const point of [...points].sort((a,b)=>a.id.localeCompare(b.id))){
  const cx=Math.floor(point.x/radius),cy=Math.floor(point.y/radius);let closest=null,best=radius*radius;
  for(let x=cx-1;x<=cx+1;x++)for(let y=cy-1;y<=cy+1;y++)for(const group of cells.get(x+':'+y)||[]){
   const distance=(point.x-group.x)**2+(point.y-group.y)**2;
   if(distance<=best&&group.members.every(member=>(point.x-member.x)**2+(point.y-member.y)**2<=4*radius*radius)){closest=group;best=distance;}
  }
  if(!closest){const group={x:point.x,y:point.y,members:[point]};groups.push(group);insert(group);continue;}
  cells.get(closest.cell).delete(closest);
  const count=closest.members.length;closest.x=(closest.x*count+point.x)/(count+1);closest.y=(closest.y*count+point.y)/(count+1);closest.members.push(point);insert(closest);
 }
 return groups;
}
