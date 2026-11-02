const { execSync } = require('child_process');
const storagePath = 'C:\\Users\\Manish Kushwah\\Downloads\\multi-profile-manager\\data\\profiles\\profile_001';

function killProfileProcesses(dir) {
  if (process.platform === 'win32') {
    try {
      const p = dir.replace(/\\/g, '\\\\');
      execSync(`wmic process where "name='chrome.exe' and commandline like '%${p}%'" call terminate`, { stdio: 'ignore', timeout: 3000 });
      console.log('WMIC kill executed successfully');
    } catch (e) {
      console.log('WMIC error/not found:', e.message);
    }
  }
}

killProfileProcesses(storagePath);
