/**
 * Phase 4: AI Tag & Description Generator
 * 
 * Multi-provider fallback chain:
 *   1. NVIDIA (free models) → 2. Google Gemini → 3. OpenRouter (free models)
 * Only 1 API key required. Automatically uses the first available provider.
 * 
 * Usage:
 *   node src/04_generate_tags.js <reelNumber>
 *   Or imported by the dashboard server.
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { log, logError, loadJSON, saveJSON, padNumber } from './utils/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.resolve(ROOT_DIR, process.env.OUTPUT_DIR || 'output');
const COMPLETE_DIR = path.join(OUTPUT_DIR, 'Complete');

// ═══════════════ PROVIDER CONFIGS ═══════════════

const PROVIDERS = [
  // Priority 1: NVIDIA — Multiple free models
  {
    name: 'NVIDIA',
    key: () => process.env.NVIDIA_API_KEY,
    models: [
      'meta/llama-3.1-405b-instruct',
      'meta/llama-3.1-70b-instruct',
      'mistralai/mixtral-8x22b-instruct-v0.1',
      'google/gemma-2-27b-it',
    ],
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    format: 'openai', // OpenAI-compatible API
  },
  // Priority 2: Google Gemini
  {
    name: 'Gemini',
    key: () => process.env.GEMINI_API_KEY,
    models: [
      'gemini-2.0-flash',
      'gemini-1.5-flash',
    ],
    url: (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    format: 'gemini',
  },
  // Priority 3: OpenRouter — Free models
  {
    name: 'OpenRouter',
    key: () => process.env.OPENROUTER_API_KEY,
    models: [
      'meta-llama/llama-3.1-8b-instruct:free',
      'mistralai/mistral-7b-instruct:free',
      'google/gemma-2-9b-it:free',
    ],
    url: 'https://openrouter.ai/api/v1/chat/completions',
    format: 'openai',
  },
];

// ═══════════════ PROMPT ═══════════════

function buildPrompt(desc, movieInfo) {
  return `You are an Instagram content expert specializing in movie recommendations.

Based on this movie review/description, generate an Instagram reel caption and relevant hashtags.

Movie Info:
${movieInfo}

Original Description:
${desc.slice(0, 800)}

Requirements:
1. Write a SHORT, engaging Instagram caption (2-4 lines max). Use emojis. Make people want to watch the movie.
2. Generate exactly 25 relevant hashtags. Mix popular and niche tags.
3. Include hashtags for: the movie name, genre, language, year, actors if mentioned, and general movie/reel tags.

Respond in EXACTLY this JSON format (no markdown, no code blocks, just raw JSON):
{
  "caption": "Your engaging caption here with emojis",
  "hashtags": ["#movie", "#moviename", "...25 total..."],
  "movie_name": "Movie Name (Year)"
}`;
}

// ═══════════════ API CALLERS ═══════════════

/**
 * Call OpenAI-compatible API (NVIDIA / OpenRouter)
 */
