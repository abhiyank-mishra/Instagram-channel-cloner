/**
 * Phase 1: Collect All Reel Links from @findinggoodmovie.s
 * 
 * This script:
 * 1. Launches a visible browser with stealth mode
 * 2. Waits for manual Instagram login
 * 3. Exports cookies for yt-dlp (Phase 2)
 * 4. Navigates to the profile's Reels tab
 * 5. Scrolls to the bottom collecting all reel links
 * 6. Saves links in order: Reel 01 = oldest (first posted)
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser, navigateAndLogin } from './utils/browser.js';
import { exportCookies } from './utils/cookies.js';
import { randomDelay, saveJSON, log, logError, ensureDir } from './utils/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// Config from .env
const TARGET_PROFILE = process.env.TARGET_PROFILE || 'findinggoodmovie.s';
const SCROLL_DELAY_MIN = parseInt(process.env.SCROLL_DELAY_MIN) || 1500;
const SCROLL_DELAY_MAX = parseInt(process.env.SCROLL_DELAY_MAX) || 3000;
const MAX_STALE_SCROLLS = parseInt(process.env.MAX_STALE_SCROLLS) || 8;
const COOKIES_FILE = path.resolve(ROOT_DIR, process.env.COOKIES_FILE || 'cookies.txt');
const OUTPUT_DIR = path.resolve(ROOT_DIR, process.env.OUTPUT_DIR || 'output');

/**
 * Scroll the reels tab and collect all reel/post links
 */
async function collectReelLinks(page) {
  const reelLinks = new Set();
  let staleCount = 0;
  let scrollCount = 0;
  let lastCount = 0;

  log('📜 Starting scroll to collect reel links...');

  while (true) {
    scrollCount++;

    // Extract reel/post links from the page
    const newLinks = await page.evaluate(() => {
      const links = [];
      // Instagram uses <a> tags with href containing /reel/ or /p/
      const anchors = document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]');
      anchors.forEach(a => {
        const href = a.getAttribute('href');
        if (href && (href.includes('/reel/') || href.includes('/p/'))) {
          // Normalize to full URL
          const fullUrl = href.startsWith('http')
            ? href
            : `https://www.instagram.com${href}`;
          links.push(fullUrl);
        }
      });
      return links;
    });

    // Add to set (deduplication)
    for (const link of newLinks) {
      reelLinks.add(link);
    }

    // Check if we found new links
    if (reelLinks.size === lastCount) {
      staleCount++;
      log(`   📊 Scroll #${scrollCount}: No new reels (${reelLinks.size} total, stale: ${staleCount}/${MAX_STALE_SCROLLS})`);
    } else {
      staleCount = 0; // Reset stale counter
      log(`   📊 Scroll #${scrollCount}: Found ${reelLinks.size} reels (+${reelLinks.size - lastCount} new)`);
    }
    lastCount = reelLinks.size;

    // Stop if no new content after MAX_STALE_SCROLLS consecutive scrolls
    if (staleCount >= MAX_STALE_SCROLLS) {
      log(`\n🏁 Reached end of feed after ${scrollCount} scrolls (no new content for ${MAX_STALE_SCROLLS} scrolls)`);
      break;
    }

    // Scroll down by random amount
    await page.evaluate(() => {
      const distance = 300 + Math.floor(Math.random() * 400); // 300-700px
      window.scrollBy(0, distance);
    });

    // Human-like random delay
    await randomDelay(SCROLL_DELAY_MIN, SCROLL_DELAY_MAX);
  }

  return Array.from(reelLinks);
}

/**
 * Main execution
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  📸 Instagram Reels Link Collector');
  console.log(`  🎯 Target: @${TARGET_PROFILE}`);
  console.log('='.repeat(60) + '\n');

  let browser;

  try {
    // Step 1: Launch browser
    const result = await launchBrowser();
    browser = result.browser;
    const page = result.page;

    // Step 2: Navigate and login
    await navigateAndLogin(page);

    // Step 3: Export cookies for yt-dlp
    await exportCookies(page, COOKIES_FILE);

    // Step 4: Navigate to the profile's Reels tab
    const profileReelsUrl = `https://www.instagram.com/${TARGET_PROFILE}/reels/`;
    log(`🌐 Navigating to ${profileReelsUrl}`);
    await page.goto(profileReelsUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    // Wait for content to load
    await randomDelay(3000, 5000);

    // Check if the profile exists / is accessible
    const pageTitle = await page.title();
    if (pageTitle.includes('Page Not Found') || pageTitle.includes('not available')) {
      throw new Error(`Profile @${TARGET_PROFILE} not found or is private!`);
    }

    log(`✅ On profile page: ${pageTitle}`);

    // Step 5: Scroll and collect all reel links
    const links = await collectReelLinks(page);

    if (links.length === 0) {
      log('⚠️ No reel links found! The profile might be private or have no reels.');
      return;
    }

    // Step 6: Reverse so Reel 01 = oldest (first posted)
    // Instagram shows newest first, so we reverse
    const reversedLinks = links.reverse();

    // Build the output JSON
    const output = {
      profile: TARGET_PROFILE,
      profile_url: `https://www.instagram.com/${TARGET_PROFILE}/`,
      total_reels: reversedLinks.length,
      collected_at: new Date().toISOString(),
      reels: reversedLinks.map((url, index) => ({
        reel_number: index + 1,
        url: url.endsWith('/') ? url : url + '/',
      })),
    };

    // Step 7: Save to JSON
    const outputPath = path.join(OUTPUT_DIR, 'Reel links', 'reel_links.json');
    saveJSON(outputPath, output);

    console.log('\n' + '='.repeat(60));
    log(`🎉 SUCCESS! Collected ${reversedLinks.length} reel links`);
    log(`📄 Output saved to: ${outputPath}`);
    log('📝 Next step: Run "npm run download-reels" to download all reels');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    logError('Fatal error during link collection', error);
    console.error(error);
  } finally {
    if (browser) {
      log('🔒 Closing browser...');
      await browser.close();
    }
  }
}

// Run
main();
