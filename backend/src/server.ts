import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer } from 'ws';
import { db, getSetting, setSetting, log, now, bus, ROOT } from './db';
import * as B from './browser';
import { snapshot, chromeProcessCount } from './resources';
const HOST = process.env.HOST || '127.0.0.1', PORT = parseInt(process.env.PORT || '4000'), TOKEN = process.env.API_TOKEN || '';
if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !TOKEN) { console.error('Refusing remote bind without API_TOKEN'); process.exit(1); }
const app = express(); app.use(express.json({ limit: '50kb' }));
app.use('/api', (req, res, next) => { if (TOKEN && req.header('x-api-token') !== TOKEN) return res.status(401).json({ error: 'Unauthorized' }); next(); });
app.use(express.static(path.join(ROOT, 'frontend')));
const wrap = (fn: (req: Request, res: Response) => any) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
const get = (id: string) => { const p = db.prepare('SELECT * FROM profiles WHERE id=?').get(id) as any; if (!p) throw bad('Profile not found', 404); return p; };
const idOf = (n: number) => `profile_${String(n).padStart(3, '0')}`;
const email = (s: any) => { if (s === undefined || s === null || s === '') return null; if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s))) throw bad('Invalid email'); return String(s); };
export function parseYouTube(raw: string): any {
  let u: URL; try { u = new URL(raw); } catch { return { valid: false, error: 'Not a valid URL' }; }
  if (u.protocol !== 'https:') return { valid: false, error: 'HTTPS required' };
  const h = u.hostname.replace(/^www\.|^m\./, ''); let v: string | null = null;
  if (h === 'youtu.be') v = u.pathname.slice(1); else if (h === 'youtube.com') v = u.pathname === '/watch' ? u.searchParams.get('v') : (u.pathname.match(/^\/(embed|shorts)\/([\w-]{11})/)?.[2] ?? null);
  else return { valid: false, error: 'Only youtube.com / youtu.be URLs are allowed' };
  return v && /^[\w-]{11}$/.test(v) ? { valid: true, videoId: v, url: `https://www.youtube.com/watch?v=${v}` } : { valid: false, error: 'No valid video ID found' };
}
function addProfile(name?: string, em?: string | null) {
  const used = new Set((db.prepare('SELECT id FROM profiles').all() as any[]).map(r => r.id)); let n = 1; while (used.has(idOf(n))) n++;
  if (n > 50) throw bad('Maximum of 50 profiles reached');
  const id = idOf(n), dir = path.join(getSetting('profiles_dir'), id);
  db.prepare('INSERT INTO profiles(id,profile_name,account_email,storage_path,created_at) VALUES(?,?,?,?,?)').run(id, name || `Profile ${n}`, em ?? null, dir, now());
  fs.mkdirSync(dir, { recursive: true }); log(id, 'profile_created', `Created ${id}`); return id;
}
const withAssign = (p: any) => ({ ...p, running: B.isRunning(p.id), needs_login: B.isRunning(p.id) ? false : getSetting(`login:${p.id}`) !== '1',
  test_url: (db.prepare('SELECT video_url FROM video_assignments WHERE profile_id=? ORDER BY id DESC LIMIT 1').get(p.id) as any)?.video_url ?? null });
app.get('/api/profiles', wrap((_q, r) => r.json((db.prepare('SELECT * FROM profiles ORDER BY id').all() as any[]).map(withAssign))));
app.post('/api/profiles', wrap((q, r) => { const name = String(q.body.profile_name ?? '').trim().slice(0, 60); r.status(201).json(withAssign(get(addProfile(name || undefined, email(q.body.account_email))))); }));
app.post('/api/profiles/seed', wrap((_q, r) => { let c = 0; while ((db.prepare('SELECT COUNT(*) c FROM profiles').get() as any).c < 50) { addProfile(); c++; } r.json({ created: c }); }));
app.get('/api/profiles/:id', wrap((q, r) => r.json(withAssign(get(q.params.id)))));
app.put('/api/profiles/:id', wrap((q, r) => { const p = get(q.params.id); const name = q.body.profile_name !== undefined ? String(q.body.profile_name).trim().slice(0, 60) : p.profile_name; if (!name) throw bad('Name required');
  db.prepare('UPDATE profiles SET profile_name=?, account_email=? WHERE id=?').run(name, q.body.account_email !== undefined ? email(q.body.account_email) : p.account_email, p.id); r.json(withAssign(get(p.id))); }));
