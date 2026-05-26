/**
 * HTTP server for the visual template editor
 * - Serves editor/index.html 
 * - POST /save-template → saves template_config.json to project root
 * - POST /upload-logo → saves logo to assets/ folder
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const EDITOR_DIR = path.resolve(ROOT_DIR, 'editor');
const ASSETS_DIR = path.resolve(ROOT_DIR, 'assets');
const OUTPUT_DIR = path.resolve(ROOT_DIR, process.env.OUTPUT_DIR || 'output');
const COMPLETE_DIR = path.join(OUTPUT_DIR, 'Complete');
const PORT = 3456;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Ensure assets directory exists
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

/**
 * Auto-extract a preview frame from the first downloaded reel
 */
(function extractPreview() {
  try {
    const previewPath = path.join(EDITOR_DIR, 'preview_frame.jpg');
    if (!fs.existsSync(COMPLETE_DIR)) return;
    const reelDirs = fs.readdirSync(COMPLETE_DIR).filter(d => d.startsWith('Reel ')).sort();
    for (const dir of reelDirs) {
      const videoPath = path.join(COMPLETE_DIR, dir, 'reel.mp4');
      if (fs.existsSync(videoPath)) {
        execSync(`ffmpeg -y -ss 2 -i "${videoPath}" -frames:v 1 -q:v 2 "${previewPath}"`, { stdio:'pipe', timeout:15000 });
        console.log(`\n📸 Preview frame extracted from ${dir}`);
        break;
      }
    }
  } catch(e) { console.error('Preview extract failed:', e.message?.slice(0,80)); }
})();

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // GET /load-template — return saved template_config.json if it exists
  if (req.method === 'GET' && req.url === '/load-template') {
    const templatePath = path.join(ROOT_DIR, 'template_config.json');
    if (fs.existsSync(templatePath)) {
      try {
        const data = fs.readFileSync(templatePath, 'utf-8');
        JSON.parse(data); // validate JSON
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid template file' }));
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No saved template' }));
    }
    return;
  }

  // POST /test-render — render a single frame with FFmpeg to preview actual output
  if (req.method === 'POST' && req.url === '/test-render') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const config = JSON.parse(body);
        const previewPath = path.join(EDITOR_DIR, 'preview_frame.jpg');
        const testOutputPath = path.join(EDITOR_DIR, 'test_render.jpg');

        if (!fs.existsSync(previewPath)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No preview frame found' }));
          return;
        }

        // Build filter_complex from the config layers
        let filters = [];
        let currentStream = '[0:v]';
        let streamIdx = 0;

        for (const layer of config.layers || []) {
          if (!layer.visible) continue;

          if (layer.type === 'bar') {
            const barColor = (layer.color || '0x000000').replace('#', '0x');
            const out = `[s${streamIdx}]`;
            filters.push(`${currentStream}drawbox=x=${layer.x||0}:y=${layer.y||0}:w=${layer.w||'iw'}:h=${layer.h||100}:color=${barColor}@${layer.opacity||0.85}:t=fill${out}`);
            currentStream = out; streamIdx++;
          }
          else if (layer.type === 'text') {
            const text = (layer.content || 'Text').replace(/'/g, "'\\''").replace(/:/g, '\\:');
            const fontColor = (layer.color || '0xffffff').replace('#', '0x');
            const shadow = Math.min(layer.shadowPx || 0, 3);
            const out = `[s${streamIdx}]`;
            filters.push(`${currentStream}drawtext=text='${text}':fontfile='C\\:/Windows/Fonts/arial.ttf':fontsize=${layer.size||36}:fontcolor=${fontColor}:x=${layer.x||0}:y=${layer.y||0}:shadowcolor=black@0.8:shadowx=${shadow}:shadowy=${shadow}${out}`);
            currentStream = out; streamIdx++;
          }
          else if (layer.type === 'blur') {
            const bw = Math.max(4, (layer.w||200) % 2 === 0 ? (layer.w||200) : (layer.w||200)+1);
            const bh = Math.max(4, (layer.h||200) % 2 === 0 ? (layer.h||200) : (layer.h||200)+1);
            const maxR = Math.max(1, Math.floor(Math.min(bw, bh) / 4));
            const ba = Math.min(layer.blurAmount||15, maxR);
            const out = `[s${streamIdx}]`;
            filters.push(`${currentStream}split[bb${streamIdx}][bo${streamIdx}]`);
            filters.push(`[bo${streamIdx}]crop=${bw}:${bh}:${layer.x||0}:${layer.y||0},boxblur=${ba}:1:${ba}:1[bc${streamIdx}]`);
            filters.push(`[bb${streamIdx}][bc${streamIdx}]overlay=${layer.x||0}:${layer.y||0}${out}`);
            currentStream = out; streamIdx++;
          }
        }

        if (filters.length === 0) {
          // No filters, just copy the preview
          fs.copyFileSync(previewPath, testOutputPath);
        } else {
          const filterStr = filters.join(';');
          const cmd = `ffmpeg -y -i "${previewPath}" -filter_complex "${filterStr}" -map "${currentStream}" -frames:v 1 -q:v 2 "${testOutputPath}"`;
          execSync(cmd, { stdio: 'pipe', timeout: 15000 });
        }

        // Return the rendered frame
        const data = fs.readFileSync(testOutputPath);
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': data.length, 'Cache-Control': 'no-cache' });
        res.end(data);
      } catch(err) {
        console.error('Test render failed:', err.message?.slice(0, 200));
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message?.slice(0, 300) || 'Render failed' }));
      }
    });
    return;
  }

  // POST /save-template — save template config to project root
  if (req.method === 'POST' && req.url === '/save-template') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const config = JSON.parse(body);
        const savePath = path.join(ROOT_DIR, 'template_config.json');
        fs.writeFileSync(savePath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`\n💾 Template saved to: ${savePath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: savePath }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // POST /upload-logo — save logo image to assets/
  if (req.method === 'POST' && req.url.startsWith('/upload-logo')) {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        // Parse multipart form data (simple extraction)
        const boundary = req.headers['content-type'].split('boundary=')[1];
        const parts = parseMultipart(buffer, boundary);
        
        if (parts.length > 0) {
          const part = parts[0];
          const fileName = part.filename || 'logo.png';
          const savePath = path.join(ASSETS_DIR, fileName);
          fs.writeFileSync(savePath, part.data);
          console.log(`\n🏷️ Logo saved to: ${savePath}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, path: savePath, filename: fileName }));
        } else {
          throw new Error('No file found in upload');
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Static file serving
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(EDITOR_DIR, decodeURIComponent(filePath));

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

/**
 * Simple multipart form data parser
 */
function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuf = Buffer.from('--' + boundary);
  const bufStr = buffer.toString('binary');
  const sections = bufStr.split('--' + boundary);

  for (let i = 1; i < sections.length - 1; i++) {
    const section = sections[i];
    const headerEnd = section.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headers = section.substring(0, headerEnd);
    const body = section.substring(headerEnd + 4);

    // Remove trailing \r\n
    const cleanBody = body.endsWith('\r\n') ? body.slice(0, -2) : body;

    const filenameMatch = headers.match(/filename="([^"]+)"/);
    parts.push({
      filename: filenameMatch ? filenameMatch[1] : null,
      data: Buffer.from(cleanBody, 'binary'),
    });
  }
  return parts;
}

server.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('  🎨 Reel Template Editor');
  console.log('='.repeat(50));
  console.log(`\n  🌐 Open in browser: http://localhost:${PORT}\n`);
  console.log('  Instructions:');
  console.log('  1. Drag elements to position them');
  console.log('  2. Adjust fonts, colors, sizes in left panel');
  console.log('  3. Upload your brand logo (PNG)');
  console.log('  4. Click "Save Template" → auto-saves to project');
  console.log('  5. Press Ctrl+C to stop the editor\n');
  console.log('='.repeat(50) + '\n');

  // Auto-open browser
  exec(`start http://localhost:${PORT}`);
});
