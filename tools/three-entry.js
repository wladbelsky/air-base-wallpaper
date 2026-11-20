// Entry of the vendored three.js bundle (js/three.rNNN.webgpu.min.js): three.js is ESM-only since r160, the wallpaper's
// scripts are classic scripts sharing a global THREE — esbuild bundles this into one IIFE that sets window.THREE
// (npm run vendor:three). three/webgpu is the whole of three.js plus WebGPURenderer (WebGPU, or WebGL 2 as a fallback)
// and the node materials; TSL (the shading language for them) is THREE.TSL.
export * from 'three/webgpu';
export * as TSL from 'three/tsl';
export { bloom } from 'three/addons/tsl/display/BloomNode.js';
export { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
