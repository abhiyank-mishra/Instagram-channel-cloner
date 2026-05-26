/**
 * Phase 2: Download All Reels + Extract Metadata
 * 
 * Usage:
 *   npm run download                         → Download ALL reels
 *   npm run download -- count 5              → Download first 5 reels
 *   npm run download -- num 5                → Download only Reel 05
 *   npm run download -- num 5 3 47           → Download Reels 05, 03, 47
 *   npm run download -- 5                    → Shorthand: first 5 reels
 * 
 * All modes skip already-downloaded reels automatically.
 * 
 * This script:
 * 1. Reads reel links from Phase 1 output
 * 2. Parses CLI args to determine which reels to download
 * 3. Downloads each reel video using yt-dlp
 * 4. Extracts metadata (description, timestamp, comments, etc.)
 * 5. Creates individual reel folders with video + JSON
 * 6. Builds a combined All_reel.json
 * 7. Supports resume from interruptions
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  randomDelay, saveJSON, loadJSON, log, logError,
  ensureDir, extractHashtags, unixToISO, padNumber
} from './utils/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// Config from .env
const DOWNLOAD_DELAY_MIN = parseInt(process.env.DOWNLOAD_DELAY_MIN) || 3000;
const DOWNLOAD_DELAY_MAX = parseInt(process.env.DOWNLOAD_DELAY_MAX) || 8000;
const MAX_COMMENTS = parseInt(process.env.MAX_COMMENTS) || 10;
const COOKIES_FILE = path.resolve(ROOT_DIR, process.env.COOKIES_FILE || 'cookies.txt');
const OUTPUT_DIR = path.resolve(ROOT_DIR, process.env.OUTPUT_DIR || 'output');
const REEL_LINKS_PATH = path.join(OUTPUT_DIR, 'Reel links', 'reel_links.json');
const COMPLETE_DIR = path.join(OUTPUT_DIR, 'Complete');
const PROGRESS_FILE = path.join(COMPLETE_DIR, 'progress.json');

/**
 * Parse CLI arguments
 * Supports: count <N>, num <N...>, or just a number (treated as count)
 * Returns { mode: 'all' | 'count' | 'num', count?: number, nums?: number[] }
 */
function parseCLIArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    return { mode: 'all' };
  }

  // Check if first arg is 'count' keyword
  if (args[0].toLowerCase() === 'count' && args[1]) {
    const count = parseInt(args[1]);
    if (isNaN(count) || count <= 0) {
      logError('count requires a positive number. Example: npm run download count 5');
      process.exit(1);
    }
    return { mode: 'count', count };
  }

  // Check if first arg is 'num' keyword
  if (args[0].toLowerCase() === 'num') {
    const nums = [];
    for (let i = 1; i < args.length; i++) {
      const n = parseInt(args[i]);
      if (!isNaN(n) && n > 0) {
        nums.push(n);
      }
    }
    if (nums.length === 0) {
      logError('num requires at least one reel number. Example: npm run download num 5 3 47');
      process.exit(1);
    }
    return { mode: 'num', nums };
  }

  // If first arg is just a number, treat as count
  const firstNum = parseInt(args[0]);
  if (!isNaN(firstNum) && firstNum > 0 && args.length === 1) {
    return { mode: 'count', count: firstNum };
  }

  // If all args are numbers, treat as num mode
  const allNums = args.map(a => parseInt(a)).filter(n => !isNaN(n) && n > 0);
  if (allNums.length === args.length && allNums.length > 0) {
    return { mode: 'num', nums: allNums };
  }

  // Unknown args — show usage
  log(`⚠️ Unknown arguments: ${args.join(' ')}`);
  log('Usage:');
  log('  npm run download                         → Download ALL reels');
  log('  npm run download -- count 5              → Download first 5 reels');
  log('  npm run download -- num 5                → Download only Reel 05');
  log('  npm run download -- num 5 3 47 87 56     → Download specific reels');
  log('  npm run download -- 5                    → Shorthand: first 5 reels');
  process.exit(1);
}

/**
 * Check if a reel is already downloaded (has video file + reel_data.json)
 */
