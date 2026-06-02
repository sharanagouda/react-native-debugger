#!/usr/bin/env node
'use strict';

/**
 * RN Debugger — Auto Setup
 *
 * Usage:
 *   node bin/setup.js <path-to-rn-project>   # install into RN project
 *   node bin/setup.js <path-to-rn-project> --uninstall   # remove from RN project
 *
 * What it does (install):
 *   1. Validates the target is a React Native project
 *   2. Copies RNDebugSDK.js into the project
 *   3. Detects platform (iOS sim / Android emu / device) and sets HOST
 *   4. Patches the entry file (index.js / index.tsx) to load the SDK
 *   5. Detects Redux (@reduxjs/toolkit or redux) and patches the store
 *   6. Runs adb reverse for Android
 *   7. Prints summary
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const readline = require('readline');

// ─── Colors ──────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  red:   '\x1b[31m',
  cyan:  '\x1b[36m',
  magenta:'\x1b[35m',
};
const log   = (...a) => console.log(C.green + '  ✓' + C.reset, ...a);
const warn  = (...a) => console.log(C.yellow + '  ⚠' + C.reset, ...a);
const err   = (...a) => console.log(C.red + '  ✗' + C.reset, ...a);
const info  = (...a) => console.log(C.cyan + '  →' + C.reset, ...a);
const title = (t) => console.log('\n' + C.bold + C.magenta + '  ' + t + C.reset);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fileExists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function dirExists(p)  { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function readJSON(p)   { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(C.cyan + '  ? ' + C.reset + question + ' ', answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function getMacLanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '192.168.1.100';
}

function tryExec(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim(); } catch { return ''; }
}

// ─── SDK Marker ──────────────────────────────────────────────────────────────
const SDK_MARKER_START = '// ── RNDebugSDK setup ──';
const SDK_MARKER_END   = '// ── /RNDebugSDK setup ──';

// ─── Detect platform ────────────────────────────────────────────────────────
function detectPlatform() {
  // Check if Android emulator is running
  const adbDevices = tryExec('adb devices 2>/dev/null');
  const hasAndroidEmu = adbDevices.includes('emulator');
  const hasAndroidDevice = /\b[A-Z0-9]{6,}\s+device\b/i.test(adbDevices) && !hasAndroidEmu;

  // Check if iOS simulator is running
  const xcrun = tryExec('xcrun simctl list devices booted 2>/dev/null');
  const hasIOSSim = xcrun.includes('Booted');

  return { hasAndroidEmu, hasAndroidDevice, hasIOSSim };
}

function pickHost(platform) {
  if (platform.hasIOSSim && !platform.hasAndroidEmu && !platform.hasAndroidDevice) {
    return { host: '127.0.0.1', reason: 'iOS Simulator detected' };
  }
  if (platform.hasAndroidEmu && !platform.hasIOSSim) {
    return { host: '10.0.2.2', reason: 'Android Emulator detected' };
  }
  if (platform.hasAndroidDevice) {
    return { host: '10.0.2.2', reason: 'Android device detected (using adb reverse)' };
  }
  if (platform.hasIOSSim && platform.hasAndroidEmu) {
    return { host: '127.0.0.1', reason: 'Both iOS Sim + Android Emu detected (defaulting to iOS, Android uses adb reverse)' };
  }
  // Nothing running — default to localhost
  return { host: '127.0.0.1', reason: 'No running devices detected (default)' };
}

// ─── Find entry file ─────────────────────────────────────────────────────────
function findEntryFile(projectDir) {
  const candidates = ['index.js', 'index.tsx', 'index.ts'];
  for (const f of candidates) {
    if (fileExists(path.join(projectDir, f))) return f;
  }
  return null;
}

// ─── Find Redux store file ───────────────────────────────────────────────────
function findStoreFile(projectDir) {
  const searchDirs = ['src', 'app', 'store', 'redux', 'src/store', 'src/redux', 'app/store', 'app/redux', 'src/app/store'];
  const storeNames = ['store.ts', 'store.js', 'store.tsx', 'index.ts', 'index.js'];

  for (const dir of searchDirs) {
    for (const name of storeNames) {
      const p = path.join(projectDir, dir, name);
      if (fileExists(p)) {
        const content = fs.readFileSync(p, 'utf8');
        if (content.includes('configureStore') || content.includes('createStore')) {
          return path.join(dir, name);
        }
      }
    }
  }
  return null;
}

// ─── Install ─────────────────────────────────────────────────────────────────
async function install(projectDir) {
  const debuggerDir = path.resolve(__dirname, '..');

  title('RN Debugger — Auto Setup');
  console.log();

  // 1. Validate RN project
  info('Validating React Native project...');
  const pkg = readJSON(path.join(projectDir, 'package.json'));
  if (!pkg) {
    err('No package.json found at ' + projectDir);
    process.exit(1);
  }
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!allDeps['react-native']) {
    err('Not a React Native project (no react-native dependency)');
    process.exit(1);
  }
  log('React Native project found:', C.bold + pkg.name + C.reset, '(' + (allDeps['react-native']) + ')');

  // 2. Detect platform and set HOST
  info('Detecting running devices...');
  const platform = detectPlatform();
  const { host, reason } = pickHost(platform);
  log('HOST =', C.bold + host + C.reset, C.dim + '(' + reason + ')' + C.reset);

  // 3. Copy SDK
  info('Installing RNDebugSDK...');
  const sdkSrc = path.join(debuggerDir, 'sdk', 'RNDebugSDK.js');
  const sdkDestDir = path.join(projectDir, 'src', 'debug');
  const sdkDest = path.join(sdkDestDir, 'RNDebugSDK.js');

  if (!dirExists(path.join(projectDir, 'src'))) {
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  }
  fs.mkdirSync(sdkDestDir, { recursive: true });

  // Read SDK, patch HOST
  let sdkContent = fs.readFileSync(sdkSrc, 'utf8');
  sdkContent = sdkContent.replace(
    /const HOST = '[^']+';/,
    `const HOST = '${host}';`
  );
  fs.writeFileSync(sdkDest, sdkContent);
  log('Copied RNDebugSDK.js →', C.dim + 'src/debug/RNDebugSDK.js' + C.reset);

  // 4. Patch entry file
  info('Patching entry file...');
  const entryFile = findEntryFile(projectDir);
  if (!entryFile) {
    warn('No index.js/tsx found — you\'ll need to add the SDK import manually');
    console.log(C.dim + '    Add to your entry file:' + C.reset);
    console.log(C.dim + '      if (__DEV__) { require("./src/debug/RNDebugSDK"); }' + C.reset);
  } else {
    const entryPath = path.join(projectDir, entryFile);
    let entryContent = fs.readFileSync(entryPath, 'utf8');

    if (entryContent.includes('RNDebugSDK')) {
      log('Entry file already has RNDebugSDK import — skipping');
    } else {
      const sdkImport = `${SDK_MARKER_START}
if (__DEV__) {
  const { watchAsyncStorage } = require('./src/debug/RNDebugSDK');
  watchAsyncStorage();
}
${SDK_MARKER_END}
`;
      entryContent = sdkImport + entryContent;
      fs.writeFileSync(entryPath, entryContent);
      log('Patched', C.bold + entryFile + C.reset, '— SDK loads automatically in dev mode');
    }
  }

  // 5. Detect and wire Redux
  info('Checking for Redux...');
  const hasRedux = allDeps['@reduxjs/toolkit'] || allDeps['redux'];
  if (hasRedux) {
    const storeFile = findStoreFile(projectDir);
    if (storeFile) {
      const storePath = path.join(projectDir, storeFile);
      const storeContent = fs.readFileSync(storePath, 'utf8');

      if (storeContent.includes('RNDebugSDK')) {
        log('Redux store already has RNDebugSDK wired — skipping');
      } else if (storeContent.includes('configureStore')) {
        // RTK configureStore
        const patchedStore = `${SDK_MARKER_START}\nimport { reduxMiddleware } from '../debug/RNDebugSDK';\n${SDK_MARKER_END}\n` + storeContent;

        // Try to add middleware to configureStore
        if (storeContent.includes('middleware:') || storeContent.includes('middleware :')) {
          warn('Redux store found at', C.bold + storeFile + C.reset, '— has custom middleware');
          console.log(C.dim + '    Add manually to your middleware:' + C.reset);
          console.log(C.dim + '      import { reduxMiddleware } from \'./src/debug/RNDebugSDK\';' + C.reset);
          console.log(C.dim + '      middleware: (getDefault) => __DEV__' + C.reset);
          console.log(C.dim + '        ? getDefault().concat(reduxMiddleware)' + C.reset);
          console.log(C.dim + '        : getDefault(),' + C.reset);
        } else {
          // Add middleware field to configureStore
          const patched = storeContent.replace(
            /(configureStore\s*\(\s*\{)/,
            `$1\n  middleware: (getDefaultMiddleware) =>\n    __DEV__\n      ? getDefaultMiddleware().concat(require('./src/debug/RNDebugSDK').reduxMiddleware)\n      : getDefaultMiddleware(),`
          );
          if (patched !== storeContent) {
            fs.writeFileSync(storePath, patched);
            log('Patched', C.bold + storeFile + C.reset, '— Redux middleware wired');
          } else {
            warn('Could not auto-patch', storeFile, '— wire Redux manually');
          }
        }
      } else if (storeContent.includes('createStore')) {
        warn('Legacy createStore found at', C.bold + storeFile + C.reset);
        console.log(C.dim + '    Add manually:' + C.reset);
        console.log(C.dim + '      import { reduxEnhancer } from \'./src/debug/RNDebugSDK\';' + C.reset);
        console.log(C.dim + '      const store = createStore(reducer, __DEV__ ? reduxEnhancer : undefined);' + C.reset);
      }
    } else {
      warn('Redux detected but store file not found automatically');
      console.log(C.dim + '    Add to your store setup:' + C.reset);
      console.log(C.dim + '      import { reduxMiddleware } from \'./src/debug/RNDebugSDK\';' + C.reset);
    }
  } else {
    log('No Redux detected — skipping');
  }

  // 6. adb reverse for Android
  if (platform.hasAndroidEmu || platform.hasAndroidDevice) {
    info('Setting up adb reverse...');
    const ports = [9090, 9091, 9092, 8097];
    let allGood = true;
    for (const port of ports) {
      const result = tryExec(`adb reverse tcp:${port} tcp:${port} 2>&1`);
      if (result.includes('error')) {
        warn(`adb reverse tcp:${port} failed`);
        allGood = false;
      }
    }
    if (allGood) {
      log('adb reverse set for ports 9090, 9091, 9092, 8097');
    }
  }

  // 7. Add .gitignore entry if not present
  const gitignorePath = path.join(projectDir, '.gitignore');
  if (fileExists(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    if (!gitignore.includes('RNDebugSDK')) {
      fs.appendFileSync(gitignorePath, '\n# RN Debugger SDK (dev only)\nsrc/debug/RNDebugSDK.js\n');
      log('Added RNDebugSDK.js to .gitignore');
    }
  }

  // Summary
  title('Setup Complete!');
  console.log();
  console.log(C.dim + '  Files modified:' + C.reset);
  console.log(C.dim + '    + src/debug/RNDebugSDK.js   (SDK)' + C.reset);
  if (entryFile) console.log(C.dim + '    ~ ' + entryFile + '                (entry patched)' + C.reset);
  console.log();
  console.log(C.bold + '  Next steps:' + C.reset);
  console.log('    1. Start the debugger:  ' + C.cyan + 'cd ' + debuggerDir + ' && npm start' + C.reset);
  console.log('    2. Run your RN app:     ' + C.cyan + 'npx react-native run-ios' + C.reset + '  or  ' + C.cyan + 'run-android' + C.reset);
  console.log('    3. Console, Network, Storage auto-connect');
  console.log();
  if (platform.hasAndroidDevice || platform.hasAndroidEmu) {
    console.log(C.dim + '  Tip: If adb reverse drops, re-run:' + C.reset);
    console.log(C.dim + '    adb reverse tcp:9090 tcp:9090 && adb reverse tcp:9091 tcp:9091 && adb reverse tcp:9092 tcp:9092' + C.reset);
    console.log();
  }
  console.log(C.dim + '  To remove: node ' + path.join(debuggerDir, 'bin/setup.js') + ' ' + projectDir + ' --uninstall' + C.reset);
  console.log();
}

// ─── Uninstall ───────────────────────────────────────────────────────────────
function uninstall(projectDir) {
  title('RN Debugger — Uninstall');
  console.log();

  // Remove SDK file
  const sdkPath = path.join(projectDir, 'src', 'debug', 'RNDebugSDK.js');
  if (fileExists(sdkPath)) {
    fs.unlinkSync(sdkPath);
    log('Removed src/debug/RNDebugSDK.js');
    // Remove debug dir if empty
    const debugDir = path.join(projectDir, 'src', 'debug');
    try {
      const remaining = fs.readdirSync(debugDir);
      if (remaining.length === 0) {
        fs.rmdirSync(debugDir);
        log('Removed empty src/debug/ directory');
      }
    } catch {}
  } else {
    warn('SDK file not found — may already be removed');
  }

  // Remove SDK import from entry file
  const entryFile = findEntryFile(projectDir);
  if (entryFile) {
    const entryPath = path.join(projectDir, entryFile);
    let content = fs.readFileSync(entryPath, 'utf8');
    const markerRe = new RegExp(
      escapeRegExp(SDK_MARKER_START) + '[\\s\\S]*?' + escapeRegExp(SDK_MARKER_END) + '\\n?',
      'g'
    );
    const cleaned = content.replace(markerRe, '');
    if (cleaned !== content) {
      fs.writeFileSync(entryPath, cleaned);
      log('Removed SDK import from', C.bold + entryFile + C.reset);
    }
  }

  // Remove from store files
  const storeFile = findStoreFile(projectDir);
  if (storeFile) {
    const storePath = path.join(projectDir, storeFile);
    let content = fs.readFileSync(storePath, 'utf8');

    // Remove marker blocks
    const markerRe = new RegExp(
      escapeRegExp(SDK_MARKER_START) + '[\\s\\S]*?' + escapeRegExp(SDK_MARKER_END) + '\\n?',
      'g'
    );
    let cleaned = content.replace(markerRe, '');

    // Remove inline require of RNDebugSDK in configureStore
    cleaned = cleaned.replace(
      /\s*middleware:\s*\(getDefaultMiddleware\)\s*=>\s*\n?\s*__DEV__\s*\n?\s*\?\s*getDefaultMiddleware\(\)\.concat\(require\(['"]\.\/src\/debug\/RNDebugSDK['"]\)\.reduxMiddleware\)\s*\n?\s*:\s*getDefaultMiddleware\(\),?\n?/g,
      '\n'
    );
    // Clean up double newlines left behind
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    if (cleaned !== content) {
      fs.writeFileSync(storePath, cleaned);
      log('Removed SDK from', C.bold + storeFile + C.reset);
    }
  }

  // Remove .gitignore entry
  const gitignorePath = path.join(projectDir, '.gitignore');
  if (fileExists(gitignorePath)) {
    let gitignore = fs.readFileSync(gitignorePath, 'utf8');
    const cleaned = gitignore.replace(/\n# RN Debugger SDK \(dev only\)\nsrc\/debug\/RNDebugSDK\.js\n?/g, '');
    if (cleaned !== gitignore) {
      fs.writeFileSync(gitignorePath, cleaned);
      log('Removed from .gitignore');
    }
  }

  title('Uninstall Complete');
  console.log();
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const isUninstall = args.includes('--uninstall') || args.includes('--remove');
  let projectArg = args.find(a => !a.startsWith('--'));

  // If no path given, check if current directory is an RN project
  if (!projectArg) {
    const cwd = process.cwd();
    const cwdPkg = readJSON(path.join(cwd, 'package.json'));
    const cwdDeps = { ...cwdPkg?.dependencies, ...cwdPkg?.devDependencies };
    if (cwdPkg && cwdDeps['react-native']) {
      // Running from inside an RN project — use current directory
      projectArg = cwd;
      info('Detected RN project in current directory:', C.bold + cwdPkg.name + C.reset);
    } else {
      // Not in an RN project — show help
      console.log();
      console.log(C.bold + '  RN Debugger — Setup CLI' + C.reset);
      console.log();
      console.log('  Run from inside your React Native project:');
      console.log('    ' + C.cyan + 'node /path/to/rn-debug-app/bin/setup.js' + C.reset);
      console.log();
      console.log('  Or specify the path:');
      console.log('    ' + C.cyan + 'node /path/to/rn-debug-app/bin/setup.js /path/to/rn-project' + C.reset);
      console.log('    ' + C.cyan + 'node /path/to/rn-debug-app/bin/setup.js /path/to/rn-project --uninstall' + C.reset);
      console.log();
      process.exit(0);
    }
  }

  const projectDir = path.resolve(projectArg);

  if (!dirExists(projectDir)) {
    err('Directory not found:', projectDir);
    process.exit(1);
  }

  if (isUninstall) {
    uninstall(projectDir);
  } else {
    await install(projectDir);
  }
}

main().catch(e => { err(e.message); process.exit(1); });
