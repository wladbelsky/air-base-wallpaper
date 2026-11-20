// Rebuilds js/three.r187.min.js from the three package in node_modules (npm run vendor:three; in Docker: tools/vendor_three.ps1).
// three.js ships only ES modules since r160; the wallpaper's scripts are classic scripts sharing a global THREE, so the
// whole namespace (+ the post-processing addons in tools/three-entry.js) goes into one IIFE that sets window.THREE.
// On a three.js update: bump the version in package.json, rename the output (CEF caches the old file: it has no ?v=),
// update index.html / tests/repo.spec.js / CLAUDE.md.
const path = require('path');
const { REVISION } = require('three');
const out = path.join(__dirname, '..', 'js', `three.r${REVISION}.min.js`);
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'three-entry.js')], outfile: out, bundle: true, format: 'iife', globalName: 'THREE',
  minify: true, target: 'chrome90', legalComments: 'none',
  banner: { js: `/* three.js r${REVISION} — MIT License, Copyright 2010-2026 Three.js Authors. Bundled by tools/vendor_three.js */` }
});
console.log('wrote', path.relative(process.cwd(), out));
