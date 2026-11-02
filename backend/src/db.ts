import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
export const ROOT = path.resolve(__dirname, '../..');
fs.mkdirSync(path.join(ROOT, 'data/logs'), { recursive: true });
export const db = new DatabaseSync(process.env.DB_PATH || path.join(ROOT, 'data/manager.db'));
db.exec('PRAGMA journal_mode = WAL');
const migrations = [`
CREATE TABLE profiles(id TEXT PRIMARY KEY, profile_name TEXT NOT NULL, account_email TEXT, storage_path TEXT NOT NULL,
 browser_mode TEXT NOT NULL DEFAULT 'visible', status TEXT NOT NULL DEFAULT 'stopped', created_at TEXT NOT NULL, last_used_at TEXT);
CREATE TABLE video_assignments(id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, video_url TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE test_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL, test_status TEXT NOT NULL, error_message TEXT, started_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE activity_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT, event_type TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL);
CREATE TABLE settings(id INTEGER PRIMARY KEY AUTOINCREMENT, setting_key TEXT UNIQUE NOT NULL, setting_value TEXT);
CREATE INDEX idx_va_profile ON video_assignments(profile_id);
CREATE INDEX idx_tr_profile ON test_runs(profile_id, started_at);
CREATE INDEX idx_log_created ON activity_logs(created_at);
CREATE INDEX idx_log_profile ON activity_logs(profile_id);`];
let v = Number((db.prepare('PRAGMA user_version').get() as any)?.user_version ?? 0);
while (v < migrations.length) { db.exec(migrations[v]); v++; db.exec(`PRAGMA user_version = ${v}`); }
const defaults: Record<string, string> = { browser_path: process.env.CHROME_PATH || '', browser_mode: 'visible',
  headless_concurrency: '2', visible_concurrency: '1', schedule_enabled: 'false', schedule_minutes: '5',
  profiles_dir: path.join(ROOT, 'data/profiles'), log_retention_days: '30', theme: 'dark', start_scheduler_on_boot: 'false' };
for (const [k, val] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO settings(setting_key,setting_value) VALUES(?,?)').run(k, val);
export const getSetting = (k: string) => (db.prepare('SELECT setting_value v FROM settings WHERE setting_key=?').get(k) as any)?.v ?? '';
export const setSetting = (k: string, val: string) => db.prepare('INSERT INTO settings(setting_key,setting_value) VALUES(?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value').run(k, val);
export const now = () => new Date().toISOString();
export const bus: { emit?: (m: any) => void } = {};
export function log(profile_id: string | null, event_type: string, description: string) {
  db.prepare('INSERT INTO activity_logs(profile_id,event_type,description,created_at) VALUES(?,?,?,?)').run(profile_id, event_type, description, now());
  bus.emit?.({ type: 'log' });
}
db.prepare("DELETE FROM activity_logs WHERE created_at < datetime('now', ?)").run(`-${parseInt(getSetting('log_retention_days')) || 30} days`);
db.prepare("UPDATE profiles SET status='stopped' WHERE status IN ('running','starting')").run();