app.delete('/api/profiles/:id', wrap(async (q, r) => { const p = get(q.params.id); if (q.query.confirm !== 'true') throw bad('Pass ?confirm=true to delete');
  await B.stop(p.id); db.prepare('DELETE FROM profiles WHERE id=?').run(p.id); fs.rmSync(p.storage_path, { recursive: true, force: true }); log(p.id, 'profile_deleted', 'Deleted'); r.json({ deleted: p.id }); }));
app.post('/api/profiles/:id/start', wrap(async (q, r) => { get(q.params.id); await B.start(q.params.id); r.json({ ok: true }); }));
app.post('/api/video/play-simultaneous', wrap(async (q, r) => {
  const ids: string[] = Array.isArray(q.body.profile_ids) ? q.body.profile_ids : [];
  if (!ids.length) throw bad('Select at least one profile');
  const muted = q.body.muted === true;
  const url = q.body.url ? String(q.body.url) : undefined;
  const result = await B.playSimultaneous(ids, url, muted);
  r.json(result);
}));
app.post('/api/video/play-all', wrap(async (q, r) => {
  const ids: string[] = Array.isArray(q.body.profile_ids) ? q.body.profile_ids : [];
  if (!ids.length) throw bad('Select at least one profile');
  const muted = q.body.muted === true;
  const url = q.body.url ? String(q.body.url) : undefined;
  const result = await B.playSimultaneous(ids, url, muted);
  r.json(result);
}));
app.post('/api/profiles/bulk-start', wrap(async (q, r) => {
  const ids: string[] = Array.isArray(q.body.profile_ids) ? q.body.profile_ids : [];
  if (!ids.length) throw bad('Select at least one profile');
  const result = await B.startSimultaneous(ids);
  r.json(result);
}));
app.post('/api/profiles/bulk-stop', wrap(async (q, r) => {
  const ids: string[] = Array.isArray(q.body.profile_ids) ? q.body.profile_ids : [];
  if (!ids.length) throw bad('Select at least one profile');
  const result = await B.stopSimultaneous(ids);
  r.json(result);
}));
app.post('/api/video/mute-all', wrap(async (q, r) => {
  const muted = q.body.muted !== false;
  await B.setAllMuted(muted);
  r.json({ ok: true, muted, count: B.getAllRunningIds().length });
}));
app.post('/api/profiles/:id/stop', wrap(async (q, r) => { get(q.params.id); await B.stop(q.params.id); r.json({ ok: true }); }));
app.post('/api/profiles/:id/play-video', wrap(async (q, r) => { get(q.params.id); const res = await B.playVideo(q.params.id, q.body.url); r.json(res); }));
app.post('/api/profiles/:id/google-login', wrap(async (q, r) => { get(q.params.id); const res = await B.openGoogleLogin(q.params.id); r.json(res); }));
app.post('/api/profiles/:id/mark-logged-in', wrap((q, r) => { const p = get(q.params.id); const val = q.body.logged_in === false ? '0' : '1'; setSetting(`login:${p.id}`, val); log(p.id, 'login_status_updated', val === '1' ? 'Marked as permanently logged in' : 'Marked as needs login'); r.json({ ok: true, needs_login: val !== '1' }); }));
app.post('/api/profiles/:id/interact', wrap(async (q, r) => { get(q.params.id); const res = await B.interact(q.params.id, q.body.action, q.body); r.json(res); }));
app.post('/api/profiles/:id/mute', wrap(async (q, r) => {
  const muted = q.body.muted !== false;
  await B.setMuted(q.params.id, muted);
  r.json({ ok: true, muted });
}));
app.get('/api/profiles/:id/mute', wrap(async (q, r) => {
  const muted = await B.getMuted(q.params.id);
  r.json({ muted });
}));
app.get('/api/profiles/:id/screenshot', wrap(async (q, r) => { const buf = await B.captureScreenshot(q.params.id); if (!buf) return r.status(404).send('No active window to capture'); r.type('image/jpeg').send(buf); }));
app.get('/api/profiles/:id/page-info', wrap(async (q, r) => { const info = await B.getPageInfo(q.params.id); r.json(info || { running: false }); }));
app.get('/api/profiles/:id/status', wrap(async (q, r) => { get(q.params.id); r.json(await B.status(q.params.id)); }));
app.post('/api/video/validate', wrap((q, r) => r.json(parseYouTube(String(q.body.url ?? '')))));
app.post('/api/video/assign', wrap((q, r) => { const v = parseYouTube(String(q.body.url ?? '')); if (!v.valid) throw bad(v.error); const ids: string[] = Array.isArray(q.body.profile_ids) ? q.body.profile_ids : [q.body.profile_id];
  if (!ids.length) throw bad('Select at least one profile'); ids.forEach(id => { get(id); db.prepare('INSERT INTO video_assignments(profile_id,video_url,created_at) VALUES(?,?,?)').run(id, v.url, now()); }); r.json({ assigned: ids.length, url: v.url }); }));
