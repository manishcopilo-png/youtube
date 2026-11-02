const { spawn } = require('child_process');
const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDataDir = 'C:\\Users\\Manish Kushwah\\Downloads\\multi-profile-manager\\data\\profiles\\profile_001';

console.log('Testing spawn with:', exe);
console.log('User data dir:', userDataDir);

const child = spawn(exe, [
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  'https://accounts.google.com/'
], {
  detached: true,
  stdio: 'ignore'
});

child.on('error', err => console.error('Spawn error:', err));
console.log('Spawned PID:', child.pid);
setTimeout(() => {
  console.log('Done test');
  process.exit(0);
}, 2000);
