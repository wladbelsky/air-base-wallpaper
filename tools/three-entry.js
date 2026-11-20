// Entry of the vendored three.js bundle (js/three.r187.min.js): three.js is ESM-only since r160, the wallpaper's scripts are
// classic scripts sharing a global THREE — esbuild bundles this into one IIFE that sets window.THREE (npm run vendor:three)
export * from 'three';
export { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
export { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
export { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
export { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