app.post('/api/video/test', wrap(async (q, r) => { const p = get(q.body.profile_id); let url: string | null = null;
  if (q.body.url) { const v = parseYouTube(String(q.body.url)); if (!v.valid) throw bad(v.error); url = v.url; } else url = withAssign(p).test_url; if (!url) throw bad('No assigned URL'); r.json(await B.playVideo(p.id, url)); }));
app.get('/api/video/runs', wrap((_q, r) => r.json(db.prepare('SELECT * FROM test_runs ORDER BY id DESC LIMIT 100').all())));
app.get('/api/system/resources', wrap(async (_q, r) => r.json({ ...snapshot(B.runningTests, B.runningCount()), queued: 0, systemChromeProcesses: await chromeProcessCount() })));
app.get('/api/logs', wrap((q, r) => { const rows = db.prepare('SELECT * FROM activity_logs WHERE (?1 IS NULL OR profile_id=?1) AND (?2 IS NULL OR event_type=?2) ORDER BY id DESC LIMIT 1000').all(q.query.profile_id ?? null, q.query.event_type ?? null) as any[];
  if (q.query.format !== 'csv') return r.json(rows); const esc = (s: any) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  r.type('text/csv').attachment('activity_logs.csv').send(['created_at,profile_id,event_type,description', ...rows.map(x => [x.created_at, x.profile_id, x.event_type, x.description].map(esc).join(','))].join('\n')); }));
const ALLOWED = ['browser_path', 'browser_mode', 'headless_concurrency', 'visible_concurrency', 'schedule_enabled', 'schedule_minutes', 'profiles_dir', 'log_retention_days', 'theme', 'start_scheduler_on_boot'];
app.get('/api/settings', wrap((_q, r) => r.json(Object.fromEntries(ALLOWED.map(k => [k, getSetting(k)])))));
app.put('/api/settings', wrap((q, r) => { for (const [k, v] of Object.entries(q.body)) { if (!ALLOWED.includes(k)) throw bad(`Unknown setting ${k}`); const s = String(v);
  if (k === 'schedule_minutes' && ![5, 6, 7, 8, 9, 10].includes(+s)) throw bad('Interval must be 5-10 minutes'); if (k.endsWith('concurrency') && !(+s >= 1 && +s <= 50)) throw bad('Concurrency must be 1-50');
  if (k === 'browser_mode' && !['visible', 'headless'].includes(s)) throw bad('Mode must be visible|headless'); setSetting(k, s); } schedule(); r.json({ ok: true }); }));
let timer: NodeJS.Timeout | null = null;
function schedule() { if (timer) clearInterval(timer); timer = null;
  if (getSetting('schedule_enabled') === 'true') timer = setInterval(() => (db.prepare('SELECT profile_id id, video_url url FROM video_assignments WHERE id IN (SELECT MAX(id) FROM video_assignments GROUP BY profile_id)').all() as any[]).forEach(a => B.playVideo(a.id, a.url)), parseInt(getSetting('schedule_minutes')) * 60000); }
app.post('/api/scheduler/:action', wrap(async (q, r) => { const a = q.params.action;
  if (a === 'stop') { await B.stopAll(); setSetting('schedule_enabled', 'false'); schedule(); } else if (a === 'pause' || a === 'resume') { setSetting('schedule_enabled', a === 'resume' ? 'true' : 'false'); schedule(); } r.json({ ok: true }); }));
if (getSetting('start_scheduler_on_boot') !== 'true') setSetting('schedule_enabled', 'false');
schedule();
app.use((e: any, _q: Request, r: Response, _n: NextFunction) => r.status(e.status || 500).json({ error: e.message || 'Server error' }));
const server = http.createServer(app); const wss = new WebSocketServer({ server, path: '/ws' });
bus.emit = m => wss.clients.forEach(c => c.readyState === 1 && c.send(JSON.stringify(m)));
setInterval(() => bus.emit?.({ type: 'resources', data: snapshot(B.runningTests, B.runningCount()) }), 3000);
const bye = async () => { await B.stopAll(); process.exit(0); }; process.on('SIGINT', bye); process.on('SIGTERM', bye);
server.listen(PORT, HOST, () => console.log(`Manager at http://${HOST}:${PORT}`));
