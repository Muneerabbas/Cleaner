const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const shimMap = {
  'promise/setimmediate/es6-extensions': path.resolve(
    __dirname,
    'shims/promise-setimmediate-es6-extensions.js',
  ),
  'promise/setimmediate/finally': path.resolve(
    __dirname,
    'shims/promise-setimmediate-finally.js',
  ),
};

config.resolver = config.resolver || {};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const shimPath = shimMap[moduleName];
  if (shimPath) {
    return {
      type: 'sourceFile',
      filePath: shimPath,
    };
  }
  if (typeof context.resolveRequest === 'function') {
    return context.resolveRequest(context, moduleName, platform);
  }
  const { resolve } = require('metro-resolver');
  return resolve(context, moduleName, platform);
};

module.exports = config;
