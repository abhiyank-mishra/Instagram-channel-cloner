import fs from 'fs';
import path from 'path';

/**
 * Random delay between min and max milliseconds (human-like)
 */
export function randomDelay(min = 1000, max = 3000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create directory recursively if it doesn't exist
 */
export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    log(`📁 Created directory: ${dirPath}`);
  }
}

/**
 * Save data as pretty-printed JSON
 */
export function saveJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  log(`💾 Saved: ${filePath}`);
}

/**
 * Load JSON from file, returns null if not found
 */
export function loadJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Timestamped console log
 */
export function log(message) {
  const now = new Date().toLocaleTimeString('en-IN', { hour12: false });
  console.log(`[${now}] ${message}`);
}

/**
 * Error log with timestamp
 */
export function logError(message, error) {
  const now = new Date().toLocaleTimeString('en-IN', { hour12: false });
  console.error(`[${now}] ❌ ${message}`, error?.message || '');
}

/**
 * Parse hashtags from a text/description
 */
export function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#[\w\u0900-\u097F]+/g); // supports Hindi hashtags too
  return matches || [];
}

/**
 * Convert Unix timestamp to ISO string
 */
export function unixToISO(timestamp) {
  if (!timestamp) return null;
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Pad number with leading zeros (e.g., 1 → "01", 10 → "10")
 */
export function padNumber(num, length = 2) {
  return String(num).padStart(length, '0');
}

/**
 * Wait for user to press Enter in the terminal
 */
export async function waitForInput(promptMessage = 'Press Enter to continue...') {
  const readline = await import('readline');
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(`\n🔔 ${promptMessage}\n`, () => {
      rl.close();
      resolve();
    });
  });
}
