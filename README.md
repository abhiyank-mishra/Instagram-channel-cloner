# 🎬 Instagram Channel Cloner & Movie Reel Automator

A comprehensive, state-of-the-art automation suite to clone, download, custom-edit (WYSIWYG template based), generate AI tags/captions, and manage Instagram Reels publishing with a unified dashboard.

Designed and developed by **[Abhiyank Mishra](https://abhiyank.in)**.

[![GitHub Portfolio](https://img.shields.io/badge/GitHub-abhiyank--mishra-blueviolet?style=flat-square&logo=github)](https://github.com/abhiyank-mishra)
[![Portfolio Website](https://img.shields.io/badge/Portfolio-abhiyank.in-ff5722?style=flat-square&logo=google-chrome)](https://abhiyank.in)

---

## 🌟 Key Features

1. **🔗 Link Collector (`npm run collect-links`)**: Scrapes reel links from any target page (e.g., movie review channels) using Puppeteer with Stealth plugins.
2. **⬇️ Smart Downloader (`npm run download`)**: Automatically downloads reels and metadata using `yt-dlp`, handling rate-limiting and session cookies.
3. **🎨 WYSIWYG Template Editor (`npm run editor`)**: 
   - Interactive local editor at `http://localhost:3456`.
   - Add/position text layers, bars, logos (PNG), and blur sections with drag-and-drop.
   - Real-time **FFmpeg test render comparison** directly inside the browser.
   - Saves to a central `template_config.json`.
4. **🎬 FFmpeg Video Processor (`npm run edit`)**: Burns your template configuration (including dynamic day indicators like `Day 01`, `Day 01.5`, etc.) into the raw video.
5. **🧠 AI Metadata Generator (`npm run generate-tags`)**: Integrates with NVIDIA API, Google Gemini, and OpenRouter models to automatically generate high-engagement movie reviews, meta tags, and hashtags.
6. **📊 Upload Manager Dashboard (`npm run dashboard`)**:
   - Web GUI at `http://localhost:3457` to control the entire workflow.
   - Play side-by-side previews of original vs edited videos.
   - One-click AI Tag generation.
   - Mandated **Upload Verification** with real-time Instagram link validation.
   - Automatically parses published metadata using `yt-dlp` to sync descriptions/likes, and transfers the edited files from `Edited/` to the `Uploaded/` storage folder.

---

## 🛠️ Tech Stack

- **Core**: Node.js (ES Modules)
- **Scraping**: Puppeteer & Puppeteer Extra Stealth
- **Video Processing**: FFmpeg (drawtext, crop, scale, boxblur filters)
- **Downloader Engine**: `yt-dlp`
- **Frontend**: HTML5, Vanilla HSL CSS, Javascript (Drag & Drop API, Custom Canvas)
- **APIs**: NVIDIA Nim API, Google Gemini Pro API, OpenRouter API (Multi-provider failover system)

---

## 🚀 Quick Start Guide

### 1. Prerequisites
Ensure you have the following installed on your machine:
- [Node.js](https://nodejs.org/) (v18+)
- [FFmpeg](https://ffmpeg.org/download.html) (Added to system PATH)
- Python (For `yt-dlp` dependencies)

### 2. Installation
Clone this repository and run the setup script:
```bash
# Run the setup script which diagnoses system dependencies and installs npm packages
setup.bat
```
*(Alternatively, run `npm install` directly).*

### 3. Configuration
Duplicate `.env.example` to `.env` and fill in your API keys:
```env
# API Keys (Provide at least one)
NVIDIA_API_KEY=your_nvidia_key
GEMINI_API_KEY=your_gemini_key
OPENROUTER_API_KEY=your_openrouter_key

# Directory Settings
OUTPUT_DIR=output
COOKIES_FILE=cookies.txt
```

---

## 🔄 Workflow Walkthrough

### Step 1: Collect Reel Links
Scrape links from the target Instagram profile:
```bash
npm run collect-links
```

### Step 2: Download Reels
Download the collected videos along with their original JSON metadata:
```bash
npm run download
```

### Step 3: Design the Template
Launch the editor server to configure overlay placement, fonts, colors, and logos:
```bash
npm run editor
```
Open `http://localhost:3456` in your browser. Design your layout and hit **Save Template**.

### Step 4: Manage & Publish via Dashboard
Start the unified manager dashboard:
```bash
npm run dashboard
```
Open `http://localhost:3457`. From here you can:
- Click **Edit** to apply the FFmpeg template processing.
- Click **Preview** to verify the video.
- Generate **AI Tags** to copy-paste.
- Click **Upload**, publish the video to Instagram, paste the link, and save.

---

## 📂 Project Structure

```
├── dashboard/               # Upload Manager Dashboard frontend
├── editor/                  # WYSIWYG Template Editor frontend
├── src/
│   ├── 01_collect_links.js  # Puppeteer-based scraper
│   ├── 02_download_reels.js  # yt-dlp downloader & info extractor
│   ├── 03_edit_reels.js      # FFmpeg filter builder and compiler
│   ├── 04_generate_tags.js   # LLM API tag & description generator
│   ├── serve_editor.js       # Express-like editor backend with frame extraction
│   ├── serve_dashboard.js    # Dashboard backend with active yt-dlp scraping
│   └── utils/
│       ├── cookies.js        # Session cookie manager
│       └── helpers.js        # General file & JSON utilities
├── template_config.json      # Saved template layer settings
└── setup.bat                 # Windows environment diagnostics tool
```

---

## ✍️ Author & Credits

Developed with ❤️ by **Abhiyank Mishra**.

- **Portfolio**: [abhiyank.in](https://abhiyank.in)
- **GitHub**: [@abhiyank-mishra](https://github.com/abhiyank-mishra)

Feel free to connect for collaborations, enhancements, or bug reports!
