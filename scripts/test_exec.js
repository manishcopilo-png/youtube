const { exec } = require('child_process');
const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDir = 'C:\\Users\\Manish Kushwah\\Downloads\\multi-profile-manager\\data\\profiles\\profile_001';

const cmd = `start "" "${exe}" --user-data-dir="${profileDir}" --new-window --no-first-run --no-default-browser-check "https://accounts.google.com/"`;
console.log('Running cmd:', cmd);

exec(cmd, (err, stdout, stderr) => {
  console.log('Finished exec:', { err, stdout, stderr });
});
