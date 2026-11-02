import { chromium, BrowserContext, Page } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { exec, execSync } from 'child_process';
import { db, getSetting, setSetting, log, now, bus } from './db';
import { ramPercent } from './resources';

const ctxs = new Map<string, BrowserContext>();
export let runningTests = 0;
export const runningCount = () => ctxs.size;
export const getAllRunningIds = () => [...ctxs.keys()];

const emit = () => bus.emit?.({ type: 'status' });
const setStatus = (id: string, s: string) => { db.prepare('UPDATE profiles SET status=? WHERE id=?').run(s, id); emit(); };
const profile = (id: string) => db.prepare('SELECT * FROM profiles WHERE id=?').get(id) as any;

export const isRunning = (id: string) => ctxs.has(id);

export function killProfileProcesses(storagePath: string) {
  try {
    fs.rmSync(path.join(storagePath, 'lockfile'), { force: true });
    fs.rmSync(path.join(storagePath, 'SingletonLock'), { force: true });
    fs.rmSync(path.join(storagePath, 'SingletonSocket'), { force: true });
    fs.rmSync(path.join(storagePath, 'SingletonCookie'), { force: true });
  } catch {}
}

async function hasSession(ctx: BrowserContext) {
  try {
    const cookies = await ctx.cookies();
    return cookies.some(c => c.name === 'SID' || c.name === '__Secure-1PSID' || c.name === 'SSID' || c.name === 'SAPISID');
  } catch {
    return false;
  }
}

async function saveLoginState(id: string, ctx: BrowserContext) {
  const loggedIn = await hasSession(ctx);
  if (loggedIn) {
    setSetting(`login:${id}`, '1');
  }
}

function resolveChromePath(): string | undefined {
  const custom = getSetting('browser_path');
  if (custom && fs.existsSync(custom)) return custom;
  const standardPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
  ];
  for (const p of standardPaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

async function launch(id: string, headless: boolean) {
  const p = profile(id);
  fs.mkdirSync(p.storage_path, { recursive: true });

  // Kill any orphaned process locking this profile directory
  killProfileProcesses(p.storage_path);

  // Clear stale lockfile
  try {
    fs.rmSync(path.join(p.storage_path, 'lockfile'), { force: true });
  } catch {}

  const exe = resolveChromePath();

  const ctx = await chromium.launchPersistentContext(p.storage_path, {
    headless,
    ...(exe ? { executablePath: exe } : { channel: 'chrome' }),
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--autoplay-policy=no-user-gesture-required',
      '--start-maximized'
    ],
    ...(headless ? { viewport: { width: 1280, height: 720 } } : { viewport: null })
  });

  // Bypass Google automated browser security check
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
  });

  ctx.on('page', pg => pg.on('crash', async () => {
    log(id, 'browser_crashed', 'Page crashed');
    try { await pg.reload(); log(id, 'recovery', 'Crashed page reloaded'); } catch { /* ignore */ }
  }));

  ctx.on('close', async () => {
    if (ctxs.get(id) === ctx) {
      ctxs.delete(id);
      setStatus(id, 'stopped');
      log(id, 'browser_stopped', 'Browser closed');
    }
  });

  return ctx;
}

export async function start(id: string, initialUrl?: string) {
  if (ctxs.has(id)) return ctxs.get(id)!;
  const mode = getSetting('browser_mode') === 'headless' ? 'headless' : 'visible';
  setSetting('visible_concurrency', '50');

  setStatus(id, 'starting');
  try {
    const ctx = await launch(id, mode === 'headless');
    ctxs.set(id, ctx);

    // If visible mode, open assigned video if available, or target URL, or Google
    if (mode === 'visible') {
      const pages = ctx.pages();
      const pg = pages.length > 0 ? pages[0] : await ctx.newPage();
      let targetUrl: string = initialUrl || '';
      if (!targetUrl) {
        const assign = db.prepare('SELECT video_url FROM video_assignments WHERE profile_id=? ORDER BY id DESC LIMIT 1').get(id) as any;
        targetUrl = assign?.video_url || 'https://www.google.com';
      }
      await pg.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => 0);

      // If it's a video, trigger autoplay
      if (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be')) {
        await pg.waitForTimeout(1000);
        await pg.evaluate(() => {
          const v = document.querySelector('video');
          if (v) {
            v.play().catch(() => {
              v.muted = true;
              v.play().catch(() => 0);
            });
          }
        }).catch(() => 0);
      }

      await pg.bringToFront().catch(() => 0);
    }

    db.prepare('UPDATE profiles SET status=?, browser_mode=?, last_used_at=? WHERE id=?').run('running', mode, now(), id);
    emit();
    log(id, 'browser_launched', `Launched (${mode})`);
    return ctx;
  } catch (e: any) {
    ctxs.delete(id);
    setStatus(id, 'failed');
    log(id, 'browser_failed', e.message);
    throw e;
  }
}