async function callOpenAI(provider, model, prompt) {
  const apiKey = provider.key();
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  // OpenRouter needs extra headers
  if (provider.name === 'OpenRouter') {
    headers['HTTP-Referer'] = 'https://github.com/instagram-movies-for-you';
    headers['X-Title'] = 'Instagram Movies For You';
  }

  const response = await fetch(provider.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 800,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${provider.name}/${model} → ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Call Google Gemini API
 */
async function callGemini(provider, model, prompt) {
  const apiKey = provider.key();
  const url = provider.url(model, apiKey);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini/${model} → ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ═══════════════ MAIN GENERATOR ═══════════════

/**
 * Generate tags using fallback chain: NVIDIA → Gemini → OpenRouter
 * Tries multiple models per provider before moving to next provider.
 */
export async function generateTags(reelData) {
  const movieInfo = extractMovieInfo(reelData.description || '');
  const prompt = buildPrompt(reelData.description || '', movieInfo);

  // Find available providers (ones with API keys)
  const available = PROVIDERS.filter(p => {
    const key = p.key();
    return key && key.trim().length > 0;
  });

  if (available.length === 0) {
    throw new Error(
      'No AI API key found! Set at least one in .env:\n' +
      '  NVIDIA_API_KEY=... (from build.nvidia.com)\n' +
      '  GEMINI_API_KEY=... (from aistudio.google.com)\n' +
      '  OPENROUTER_API_KEY=... (from openrouter.ai/keys)'
    );
  }

  log(`🤖 Available AI providers: ${available.map(p => p.name).join(', ')}`);

  const errors = [];

  for (const provider of available) {
    // Use env override for model if set (NVIDIA only)
    const models = provider.name === 'NVIDIA' && process.env.NVIDIA_MODEL
      ? [process.env.NVIDIA_MODEL, ...provider.models.filter(m => m !== process.env.NVIDIA_MODEL)]
      : provider.models;

    for (const model of models) {
      try {
        log(`   🔄 Trying ${provider.name} → ${model.split('/').pop()}...`);

        let content;
        if (provider.format === 'gemini') {
          content = await callGemini(provider, model, prompt);
        } else {
          content = await callOpenAI(provider, model, prompt);
        }

        // Parse JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          errors.push(`${provider.name}/${model}: No JSON in response`);
          continue;
        }

        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.caption && !parsed.hashtags) {
          errors.push(`${provider.name}/${model}: Empty result`);
          continue;
        }

        log(`   ✅ Success via ${provider.name} → ${model.split('/').pop()}`);

        return {
          caption: parsed.caption || '',
          hashtags: parsed.hashtags || [],
          movie_name: parsed.movie_name || '',
          provider: provider.name,
          model: model,
        };
      } catch (err) {
        const msg = `${provider.name}/${model}: ${err.message.slice(0, 100)}`;
        errors.push(msg);
        log(`   ⚠️ ${msg}`);
        // Continue to next model/provider
      }
    }
  }

  // All providers failed
  throw new Error(
    `All AI providers failed!\n${errors.map(e => `  • ${e}`).join('\n')}`
  );
}

/**
 * Extract key movie info from description
 */
function extractMovieInfo(desc) {
  const parts = [];
  const nameMatch = desc.match(/(?:Movies?\s*Name\s*(?:&\s*Review)?[:\-–]*\s*)([^\n(]+(?:\(\d{4}\))?)/i);
  if (nameMatch) parts.push(`Movie: ${nameMatch[1].trim()}`);
  const yearMatch = desc.match(/\((\d{4})\)/);
  if (yearMatch) parts.push(`Year: ${yearMatch[1]}`);
  const hashtags = desc.match(/#\w+/g);
  if (hashtags) parts.push(`Original Tags: ${hashtags.join(' ')}`);
  return parts.join('\n') || 'No specific info extracted';
}

/**
 * Generate tags for a specific reel and save to reel_data.json
 */
export async function generateTagsForReel(reelNum) {
  const reelDir = path.join(COMPLETE_DIR, `Reel ${padNumber(reelNum)}`);
  const dataPath = path.join(reelDir, 'reel_data.json');

  if (!fs.existsSync(dataPath)) {
    throw new Error(`reel_data.json not found for Reel ${padNumber(reelNum)}`);
  }

  const reelData = loadJSON(dataPath);
  log(`🤖 Generating AI tags for Reel ${padNumber(reelNum)}...`);

  const result = await generateTags(reelData);

  // Update reel_data.json
  reelData.ai_caption = result.caption;
  reelData.ai_hashtags = result.hashtags;
  reelData.ai_movie_name = result.movie_name;
  reelData.ai_provider = `${result.provider}/${result.model}`;
  reelData.tags_generated_at = new Date().toISOString();

  saveJSON(dataPath, reelData);
  log(`✅ Tags saved for Reel ${padNumber(reelNum)}: ${result.hashtags.length} hashtags`);

  return result;
}

// ═══════════════ CLI ═══════════════
const isMainScript = process.argv[1] && (
  process.argv[1].includes('04_generate_tags') ||
  process.argv[1].endsWith('generate_tags.js')
);

if (isMainScript) {
  const num = parseInt(process.argv[2]);
  if (!num) {
    console.log('Usage: node src/04_generate_tags.js <reelNumber>');
    console.log('  npm run generate-tags -- 1    → Generate tags for Reel 01');
    process.exit(1);
  }
  generateTagsForReel(num).catch(e => { logError(e.message); process.exit(1); });
}
