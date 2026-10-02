// Fails the build if any browser-served asset contains code from the private analysis engine.
// Runs after `next build`; see openspec/changes/refactor-node-eeg-pipeline.
//
// Markers are derived at check time from the installed package itself (its exported names and
// the names of the functions it defines), so this public repository never has to list them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ENGINE = '@divergentneuro/biofeedback-core';
const engineDir = path.join('node_modules', ...ENGINE.split('/'));

/** Source text of the engine's own runtime dependencies, which its dist bundles in. */
function thirdPartySource(pkg) {
  let text = '';
  for (const dep of Object.keys(pkg.dependencies || {})) {
    const dir = path.join('node_modules', ...dep.split('/'));
    try {
      const depPkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      for (const f of [depPkg.main, depPkg.module, depPkg.browser].filter((x) => typeof x === 'string')) {
        try {
          text += readFileSync(path.join(dir, f), 'utf8');
        } catch {
          // entry not present in this build of the dependency
        }
      }
      if (dep === 'lodash') text += readFileSync(path.join(dir, 'lodash.js'), 'utf8');
    } catch {
      // dependency not installed; nothing to subtract
    }
  }
  return text;
}

/**
 * This app's own browser-side source (everything except lib/server and API routes). Names our
 * client code uses itself, e.g. `channelName`, are expected in the bundle.
 */
function ownClientSource() {
  let text = '';
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (/^(node_modules|\.next|\.git|\.eeg-worker)$/.test(name)) continue;
      if (file === path.join('lib', 'server') || file === path.join('app', 'api')) continue;
      if (statSync(file).isDirectory()) visit(file);
      else if (/\.(ts|tsx|js|jsx)$/.test(name) && !/__tests__/.test(file)) text += readFileSync(file, 'utf8');
    }
  };
  for (const dir of ['app', 'components', 'lib', 'types']) {
    try {
      visit(dir);
    } catch {
      // directory absent
    }
  }
  return text;
}

function engineMarkers() {
  const pkg = JSON.parse(readFileSync(path.join(engineDir, 'package.json'), 'utf8'));
  const entry = path.join(engineDir, pkg.module || pkg.main);
  const src = readFileSync(entry, 'utf8');
  const names = new Set();
  // function / class declarations and exported bindings with distinctive (long) names
  for (const m of src.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]{9,})/g)) names.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]{9,})\s*=/g)) names.add(m[1]);
  // Property names and string literals survive minification, unlike local identifiers, so they
  // are what a leaked (minified) copy would still contain.
  for (const m of src.matchAll(/(?:\.|\b)([A-Za-z_$][\w$]{9,})\s*:/g)) names.add(m[1]);
  for (const m of src.matchAll(/\.([A-Za-z_$][\w$]{9,})\b/g)) names.add(m[1]);
  for (const m of src.matchAll(/'([^'\n\\]{12,80})'|"([^"\n\\]{12,80})"|`([^`$\n\\]{12,80})`/g)) {
    const lit = (m[1] ?? m[2] ?? m[3]).trim();
    if (/[a-z]/.test(lit) && /\s|[a-z][A-Z]/.test(lit)) names.add(lit);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name && name.length >= 10) names.add(name);
    }
  }
  // Names that also occur in the bundled third-party code (lodash, fili) or in plain JS
  // (startsWith, lastIndexOf, ...) say nothing about the engine; drop them.
  const thirdParty = thirdPartySource(pkg);
  const builtins = new Set(
    [String, Array, Object, Number, Math, Promise, Map, Set, Function].flatMap((c) => [
      ...Object.getOwnPropertyNames(c),
      ...(c.prototype ? Object.getOwnPropertyNames(c.prototype) : []),
    ])
  );
  // globals and module-interop plumbing every bundle contains
  for (const n of [...Object.getOwnPropertyNames(globalThis), 'globalThis', '__esModule', 'defineProperty']) {
    builtins.add(n);
  }
  const ownClient = ownClientSource();
  const markers = [...names].filter(
    (n) =>
      /[a-z][A-Z]|\s/.test(n) && // compound camelCase or a phrase; plain words are noise
      !builtins.has(n) &&
      !thirdParty.includes(n) &&
      !ownClient.includes(n)
  );
  markers.push(ENGINE);
  return markers;
}

let markers;
try {
  markers = engineMarkers();
} catch (err) {
  console.error(`Client bundle check: cannot read ${ENGINE} (${err.message}); is it installed?`);
  process.exit(1);
}
if (markers.length < 20) {
  console.error(`Client bundle check: only ${markers.length} markers derived from ${ENGINE}; refusing to pass.`);
  process.exit(1);
}

const MIN_DISTINCT_MARKERS = 2;
const roots = ['.next/static', 'public'];
const hits = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (/\.(js|mjs|map|json|txt)$/.test(name)) {
      if (name.endsWith('.map')) hits.push(`${file}: source map shipped to the browser`);
      const text = readFileSync(file, 'utf8');
      if (text.includes(ENGINE)) hits.push(`${file}: references ${ENGINE}`);
      // Leaked engine code carries many of its identifiers together; a single everyday name
      // (e.g. one shared with another library) is not evidence on its own.
      const found = markers.filter((m) => m !== ENGINE && text.includes(m));
      if (found.length >= MIN_DISTINCT_MARKERS) {
        hits.push(`${file}: contains ${found.length} engine identifiers (${found.slice(0, 5).join(', ')}...)`);
      }
    }
  }
}

roots.forEach(walk);
if (hits.length) {
  console.error('Client bundle check FAILED — proprietary analysis code reached browser assets:');
  for (const h of hits.slice(0, 50)) console.error('  ' + h);
  process.exit(1);
}
console.log(`Client bundle check passed: none of ${markers.length} engine identifiers found in browser assets.`);
