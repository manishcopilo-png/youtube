# Multi Profile Manager (v0.1 – lean core)
Local app (Node + Express + SQLite + Playwright) managing up to 50 persistent Chrome profiles. Bound to 127.0.0.1.

## Install (Windows 10/11)
1. Install Node.js 20+ and Google Chrome. (better-sqlite3 uses prebuilt binaries; if it fails, install "Visual Studio Build Tools".)
2. Double-click `start.bat` (runs `npm install`, starts server, opens http://127.0.0.1:4000). `stop.bat` stops it.
3. Profiles tab → "Create up to 50", then Start → Open Google → sign in manually. Sessions persist in `data/profiles/profile_NNN/`.

## Notes
- Chrome is launched via `playwright-core` using installed Chrome (or CHROME_PATH / Settings → browser_path).
- Visible concurrency default 1, headless 2. RAM ≥80% pauses launches; ≥90% blocks them. Only app-launched contexts are closed.
- Video tests load the official embed page and report player/console/network status. They never play, loop or inflate views.
- A profile directory can only be open once: a test on a running profile uses its existing window; otherwise a temporary headless context is used.
- Google may show verification/CAPTCHA prompts; complete them manually.

## Troubleshooting
- "Port in use": change PORT in `.env`. "Chrome not found": set CHROME_PATH. Logs: `data/logs/server.log`.
- Sign-in blocked in automated browsers: Google sometimes refuses sign-in in Playwright-controlled Chrome. No workaround is provided; use the profile's normal Chrome sign-in or retry later.
