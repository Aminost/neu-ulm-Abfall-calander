module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel", // <-- Moved here!
    ],
    plugins: [
      "react-native-worklets/plugin", // Keep this as the only plugin
    ],
  };
};