function isAlreadyDownloaded(reelNum) {
  const reelFolderName = `Reel ${padNumber(reelNum)}`;
  const reelDir = path.join(COMPLETE_DIR, reelFolderName);

  if (!fs.existsSync(reelDir)) return false;

  // Check for reel_data.json
  const hasData = fs.existsSync(path.join(reelDir, 'reel_data.json'));
  if (!hasData) return false;

  // Check for video file
  const videoFile = findVideoFile(reelDir);
  return !!videoFile;
}

/**
 * Download a single reel using yt-dlp
 */
function downloadReel(reelUrl, outputDir, reelNum) {
  const outputTemplate = path.join(outputDir, 'reel.%(ext)s');

  // Build yt-dlp command
  const args = [
    'yt-dlp',
    `--cookies "${COOKIES_FILE}"`,
    '--write-info-json',
    '--write-description',
    '--write-comments',
    '--no-overwrites',
    '--no-playlist',
    `--output "${outputTemplate}"`,
    `"${reelUrl}"`,
  ];

  const command = args.join(' ');
  log(`   ⬇️  Downloading Reel ${padNumber(reelNum)}...`);

  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      timeout: 120000, // 2 minute timeout per reel
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: ROOT_DIR,
    });

    log(`   ✅ Reel ${padNumber(reelNum)} downloaded successfully`);
    return true;
  } catch (error) {
    logError(`   Failed to download Reel ${padNumber(reelNum)}`, error);
    // Log stderr for debugging
    if (error.stderr) {
      console.error(`   stderr: ${error.stderr.slice(0, 300)}`);
    }
    return false;
  }
}

/**
 * Parse the .info.json file generated by yt-dlp and extract relevant data
 */
function parseInfoJson(reelDir) {
  // Find the .info.json file
  const files = fs.readdirSync(reelDir);
  const infoFile = files.find(f => f.endsWith('.info.json'));

  if (!infoFile) {
    log('   ⚠️ No .info.json file found');
    return null;
  }

  const infoPath = path.join(reelDir, infoFile);
  const info = loadJSON(infoPath);

  if (!info) {
    log('   ⚠️ Failed to parse .info.json');
    return null;
  }

  // Extract top N comments
  let comments = [];
  if (info.comments && Array.isArray(info.comments)) {
    comments = info.comments.slice(0, MAX_COMMENTS).map(c => ({
      username: c.author || c.author_id || 'unknown',
      text: c.text || '',
      timestamp: c.timestamp ? unixToISO(c.timestamp) : null,
      likes: c.like_count || 0,
    }));
  }

  // Extract description from info.json or .description file
  let description = info.description || info.title || '';

  // Also check .description file
  const descFile = files.find(f => f.endsWith('.description'));
  if (descFile) {
    try {
      const descText = fs.readFileSync(path.join(reelDir, descFile), 'utf-8');
      if (descText && descText.length > description.length) {
        description = descText;
      }
    } catch { /* ignore */ }
  }

  return {
    description: description.trim(),
    hashtags: extractHashtags(description),
    posted_at: info.timestamp ? unixToISO(info.timestamp) : (info.upload_date || null),
    like_count: info.like_count || null,
    comment_count: info.comment_count || null,
    duration_seconds: info.duration || null,
    view_count: info.view_count || null,
    uploader: info.uploader || info.channel || info.uploader_id || null,
    uploader_id: info.uploader_id || info.channel_id || null,
    width: info.width || null,
    height: info.height || null,
    format: info.format || null,
    thumbnail: info.thumbnail || null,
    comments: comments,
    total_comments_available: info.comment_count || 0,
    comments_extracted: comments.length,
  };
}

/**
 * Find the video file in a reel directory
 */
function findVideoFile(reelDir) {
  const videoExtensions = ['.mp4', '.webm', '.mkv', '.avi', '.mov'];
  const files = fs.readdirSync(reelDir);

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (videoExtensions.includes(ext) && file.startsWith('reel')) {
      return file;
    }
  }
  return null;
}

/**
 * Clean up yt-dlp temporary files, keep only video and reel_data.json
 */
