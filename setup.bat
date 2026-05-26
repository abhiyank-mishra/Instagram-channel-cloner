@echo off
chcp 65001 >nul
title 🎬 Instagram Movies For You — Setup
color 0A

echo.
echo ══════════════════════════════════════════════════════
echo   🎬 Instagram Movies For You — Auto Setup
echo ══════════════════════════════════════════════════════
echo.

set "MISSING="
set "ALL_OK=1"

:: ────────────────────────────────────────────
:: Check Node.js
:: ────────────────────────────────────────────
echo [1/6] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   ❌ Node.js NOT found!
    echo   📥 Download from: https://nodejs.org/en/download/
    echo   💡 Install the LTS version, restart terminal after install.
    set "MISSING=%MISSING% Node.js"
    set "ALL_OK=0"
) else (
    for /f "tokens=*" %%v in ('node -v') do echo   ✅ Node.js %%v found
)

:: ────────────────────────────────────────────
:: Check npm
:: ────────────────────────────────────────────
echo [2/6] Checking npm...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo   ❌ npm NOT found! Install Node.js first.
    set "MISSING=%MISSING% npm"
    set "ALL_OK=0"
) else (
    for /f "tokens=*" %%v in ('npm -v') do echo   ✅ npm v%%v found
)

:: ────────────────────────────────────────────
:: Check Git
:: ────────────────────────────────────────────
echo [3/6] Checking Git...
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo   ⚠️  Git NOT found (optional but recommended)
    echo   📥 Download from: https://git-scm.com/download/win
) else (
    for /f "tokens=*" %%v in ('git --version') do echo   ✅ %%v found
)

:: ────────────────────────────────────────────
:: Check FFmpeg
:: ────────────────────────────────────────────
echo [4/6] Checking FFmpeg...
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    echo   ❌ FFmpeg NOT found! Required for video editing.
    echo   📥 Download from: https://www.gyan.dev/ffmpeg/builds/
    echo   💡 Download "ffmpeg-release-essentials.zip"
    echo   💡 Extract and add the bin\ folder to your PATH
    echo   💡 Or run: winget install Gyan.FFmpeg
    set "MISSING=%MISSING% FFmpeg"
    set "ALL_OK=0"
) else (
    for /f "tokens=3" %%v in ('ffmpeg -version 2^>^&1 ^| findstr /i "ffmpeg version"') do echo   ✅ FFmpeg %%v found
)

:: ────────────────────────────────────────────
:: Check yt-dlp
:: ────────────────────────────────────────────
echo [5/6] Checking yt-dlp...
where yt-dlp >nul 2>&1
if %errorlevel% neq 0 (
    echo   ❌ yt-dlp NOT found! Required for downloading reels.
    echo   📥 Trying to install via pip...
    where pip >nul 2>&1
    if %errorlevel% neq 0 (
        echo   ⚠️  pip not found either. Install Python first.
        echo   📥 Download Python: https://www.python.org/downloads/
        echo   💡 CHECK "Add Python to PATH" during install!
        echo   💡 Then run: pip install yt-dlp
        set "MISSING=%MISSING% yt-dlp Python"
        set "ALL_OK=0"
    ) else (
        echo   📦 Installing yt-dlp via pip...
        pip install yt-dlp
        where yt-dlp >nul 2>&1
        if %errorlevel% neq 0 (
            echo   ❌ yt-dlp install failed. Try manually: pip install yt-dlp
            set "MISSING=%MISSING% yt-dlp"
            set "ALL_OK=0"
        ) else (
            echo   ✅ yt-dlp installed successfully!
        )
    )
) else (
    for /f "tokens=*" %%v in ('yt-dlp --version') do echo   ✅ yt-dlp %%v found
)

:: ────────────────────────────────────────────
:: Check Python (for Puppeteer/Chromium build)
:: ────────────────────────────────────────────
echo [6/6] Checking Python...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo   ⚠️  Python NOT found (needed for yt-dlp)
    echo   📥 Download from: https://www.python.org/downloads/
    echo   💡 CHECK "Add Python to PATH" during install!
) else (
    for /f "tokens=*" %%v in ('python --version') do echo   ✅ %%v found
)

