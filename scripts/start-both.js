const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.join(__dirname, '..');

console.log('----------------------------------------------------');
console.log('🎵 Starting Offline Music App & Audio Engine (Port 3000)');
console.log('----------------------------------------------------');

const serverProc = spawn('node', ['server.js'], {
  stdio: 'inherit',
  shell: true,
  cwd: rootDir,
});

const expoProc = spawn('npx', ['expo', 'start', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  cwd: rootDir,
});

function cleanup() {
  try { serverProc.kill(); } catch (_) {}
  try { expoProc.kill(); } catch (_) {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
