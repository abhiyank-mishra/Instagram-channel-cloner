/**
 * Phase 3: Apply Video Template to Reels using FFmpeg
 * 
 * Usage:
 *   npm run edit                          → Edit ALL downloaded reels
 *   npm run edit -- count 5               → Edit first 5 reels
 *   npm run edit -- num 5                 → Edit only Reel 05
 *   npm run edit -- num 5 3 47            → Edit specific reels
 * 
 * Reads template_config.json (from the visual editor) and applies
 * overlays (bar, title, logo) to each reel video using FFmpeg.
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  randomDelay, saveJSON, loadJSON, log, logError,
  ensureDir, padNumber
} from './utils/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const OUTPUT_DIR = path.resolve(ROOT_DIR, process.env.OUTPUT_DIR || 'output');
const COMPLETE_DIR = path.join(OUTPUT_DIR, 'Complete');
const EDITED_DIR = path.join(OUTPUT_DIR, 'Edited');
const REEL_LINKS_PATH = path.join(OUTPUT_DIR, 'Reel links', 'reel_links.json');
const TEMPLATE_PATH = path.resolve(ROOT_DIR, 'template_config.json');
const LOGO_DIR = path.resolve(ROOT_DIR, 'assets');

/**
 * Parse CLI arguments (same as download script)
 */
function parseCLIArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) return { mode: 'all' };

  if (args[0].toLowerCase() === 'count' && args[1]) {
    const count = parseInt(args[1]);
    if (isNaN(count) || count <= 0) {
      logError('count requires a positive number.');
      process.exit(1);
    }
    return { mode: 'count', count };
  }

  if (args[0].toLowerCase() === 'num') {
    const nums = [];
    for (let i = 1; i < args.length; i++) {
      const n = parseInt(args[i]);
      if (!isNaN(n) && n > 0) nums.push(n);
    }
    if (nums.length === 0) {
      logError('num requires at least one reel number.');
      process.exit(1);
    }
    return { mode: 'num', nums };
  }

  const firstNum = parseInt(args[0]);
  if (!isNaN(firstNum) && firstNum > 0 && args.length === 1) {
    return { mode: 'count', count: firstNum };
  }

  const allNums = args.map(a => parseInt(a)).filter(n => !isNaN(n) && n > 0);
  if (allNums.length === args.length && allNums.length > 0) {
    return { mode: 'num', nums: allNums };
  }

  log('Usage:');
  log('  npm run edit                         → Edit ALL reels');
  log('  npm run edit -- count 5              → Edit first 5 reels');
  log('  npm run edit -- num 5 3 47           → Edit specific reels');
  process.exit(1);
}

/**
 * Calculate the day label for a reel being posted now.
 * Reads upload_log.json to determine:
 * - Day 01 if it's the first post ever
 * - Day 01.5 if it's the 2nd post on the same day
 * - Day 02 if it's the first post on a new day, etc.
 * 
 * @param {number} reelNum - Reel number being posted
 * @returns {{ dayNumber: string, dayRaw: number }}
 */
function calculateDayLabel(reelNum) {
  const logPath = path.join(OUTPUT_DIR, 'upload_log.json');
  let logData = { start_date: new Date().toISOString().slice(0, 10), posts: [] };

  if (fs.existsSync(logPath)) {
    try { logData = JSON.parse(fs.readFileSync(logPath, 'utf-8')); } catch(e) {}
  }

  const today = new Date().toISOString().slice(0, 10); // "2026-05-26"
  const startDate = logData.start_date || today;

  // Get all unique dates from existing posts
  const postedDates = [...new Set(logData.posts.map(p => p.date))].sort();

  // Add today if not already there (since we're about to post)
  if (!postedDates.includes(today)) {
    postedDates.push(today);
    postedDates.sort();
  }

  // Day number = index of today in the sorted unique dates + 1
  const dayIndex = postedDates.indexOf(today);
  const baseDayNum = dayIndex + 1;

  // Count how many posts are already on today
  const todayPosts = logData.posts.filter(p => p.date === today);
  const positionToday = todayPosts.length; // 0-indexed: this will be the Nth post

  // Calculate fractional day
  let dayRaw;
  if (positionToday === 0) {
    dayRaw = baseDayNum; // First post of the day → Day XX
  } else {
    // 2nd post → .5, 3rd → .67, 4th → .75, etc.
    dayRaw = baseDayNum + (positionToday / (positionToday + 1));
  }

  // Format: "01", "01.5", "02", "02.67"
  let dayNumber;
  if (dayRaw % 1 === 0) {
    dayNumber = padNumber(dayRaw);
  } else {
    const intPart = Math.floor(dayRaw);
    const fracPart = Math.round((dayRaw - intPart) * 100) / 100;
    dayNumber = padNumber(intPart) + fracPart.toString().slice(1); // e.g., "01" + ".5"
  }

  return { dayNumber, dayRaw };
}

