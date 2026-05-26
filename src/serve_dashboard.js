/**
 * Upload Manager Dashboard Server
 * Serves the dashboard GUI and provides API endpoints for:
 * - Listing reels with status
 * - Triggering FFmpeg edits
 * - Generating AI tags
 * - Marking reels as uploaded
 * - Serving video previews
 * - Day counter management
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, execSync } from 'child_process';
import { log, logError, loadJSON, saveJSON, padNumber, ensureDir, extractHashtags } from './utils/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.resolve(ROOT_DIR, process.env.OUTPUT_DIR || 'output');
const COMPLETE_DIR = path.join(OUTPUT_DIR, 'Complete');
const EDITED_DIR = path.join(OUTPUT_DIR, 'Edited');
const UPLOADED_DIR = path.join(OUTPUT_DIR, 'Uploaded');
const DASHBOARD_DIR = path.resolve(ROOT_DIR, 'dashboard');
const UPLOAD_LOG_PATH = path.join(OUTPUT_DIR, 'upload_log.json');
const TEMPLATE_PATH = path.resolve(ROOT_DIR, 'template_config.json');
const REEL_LINKS_PATH = path.join(OUTPUT_DIR, 'Reel links', 'reel_links.json');
const PORT = 3457;

// Ensure Uploaded directory exists
ensureDir(UPLOADED_DIR);

/**
 * Validate an Instagram reel URL
 * Accepts formats like:
 *   https://www.instagram.com/reel/ABC123/
 *   https://instagram.com/p/ABC123/
 *   https://www.instagram.com/reels/ABC123/
 */
function isValidInstagramUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return /^https?:\/\/(www\.)?instagram\.com\/(reel|reels|p)\/[A-Za-z0-9_-]+/i.test(trimmed);
}

const COOKIES_FILE = path.resolve(ROOT_DIR, process.env.COOKIES_FILE || 'cookies.txt');

/**
 * Fetch metadata for an uploaded reel using yt-dlp --dump-json
 */
function getUploadedMetadata(url) {
  try {
    const cmd = `yt-dlp --cookies "${COOKIES_FILE}" --dump-json "${url}"`;
    const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
    const data = JSON.parse(stdout);
    return {
      uploader: data.uploader || null,
      uploader_id: data.uploader_id || null,
      description: data.description || null,
      like_count: data.like_count || null,
      comment_count: data.comment_count || null,
      duration_seconds: data.duration || null
    };
  } catch (err) {
    logError(`Failed to fetch metadata from uploaded link: ${url}`);
    return null;
  }
}

const MIME = {
  '.html':'text/html', '.css':'text/css', '.js':'application/javascript',
  '.json':'application/json', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.png':'image/png', '.mp4':'video/mp4', '.webm':'video/webm',
  '.svg':'image/svg+xml', '.ico':'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function jsonResp(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
  res.end(JSON.stringify(data));
}

function getUploadLog() {
  if (fs.existsSync(UPLOAD_LOG_PATH)) {
    try { return JSON.parse(fs.readFileSync(UPLOAD_LOG_PATH, 'utf-8')); } catch(e) {}
  }
  return { start_date: new Date().toISOString().slice(0,10), posts: [] };
}

/**
 * Calculate day info for the next post
 */
function calculateNextDay() {
  const logData = getUploadLog();
  const today = new Date().toISOString().slice(0, 10);
  const postedDates = [...new Set(logData.posts.map(p => p.date))].sort();
  if (!postedDates.includes(today)) { postedDates.push(today); postedDates.sort(); }
  const dayIndex = postedDates.indexOf(today);
  const baseDayNum = dayIndex + 1;
  const todayPosts = logData.posts.filter(p => p.date === today);
  const positionToday = todayPosts.length;
  let dayRaw = positionToday === 0 ? baseDayNum : baseDayNum + (positionToday / (positionToday + 1));
  let dayNumber;
  if (dayRaw % 1 === 0) dayNumber = padNumber(dayRaw);
  else {
    const intP = Math.floor(dayRaw);
    const fracP = Math.round((dayRaw - intP) * 100) / 100;
    dayNumber = padNumber(intP) + fracP.toString().slice(1);
  }
  return { dayNumber, dayRaw, baseDayNum, todayPostCount: todayPosts.length, totalPosts: logData.posts.length };
}

