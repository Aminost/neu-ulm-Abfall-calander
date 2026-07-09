// Default Expo Metro config. Declaring it here keeps Metro from searching parent
// directories for a config (which matters when this project is nested inside
// another repo) and gives a clear place to add customizations later.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = config;