/**
 * Extract dynamic text for a layer based on its dynamicSource
 */
function extractDynamicText(reelData, layer, editContext) {
  const source = layer.dynamicSource || 'auto';
  const desc = reelData.description || '';

  switch (source) {
    case 'auto': {
      let match = desc.match(/(?:Movies?\s*Name\s*(?:&\s*Review)?[:\-–]*\s*)([^\n(]+(?:\(\d{4}\))?)/i);
      if (match) return match[1].trim();
      match = desc.match(/^([A-Z][^.!\n]{2,50}(?:\s*\(\d{4}\))?)/);
      if (match) return match[1].trim();
      const firstLine = desc.split(/[\n\r]/)[0].trim();
      return firstLine.length <= 80 ? firstLine : firstLine.slice(0, 60) + '...';
    }
    case 'description_first_line': {
      const line = desc.split(/[\n\r]/)[0].trim();
      return line.length > 80 ? line.slice(0, 77) + '...' : line;
    }
    case 'reel_label':
      return reelData.reel_label || `Reel ${padNumber(reelData.reel_number)}`;
    case 'day_counter': {
      // Use pre-calculated day from editContext, or calculate now
      const dayInfo = (editContext && editContext.dayInfo) || calculateDayLabel(reelData.reel_number);
      const format = layer.dayFormat || 'Day {day}';
      return format.replace('{day}', dayInfo.dayNumber);
    }
    default:
      return layer.content || 'Untitled';
  }
}

/**
 * Escape text for FFmpeg drawtext filter
 */
function escapeFFmpegText(text) {
  return text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/;/g, '\\;');
}

/**
 * Map CSS font family to FFmpeg fontfile or system font name
 * Returns the best available font path or name
 */
