#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REQUIRED_FILES = [
  'node_modules/source-map/source-map.js',
  'node_modules/source-map/lib/base64-vlq.js',
  'node_modules/source-map/lib/array-set.js',
  'node_modules/source-map/lib/source-map-generator.js',
  'node_modules/source-map/lib/source-map-consumer.js',
];

function hasAllRequired(rootDir) {
  return REQUIRED_FILES.every((rel) => fs.existsSync(path.join(rootDir, rel)));
}

function npmCmd() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function reinstallSourceMap(rootDir) {
  const cmd = npmCmd();
  const args = ['install', 'source-map@0.6.1', '--no-save', '--ignore-scripts'];
  const out = spawnSync(cmd, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });
  return out.status === 0;
}

function main() {
  const rootDir = process.cwd();
  if (hasAllRequired(rootDir)) {
    console.log('[fix-source-map] source-map package looks healthy.');
    return;
  }

  console.warn('[fix-source-map] source-map install is incomplete. Attempting repair...');
  const ok = reinstallSourceMap(rootDir);
  if (!ok || !hasAllRequired(rootDir)) {
    console.error(
      '[fix-source-map] Repair failed. Use Node 22 LTS and run: rm -rf node_modules package-lock.json && npm install',
    );
    process.exit(1);
  }

  console.log('[fix-source-map] Repaired source-map package.');
}

main();

