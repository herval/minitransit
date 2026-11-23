import {readFileSync} from 'node:fs';
// Browser modules are served directly. Fail the image build if its core assets are missing.
for(const file of ['ui/map.html','public/map.js','public/map.css','public/theme.js','public/model.js','public/regional-geometry.js','data/regional-schedule.json'])readFileSync(file);
console.log('MiniTransit browser assets ready.');
