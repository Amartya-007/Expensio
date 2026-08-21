// Required for PowerSync's watched queries (Async Iterator response format) —
// see docs/architecture/expensio-react-native-setup.md and
// https://github.com/powersync-ja/powersync-js/blob/main/packages/react-native/README.md#babel-plugins-watched-queries
//
// jsxImportSource + nativewind/babel: wires up NativeWind (see
// docs/architecture/expensio-ui-port-plan.md) — pinned to tailwindcss ^3.4.x in
// package.json because nativewind@4.2.6's actual engine (react-native-css-interop)
// declares a "~3" peer dependency; its own top-level peerDependencies string
// (">3.3.0") is misleadingly permissive and `npm ls` flags v4 as invalid.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: ['@babel/plugin-transform-async-generator-functions'],
  };
};
