// Config for tools/preview.spec.js (the Workshop preview render) — the test config with this folder as testDir; the
// browser of the tests' webgpu project (a headed Chromium with WebGPU: xvfb-run -a) unless PREVIEW_GL=webgl2
const path = require('path');
const base = require('../playwright.config.js');
const gpu = (process.env.PREVIEW_GL || 'webgpu') === 'webgpu' ? base.projects.find(p => p.name === 'webgpu').use : {};
module.exports = Object.assign({}, base, { testDir: __dirname, testMatch: 'preview.spec.js', reporter: [['list']], projects: undefined,
  use: Object.assign({}, base.use, gpu), webServer: Object.assign({}, base.webServer, { cwd: path.join(__dirname, '..') }) });
