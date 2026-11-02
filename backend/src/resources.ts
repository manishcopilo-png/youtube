import os from 'os';
import { execFile } from 'child_process';
let last = os.cpus().map(c => ({ ...c.times }));
export function cpuPercent() {
  const cur = os.cpus().map(c => ({ ...c.times })); let idle = 0, total = 0;
  cur.forEach((c, i) => { const p = last[i]; const t = (Object.keys(c) as (keyof typeof c)[]).reduce((s, k) => s + c[k] - p[k], 0); total += t; idle += c.idle - p.idle; });
  last = cur; return total ? Math.round((1 - idle / total) * 100) : 0;
}
export const ramPercent = () => Math.round((1 - os.freemem() / os.totalmem()) * 100);
export function snapshot(runningTests: number, appBrowsers: number) {
  const r = ramPercent();
  return { totalRamMB: Math.round(os.totalmem() / 1048576), availableRamMB: Math.round(os.freemem() / 1048576), ramPercent: r, cpuPercent: cpuPercent(),
    appBrowserContexts: appBrowsers, runningTests, warning: null };
}
// Informational only; the app never kills processes it does not own.
export const chromeProcessCount = () => new Promise<number>(res => process.platform === 'win32'
  ? execFile('tasklist', ['/FI', 'IMAGENAME eq chrome.exe', '/FO', 'CSV', '/NH'], (_e, o) => res((o || '').split('\n').filter(l => l.includes('chrome.exe')).length))
  : res(0));
