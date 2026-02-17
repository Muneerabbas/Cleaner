#!/usr/bin/env node
'use strict';

/**
 * Node 25 tightened ESM/CJS behavior and may treat `glob/dist/commonjs/*.js`
 * as ESM due to parent package `"type": "module"`.
 *
 * This writes a nested package.json with `"type": "commonjs"` so require() works.
 * Safe no-op if paths do not exist.
 */

const fs = require('fs');
const path = require('path');

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function ensureCjsTwin(jsPath) {
  const cjsPath = jsPath.replace(/\.js$/, '.cjs');
  if (!fs.existsSync(jsPath)) return false;
  const jsSrc = fs.readFileSync(jsPath, 'utf8');
  const current = fs.existsSync(cjsPath) ? fs.readFileSync(cjsPath, 'utf8') : null;
  if (current !== jsSrc) {
    fs.writeFileSync(cjsPath, jsSrc, 'utf8');
    return true;
  }
  return false;
}

function rewriteGlobRequireExportsToCjs(globPkg) {
  let changed = false;
  const rewriteOne = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.default === 'string' && node.default.startsWith('./dist/commonjs/') && node.default.endsWith('.js')) {
      node.default = node.default.replace(/\.js$/, '.cjs');
      changed = true;
    }
  };

  if (typeof globPkg.main === 'string' && globPkg.main.startsWith('./dist/commonjs/') && globPkg.main.endsWith('.js')) {
    globPkg.main = globPkg.main.replace(/\.js$/, '.cjs');
    changed = true;
  }

  if (globPkg.exports && typeof globPkg.exports === 'object') {
    for (const val of Object.values(globPkg.exports)) {
      if (val && typeof val === 'object' && 'require' in val) {
        rewriteOne(val.require);
      }
    }
  }

  return changed;
}

function patchGlobCommonJsScope(rootDir) {
  const globPkgPath = path.join(rootDir, 'node_modules', 'glob', 'package.json');
  if (!fs.existsSync(globPkgPath)) return false;

  let globPkg;
  try {
    globPkg = JSON.parse(fs.readFileSync(globPkgPath, 'utf8'));
  } catch {
    return false;
  }

  const globDir = path.dirname(globPkgPath);
  const commonJsDir = path.join(globDir, 'dist', 'commonjs');
  const esmDir = path.join(globDir, 'dist', 'esm');

  let changed = false;

  // Keep root module type stable for import side.
  if (globPkg.type !== 'module') {
    globPkg.type = 'module';
    changed = true;
  }

  // Keep ESM import paths working.
  if (fs.existsSync(esmDir)) {
    writeJson(path.join(esmDir, 'package.json'), { type: 'module' });
    changed = true;
  }

  // Explicitly mark CommonJS directory too.
  if (fs.existsSync(commonJsDir)) {
    writeJson(path.join(commonJsDir, 'package.json'), { type: 'commonjs' });
    changed = true;

    // Create .cjs twins to bypass Node 25 ESM confusion entirely.
    const cjsCandidates = ['index.js', 'index.min.js', 'glob.js', 'has-magic.js', 'ignore.js', 'pattern.js', 'processor.js', 'walker.js'];
    for (const file of cjsCandidates) {
      if (ensureCjsTwin(path.join(commonJsDir, file))) {
        changed = true;
      }
    }

    if (rewriteGlobRequireExportsToCjs(globPkg)) {
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(globPkgPath, JSON.stringify(globPkg, null, 2) + '\n', 'utf8');
  }

  return changed;
}

function main() {
  const rootDir = process.cwd();
  const patched = patchGlobCommonJsScope(rootDir);

  const major = Number((process.versions.node || '0').split('.')[0] || 0);
  if (major >= 25) {
    console.warn(
      '[fix-glob-commonjs] Node 25 detected. Recommended runtime for this project: Node 20 or 22 LTS.',
    );
  }

  if (patched) {
    console.log('[fix-glob-commonjs] Patched glob package for Node 25 CJS compatibility.');
  } else {
    console.log('[fix-glob-commonjs] No patch needed.');
  }
}

main();
