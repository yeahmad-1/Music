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
  return null;
}

const { Readable } = require('stream');

const VIDSSAVE_API_BASE = 'https://api.vidssave.com/api/contentsite_api';
const VIDSSAVE_DOMAIN = 'api-ak.vidssave.com';
let VIDSSAVE_AUTH = '20250901majwlqo';

async function refreshVidssaveAuth() {
  try {
    const html = await (await fetch('https://id.vidssave.com/home-1ey')).text();
    const matches = html.match(/src=["']([^"']+\.js)["']/g) || [];
    for (const match of matches) {
      const pathMatch = match.match(/src=["']([^"']+)["']/);
      if (!pathMatch) continue;
      const url = pathMatch[1].startsWith('http') ? pathMatch[1] : 'https://id.vidssave.com' + pathMatch[1];
      try {
        const js = await (await fetch(url)).text();
        const m = js.match(/auth[":=]+([0-9]{8}[a-z0-9]+)/i);
        if (m) {
          VIDSSAVE_AUTH = m[1];
          return VIDSSAVE_AUTH;
        }
      } catch {}
    }
  } catch {}
  return VIDSSAVE_AUTH;
}

async function resolveYouTubeAudio(videoUrl) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) throw new Error('Invalid YouTube URL');

  const fullUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let lastError = null;

  // Primary Strategy: High-speed VidsSave conversion & extraction engine
  try {
    await refreshVidssaveAuth();
    const callParse = (origin) => fetch(`${VIDSSAVE_API_BASE}/media/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://id.vidssave.com',
        'Referer': 'https://id.vidssave.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: new URLSearchParams({ auth: VIDSSAVE_AUTH, domain: VIDSSAVE_DOMAIN, origin, link: fullUrl }),
    }).then(r => r.json());

    const [src, cache] = await Promise.all([
      callParse('source').catch(() => null),
      callParse('cache').catch(() => null),
    ]);

    const json = (src && src.status === 1) ? src : cache;
    if (json && json.status === 1 && json.data) {
      const rawTitle = json.data.title || `YouTube Audio - ${videoId}`;
      const title = rawTitle.replace(/[\\/:*?"<>|]/g, '_').trim();
      const resources = json.data.resources || [];
      const audioResources = resources.filter(r => r.type === 'audio');

      // 1. Try converted MP3 download stream
      const mp3Resource = audioResources.find(r => r.format === 'MP3' && r.resource_content) || audioResources.find(r => r.resource_content);
      if (mp3Resource) {
        try {
          const body = new URLSearchParams({
            auth: VIDSSAVE_AUTH,
            domain: VIDSSAVE_DOMAIN,
            request: mp3Resource.resource_content,
            no_encrypt: '1',
          });
          const r1 = await fetch(`${VIDSSAVE_API_BASE}/media/download`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Origin': 'https://id.vidssave.com',
              'Referer': 'https://id.vidssave.com/',
            },
            body,
          });
          const j1 = await r1.json();
          if (j1 && j1.status === 1 && j1.data?.task_id) {
            const q = new URLSearchParams({
              auth: VIDSSAVE_AUTH,
              domain: VIDSSAVE_DOMAIN,
              task_id: j1.data.task_id,
              download_domain: 'vidssave.com',
              origin: 'content_site',
            });
            const r2 = await fetch(`${VIDSSAVE_API_BASE}/media/download_query?${q}`);
            const text = await r2.text();
            const m = text.match(/"download_link":"([^"]+)"/);
            if (m && m[1]) {
              const directLink = m[1].replace(/\\/g, '');
              return { title, streamUrl: directLink, videoId };
            }
          }
        } catch (convErr) {
          // Fall through to direct download_url
        }
      }

      // 2. Direct download_url fallback
      const directAudio = audioResources.find(r => r.download_url);
      if (directAudio && directAudio.download_url) {
        return { title, streamUrl: directAudio.download_url, videoId };
      }
    }
  } catch (err) {
    lastError = err;
  }

  // Fallback Strategy: Cobalt API
  const cobaltEndpoints = [
    'https://api.cobalt.tools',
    'https://cobalt-api.kwiatekm.tokyo',
    'https://cobalt.xy2401.com',
  ];

  for (const endpoint of cobaltEndpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: fullUrl,
          downloadMode: 'audio',
          audioFormat: 'mp3',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const stream = data.url || (data.status === 'stream' && data.url) || (data.status === 'tunnel' && data.url);
        if (stream) {
          return {
            title: data.filename ? data.filename.replace(/\.[^/.]+$/, '') : `YouTube Audio - ${videoId}`,
            streamUrl: stream,
            videoId,
          };
        }
      }
    } catch (e) {}
  }

  // Fallback Strategy: Piped API
  const pipedEndpoints = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.privacydev.net',
    'https://piped-api.lunar.icu',
  ];

  for (const base of pipedEndpoints) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.audioStreams && data.audioStreams.length > 0) {
          const sorted = data.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          return {
            title: data.title || `YouTube Audio - ${videoId}`,
            streamUrl: sorted[0].url,
            videoId,
          };
        }
      }
    } catch (e) {}
  }

  throw new Error(lastError?.message || 'Unable to resolve YouTube audio stream. Please check video accessibility.');
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

  // Built-in Healthcheck endpoint for keep-alive pings
  if (req.url === '/health' || req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('OK');
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
        'Content-Type': response.headers.get('content-type') || 'audio/mpeg',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        ...(response.headers.get('content-length') ? { 'Content-Length': response.headers.get('content-length') } : {}),
      });

      if (response.body) {
        const stream = Readable.fromWeb(response.body);
        stream.pipe(res);
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Web server listening on port ${PORT}`);
});
