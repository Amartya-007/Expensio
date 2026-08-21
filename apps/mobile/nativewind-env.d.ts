/// <reference types="nativewind/types" />

// nativewind's own types.d.ts only augments className props (via react-native-css-interop)
// -- it doesn't declare *.css as an importable module, so the side-effect
// `import './global.css'` in App.tsx needs this or tsc rejects it (TS2882).
declare module '*.css';
