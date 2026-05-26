import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { log } from './helpers.js';

// Register stealth plugin to avoid bot detection
puppeteer.use(StealthPlugin());

/**
 * Launch a headed (visible) Puppeteer browser with stealth plugin
 * Returns { browser, page }
 */
export async function launchBrowser() {
  log('🚀 Launching browser with stealth mode...');

  const browser = await puppeteer.launch({
    headless: false,         // Visible browser for login
    defaultViewport: null,   // Use full window size
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
    // Give extra time for startup
    timeout: 60000,
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  // Set a realistic viewport
  await page.setViewport({ width: 1920, height: 1080 });

  // Set a realistic user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );

  // Override navigator.webdriver
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  log('✅ Browser launched successfully');
  return { browser, page };
}

/**
 * Check if user is logged into Instagram by looking for session cookies
 */
export async function isLoggedIn(page) {
  const cookies = await page.cookies('https://www.instagram.com');
  return cookies.some(c => c.name === 'sessionid' && c.value);
}

/**
 * Navigate to Instagram and wait for login
 */
export async function navigateAndLogin(page) {
  log('🌐 Navigating to Instagram...');
  await page.goto('https://www.instagram.com/', {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  // Check if already logged in
  if (await isLoggedIn(page)) {
    log('✅ Already logged into Instagram!');
    return;
  }

  log('⏳ Waiting for you to log in to Instagram...');
  log('📱 Please log in manually in the browser window.');
  log('   The script will continue automatically once login is detected.');

  // Poll for login (check every 3 seconds)
  while (!(await isLoggedIn(page))) {
    await new Promise(r => setTimeout(r, 3000));
  }

  log('✅ Instagram login detected!');
  // Wait a bit for the page to fully load after login
  await new Promise(r => setTimeout(r, 3000));
}
