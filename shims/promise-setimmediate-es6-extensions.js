'use strict';

// React Native 0.81 expects this legacy path from the `promise` package.
// Some modern `promise` versions no longer ship it, so we map to a safe Promise implementation.
let PromiseImpl = global.Promise;

if (typeof PromiseImpl !== 'function') {
  PromiseImpl = require('promise/setimmediate/core');
}

module.exports = PromiseImpl;
