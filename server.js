const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DIST_DIR = path.join(__dirname, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function extractVideoId(urlStr) {
  if (!urlStr) return null;
  const shortMatch = urlStr.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  const watchMatch = urlStr.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortsMatch = urlStr.match(/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch) return shortsMatch[1];
  const embedMatch = urlStr.match(/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  const directMatch = urlStr.trim().match(/^([a-zA-Z0-9_-]{11})$/);
  if (directMatch) return directMatch[1];
  return null;
}

const { Readable } = require('stream');
const { spawn, spawnSync } = require('child_process');
const { ensureYtDlp } = require('./scripts/ensure-ytdlp');

let ffmpegBinary = null;
try {
  ffmpegBinary = require('ffmpeg-static');
  if (ffmpegBinary && process.platform !== 'win32') {
    try { fs.chmodSync(ffmpegBinary, 0o755); } catch (_) {}
  }
} catch (_) {}

const CACHE_DIR = path.join(__dirname, 'audio_cache');
const COOKIES_FILE = path.join(__dirname, 'cookies.txt');
if (process.env.YOUTUBE_COOKIES) {
  try { fs.writeFileSync(COOKIES_FILE, process.env.YOUTUBE_COOKIES, 'utf8'); } catch (_) {}
}

if (!fs.existsSync(CACHE_DIR)) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (_) {}
}

const activeDownloads = new Map();

function runProcess(bin, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGKILL'); } catch (_) {}
      reject(new Error(`Process timed out after ${timeoutMs / 1000}s. Out: ${stdout.slice(-150)} | Err: ${stderr.slice(-150)}`));
    }, timeoutMs);

    proc.stdout.on('data', chunk => {
      stdout = (stdout + chunk.toString()).slice(-20000);
    });
    proc.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-20000);
    });
    proc.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Exit code ${code}: ${(stderr || stdout).slice(-400)}`));
    });
    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function serveAudioFile(filePath, req, res) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType =
      ext === '.mp3' ? 'audio/mpeg' :
      ext === '.m4a' ? 'audio/mp4' :
      ext === '.mp4' ? 'audio/mp4' :
      ext === '.webm' ? 'audio/webm' :
      ext === '.ogg' || ext === '.opus' ? 'audio/ogg' :
      ext === '.wav' ? 'audio/wav' : 'audio/mpeg';

    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || start >= fileSize || (parts[1] && end >= fileSize) || start > end) {
        res.writeHead(416, {
          'Content-Range': `bytes */${fileSize}`,
          'Access-Control-Allow-Origin': '*',
        });
        return res.end();
      }

      const chunksize = (end - start) + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Cache-Control': 'public, max-age=604800, immutable',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Cache-Control': 'public, max-age=604800, immutable',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error serving audio: ' + err.message);
    }
  }
}

async function downloadViaLoader(videoId) {
  try {
    console.log(`[AudioCache] Attempting cloud MP3 resolver for ${videoId}...`);
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const initRes = await fetch(`https://loader.to/ajax/download.php?button=1&start=1&end=1&format=mp3&url=${encodeURIComponent(ytUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!initRes.ok) return null;
    const data = await initRes.json();
    if (!data.content) return null;
    const html = Buffer.from(data.content, 'base64').toString();
    const matchId = html.match(/id="(card-v2_stream_[^"]+|v2_stream_[^"]+_progress)"/);
    if (!matchId) return null;
    const streamId = matchId[1].replace('card-', '').replace('_progress', '');

    // Poll progress up to 20 times (~30 seconds)
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const progRes = await fetch(`https://loader.to/ajax/progress.php?id=${streamId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(8000)
      });
      if (progRes.ok) {
        const prog = await progRes.json();
        if (prog.success === 1 && prog.download_url) {
          console.log(`[AudioCache] Cloud resolver generated MP3 URL for ${videoId}! Streaming audio...`);
          const streamRes = await fetch(prog.download_url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(60000)
          });
          if (streamRes.ok) {
            const arrayBuf = await streamRes.arrayBuffer();
            const buf = Buffer.from(arrayBuf);
            if (buf.length > 10000) {
              const targetFile = path.join(CACHE_DIR, `${videoId}.mp3`);
              const tempFile = `${targetFile}.tmp-${Date.now()}`;
              fs.writeFileSync(tempFile, buf);
              if (fs.existsSync(targetFile)) {
                try { fs.unlinkSync(targetFile); } catch (_) {}
              }
              fs.renameSync(tempFile, targetFile);
              console.log(`[AudioCache] Successfully cached MP3 for ${videoId} via cloud resolver (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
              return targetFile;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[AudioCache] Cloud resolver error for ${videoId}:`, err.message);
  }
  return null;
}

async function downloadAudioToCache(videoId) {
  for (const ext of ['.mp3', '.m4a', '.mp4', '.webm', '.opus', '.ogg', '.wav']) {
    const p = path.join(CACHE_DIR, `${videoId}${ext}`);
    if (fs.existsSync(p) && fs.statSync(p).size > 10000) {
      return p;
    }
  }

  if (activeDownloads.has(videoId)) {
    return activeDownloads.get(videoId);
  }

  const downloadPromise = (async () => {
    // 1. Prioritize Cloud MP3 resolver (bypasses YouTube datacenter bot detection)
    try {
      const cloudFile = await downloadViaLoader(videoId);
      if (cloudFile && fs.existsSync(cloudFile) && fs.statSync(cloudFile).size > 10000) {
        return cloudFile;
      }
    } catch (e) {
      console.warn(`[AudioCache] Cloud resolver pre-check failed for ${videoId}:`, e.message);
    }

    const bin = await getYtDlp();
    if (!bin) throw new Error('Audio engine is initializing, please retry shortly.');

    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const embedUrl = `https://www.youtube.com/embed/${videoId}`;
    const tempPrefix = path.join(CACHE_DIR, `temp_${videoId}_${Date.now()}`);

    const hasCookies = fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 10;
    let safeCookiesFile = null;
    if (hasCookies) {
      safeCookiesFile = path.join(CACHE_DIR, 'session_cookies.txt');
      try { fs.copyFileSync(COOKIES_FILE, safeCookiesFile); } catch (_) { safeCookiesFile = COOKIES_FILE; }
    }

    const commonArgs = [
      '--no-check-certificates',
      '--socket-timeout', '15',
      '--no-playlist',
      '--no-progress',
      '--js-runtimes', `node:${process.execPath}`,
      '--remote-components', 'ejs:github',
      '-f', 'ba/b/251/140/18',
      '-o', `${tempPrefix}.%(ext)s`,
    ];

    // Multi-tier extraction strategies:
    // 1. Mobile multi-client WITH cookies (User's authenticated session with mobile agent)
    // 2. Authenticated web client with cookies
    // 3. Mobile multi-client WITHOUT cookies
    // 4. Dedicated android client without cookies
    // 5. Web embedded client with embed URL
    const strategies = [
      ...(hasCookies && safeCookiesFile ? [{
        name: 'mobile-with-cookies',
        url: ytUrl,
        args: [
          ...commonArgs,
          '--extractor-args', 'youtube:player_client=visionos,android,mweb',
          '--cookies', safeCookiesFile,
        ],
      }, {
        name: 'web-with-cookies',
        url: ytUrl,
        args: [
          ...commonArgs,
          '--cookies', safeCookiesFile,
        ],
      }] : []),
      {
        name: 'mobile-no-cookies',
        url: ytUrl,
        args: [
          ...commonArgs,
          '--extractor-args', 'youtube:player_client=visionos,android,mweb',
          '--no-cookies',
        ],
      },
      {
        name: 'android-standalone',
        url: ytUrl,
        args: [
          ...commonArgs,
          '--extractor-args', 'youtube:player_client=android',
          '--no-cookies',
        ],
      },
      {
        name: 'web-embedded',
        url: embedUrl,
        args: [
          ...commonArgs,
          '--extractor-args', 'youtube:player_client=web_embedded',
          '--no-cookies',
        ],
      },
    ];

    const strategyErrors = [];

    for (const strat of strategies) {
      const existingFiles = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith(path.basename(tempPrefix)));
      if (existingFiles.length > 0) break;

      try {
        console.log(`[AudioCache] Attempting download for ${videoId} using strategy "${strat.name}"...`);
        await runProcess(bin, [...strat.args, strat.url], 12000);
        const checkFiles = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith(path.basename(tempPrefix)));
        if (checkFiles.length > 0) {
          console.log(`[AudioCache] Strategy "${strat.name}" succeeded for ${videoId}!`);
          break;
        }
      } catch (err) {
        strategyErrors.push(`[${strat.name}]: ${err.message}`);
        console.warn(`[AudioCache] Strategy "${strat.name}" failed for ${videoId}: ${err.message}`);
      }
    }

    // Check if any file was downloaded
    let files = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith(path.basename(tempPrefix)));

    // Fallback 1: High-Speed Cloud MP3 Resolver (bypasses YouTube datacenter bot detection)
    if (files.length === 0) {
      console.log(`[AudioCache] yt-dlp local strategies failed for ${videoId}. Trying cloud MP3 resolver...`);
      const loaderFile = await downloadViaLoader(videoId);
      if (loaderFile && fs.existsSync(loaderFile) && fs.statSync(loaderFile).size > 10000) {
        return loaderFile;
      }
    }

    // Fallback 2: Invidious API fallback
    if (files.length === 0) {
      console.warn(`[AudioCache] yt-dlp strategies failed for ${videoId}. Trying Invidious API fallback...`);
      const invidiousPool = [
        'https://invidious.nerdvpn.de',
        'https://invidious.f5.si',
        'https://yt.chocolatemoo53.com',
        'https://inv.nadeko.net'
      ];
      for (const base of invidiousPool) {
        try {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 8000);
          const apiRes = await fetch(`${base}/api/v1/videos/${videoId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: ctrl.signal
          });
          clearTimeout(tid);
          if (apiRes.ok) {
            const data = await apiRes.json();
            const formats = (data.adaptiveFormats || []).filter(f => f.type && f.type.startsWith('audio/'));
            if (formats.length > 0) {
              const best = formats.find(f => f.container === 'm4a') || formats[0];
              const streamRes = await fetch(best.url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
              });
              if (streamRes.ok) {
                const targetExt = best.container || 'm4a';
                const targetFile = path.join(CACHE_DIR, `${videoId}.${targetExt}`);
                const fileStream = fs.createWriteStream(targetFile);
                const reader = streamRes.body.getReader();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  fileStream.write(Buffer.from(value));
                }
                await new Promise(r => fileStream.end(r));
                if (fs.existsSync(targetFile) && fs.statSync(targetFile).size > 10000) {
                  return targetFile;
                }
              }
            }
          }
        } catch (_) {}
      }
    }

    files = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith(path.basename(tempPrefix)));
    if (files.length > 0) {
      const generated = path.join(CACHE_DIR, files[0]);
      const ext = path.extname(generated).toLowerCase();
      const targetFile = path.join(CACHE_DIR, `${videoId}${ext}`);
      if (fs.existsSync(targetFile)) {
        try { fs.unlinkSync(targetFile); } catch (_) {}
      }
      fs.renameSync(generated, targetFile);

      // If downloaded format is not MP3 and ffmpeg is available, convert it to clean standard MP3 in background
      if (ext !== '.mp3' && ffmpegBinary) {
        const mp3Target = path.join(CACHE_DIR, `${videoId}.mp3`);
        try {
          await runProcess(ffmpegBinary, [
            '-y',
            '-i', targetFile,
            '-vn',
            '-acodec', 'libmp3lame',
            '-q:a', '2',
            mp3Target
          ], 30000);
          if (fs.existsSync(mp3Target) && fs.statSync(mp3Target).size > 10000) {
            try { fs.unlinkSync(targetFile); } catch (_) {}
            return mp3Target;
          }
        } catch (convErr) {
          console.warn('[AudioCache] Background MP3 conversion failed, serving original format:', convErr.message);
        }
      }

      return targetFile;
    }

    throw new Error(
      strategyErrors.length > 0
        ? `Audio download failed: ${strategyErrors.join(' | ')}`
        : 'Audio download failed: YouTube blocked access or video is unavailable. Please verify the link.'
    );
  })();

  activeDownloads.set(videoId, downloadPromise);
  try {
    const resultPath = await downloadPromise;
    return resultPath;
  } finally {
    activeDownloads.delete(videoId);
  }
}

let ytDlpBinary = null;
async function getYtDlp() {
  if (ytDlpBinary) return ytDlpBinary;
  try {
    ytDlpBinary = await ensureYtDlp(__dirname);
    return ytDlpBinary;
  } catch (err) {
    console.error('[yt-dlp] Error ensuring binary:', err.message);
    return null;
  }
}

// Preload yt-dlp binary asynchronously on boot
getYtDlp().catch(() => {});

async function resolveYouTubeAudio(videoUrl) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) throw new Error('Invalid YouTube track URL or ID');

  let title = `YouTube Track - ${videoId}`;

  // 1. Instant title fetch via official YouTube oEmbed API (< 400ms)
  try {
    const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
      headers: { 'User-Agent': 'OfflineMusicApp/1.0' }
    });
    if (oembedRes.ok) {
      const data = await oembedRes.json();
      if (data.title) {
        title = data.title;
      }
    }
  } catch (_) {}

  // 2. Fallback to yt-dlp title if oEmbed didn't provide one
  if (title.startsWith('YouTube Track -')) {
    const bin = await getYtDlp();
    if (bin) {
      try {
        const titleProc = spawnSync(bin, [
          '--print', '%(title)s',
          '--no-playlist',
          `https://www.youtube.com/watch?v=${videoId}`
        ], { encoding: 'utf8', timeout: 10000 });
        if (titleProc.stdout && titleProc.stdout.trim()) {
          title = titleProc.stdout.trim();
        }
      } catch (_) {}
    }
  }

  const cleanTitle = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  const proxyUrl = `/api/proxy-audio?id=${videoId}`;

  return {
    title: cleanTitle,
    streamUrl: proxyUrl,
    directUrl: proxyUrl,
    videoId,
  };
}

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // HTTPS enforcement on reverse-proxy environments (Render)
  if (req.headers['x-forwarded-proto'] === 'http') {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    return res.end();
  }

  // Built-in Healthcheck endpoint for keep-alive pings
  if (req.url === '/health' || req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('OK');
  }

  // API: YouTube Cookies Management
  if (req.url === '/api/cookies') {
    if (req.method === 'GET') {
      const exists = fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 10;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ hasCookies: exists }));
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.cookies && typeof parsed.cookies === 'string') {
            fs.writeFileSync(COOKIES_FILE, parsed.cookies.trim(), 'utf8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: 'Cookies saved successfully!' }));
          } else {
            if (fs.existsSync(COOKIES_FILE)) {
              try { fs.unlinkSync(COOKIES_FILE); } catch (_) {}
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: 'Cookies cleared.' }));
          }
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // API: Settings Backup & Persistence
  if (req.url === '/api/settings') {
    const SETTINGS_FILE = path.join(__dirname, '.app_settings.json');
    if (req.method === 'GET') {
      try {
        if (fs.existsSync(SETTINGS_FILE)) {
          const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(data);
        }
      } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{}');
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          fs.writeFileSync(SETTINGS_FILE, JSON.stringify(parsed, null, 2), 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // API: Diagnostics for Cloud MP3 resolver
  if (req.url.startsWith('/api/diag-loader')) {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const videoId = reqUrl.searchParams.get('id') || 'lcw4TDMBjZA';
    try {
      const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const initRes = await fetch(`https://loader.to/ajax/download.php?button=1&start=1&end=1&format=mp3&url=${encodeURIComponent(ytUrl)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(10000)
      });
      const status = initRes.status;
      const text = await initRes.text();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, status, text: text.slice(0, 300) }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // API: Diagnostics for yt-dlp on Render / Cloud Host
  if (req.url.startsWith('/api/diag-ytdlp')) {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const videoId = reqUrl.searchParams.get('id') || 'lcw4TDMBjZA';
    const useCookies = reqUrl.searchParams.get('cookies') === '1';
    const client = reqUrl.searchParams.get('client') || 'visionos,android';

    try {
      const bin = await getYtDlp();
      const hasCookies = fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 10;
      const testArgs = [
        '--no-check-certificates',
        '--socket-timeout', '15',
        '--no-playlist',
        '--no-progress',
        '--js-runtimes', `node:${process.execPath}`,
        '--remote-components', 'ejs:github',
        '--extractor-args', `youtube:player_client=${client}`,
        ...(useCookies && hasCookies ? ['--cookies', COOKIES_FILE] : ['--no-cookies']),
        '-f', 'ba/b/251/140/18',
        '--get-url',
        `https://www.youtube.com/watch?v=${videoId}`,
      ];

      const resOutput = await runProcess(bin, testArgs, 20000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        hasCookies,
        binaryPath: bin,
        client,
        useCookies,
        url: resOutput.stdout.trim(),
        stderr: resOutput.stderr,
      }));
    } catch (err) {
      const hasCookies = fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 10;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        hasCookies,
        execPath: process.execPath,
        envPath: process.env.PATH,
        error: err.message,
      }));
    }
  }

  // API: YouTube Resolver (Node backend, zero CORS issues!)
  if (req.url.startsWith('/api/youtube')) {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const targetUrl = reqUrl.searchParams.get('url');

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    try {
      const result = await resolveYouTubeAudio(targetUrl);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        title: result.title,
        streamUrl: result.streamUrl,
        directUrl: result.directUrl,
        videoId: result.videoId,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message || 'Resolution failed' }));
    }
  }

  // API: Audio Stream Proxy (serves cached, accurate MP3 audio with full Range support!)
  if (req.url.startsWith('/api/proxy-audio')) {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const videoId = reqUrl.searchParams.get('id') || extractVideoId(reqUrl.searchParams.get('url'));
    const genericStreamUrl = reqUrl.searchParams.get('url');

    if (videoId) {
      for (const ext of ['.mp3', '.m4a', '.mp4', '.webm', '.opus', '.ogg', '.wav']) {
        const cachedFilePath = path.join(CACHE_DIR, `${videoId}${ext}`);
        if (fs.existsSync(cachedFilePath) && fs.statSync(cachedFilePath).size > 5000) {
          return serveAudioFile(cachedFilePath, req, res);
        }
      }

      try {
        const filePath = await downloadAudioToCache(videoId);
        return serveAudioFile(filePath, req, res);
      } catch (err) {
        console.error(`[AudioProxy] Failed to fetch/convert audio for ${videoId}:`, err.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`Audio stream extraction failed: ${err.message}`);
        }
        return;
      }
    }

    if (!genericStreamUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing id or url parameter');
    }

    // Generic URL proxy fallback
    try {
      const response = await fetch(genericStreamUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...(req.headers.range ? { Range: req.headers.range } : {}),
        },
      });

      if (!response.ok && response.status >= 400) {
        res.writeHead(response.status, { 'Content-Type': 'text/plain' });
        return res.end(`Upstream audio request failed: ${response.status}`);
      }

      res.writeHead(response.status, {
        'Content-Type': response.headers.get('content-type') || 'audio/mp4',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        ...(response.headers.get('content-length') ? { 'Content-Length': response.headers.get('content-length') } : {}),
      });

      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const ok = res.write(value);
            if (!ok) {
              await new Promise(r => res.once('drain', r));
            }
          }
        } finally {
          reader.cancel().catch(() => {});
        }
        res.end();
      } else {
        res.end();
      }
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Proxy streaming error: ' + err.message);
    }
  }

  // Static File Server with SPA routing fallback
  const safeUrl = (req.url || '/').split('?')[0];
  let targetPath = path.join(DIST_DIR, safeUrl === '/' ? 'index.html' : safeUrl);

  fs.stat(targetPath, (err, stats) => {
    if (err || !stats.isFile()) {
      targetPath = path.join(DIST_DIR, 'index.html');
    }

    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(targetPath, (readErr, content) => {
      if (readErr) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Offline Music App</title></head>
            <body style="font-family:sans-serif;text-align:center;padding:50px;background:#1A1A2E;color:#fff;">
              <h1>Offline Music App Server is Live! 🎵</h1>
              <p>Web build is ready. Health check is active at <code>/health</code>.</p>
            </body>
          </html>
        `);
      } else {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
        });
        res.end(content);
      }
    });
  });
});

// Automatic Server-Side Keep-Alive Heartbeat
// Pings external URL every 4 minutes to ensure Render free tier never spins down
const SERVER_PING_URL = (process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL || 'https://music-hlq1.onrender.com').replace(/\/$/, '') + '/ping';

function startServerKeepAlive() {
  console.log(`[KeepAlive] Automatic server heartbeat active for: ${SERVER_PING_URL}`);
  
  // Initial ping 15s after startup
  setTimeout(() => {
    pingSelf();
  }, 15000);

  // Periodic heartbeat every 4 minutes (Render free tier timeout is 15 minutes)
  setInterval(() => {
    pingSelf();
  }, 4 * 60 * 1000);
}

async function pingSelf() {
  try {
    const res = await fetch(SERVER_PING_URL, {
      headers: { 'User-Agent': 'OfflineMusicApp-ServerSelfPing/1.0' }
    });
    console.log(`[KeepAlive] Heartbeat ping sent to ${SERVER_PING_URL} (Status: ${res.status})`);
  } catch (err) {
    console.warn(`[KeepAlive] Heartbeat ping warning: ${err.message}`);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Web server listening on port ${PORT}`);
  startServerKeepAlive();
});
