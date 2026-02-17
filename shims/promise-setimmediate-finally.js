'use strict';

const PromiseImpl = require('./promise-setimmediate-es6-extensions');

if (
  PromiseImpl &&
  PromiseImpl.prototype &&
  typeof PromiseImpl.prototype.finally !== 'function'
) {
  PromiseImpl.prototype.finally = function finallyPolyfill(onFinally) {
    const P = this && this.constructor ? this.constructor : PromiseImpl;
    const cb = typeof onFinally === 'function' ? onFinally : () => undefined;
    return this.then(
      (value) => P.resolve(cb()).then(() => value),
      (reason) =>
        P.resolve(cb()).then(() => {
          throw reason;
        }),
    );
  };
}

module.exports = PromiseImpl;
