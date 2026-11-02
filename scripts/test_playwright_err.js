const { chromium } = require('playwright-core');

(async () => {
  try {
    const ctx = await chromium.launchPersistentContext('C:\\Users\\Manish Kushwah\\Downloads\\multi-profile-manager\\data\\profiles\\profile_001', {
      channel: 'chrome',
      headless: false,
    });
    console.log('Success launched!');
    await ctx.close();
  } catch (err) {
    console.error('Playwright Error:', err.message);
  }
})();