export async function startSimultaneous(profileIds: string[]) {
  if (!profileIds.length) return { error: 'No profiles selected' };
  setSetting('visible_concurrency', '50');
  setSetting('browser_mode', 'visible');
  log(null, 'simultaneous_start', `Starting ${profileIds.length} profiles simultaneously`);

  const promises = profileIds.map(async (id) => {
    try {
      await start(id);
      return { id, ok: true };
    } catch (err: any) {
      return { id, ok: false, error: err.message };
    }
  });

  const results = await Promise.all(promises);
  emit();
  return { ok: true, started: results.filter(r => r.ok).length, results };
}

export async function stop(id: string) {
  const c = ctxs.get(id);
  if (c) {
    await saveLoginState(id, c).catch(() => 0);
    await c.close().catch(() => 0);
    ctxs.delete(id);
  }
  const p = profile(id);
  if (p) killProfileProcesses(p.storage_path);
  setStatus(id, 'stopped');
}

export async function stopSimultaneous(profileIds: string[]) {
  if (!profileIds.length) return { ok: true, stopped: 0 };
  const promises = profileIds.map(async (id) => {
    try {
      await stop(id);
      return { id, ok: true };
    } catch (err: any) {
      return { id, ok: false, error: err.message };
    }
  });
  const results = await Promise.all(promises);
  emit();
  return { ok: true, stopped: results.filter(r => r.ok).length, results };
}

export async function stopAll() {
  await Promise.all([...ctxs.keys()].map(id => stop(id).catch(() => 0)));
  ctxs.clear();
  db.prepare("UPDATE profiles SET status='stopped'").run();
  emit();
}

export async function openGoogleLogin(id: string) {
  if (!ctxs.has(id)) {
    setSetting('browser_mode', 'visible');
    await start(id, 'https://accounts.google.com/');
  } else {
    const ctx = ctxs.get(id)!;
    const pages = ctx.pages();
    const pg = pages.length > 0 ? pages[0] : await ctx.newPage();
    await pg.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded' });
    await pg.bringToFront().catch(() => 0);
  }
  log(id, 'login_page_opened', 'Google login page opened for manual sign-in');
  return { ok: true, message: 'Google Sign-In page opened in visible Chrome window.' };
}