echo.
echo ──────────────────────────────────────────────────────

:: ────────────────────────────────────────────
:: If critical tools missing, stop here
:: ────────────────────────────────────────────
if "%ALL_OK%"=="0" (
    echo.
    echo ❌ Missing required tools:%MISSING%
    echo.
    echo Please install the missing tools listed above, then run setup.bat again.
    echo.
    pause
    exit /b 1
)

:: ────────────────────────────────────────────
:: Install npm dependencies
:: ────────────────────────────────────────────
echo.
echo 📦 Installing npm dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ❌ npm install failed!
    pause
    exit /b 1
)
echo ✅ Dependencies installed!

:: ────────────────────────────────────────────
:: Create .env if not exists
:: ────────────────────────────────────────────
if not exist ".env" (
    echo.
    echo 📝 Creating .env config file...
    (
        echo # Target Instagram profile ^(without @^)
        echo TARGET_PROFILE=findinggoodmovie.s
        echo.
        echo # Scroll delay range in milliseconds
        echo SCROLL_DELAY_MIN=1500
        echo SCROLL_DELAY_MAX=3000
        echo.
        echo # Delay between yt-dlp downloads in milliseconds
        echo DOWNLOAD_DELAY_MIN=3000
        echo DOWNLOAD_DELAY_MAX=8000
        echo.
        echo # Max comments to extract per reel
        echo MAX_COMMENTS=10
        echo.
        echo # Max consecutive scrolls with no new content before stopping
        echo MAX_STALE_SCROLLS=8
        echo.
        echo # yt-dlp cookies file path
        echo COOKIES_FILE=cookies.txt
        echo.
        echo # Output directory
        echo OUTPUT_DIR=output
        echo.
        echo # AI Tag Generation - At least 1 API key required
        echo # Priority: NVIDIA then Gemini then OpenRouter
        echo.
        echo # NVIDIA API - Get from https://build.nvidia.com
        echo NVIDIA_API_KEY=
        echo NVIDIA_MODEL=meta/llama-3.1-405b-instruct
        echo.
        echo # Google Gemini API - Get from https://aistudio.google.com
        echo GEMINI_API_KEY=
        echo.
        echo # OpenRouter API - Get from https://openrouter.ai/keys
        echo OPENROUTER_API_KEY=
    ) > .env
    echo ✅ .env created! Edit it with your API keys.
) else (
    echo ✅ .env already exists
)

:: ────────────────────────────────────────────
:: Create output directories
:: ────────────────────────────────────────────
if not exist "output" mkdir output
if not exist "output\Complete" mkdir "output\Complete"
if not exist "output\Reel links" mkdir "output\Reel links"
if not exist "output\Edited" mkdir "output\Edited"
if not exist "assets" mkdir assets

:: ────────────────────────────────────────────
:: Done!
:: ────────────────────────────────────────────
echo.
echo ══════════════════════════════════════════════════════
echo   ✅ SETUP COMPLETE!
echo ══════════════════════════════════════════════════════
echo.
echo Available commands:
echo.
echo   npm run collect-links    → Scrape all reel links from Instagram
echo   npm run download         → Download reel videos + metadata
echo   npm run editor           → Open visual template editor
echo   npm run edit             → Apply template to videos (FFmpeg)
echo   npm run dashboard        → Open Upload Manager Dashboard
echo   npm run generate-tags    → Generate AI captions/hashtags
echo.
echo ⚡ Quick Start:
echo   1. Edit .env with your API keys (at least 1 AI key)
echo   2. Run: npm run collect-links
echo   3. Run: npm run download -- count 5
echo   4. Run: npm run editor        (design your template)
echo   5. Run: npm run dashboard     (manage everything)
echo.
echo ══════════════════════════════════════════════════════
echo.
pause
