const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

async function downloadFile(url, dest) {
  console.log(`[yt-dlp] Downloading from ${url}...`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to download yt-dlp: HTTP ${res.status} ${res.statusText}`);
  }

  const tmpDest = `${dest}.tmp-${Date.now()}`;
  const fileStream = fs.createWriteStream(tmpDest);

  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(Buffer.from(value));
    }
  } else {
    const arrayBuffer = await res.arrayBuffer();
    fileStream.write(Buffer.from(arrayBuffer));
  }

  await new Promise((resolve, reject) => {
    fileStream.end(err => (err ? reject(err) : resolve()));
  });

  if (fs.existsSync(dest)) {
    try { fs.unlinkSync(dest); } catch (_) {}
  }
  fs.renameSync(tmpDest, dest);

  const stats = fs.statSync(dest);
  console.log(`[yt-dlp] Downloaded successfully! Size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
}

async function ensureYtDlp(customDir) {
  const rootDir = customDir || path.join(__dirname, '..');
  const binDir = path.join(rootDir, 'bin');

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
  const binaryPath = path.join(binDir, binaryName);

  // 1. Check if local binary already exists and is executable
  if (fs.existsSync(binaryPath) && fs.statSync(binaryPath).size > 100000) {
    try {
      if (!isWin) {
        try { fs.chmodSync(binaryPath, 0o755); } catch (_) {}
      }
      const test = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' });
      if (test.status === 0 && test.stdout) {
        console.log(`[yt-dlp] Verified binary at ${binaryPath} (v${test.stdout.trim()})`);
        return binaryPath;
      }
    } catch (_) {}
  }

  // 2. Check if yt-dlp exists globally in PATH
  try {
    const globalTest = spawnSync('yt-dlp', ['--version'], { encoding: 'utf8' });
    if (globalTest.status === 0 && globalTest.stdout) {
      console.log(`[yt-dlp] Using system-installed yt-dlp (v${globalTest.stdout.trim()})`);
      return 'yt-dlp';
    }
  } catch (_) {}

  // 3. Download appropriate binary
  let downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  if (isWin) {
    downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  } else {
    // Check if python3 is available for the 3MB zipapp
    let hasPython = false;
    try {
      const py = spawnSync('python3', ['--version']);
      hasPython = py.status === 0;
    } catch (_) {}

    if (!hasPython) {
      // Standalone PyInstaller Linux binary (runs without python3)
      downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
    }
  }

  await downloadFile(downloadUrl, binaryPath);

  if (!isWin) {
    try { fs.chmodSync(binaryPath, 0o755); } catch (_) {}
  }

  const verify = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' });
  if (verify.status !== 0) {
    throw new Error(`yt-dlp verification failed: ${verify.stderr || 'unknown error'}`);
  }

  console.log(`[yt-dlp] Successfully installed yt-dlp (v${verify.stdout.trim()})`);
  return binaryPath;
}

if (require.main === module) {
  ensureYtDlp()
    .then(p => {
      console.log('[yt-dlp] Ready:', p);
      process.exit(0);
    })
    .catch(err => {
      console.error('[yt-dlp] Setup error:', err);
      process.exit(1);
    });
}

module.exports = { ensureYtDlp };