export async function playVideo(id: string, targetUrl?: string, muted?: boolean) {
  let url = targetUrl;
  if (!url) {
    const assign = db.prepare('SELECT video_url FROM video_assignments WHERE profile_id=? ORDER BY id DESC LIMIT 1').get(id) as any;
    url = assign?.video_url;
  }
  if (!url) throw Object.assign(new Error('No video URL assigned to this profile'), { status: 400 });

  // If targetUrl was given, save as assigned url
  if (targetUrl) {
    db.prepare('INSERT INTO video_assignments(profile_id, video_url, created_at) VALUES(?,?,?)').run(id, targetUrl, now());
  }

  // Ensure profile is running in visible mode
  let ctx = ctxs.get(id);
  if (!ctx) {
    setSetting('browser_mode', 'visible');
    ctx = await start(id, url);
  } else {
    const pages = ctx.pages();
    const page = pages.length > 0 ? pages[0] : await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  const pages = ctx.pages();
  const page = pages.length > 0 ? pages[0] : await ctx.newPage();

  // Auto-play the video
  try {
    await page.waitForTimeout(1000);

    const playBtn = page.locator('button.ytp-large-play-button, button.ytp-play-button, .video-stream, #movie_player').first();
    if (await playBtn.isVisible().catch(() => false)) {
      await playBtn.click().catch(() => 0);
    }

    await page.evaluate((isMuted) => {
      const v = document.querySelector('video');
      if (v) {
        if (isMuted !== undefined) v.muted = isMuted;
        v.play().catch(() => {
          v.muted = true;
          v.play().catch(() => 0);
        });
      }
    }, muted).catch(() => 0);
  } catch {}

  log(id, 'video_playing', `Video is now playing: ${url}`);
  return { ok: true, url, message: `Video is now playing in ${id} window.` };
}

// ---- Simultaneous Multi-Profile Video Player (Plays all selected profiles at the SAME time) ----
export async function playSimultaneous(profileIds: string[], targetUrl?: string, muted = false) {
  if (!profileIds.length) return { error: 'No profiles selected' };

  log(null, 'simultaneous_play_started', `Starting ${profileIds.length} profiles simultaneously at the same time`);

  setSetting('visible_concurrency', '50');
  setSetting('browser_mode', 'visible');

  // Start ALL selected profiles concurrently in parallel (NO sequential delays!)
  const promises = profileIds.map(async (id) => {
    try {
      await playVideo(id, targetUrl, muted);
      return { id, ok: true };
    } catch (err: any) {
      log(id, 'play_error', err.message);
      return { id, ok: false, error: err.message };
    }
  });

  const results = await Promise.all(promises);
  const successCount = results.filter(r => r.ok).length;
  emit();
  return { ok: true, played: successCount, total: profileIds.length, results };
}

export async function setMuted(id: string, muted: boolean) {
  const ctx = ctxs.get(id);
  if (!ctx) return false;
  for (const page of ctx.pages()) {
    try {
      await page.evaluate((m) => {
        document.querySelectorAll('video').forEach(v => { v.muted = m; });
      }, muted);
    } catch {}
  }
  log(id, 'video_mute_changed', muted ? 'Audio muted' : 'Audio unmuted');
  return true;
}

export async function setAllMuted(muted: boolean) {
  for (const id of ctxs.keys()) {
    await setMuted(id, muted);
  }
  return true;
}

export async function getMuted(id: string): Promise<boolean> {
  const ctx = ctxs.get(id);
  if (!ctx) return true;
  const page = ctx.pages()[0];
  if (!page) return true;
  try {
    return await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? v.muted : true;
    });
  } catch {
    return true;
  }
}

export async function interact(id: string, action: string, data: any) {
  const ctx = ctxs.get(id);
  if (!ctx) throw Object.assign(new Error('Profile is not running'), { status: 400 });
  const pages = ctx.pages();
  const page = pages.length > 0 ? pages[0] : null;
  if (!page) throw Object.assign(new Error('No active page in profile'), { status: 400 });

  if (action === 'click') {
    const x = Math.round(Number(data.x) || 0);
    const y = Math.round(Number(data.y) || 0);
    await page.mouse.click(x, y);
    log(id, 'user_clicked', `Clicked at (${x}, ${y})`);
  } else if (action === 'type') {
    const text = String(data.text ?? '');
    await page.keyboard.type(text, { delay: 20 });
    log(id, 'user_typed', `Typed text into active element`);
  } else if (action === 'press') {
    const key = String(data.key || 'Enter');
    await page.keyboard.press(key);
    log(id, 'user_pressed', `Pressed key: ${key}`);
  } else if (action === 'fill') {
    const selector = String(data.selector || 'input');
    const value = String(data.value ?? '');
    await page.fill(selector, value);
    log(id, 'user_filled', `Filled ${selector}`);
  }

  await page.waitForTimeout(300);
  return { ok: true, url: page.url(), title: await page.title() };
}

export async function captureScreenshot(id: string): Promise<Buffer | null> {
  const ctx = ctxs.get(id);
  if (!ctx) return null;
  const pages = ctx.pages();
  const page = pages.length > 0 ? pages[0] : null;
  if (!page) return null;
  try {
    return await page.screenshot({ type: 'jpeg', quality: 65, timeout: 3000 });
  } catch {
    return null;
  }
}

export async function getPageInfo(id: string): Promise<{ url: string; title: string; running: boolean } | null> {
  const ctx = ctxs.get(id);
  if (!ctx) return { url: '', title: '', running: false };
  const pages = ctx.pages();
  const page = pages.length > 0 ? pages[0] : null;
  if (!page) return { url: '', title: '', running: true };
  try {
    return {
      url: page.url(),
      title: await page.title(),
      running: true
    };
  } catch {
    return { url: '', title: '', running: true };
  }
}

export async function status(id: string) {
  const c = ctxs.get(id);
  const loggedIn = c ? await hasSession(c).catch(() => false) : getSetting(`login:${id}`) === '1';
  return { ...profile(id), running: isRunning(id), needs_login: !loggedIn };
}
