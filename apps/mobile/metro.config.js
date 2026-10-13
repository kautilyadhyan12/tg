const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// @app/shared is TypeScript whose imports end in ".js" (the api's module
// rules). Metro looks for that exact file, so try the name without it first.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (/^\.\.?\//.test(moduleName) && moduleName.endsWith(".js")) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    } catch {
      // A real .js file: resolved as written, below.
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
