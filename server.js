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

async function resolveYouTubeAudio(videoUrl) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) throw new Error('Invalid YouTube URL');

  const fullUrl = `https://www.youtube.com/watch?v=${videoId}`;
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
    } catch (e) {
      // try next
    }
  }

  // Fallback: Piped API
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
    } catch (e) {
      // try next
    }
  }

  // Fallback: Invidious API
  const invidiousEndpoints = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://vid.puffyan.us',
  ];

  for (const base of invidiousEndpoints) {
    try {
      const res = await fetch(`${base}/api/v1/videos/${videoId}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.adaptiveFormats) {
          const audioFormats = data.adaptiveFormats.filter(f => f.type && f.type.startsWith('audio/'));
          if (audioFormats.length > 0) {
            return {
              title: data.title || `YouTube Audio - ${videoId}`,
              streamUrl: audioFormats[0].url,
              videoId,
            };
          }
        }
      }
    } catch (e) {
      // try next
    }
  }

  throw new Error('Unable to resolve YouTube audio stream. Please check video accessibility.');
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
      const parsed = new URL(streamUrl);
      const client = parsed.protocol === 'https:' ? https : http;

      const proxyReq = client.get(streamUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          ...(req.headers.range ? { Range: req.headers.range } : {}),
        }
      }, (proxyRes) => {
        // Follow redirect if needed
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
          const redirectUrl = new URL(proxyRes.headers.location, streamUrl).toString();
          const redirectClient = redirectUrl.startsWith('https') ? https : http;
          const redirectReq = redirectClient.get(
            redirectUrl,
            {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                ...(req.headers.range ? { Range: req.headers.range } : {}),
              }
            },
            (redirectRes) => {
              res.writeHead(redirectRes.statusCode, {
                'Content-Type': redirectRes.headers['content-type'] || 'audio/mpeg',
                'Access-Control-Allow-Origin': '*',
                'Accept-Ranges': 'bytes',
                ...(redirectRes.headers['content-length'] ? { 'Content-Length': redirectRes.headers['content-length'] } : {}),
              });
              redirectRes.pipe(res);
            }
          );
          redirectReq.on('error', () => {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Proxy redirect failed');
          });
          return;
        }

        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'audio/mpeg',
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes',
          ...(proxyRes.headers['content-length'] ? { 'Content-Length': proxyRes.headers['content-length'] } : {}),
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Proxy streaming error: ' + err.message);
      });
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Invalid stream URL');
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
