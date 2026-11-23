// Center the color lanes on each shared track, then join them inside station masks.
// A branch with one line always follows the station centerline.
export function buildNetworkGeometry(routes, coordinates, {spacing=7, branches=[], junctions=['_WYE']}={}) {
  const edges=new Map(), junctionSet=new Set(junctions);
  const edgeKey=(a,b)=>[a,b].sort().join('|');
  const routeById=new Map(routes.map(route=>[route.id,route]));
  function register(line,ids) {
    for(let i=1;i<ids.length;i++) {
      const from=ids[i-1],to=ids[i],key=edgeKey(from,to);
      if(!edges.has(key)) {
        const [a,b]=[from,to].sort();
        edges.set(key,{a,b,orders:new Map(),lanes:new Map()});
      }
      const edge=edges.get(key),direction=from===edge.a?1:-1;
      edge.orders.set(line,(routeById.get(line)?.laneOrder||0)*direction);
    }
  }
  for(const route of routes)register(route.id,route.ids);
  for(const branch of branches)register(branch.line,branch.ids);
  for(const edge of edges.values()) {
    const lines=[...edge.orders].sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0]));
    lines.forEach(([line],index)=>edge.lanes.set(line,(index-(lines.length-1)/2)*spacing));
  }
  function endpoint(line,from,to,id) {
    const a=coordinates[from],b=coordinates[to],point=coordinates[id];
    const edge=edges.get(edgeKey(from,to)),direction=from===edge.a?1:-1;
    const offset=edge.lanes.get(line)*direction,length=Math.hypot(b.x-a.x,b.y-a.y)||1;
    return{x:point.x-(b.y-a.y)/length*offset,y:point.y+(b.x-a.x)/length*offset};
  }
  function unmaskedCorner(previous,current,next,incoming,outgoing) {
    const a=coordinates[previous],p=coordinates[current],b=coordinates[next];
    const u={x:p.x-a.x,y:p.y-a.y},v={x:b.x-p.x,y:b.y-p.y};
    const cross=u.x*v.y-u.y*v.x;
    if(Math.abs(cross)<1e-8)return{x:(incoming.x+outgoing.x)/2,y:(incoming.y+outgoing.y)/2};
    const t=((outgoing.x-incoming.x)*v.y-(outgoing.y-incoming.y)*v.x)/cross;
    return{x:incoming.x+u.x*t,y:incoming.y+u.y*t};
  }
  function build(line,ids) {
    const points=[],distances={};let length=0;
    function append(point) {
      const previous=points.at(-1);
      if(previous) {
        const distance=Math.hypot(point.x-previous.x,point.y-previous.y);
        if(distance<1e-8)return;
        length+=distance;
      }
      points.push({x:point.x,y:point.y});
    }
    ids.forEach((id,index)=>{
      const previous=ids[index-1],next=ids[index+1];
      const incoming=previous?endpoint(line,previous,id,id):null;
      const outgoing=next?endpoint(line,id,next,id):null;
      if(junctionSet.has(id)&&incoming&&outgoing) {
        append(unmaskedCorner(previous,id,next,incoming,outgoing));distances[id]=length;
      } else {
        if(incoming)append(incoming);
        append(coordinates[id]);distances[id]=length;
        if(outgoing)append(outgoing);
      }
    });
    return{line,ids,points,distances,length};
  }
  return {
    routes:new Map(routes.map(route=>[route.id,build(route.id,route.ids)])),
    branches:branches.map(branch=>build(branch.line,branch.ids)),
    bundles:[...edges.values()].map(({a,b,lanes})=>({a,b,lanes:Object.fromEntries(lanes)}))
  };
}
