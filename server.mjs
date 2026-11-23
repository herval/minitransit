import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {getRegionalSnapshot,getLiveNetwork} from './lib/regional-live.mjs';
import {compactSnapshot,stableSnapshot} from './lib/map-data.mjs';

const root=fileURLToPath(new URL('.',import.meta.url)),compress=promisify(gzip);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json; charset=utf-8'};

function acceptsGzip(header=''){
  const encodings=new Map(header.split(',').map(part=>{
    const [name,...parameters]=part.trim().split(';');
    const quality=parameters.find(parameter=>parameter.trim().startsWith('q='));
    return [name.trim().toLowerCase(),quality?Number(quality.trim().slice(2)):1];
  }));
  return (encodings.get('gzip')??encodings.get('*')??0)>0;
}

async function loadAssets(){
  const assets=new Map();
  async function add(url,path){
    const bytes=await readFile(path);
    assets.set(url,{bytes,type:types[extname(path)]||'application/octet-stream',etag:'"'+createHash('sha256').update(bytes).digest('hex')+'"',compressed:bytes.length>1024?await compress(bytes):null});
  }
  async function walk(directory,prefix=''){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(entry.name.startsWith('.'))continue;
      const path=join(directory,entry.name),url=prefix+'/'+entry.name;
      if(entry.isDirectory())await walk(path,url);else if(entry.isFile())await add(url,path);
    }
  }
  await add('/',join(root,'ui/map.html'));await walk(join(root,'public'));return assets;
}

// Dependencies are injectable so HTTP behavior can be verified without network calls.
export async function createAppServer({apiKey=process.env.BART_511_API_KEY,snapshot=getRegionalSnapshot,network=getLiveNetwork}={}){
  const assets=await loadAssets();
  let mapCache;
  async function json(response,request,value,status=200,{validator=false}={}){
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':validator?'private, no-cache':'no-store','Vary':'Accept-Encoding'};
    if(value.serverTime!=null)headers['X-Server-Time']=String(value.serverTime);
    if(validator){headers.ETag='W/"'+createHash('sha256').update(JSON.stringify(stableSnapshot(value))).digest('hex')+'"';if(request.headers['if-none-match']===headers.ETag){response.writeHead(304,headers);response.end();return;}}
    const body=Buffer.from(JSON.stringify(value)),useGzip=acceptsGzip(request.headers['accept-encoding'])&&body.length>1024;
    const bytes=useGzip?await compress(body):body;
    response.writeHead(status,{...headers,'Content-Length':bytes.length,...(useGzip?{'Content-Encoding':'gzip'}:{})});response.end(request.method==='HEAD'?undefined:bytes);
  }
  return createServer(async(request,response)=>{
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    if(request.method!=='GET'&&request.method!=='HEAD'){
      response.writeHead(405,{'Allow':'GET, HEAD','Cache-Control':'no-store'});response.end();return;
    }
    let path,url;
    try {url=new URL(request.url,'http://localhost');path=decodeURIComponent(url.pathname);}catch{response.writeHead(400);response.end();return;}
    const head=request.method==='HEAD';
    if(path==='/healthz'){
      response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(head?undefined:'{"ok":true}');return;
    }
    if(['/api/live','/api/network','/api/train','/api/station'].includes(path)){
      try{
        if(path==='/api/network'){await json(response,request,await network({apiKey}),200,{validator:true});return;}
        const full=await snapshot({apiKey});
        if(path==='/api/train'){
          const train=full.trips.trains.find(t=>t.id===url.searchParams.get('id'));
          await json(response,request,train?{serverTime:full.serverTime,train}:{error:'Trip no longer reported'},train?200:404);return;
        }
        if(path==='/api/station'){
          const id=url.searchParams.get('id'),data=await network({apiKey}),station=Object.hasOwn(data.stations,id)?data.stations[id]:null;
          await json(response,request,station&&station.public!==false?{serverTime:full.serverTime,station:id,departures:full.trips.departures[id]||[]}:{error:'Unknown stop'},station&&station.public!==false?200:404);return;
        }
        let value=full;
        if(full.regional){
          const data=await network({apiKey});
          if(mapCache?.trips!==full.trips||mapCache?.alerts!==full.alerts||mapCache?.network!==data){mapCache={trips:full.trips,alerts:full.alerts,network:data,value:compactSnapshot(full,data)};}
          value={...mapCache.value,serverTime:full.serverTime};
        }
        await json(response,request,value,200,{validator:full.regional===true});
      }catch{
        const body=JSON.stringify({error:'The regional transit feed could not be loaded. Retrying shortly.',serverTime:Date.now()});
        response.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(head?undefined:body);
      }
      return;
    }
    const asset=assets.get(path);
    if(!asset){response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});response.end(head?undefined:'Not found');return;}
    const headers={'Content-Type':asset.type,'Cache-Control':'no-cache','ETag':asset.etag,'Vary':'Accept-Encoding'};
    if(request.headers['if-none-match']===asset.etag){response.writeHead(304,headers);response.end();return;}
    const useGzip=asset.compressed&&acceptsGzip(request.headers['accept-encoding']),bytes=useGzip?asset.compressed:asset.bytes;
    response.writeHead(200,{...headers,'Content-Length':bytes.length,...(useGzip?{'Content-Encoding':'gzip'}:{})});response.end(head?undefined:bytes);
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||8080),host=process.env.HOST||'0.0.0.0';
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be between 1 and 65535');
  const server=await createAppServer();
  server.listen(port,host,()=>console.log(`MiniTransit listening on ${host}:${port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();});
}
