const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDir = 'C:\\Users\\Manish Kushwah\\Downloads\\multi-profile-manager\\data\\profiles\\profile_001';

try {
  fs.rmSync(path.join(profileDir, 'lockfile'), { force: true });
} catch {}

console.log('Launching Chrome via cmd.exe start...');
execFile('cmd.exe', [
  '/c',
  'start',
  '""',
  exe,
  `--user-data-dir=${profileDir}`,
  '--new-window',
  '--no-first-run',
  '--no-default-browser-check',
  'https://accounts.google.com/'
], (err, stdout, stderr) => {
  if (err) {
    console.error('Launch error:', err);
  } else {
    console.log('Launch succeeded. stdout:', stdout, 'stderr:', stderr);
  }
});