function cleanupReelDir(reelDir) {
  const files = fs.readdirSync(reelDir);
  const keepExtensions = ['.mp4', '.webm', '.mkv', '.avi', '.mov'];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    // Keep video files and reel_data.json
    if (file === 'reel_data.json') continue;
    if (keepExtensions.includes(ext) && file.startsWith('reel')) continue;

    // Delete .info.json, .description, etc.
    try {
      fs.unlinkSync(path.join(reelDir, file));
    } catch { /* ignore */ }
  }
}

/**
 * Load or initialize progress tracker
 */
function loadProgress() {
  const existing = loadJSON(PROGRESS_FILE);
  if (existing) {
    log(`📋 Resuming from previous progress: ${existing.completed.length} reels already done`);
    return existing;
  }
  return { completed: [], failed: [], last_updated: null };
}

function saveProgress(progress) {
  progress.last_updated = new Date().toISOString();
  saveJSON(PROGRESS_FILE, progress);
}

/**
 * Main execution
 */
async function main() {
  // Parse CLI arguments
  const cliArgs = parseCLIArgs();

  console.log('\n' + '='.repeat(60));
  console.log('  📥 Instagram Reels Downloader');
  console.log('='.repeat(60) + '\n');

  // Step 1: Load reel links from Phase 1
  const reelLinksData = loadJSON(REEL_LINKS_PATH);
  if (!reelLinksData || !reelLinksData.reels || reelLinksData.reels.length === 0) {
    logError('No reel links found! Run Phase 1 first: npm run collect-links');
    process.exit(1);
  }

  log(`📊 Total reels available: ${reelLinksData.reels.length} from @${reelLinksData.profile}`);

  // Step 2: Check cookies file
  if (!fs.existsSync(COOKIES_FILE)) {
    logError(`Cookies file not found at ${COOKIES_FILE}. Run Phase 1 first to generate cookies.`);
    process.exit(1);
  }
  log(`🍪 Using cookies from: ${COOKIES_FILE}`);

  // Step 3: Filter reels based on CLI args
  let reelsToProcess = reelLinksData.reels;

  if (cliArgs.mode === 'count') {
    reelsToProcess = reelLinksData.reels.slice(0, cliArgs.count);
    log(`🎯 Mode: --count ${cliArgs.count} → downloading first ${reelsToProcess.length} reels`);
  } else if (cliArgs.mode === 'num') {
    reelsToProcess = reelLinksData.reels.filter(r => cliArgs.nums.includes(r.reel_number));
    const found = reelsToProcess.map(r => r.reel_number);
    const notFound = cliArgs.nums.filter(n => !found.includes(n));
    log(`🎯 Mode: --num ${cliArgs.nums.join(' ')} → found ${reelsToProcess.length} matching reels`);
    if (notFound.length > 0) {
      log(`⚠️ Reel numbers not found in links: ${notFound.join(', ')}`);
    }
  } else {
    log(`🎯 Mode: ALL → downloading all ${reelsToProcess.length} reels`);
  }

  if (reelsToProcess.length === 0) {
    logError('No reels to download with the given arguments!');
    process.exit(1);
  }

  // Step 4: Load progress (for resume support)
  const progress = loadProgress();
  ensureDir(COMPLETE_DIR);

  // Step 5: Process each reel
  const totalReels = reelsToProcess.length;
  const allReelData = [];
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < reelsToProcess.length; i++) {
    const reel = reelsToProcess[i];
    const reelNum = reel.reel_number;
    const reelUrl = reel.url;
    const reelFolderName = `Reel ${padNumber(reelNum)}`;
    const reelDir = path.join(COMPLETE_DIR, reelFolderName);

    // Skip if already downloaded (check both progress file AND actual files)
    if (progress.completed.includes(reelNum) || isAlreadyDownloaded(reelNum)) {
      log(`⏭️  Skipping Reel ${padNumber(reelNum)} (already downloaded)`);
      
      // Still load existing data for All_reel.json
      const existingData = loadJSON(path.join(reelDir, 'reel_data.json'));
      if (existingData) {
        allReelData.push(existingData);
      }
      // Make sure progress tracker is in sync
      if (!progress.completed.includes(reelNum)) {
        progress.completed.push(reelNum);
      }
      successCount++;
      skippedCount++;
      continue;
    }

    console.log(`\n${'─'.repeat(50)}`);
    log(`📦 Processing Reel ${padNumber(reelNum)} [${i + 1}/${totalReels}]`);
    log(`   🔗 ${reelUrl}`);

    // Create reel folder
    ensureDir(reelDir);

    // Download the reel
    const downloaded = downloadReel(reelUrl, reelDir, reelNum);

    if (downloaded) {
      // Parse metadata from yt-dlp output
      const metadata = parseInfoJson(reelDir);
      const videoFile = findVideoFile(reelDir);

      // Build individual reel_data.json
      const reelData = {
        reel_number: reelNum,
        reel_label: `Reel ${padNumber(reelNum)}`,
        url: reelUrl,
        description: metadata?.description || '',
        hashtags: metadata?.hashtags || [],
        posted_at: metadata?.posted_at || null,
        like_count: metadata?.like_count || null,
        comment_count: metadata?.comment_count || null,
        duration_seconds: metadata?.duration_seconds || null,
        view_count: metadata?.view_count || null,
        uploader: metadata?.uploader || null,
        uploader_id: metadata?.uploader_id || null,
        resolution: metadata?.width && metadata?.height
          ? `${metadata.width}x${metadata.height}`
          : null,
        thumbnail: metadata?.thumbnail || null,
        comments: metadata?.comments || [],
        comments_extracted: metadata?.comments_extracted || 0,
        video_file: videoFile || null,
        downloaded_at: new Date().toISOString(),
      };

      // Save individual reel_data.json
      saveJSON(path.join(reelDir, 'reel_data.json'), reelData);

      // Clean up yt-dlp temp files (keep video + reel_data.json only)
      cleanupReelDir(reelDir);

      allReelData.push(reelData);
      progress.completed.push(reelNum);
      successCount++;
    } else {
      progress.failed.push(reelNum);
      failCount++;
    }

    // Save progress after each reel
    saveProgress(progress);

    // Random delay between downloads (be nice to Instagram)
    if (i < reelsToProcess.length - 1) {
      const waitMs = Math.floor(Math.random() * (DOWNLOAD_DELAY_MAX - DOWNLOAD_DELAY_MIN)) + DOWNLOAD_DELAY_MIN;
      log(`   ⏳ Waiting ${(waitMs / 1000).toFixed(1)}s before next download...`);
      await randomDelay(DOWNLOAD_DELAY_MIN, DOWNLOAD_DELAY_MAX);
    }
  }

  // Step 6: Build All_reel.json
  console.log(`\n${'─'.repeat(50)}`);
  log('📝 Building combined All_reel.json...');

  // Sort by reel number
  allReelData.sort((a, b) => a.reel_number - b.reel_number);

  const allReelOutput = {
    profile: reelLinksData.profile,
    profile_url: reelLinksData.profile_url,
    total_reels: reelLinksData.reels.length,
    reels_in_this_batch: totalReels,
    successfully_downloaded: successCount,
    skipped_already_done: skippedCount,
    failed_downloads: failCount,
    mode: cliArgs.mode === 'count' ? `first ${cliArgs.count}` 
        : cliArgs.mode === 'num' ? `specific: ${cliArgs.nums.join(', ')}` 
        : 'all',
    scraped_at: new Date().toISOString(),
    reels: allReelData,
  };

  saveJSON(path.join(COMPLETE_DIR, 'All_reel.json'), allReelOutput);

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('  📊 DOWNLOAD SUMMARY');
  console.log('='.repeat(60));
  log(`🎯 Mode: ${cliArgs.mode === 'count' ? `--count ${cliArgs.count}` : cliArgs.mode === 'num' ? `--num ${cliArgs.nums.join(' ')}` : 'ALL'}`);
  log(`✅ Successfully downloaded: ${successCount - skippedCount} new + ${skippedCount} skipped (already done)`);
  if (failCount > 0) {
    log(`❌ Failed: ${failCount} reels`);
    log(`   Failed reel numbers: ${progress.failed.join(', ')}`);
    log(`   Tip: Run again to retry failed downloads`);
  }
  log(`📁 Output: ${COMPLETE_DIR}`);
  log(`📄 Combined JSON: ${path.join(COMPLETE_DIR, 'All_reel.json')}`);
  console.log('='.repeat(60) + '\n');
}

// Run
main();
