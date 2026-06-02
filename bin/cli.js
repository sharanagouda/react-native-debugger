#!/usr/bin/env node
'use strict';

const path = require('path');
const { execSync, spawn } = require('child_process');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', magenta: '\x1b[35m',
};

const args = process.argv.slice(2);
const command = args[0] || 'start';
const appDir = path.resolve(__dirname, '..');

function printHelp() {
  console.log();
  console.log(C.bold + C.magenta + '  RN Debugger' + C.reset + ' — React Native debugging tool');
  console.log();
  console.log('  Usage:');
  console.log(`    ${C.cyan}npx rn-debugger${C.reset}              Launch the debugger app`);
  console.log(`    ${C.cyan}npx rn-debugger setup${C.reset}        Install SDK into current RN project`);
  console.log(`    ${C.cyan}npx rn-debugger remove${C.reset}       Remove SDK from current RN project`);
  console.log(`    ${C.cyan}npx rn-debugger help${C.reset}         Show this help`);
  console.log();
  console.log('  Or add to your RN project\'s package.json:');
  console.log(`    ${C.dim}"debug:setup": "npx rn-debugger setup"${C.reset}`);
  console.log(`    ${C.dim}"debug:start": "npx rn-debugger"${C.reset}`);
  console.log(`    ${C.dim}"debug:remove": "npx rn-debugger remove"${C.reset}`);
  console.log();
}

switch (command) {
  case 'start':
  case 'launch':
  case 'open': {
    // Ensure electron is installed
    try {
      require.resolve('electron');
    } catch {
      console.log(C.yellow + '  Installing electron...' + C.reset);
      execSync('npm install', { cwd: appDir, stdio: 'inherit' });
    }
    console.log(C.green + '  Launching RN Debugger...' + C.reset);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const electronPath = path.join(appDir, 'node_modules', '.bin', 'electron');
    const child = spawn(electronPath, [appDir], { env, stdio: 'inherit', detached: true });
    child.unref();
    break;
  }

  case 'setup':
  case 'init':
  case 'install': {
    const setupScript = path.join(appDir, 'bin', 'setup.js');
    const projectPath = args[1] || process.cwd();
    // Set argv BEFORE requiring setup.js so it reads the correct path
    process.argv = [process.argv[0], setupScript, projectPath];
    require(setupScript);
    break;
  }

  case 'remove':
  case 'uninstall': {
    const setupScript = path.join(appDir, 'bin', 'setup.js');
    const projectPath = args[1] || process.cwd();
    process.argv = [process.argv[0], setupScript, projectPath, '--uninstall'];
    require(setupScript);
    break;
  }

  case 'help':
  case '--help':
  case '-h':
  default:
    printHelp();
    break;
}
