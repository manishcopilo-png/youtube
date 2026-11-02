const { chromium } = require('playwright-core');
(async () => {
  try {
    const ctx = await chromium.launchPersistentContext('data/profiles/test_login', {
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled', '--no-first-run']
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('https://accounts.google.com/');
    await page.waitForTimeout(3000);
    console.log('Title:', await page.title());
    console.log('URL:', page.url());
    const bodyText = await page.innerText('body');
    const blocked = bodyText.includes("Couldn't sign you in") || bodyText.includes('not be secure');
    console.log('Blocked:', blocked);
    await ctx.close();
  } catch (err) {
    console.error('Error:', err);
  }
})();
