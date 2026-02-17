#!/usr/bin/env node
'use strict';

const major = Number((process.versions.node || '0').split('.')[0] || 0);

if (major >= 25) {
  console.error(
    '[check-node-version] Node 25 is not supported for this project. Use Node 22 LTS (recommended) or Node 20.',
  );
  console.error('[check-node-version] Example: nvm install 22 && nvm use 22');
  process.exit(1);
}

if (major < 20) {
  console.error('[check-node-version] Node >=20 is required.');
  process.exit(1);
}

console.log(`[check-node-version] Node ${process.versions.node} OK.`);

