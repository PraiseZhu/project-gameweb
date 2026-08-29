#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { validateStatusVisualVariants } from './lib/translation/status-visual-variants.mjs';

const args = process.argv.slice(2); const at = args.indexOf('--demo');
if (at < 0 || !args[at + 1]) throw new Error('usage: node scripts/status-visual-assets.mjs --demo <dir> [--fetch]');
const demo = resolve(args[at + 1]); const fixture = join(demo, 'fixtures/status-visual-variants.json');
const registry = validateStatusVisualVariants({ registry: JSON.parse(readFileSync(fixture, 'utf8')) });
const fetchPinned = args.includes('--fetch');
const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const pngInfo = (p) => { const image = PNG.sync.read(readFileSync(p)); let minX=image.width,minY=image.height,maxX=-1,maxY=-1; for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) if(image.data[(y*image.width+x)*4+3]) { minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); } return { width:image.width,height:image.height,alphaBounds:maxX<0?{x:0,y:0,width:0,height:0}:{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1} }; };
const manifest=[];
for (const [status, locales] of Object.entries(registry.variants)) for (const [locale, asset] of Object.entries(locales)) {
  const source=join(demo,asset.sourceFile);
  if (!existsSync(source)) {
    if (!fetchPinned) throw new Error(`missing pinned visual source ${asset.sourceFile}; fetch is intentionally not part of normal build`);
    const response = await fetch(asset.url); if (!response.ok) throw new Error(`official visual fetch failed ${response.status} ${asset.assetKey}`);
    mkdirSync(dirname(source), { recursive: true }); writeFileSync(source, Buffer.from(await response.arrayBuffer()));
  }
  if (hash(source)!==asset.sha256) throw new Error(`sha mismatch ${asset.sourceFile}`);
  const info=pngInfo(source); if(info.width!==asset.intrinsic.width||info.height!==asset.intrinsic.height) throw new Error(`intrinsic mismatch ${asset.assetKey}`);
  const target=join(demo,asset.file); mkdirSync(dirname(target),{recursive:true}); copyFileSync(source,target);
  manifest.push({status,locale,assetKey:asset.assetKey,file:asset.file,sha256:asset.sha256,intrinsic:asset.intrinsic,alphaBounds:info.alphaBounds,backgroundIncluded:asset.backgroundIncluded,provenance:asset.provenance});
}
writeFileSync(join(demo,'visual-assets-manifest.json'),JSON.stringify({schema:'visual-assets-manifest/v1',assets:manifest},null,2)+'\n');
console.log(JSON.stringify({ok:true,assets:manifest.length,manifest:'visual-assets-manifest.json'}));
