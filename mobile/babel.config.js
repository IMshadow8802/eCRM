// Required for Reanimated 4. Without this file the worklets Babel plugin never
// runs: the bundle still builds, then dies at startup with
// "[runtime not ready]: TypeError: undefined is not a function", because every
// worklet is left undefined. Both @gorhom/bottom-sheet and gesture-handler's
// animations go through worklets, so nothing renders.
//
// In Reanimated 4 the plugin moved out of react-native-reanimated into
// react-native-worklets — `react-native-reanimated/plugin` is the Reanimated 3
// path and does not exist here.
//
// It MUST stay last in `plugins`: it rewrites functions the other plugins may
// still transform.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["react-native-worklets/plugin"],
  };
};
