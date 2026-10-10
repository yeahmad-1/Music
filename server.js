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

let invidiousInstances = [
  'https://invidious.f5.si',
  'https://invidious.nerdvpn.de',
  'https://yt.chocolatemoo53.com',
  'https://invidious.tiekoetter.com',
  'https://inv.nadeko.net'
];

let lastInstanceRefresh = 0;

async function refreshInvidiousPool() {
  const now = Date.now();
  if (now - lastInstanceRefresh < 15 * 60 * 1000) return;
  lastInstanceRefresh = now;
  try {
    const res = await fetch('https://api.invidious.io/instances.json?sort_by=health');
    if (res.ok) {
      const list = await res.json();
      const healthy = list
        .filter(item => item[1] && item[1].type === 'https' && !item[0].includes('.onion') && !item[0].includes('.i2p'))
        .map(item => item[1].uri.replace(/\/$/, ''))
        .filter(Boolean);
      for (const uri of healthy) {
        if (!invidiousInstances.includes(uri)) {
          invidiousInstances.push(uri);
        }
      }
    }
  } catch (_) {}
}

async function resolveYouTubeAudio(videoUrl) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) throw new Error('Invalid YouTube track URL or ID');

  refreshInvidiousPool().catch(() => {});

  let lastError = null;
  for (let i = 0; i < invidiousInstances.length; i++) {
    const base = invidiousInstances[i];
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 4500);
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: ctrl.signal
      });
      clearTimeout(tid);

      if (res.ok) {
        const data = await res.json();
        const audioFormats = (data.adaptiveFormats || []).filter(f => f.type && f.type.startsWith('audio/'));
        if (audioFormats.length > 0) {
          // Promote working instance to front of pool
          if (i > 0) {
            invidiousInstances.splice(i, 1);
            invidiousInstances.unshift(base);
          }

          // Prefer AAC m4a / mp4 for universal browser/mobile audio compatibility
          const m4a = audioFormats.find(f => f.container === 'm4a' || f.type.includes('mp4') || f.itag === '140');
          const sorted = audioFormats.sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
          const best = m4a || sorted[0];

          const rawTitle = data.title || `YouTube Audio - ${videoId}`;
          const title = rawTitle.replace(/[\\/:*?"<>|]/g, '_').trim();

          return {
            title,
            streamUrl: best.url,
            videoId,
          };
        }
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(lastError?.message || 'Unable to extract audio from YouTube. Please verify the URL.');
}

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
      const proxyUrl = `/api/proxy-audio?url=${encodeURIComponent(result.streamUrl)}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        title: result.title,
        streamUrl: proxyUrl,
        directUrl: result.streamUrl,
        videoId: result.videoId,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message || 'Resolution failed' }));
    }
  }

  // API: Audio Stream Proxy (allows web browsers to download/play streams without CORS blocks)
  if (req.url.startsWith('/api/proxy-audio')) {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const streamUrl = reqUrl.searchParams.get('url');

    if (!streamUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing url parameter');
    }

    try {
      const response = await fetch(streamUrl, {
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
