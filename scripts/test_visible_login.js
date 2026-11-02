const { chromium } = require('playwright-core');

(async () => {
  try {
    const ctx = await chromium.launchPersistentContext('C:\\Users\\Manish Kushwah\\Downloads\\multi-profile-manager\\data\\profiles\\profile_001', {
      channel: 'chrome',
      headless: false,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        '--start-maximized'
      ],
      viewport: null
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('https://accounts.google.com/');
    console.log('Opened accounts.google.com successfully in visible Chrome!');
    await new Promise(r => setTimeout(r, 4000));
    await ctx.close();
    console.log('Closed context cleanly.');
  } catch (err) {
    console.error('Error:', err);
  }
})();
