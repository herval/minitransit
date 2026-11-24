import {readFileSync} from 'node:fs';
// Browser modules are served directly. Fail the image build if its core assets are missing.
for(const file of ['ui/map.html','public/map.js','public/map.css','public/theme.js','public/model.js','public/map-motion.js','public/regional-geometry.js','public/map-overview.js','public/water.js','public/water-data.js','lib/map-data.mjs','data/regional-schedule.json'])readFileSync(file);
console.log('MiniTransit browser assets ready.');
