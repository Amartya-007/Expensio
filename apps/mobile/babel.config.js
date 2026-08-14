// Required for PowerSync's watched queries (Async Iterator response format) —
// see docs/architecture/expensio-react-native-setup.md and
// https://github.com/powersync-ja/powersync-js/blob/main/packages/react-native/README.md#babel-plugins-watched-queries
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['@babel/plugin-transform-async-generator-functions'],
  };
};
