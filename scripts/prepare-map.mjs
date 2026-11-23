import {readFileSync,writeFileSync} from 'node:fs';
const base=readFileSync('public/map.js','utf8').split('// This module is appended to map.js')[0];
writeFileSync('public/map.js',base+readFileSync('public/live-map.js','utf8'));
