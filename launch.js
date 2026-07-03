// Launch script — clears ELECTRON_RUN_AS_NODE before spawning Electron
const { spawn } = require('child_process');

const electronPath = require('electron');
console.log('Launching Electron from:', electronPath);

// --log-level=3 suppresses noisy Chromium USB/BT driver enumeration warnings
const args = ['.', '--log-level=3', ...process.argv.slice(2)];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const proc = spawn(electronPath, args, {
  stdio: 'inherit',
  env,
  cwd: __dirname,
  windowsHide: false,
});

proc.on('error', err => {
  console.error('Failed to start Electron:', err.message);
  process.exit(1);
});

proc.on('close', code => process.exit(code || 0));
