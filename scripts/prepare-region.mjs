import {writeFile} from 'node:fs/promises';
import {parseRegionalSchedule} from '../lib/regional-schedule.mjs';
const path=process.argv[2];if(!path)throw new Error('Usage: node scripts/prepare-region.mjs /path/to/regional.zip');
const schedule=await parseRegionalSchedule(path);
await writeFile(new URL('../data/regional-schedule.json',import.meta.url),JSON.stringify(schedule));
console.log(JSON.stringify({builtAt:schedule.builtAt,counts:schedule.network.counts,stations:Object.keys(schedule.network.stations).length,edges:schedule.network.edges.length,heapMB:Math.round(process.memoryUsage().heapUsed/1024/1024)}));