/**
 * Get reel status info for all downloaded reels
 */
function getAllReels() {
  const reelLinks = loadJSON(REEL_LINKS_PATH);
  if (!reelLinks || !reelLinks.reels) return [];

  return reelLinks.reels.map(r => {
    const num = r.reel_number;
    const label = `Reel ${padNumber(num)}`;
    const completeDir = path.join(COMPLETE_DIR, label);
    const editedDir = path.join(EDITED_DIR, label);
    const uploadedDir = path.join(UPLOADED_DIR, label);
    const dataPath = path.join(completeDir, 'reel_data.json');

    let data = {};
    if (fs.existsSync(dataPath)) {
      try { data = JSON.parse(fs.readFileSync(dataPath, 'utf-8')); } catch(e) {}
    }

    const downloaded = fs.existsSync(path.join(completeDir, 'reel.mp4'));
    // Check edited in both Edited/ and Uploaded/ (after upload it moves to Uploaded/)
    const editedInEditDir = fs.existsSync(path.join(editedDir, 'edited_reel.mp4'));
    const editedInUploadDir = fs.existsSync(path.join(uploadedDir, 'edited_reel.mp4'));
    const edited = editedInEditDir || editedInUploadDir;
    const uploadLog = getUploadLog();
    const uploadEntry = uploadLog.posts.find(p => p.reel_number === num);

    // Extract movie name from description
    let movieName = data.ai_movie_name || '';
    if (!movieName && data.description) {
      const m = data.description.match(/(?:Movies?\s*Name\s*(?:&\s*Review)?[:\-–]*\s*)([^\n(]+(?:\(\d{4}\))?)/i);
      if (m) movieName = m[1].trim();
    }

    return {
      reel_number: num,
      label,
      url: r.url,
      movie_name: movieName,
      downloaded,
      edited,
      uploaded: !!uploadEntry,
      upload_date: uploadEntry?.date || null,
      upload_link: uploadEntry?.upload_link || null,
      day_label: uploadEntry?.day_label || null,
      has_tags: !!(data.ai_caption || data.ai_hashtags?.length),
      ai_caption: data.ai_caption || null,
      ai_hashtags: data.ai_hashtags || [],
      description: (data.description || '').slice(0, 200),
      duration: data.duration_seconds || null,
      likes: data.like_count || null,
    };
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ── API Routes ──
  if (pathname === '/api/reels' && req.method === 'GET') {
    const reels = getAllReels();
    const downloaded = reels.filter(r => r.downloaded).length;
    const edited = reels.filter(r => r.edited).length;
    const uploaded = reels.filter(r => r.uploaded).length;
    return jsonResp(res, { reels: reels.filter(r => r.downloaded), stats: { total: reels.length, downloaded, edited, uploaded } });
  }

  if (pathname === '/api/day-info' && req.method === 'GET') {
    return jsonResp(res, calculateNextDay());
  }

  // Edit a reel (async — doesn't block the server)
  if (pathname.startsWith('/api/edit/') && req.method === 'POST') {
    const num = parseInt(pathname.split('/').pop());
    if (!num || isNaN(num)) return jsonResp(res, { error: 'Invalid reel number' }, 400);

    // Check if reel exists
    const reelDir = path.join(COMPLETE_DIR, `Reel ${padNumber(num)}`);
    if (!fs.existsSync(reelDir)) return jsonResp(res, { error: `Reel ${padNumber(num)} not found in Complete/` }, 404);

    // Check if template exists
    if (!fs.existsSync(TEMPLATE_PATH)) return jsonResp(res, { error: 'template_config.json not found! Use the editor first.' }, 400);

    log(`🎬 Edit request for Reel ${padNumber(num)}...`);

    try {
      const result = await new Promise((resolve, reject) => {
        exec(`node src/03_edit_reels.js num ${num}`, {
          cwd: ROOT_DIR,
          encoding: 'utf-8',
          timeout: 300000, // 5 min timeout
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        }, (error, stdout, stderr) => {
          if (error) {
            log(`❌ Edit Reel ${padNumber(num)} failed`);
            if (stderr) console.error(stderr.slice(-500));
            reject({ stdout, stderr: stderr || error.message, code: error.code });
          } else {
            resolve({ stdout, stderr });
          }
        });
      });

      // Verify the edited file was actually created
      const editedPath = path.join(EDITED_DIR, `Reel ${padNumber(num)}`, 'edited_reel.mp4');
      const editedExists = fs.existsSync(editedPath);
      const editedSize = editedExists ? fs.statSync(editedPath).size : 0;

      if (editedExists && editedSize > 1000) {
        log(`✅ Edit Reel ${padNumber(num)} complete! (${(editedSize/1024/1024).toFixed(1)}MB)`);
        return jsonResp(res, { success: true, output: result.stdout, fileSize: editedSize });
      } else {
        log(`⚠️ Edit Reel ${padNumber(num)} — file missing or too small`);
        return jsonResp(res, { success: false, error: `Edit process ran but output file is ${editedExists ? 'too small ('+editedSize+'b)' : 'missing'}.\nStdout: ${result.stdout?.slice(-300)}\nStderr: ${result.stderr?.slice(-300)}` }, 500);
      }
    } catch(err) {
      const errMsg = err.stderr || err.message || 'Unknown error';
      logError(`Edit Reel ${padNumber(num)}: ${errMsg.slice(0, 200)}`);
      return jsonResp(res, { success: false, error: errMsg.slice(0, 500) }, 500);
    }
  }

  // Delete edited reel (for re-edit)
  if (pathname.startsWith('/api/delete-edit/') && req.method === 'DELETE') {
    const num = parseInt(pathname.split('/').pop());
    const editedPath = path.join(EDITED_DIR, `Reel ${padNumber(num)}`, 'edited_reel.mp4');
    if (fs.existsSync(editedPath)) {
      fs.unlinkSync(editedPath);
      return jsonResp(res, { success: true });
    }
    return jsonResp(res, { error: 'Edited file not found' }, 404);
  }

  // Generate AI tags
  if (pathname.startsWith('/api/generate-tags/') && req.method === 'POST') {
    const num = parseInt(pathname.split('/').pop());
    if (!num) return jsonResp(res, { error: 'Invalid reel number' }, 400);

    try {
      const { generateTagsForReel } = await import('./04_generate_tags.js');
      const result = await generateTagsForReel(num);
      return jsonResp(res, { success: true, ...result });
    } catch(err) {
      return jsonResp(res, { success: false, error: err.message }, 500);
    }
  }

  // Validate Instagram link
  if (pathname === '/api/validate-link' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const { url } = body;
    if (!url) return jsonResp(res, { valid: false, error: 'URL is required' });
    if (!isValidInstagramUrl(url)) {
      return jsonResp(res, { valid: false, error: 'Invalid Instagram URL. Use format: https://www.instagram.com/reel/...' });
    }
    return jsonResp(res, { valid: true });
  }

  // Mark as uploaded — link is COMPULSORY
  if (pathname === '/api/mark-uploaded' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const { reel_number, upload_link } = body;
    if (!reel_number) return jsonResp(res, { error: 'reel_number required' }, 400);

    // ── COMPULSORY: Validate Instagram link ──
    if (!upload_link || !upload_link.trim()) {
      return jsonResp(res, { error: 'Instagram reel link is required! Post the reel first, then paste the link here.' }, 400);
    }
    if (!isValidInstagramUrl(upload_link)) {
      return jsonResp(res, { error: 'Invalid Instagram URL! Use format: https://www.instagram.com/reel/...' }, 400);
    }

    const logData = getUploadLog();
    const dayInfo = calculateNextDay();
    const today = new Date().toISOString().slice(0, 10);

    // Check if already uploaded
    if (logData.posts.find(p => p.reel_number === reel_number)) {
      return jsonResp(res, { error: 'Already uploaded' }, 400);
    }

    // Load reel metadata for storing in upload log
    const dataPath = path.join(COMPLETE_DIR, `Reel ${padNumber(reel_number)}`, 'reel_data.json');
    let reelData = {};
    if (fs.existsSync(dataPath)) {
      try { reelData = JSON.parse(fs.readFileSync(dataPath, 'utf-8')); } catch(e) {}
    }

    // ── Get metadata from the uploaded reel link using yt-dlp ──
    log(`🔍 Fetching metadata from uploaded reel: ${upload_link.trim()}...`);
    const uploadedMeta = getUploadedMetadata(upload_link.trim());

    const description = uploadedMeta?.description || reelData.description || null;
    const uploader = uploadedMeta?.uploader || null;
    const uploader_id = uploadedMeta?.uploader_id || null;
    const like_count = uploadedMeta && uploadedMeta.like_count !== undefined ? uploadedMeta.like_count : (reelData.like_count || null);
    const comment_count = uploadedMeta && uploadedMeta.comment_count !== undefined ? uploadedMeta.comment_count : (reelData.comment_count || null);
    const duration_seconds = uploadedMeta?.duration_seconds || reelData.duration_seconds || null;

    // Extract hashtags from description
    const ai_hashtags = description ? extractHashtags(description) : (reelData.ai_hashtags || []);
    
    // For caption, extract text before the hashtags
    let ai_caption = reelData.ai_caption || null;
    if (description) {
      const idx = description.indexOf('#');
      if (idx !== -1) {
        ai_caption = description.substring(0, idx).trim();
      } else {
        ai_caption = description;
      }
    }

    // ── Store comprehensive data in upload_log ──
    logData.posts.push({
      reel_number,
      date: today,
      day_label: `Day ${dayInfo.dayNumber}`,
      upload_link: upload_link.trim(),
      uploaded_at: new Date().toISOString(),
      movie_name: reelData.ai_movie_name || null,
      description,
      ai_caption,
      ai_hashtags,
      original_url: reelData.url || null,
      duration_seconds,
      like_count,
      uploader,
      uploader_id,
    });

    saveJSON(UPLOAD_LOG_PATH, logData);

    // Also update reel_data.json
    if (fs.existsSync(dataPath)) {
      const rd = loadJSON(dataPath);
      rd.uploaded = true;
      rd.upload_date = today;
      rd.upload_link = upload_link.trim();
      rd.day_label = `Day ${dayInfo.dayNumber}`;
      
      // Update with uploaded channel's metadata
      if (uploader) rd.uploader = uploader;
      if (uploader_id) rd.uploader_id = uploader_id;
      if (description) rd.description = description;
      if (like_count !== null) rd.like_count = like_count;
      if (comment_count !== null) rd.comment_count = comment_count;
      if (duration_seconds !== null) rd.duration_seconds = duration_seconds;
      if (ai_caption) rd.ai_caption = ai_caption;
      if (ai_hashtags.length > 0) rd.ai_hashtags = ai_hashtags;

      saveJSON(dataPath, rd);
    }

    // ── Move edited reel to Uploaded folder ──
    const editedSrc = path.join(EDITED_DIR, `Reel ${padNumber(reel_number)}`, 'edited_reel.mp4');
    const uploadedDestDir = path.join(UPLOADED_DIR, `Reel ${padNumber(reel_number)}`);
    if (fs.existsSync(editedSrc)) {
      ensureDir(uploadedDestDir);
      const uploadedDest = path.join(uploadedDestDir, 'edited_reel.mp4');
      try {
        fs.copyFileSync(editedSrc, uploadedDest);
        fs.unlinkSync(editedSrc); // Remove from Edited/ after copy
        log(`📁 Moved edited reel to: ${uploadedDestDir}`);
      } catch(moveErr) {
        log(`⚠️ Could not move edited file: ${moveErr.message}`);
        // Not fatal — upload is still marked
      }
    }

    log(`📤 Marked Reel ${padNumber(reel_number)} as uploaded → Day ${dayInfo.dayNumber} → ${upload_link.trim()}`);
    return jsonResp(res, { success: true, day_label: `Day ${dayInfo.dayNumber}` });
  }

  // Serve video preview — checks Edited/ first, then Uploaded/ for already-uploaded reels
  if (pathname.startsWith('/api/preview/') && req.method === 'GET') {
    try {
      const parts = pathname.split('/');
      const num = parseInt(parts[3]);
      const type = parts[4] || 'edited'; // 'edited' or 'original'
      let videoPath;
      if (type === 'original') {
        videoPath = path.join(COMPLETE_DIR, `Reel ${padNumber(num)}`, 'reel.mp4');
      } else {
        // Check Edited/ first, then Uploaded/
        const editedPath = path.join(EDITED_DIR, `Reel ${padNumber(num)}`, 'edited_reel.mp4');
        const uploadedPath = path.join(UPLOADED_DIR, `Reel ${padNumber(num)}`, 'edited_reel.mp4');
        videoPath = fs.existsSync(editedPath) ? editedPath : uploadedPath;
      }

      if (!fs.existsSync(videoPath)) {
        res.writeHead(404);
        return res.end('Video not found');
      }

      const stat = fs.statSync(videoPath);
      if (stat.size === 0) {
        res.writeHead(404);
        return res.end('Video file is empty');
      }

      const range = req.headers.range;
      if (range) {
        const rangeParts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(rangeParts[0]) || 0;
        const end = rangeParts[1] ? parseInt(rangeParts[1]) : stat.size - 1;
        const clampedStart = Math.max(0, Math.min(start, stat.size - 1));
        const clampedEnd = Math.max(clampedStart, Math.min(end, stat.size - 1));
        const chunkSize = clampedEnd - clampedStart + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${clampedStart}-${clampedEnd}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'video/mp4',
        });
        fs.createReadStream(videoPath, { start: clampedStart, end: clampedEnd }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(videoPath).pipe(res);
      }
    } catch(err) {
      console.error('Video preview error:', err.message);
      if (!res.headersSent) { res.writeHead(500); res.end('Server error'); }
    }
    return;
  }

  // Get reel detail
  if (pathname.startsWith('/api/reel/') && req.method === 'GET') {
    const num = parseInt(pathname.split('/').pop());
    const dataPath = path.join(COMPLETE_DIR, `Reel ${padNumber(num)}`, 'reel_data.json');
    if (!fs.existsSync(dataPath)) return jsonResp(res, { error: 'Not found' }, 404);
    const data = loadJSON(dataPath);
    const edited = fs.existsSync(path.join(EDITED_DIR, `Reel ${padNumber(num)}`, 'edited_reel.mp4'));
    return jsonResp(res, { ...data, edited });
  }

  // ── Static files ──
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(DASHBOARD_DIR, decodeURIComponent(filePath));
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err.message);
});

server.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('  📊 Upload Manager Dashboard');
  console.log('='.repeat(50));
  console.log(`\n  🌐 http://localhost:${PORT}\n`);
  console.log('='.repeat(50) + '\n');
  exec(`start http://localhost:${PORT}`);
});
