const path = require("path");

/** Repo root (babel.config.js lives here). Xcode/Metro often run with cwd `macos/`. */
const envFilePath = path.resolve(__dirname, ".env");

module.exports = {
  presets: ["module:@react-native/babel-preset"],
  plugins: [
    [
      "module:react-native-dotenv",
      {
        moduleName: "@env",
        path: envFilePath,
        allowUndefined: true,
      },
    ],
  ],
};