function getFFmpegFont(fontFamily) {
  // Clean up font family string
  const font = fontFamily.replace(/['"]/g, '').split(',')[0].trim();

  // Map common Google Fonts to Windows system font paths
  const fontMap = {
    'Bebas Neue': 'Bebas Neue',
    'Poppins': 'Poppins',
    'Oswald': 'Oswald',
    'Montserrat': 'Montserrat',
    'Bangers': 'Bangers',
    'Permanent Marker': 'Permanent Marker',
    'Anton': 'Anton',
    'Righteous': 'Righteous',
    'Roboto Condensed': 'Roboto Condensed',
    'Inter': 'Inter',
    'Arial': 'Arial',
  };

  // Check if there's a custom font file in assets
  const customFontDir = path.join(ROOT_DIR, 'assets', 'fonts');
  if (fs.existsSync(customFontDir)) {
    const fontFiles = fs.readdirSync(customFontDir);
    const match = fontFiles.find(f =>
      f.toLowerCase().includes(font.toLowerCase().replace(/\s+/g, '')) &&
      (f.endsWith('.ttf') || f.endsWith('.otf'))
    );
    if (match) {
      return path.join(customFontDir, match).replace(/\\/g, '/').replace(/:/g, '\\:');
    }
  }

  // Fallback: Use Windows fonts directory
  const winFonts = 'C:/Windows/Fonts';
  const fallbacks = {
    'Bebas Neue': 'BebasNeue-Regular.ttf',
    'Poppins': 'Poppins-Bold.ttf',
    'Oswald': 'Oswald-Bold.ttf',
    'Montserrat': 'Montserrat-Bold.ttf',
    'Anton': 'Anton-Regular.ttf',
    'Inter': 'Inter-Bold.ttf',
    'Arial': 'arial.ttf',
  };

  const fallbackFile = fallbacks[font];
  if (fallbackFile) {
    const fullPath = path.join(winFonts, fallbackFile);
    if (fs.existsSync(fullPath)) {
      return fullPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    }
  }

  // Ultimate fallback: Arial
  return 'C\\:/Windows/Fonts/arial.ttf';
}

/**
 * Build FFmpeg filter complex string from layer-based template config
 */
function buildFilterComplex(template, reelData, logoPaths) {
  const filters = [];
  let currentStream = '[0:v]';
  let streamIdx = 0;
  let logoInputIdx = 1; // logo inputs start at index 1

  const layersList = template.layers || [];

  for (const layer of layersList) {
    if (!layer.visible) continue;

    if (layer.type === 'bar') {
      // Convert hex color: remove # for FFmpeg
      const barColor = (layer.color || '0x000000').replace('#', '0x');
      const outStream = `[s${streamIdx}]`;
      filters.push(
        `${currentStream}drawbox=x=${layer.x||0}:y=${layer.y||0}:w=${layer.w||'iw'}:h=${layer.h||100}:color=${barColor}@${layer.opacity||0.85}:t=fill${outStream}`
      );
      currentStream = outStream;
      streamIdx++;
    }
    else if (layer.type === 'text') {
      const text = layer.isDynamic ? extractDynamicText(reelData, layer) : (layer.content || '');
      const escaped = escapeFFmpegText(text);
      const fontFile = getFFmpegFont(layer.font || 'Arial');
      const shadow = layer.shadowPx || 0;
      const fontColor = (layer.color || '0xffffff').replace('#', '0x');
      const outStream = `[s${streamIdx}]`;
      filters.push(
        `${currentStream}drawtext=text='${escaped}':fontfile='${fontFile}':fontsize=${layer.size||36}:fontcolor=${fontColor}:x=${layer.x||0}:y=${layer.y||0}:shadowcolor=black@0.8:shadowx=${Math.min(shadow,3)}:shadowy=${Math.min(shadow,3)}${outStream}`
      );
      currentStream = outStream;
      streamIdx++;
    }
    else if (layer.type === 'blur') {
      // FFmpeg boxblur on a crop+overlay for region blur
      // Force even dimensions (required for yuv420p chroma subsampling)
      const bx = layer.x||0, by = layer.y||0;
      const bw = Math.max(4, (layer.w||200) % 2 === 0 ? (layer.w||200) : (layer.w||200) + 1);
      const bh = Math.max(4, (layer.h||200) % 2 === 0 ? (layer.h||200) : (layer.h||200) + 1);
      // Chroma is half-resolution in yuv420p, so max radius = min(w,h)/4
      const maxRadius = Math.max(1, Math.floor(Math.min(bw, bh) / 4));
      const ba = Math.min(layer.blurAmount||15, maxRadius);
      const outStream = `[s${streamIdx}]`;
      filters.push(
        `${currentStream}split[blur_base${streamIdx}][blur_over${streamIdx}]`
      );
      filters.push(
        `[blur_over${streamIdx}]crop=${bw}:${bh}:${bx}:${by},boxblur=${ba}:1:${ba}:1[blur_crop${streamIdx}]`
      );
      filters.push(
        `[blur_base${streamIdx}][blur_crop${streamIdx}]overlay=${bx}:${by}${outStream}`
      );
      currentStream = outStream;
      streamIdx++;
    }
    else if (layer.type === 'logo' && layer.file) {
      const logoPath = logoPaths[layer.file];
      if (logoPath && fs.existsSync(logoPath)) {
        const outStream = `[s${streamIdx}]`;
        filters.push(
          `[${logoInputIdx}:v]scale=${layer.w||80}:${layer.h||80}[logo_s${streamIdx}]`
        );
        filters.push(
          `${currentStream}[logo_s${streamIdx}]overlay=x=${layer.x||0}:y=${layer.y||0}:format=auto${outStream}`
        );
        currentStream = outStream;
        streamIdx++;
        logoInputIdx++;
      }
    }
  }

  return { filterComplex: filters.join(';'), outputStream: currentStream };
}

/**
 * Edit a single reel video with FFmpeg
 */
function editReel(reelNum, reelData, template, logoPaths) {
  const reelFolderName = `Reel ${padNumber(reelNum)}`;
  const reelDir = path.join(COMPLETE_DIR, reelFolderName);
  const editedReelDir = path.join(EDITED_DIR, reelFolderName);

  const videoFile = reelData.video_file || 'reel.mp4';
  const inputPath = path.join(reelDir, videoFile);

  if (!fs.existsSync(inputPath)) {
    logError(`Video not found: ${inputPath}`);
    return false;
  }

  ensureDir(editedReelDir);
  const outputPath = path.join(editedReelDir, 'edited_reel.mp4');

  if (fs.existsSync(outputPath)) {
    const outStat = fs.statSync(outputPath);
    if (outStat.size > 1000) {
      log(`   ⏭️  Already edited, skipping`);
      return 'skipped';
    }
  }

  // Log dynamic texts
  const textLayers = (template.layers || []).filter(l => l.type === 'text' && l.visible);
  textLayers.forEach(tl => {
    const text = tl.isDynamic ? extractDynamicText(reelData, tl) : tl.content;
    log(`   📝 ${tl.name}: "${text}"`);
  });

  // Build filter complex
  const { filterComplex, outputStream } = buildFilterComplex(template, reelData, logoPaths);

  // Build FFmpeg inputs: video + any logo files
  const inputArgs = [`-i "${inputPath}"`];
  const logoLayers = (template.layers || []).filter(l => l.type === 'logo' && l.visible && l.file);
  for (const ll of logoLayers) {
    const lp = logoPaths[ll.file];
    if (lp && fs.existsSync(lp)) {
      inputArgs.push(`-i "${lp}"`);
    }
  }

  const ffmpegCmd = [
    'ffmpeg', '-y',
    ...inputArgs,
    `-filter_complex "${filterComplex}"`,
    `-map "${outputStream}"`,
    '-map 0:a?',
    '-c:v libx264 -preset fast -crf 23',
    '-c:a copy -movflags +faststart',
    `"${outputPath}"`,
  ].join(' ');

  try {
    log(`   🎬 Rendering...`);
    log(`   📋 CMD: ${ffmpegCmd.slice(0, 300)}...`);
    execSync(ffmpegCmd, { encoding:'utf-8', timeout:300000, stdio:['pipe','pipe','pipe'], cwd:ROOT_DIR });
    log(`   ✅ Edited → ${path.basename(editedReelDir)}`);

    const titleLayer = textLayers.find(t => t.isDynamic);
    const titleUsed = titleLayer ? (titleLayer.isDynamic ? extractDynamicText(reelData, titleLayer) : titleLayer.content) : '';
    saveJSON(path.join(editedReelDir, 'reel_data.json'), {
      ...reelData, edited:true, title_used:titleUsed, edited_video:'edited_reel.mp4', edited_at:new Date().toISOString(),
    });
    return true;
  } catch (error) {
    logError(`Failed to edit Reel ${padNumber(reelNum)}`, error);
    if (error.stderr) {
      error.stderr.split('\n').filter(l => l.includes('Error')||l.includes('error')).forEach(l => console.error(`   ${l.trim()}`));
    }
    return false;
  }
}

/**
 * Main
 */
async function main() {
  const cliArgs = parseCLIArgs();

  console.log('\n' + '='.repeat(60));
  console.log('  🎬 Reel Video Editor (FFmpeg)');
  console.log('='.repeat(60) + '\n');

  // Load template
  if (!fs.existsSync(TEMPLATE_PATH)) {
    logError(`Template not found at ${TEMPLATE_PATH}`);
    log('Run the visual editor first: npm run editor');
    log('Then save template_config.json to the project root.');
    process.exit(1);
  }

  const template = loadJSON(TEMPLATE_PATH);
  const layerCount = template.layers ? template.layers.length : 0;
  log(`📐 Template loaded: ${layerCount} layers`);

  // Find all logo files
  const logoPaths = {};
  const logoLayers = (template.layers || []).filter(l => l.type === 'logo' && l.file);
  for (const ll of logoLayers) {
    let lp = path.join(LOGO_DIR, ll.file);
    if (!fs.existsSync(lp)) lp = path.join(ROOT_DIR, ll.file);
    if (fs.existsSync(lp)) {
      logoPaths[ll.file] = lp;
      log(`🏷️ Logo: ${ll.file} → ${lp}`);
    } else {
      log(`⚠️ Logo not found: ${ll.file}`);
    }
  }

  // Load reel links data
  const reelLinksData = loadJSON(REEL_LINKS_PATH);
  if (!reelLinksData) {
    logError('No reel links found! Run Phase 1 first.');
    process.exit(1);
  }

  // Determine which reels to edit
  let reelsToEdit = reelLinksData.reels;
  if (cliArgs.mode === 'count') {
    reelsToEdit = reelLinksData.reels.slice(0, cliArgs.count);
    log(`🎯 Mode: count ${cliArgs.count} → editing first ${reelsToEdit.length} reels`);
  } else if (cliArgs.mode === 'num') {
    reelsToEdit = reelLinksData.reels.filter(r => cliArgs.nums.includes(r.reel_number));
    log(`🎯 Mode: num ${cliArgs.nums.join(' ')} → editing ${reelsToEdit.length} reels`);
  } else {
    log(`🎯 Mode: ALL → editing all ${reelsToEdit.length} reels`);
  }

  // Filter to only downloaded reels
  const downloadedReels = reelsToEdit.filter(r => {
    const dir = path.join(COMPLETE_DIR, `Reel ${padNumber(r.reel_number)}`);
    return fs.existsSync(dir) && fs.existsSync(path.join(dir, 'reel_data.json'));
  });

  if (downloadedReels.length === 0) {
    logError('No downloaded reels found! Run download first.');
    process.exit(1);
  }

  log(`📦 ${downloadedReels.length} downloaded reels ready to edit\n`);
  ensureDir(EDITED_DIR);

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (let i = 0; i < downloadedReels.length; i++) {
    const reel = downloadedReels[i];
    const reelDir = path.join(COMPLETE_DIR, `Reel ${padNumber(reel.reel_number)}`);
    const reelData = loadJSON(path.join(reelDir, 'reel_data.json'));

    if (!reelData) {
      logError(`No reel_data.json for Reel ${padNumber(reel.reel_number)}`);
      failCount++;
      continue;
    }

    console.log(`${'─'.repeat(50)}`);
    log(`🎬 Editing Reel ${padNumber(reel.reel_number)} [${i + 1}/${downloadedReels.length}]`);

    const result = editReel(reel.reel_number, reelData, template, logoPaths);

    if (result === 'skipped') {
      skipCount++;
    } else if (result === true) {
      successCount++;
    } else {
      failCount++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  📊 EDIT SUMMARY');
  console.log('='.repeat(60));
  log(`✅ Edited: ${successCount} reels`);
  if (skipCount > 0) log(`⏭️  Skipped: ${skipCount} (already edited)`);
  if (failCount > 0) log(`❌ Failed: ${failCount} reels`);
  log(`📁 Output: ${EDITED_DIR}`);
  console.log('='.repeat(60) + '\n');
}

main();
