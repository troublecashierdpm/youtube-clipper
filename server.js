'use strict';

const express = require('express');
const { execFile } = require('child_process');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// ── Resolve binari: yt-dlp & ffmpeg bisa beda lokasi antar OS / Python setup ──
function findBinary(name, candidates) {
  const isWin = process.platform === 'win32';
  const ext = isWin ? '.exe' : '';
  for (const dir of candidates) {
    const full = path.join(dir, name + ext);
    if (fs.existsSync(full)) return full;
  }
  return name; // fallback: biarkan PATH yang resolve
}

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const WIN_USSH = process.env.localappdata ? path.join(process.env.localappdata, 'Microsoft', 'WinGet', 'Links') : '';
const WIN_PY = process.env.APPDATA ? path.join(process.env.APPDATA, 'Python', 'Scripts') : '';

const YTDLP_PATHS = [
  HOME && path.join(HOME, '.local', 'bin'),
  WIN_PY,
  WIN_USSH,
  '/usr/local/bin', '/usr/bin', '/snap/bin',
].filter(Boolean);

const FFMPEG_PATHS = [
  HOME && path.join(HOME, 'bin'),
  WIN_USSH,
  '/usr/local/bin', '/usr/bin', '/snap/bin',
].filter(Boolean);

const YT_DLP = findBinary('yt-dlp', YTDLP_PATHS);
const FFMPEG = findBinary('ffmpeg', FFMPEG_PATHS);
console.log(`🔧 yt-dlp → ${YT_DLP}   ffmpeg → ${FFMPEG}`);

const app = express();
const PORT = process.env.PORT || 3001;
const TEMP_DIR = path.resolve(__dirname, 'temp');
const COOKIES_FILE = path.resolve(__dirname, 'cookies.txt');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Helper: exec command ──
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 600_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}\n${stderr}`.slice(0, 800)));
      else resolve(stdout);
    });
  });
}


// ── Helper: https GET ──
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } };
    https.get(url, opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

// ── Parse YouTube video ID ──
function parseVideoId(url) {
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /embed\/([a-zA-Z0-9_-]{11})/,
    /shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = String(url).match(p);
    if (m) return m[1];
  }
  return null;
}

// ── GET /api/info  (metadata only, no streaming) ──
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  const videoId = parseVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Link YouTube tidak valid' });

  try {
    // Primary: oEmbed (works from any IP)
    const raw = await httpsGet(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { 'User-Agent': 'Mozilla/5.0 (compatible)' }
    );
    const oembed = JSON.parse(raw);

    // Fallback: try yt-dlp for extra info (duration, etc.)
    let durationSec = 0;
    let thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

    try {
      const extra = await run(YT_DLP, [
        '--dump-json', '--no-playlist', '--no-warnings',
        '-J', `--cookies=${COOKIES_FILE}`,
        `https://www.youtube.com/watch?v=${videoId}`,
      ]);
      // ignore extra output lines
      const info = JSON.parse(extra.trim().split('\n').filter(l => l.startsWith('{'))[0] || '{}');
      durationSec = Math.round(info.duration || 0);
      if (info.thumbnail) thumbnail = info.thumbnail;
    } catch (_) {
      // yt-dlp blocked on this IP — that's OK, we still have oEmbed
    }

    res.json({
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: oembed.title || 'Tanpa Judul',
      channel: oembed.author_name || 'Unknown',
      thumbnail,
      duration: durationSec,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      ytdlpBlocked: false, // placeholder for UI feedback
    });
  } catch (e) {
    console.error('[/api/info]', e.message);
    res.status(500).json({ error: 'Gagal ambil info video. Coba lagi.' });
  }
});

// ── GET /api/clip ──
app.get('/api/clip', async (req, res) => {
  const { url, start, end } = req.query;
  const videoId = parseVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Link YouTube tidak valid' });

  const parseTime = (t) => {
    const str = String(t).trim();
    if (!str) return NaN;
    const parts = str.split(':').map(Number);
    let s = 0;
    for (const p of parts) { if (isNaN(p)) return NaN; s = s * 60 + p; }
    return s;
  };

  const startSec = parseTime(start);
  const endSec   = parseTime(end);
  if (isNaN(startSec) || isNaN(endSec) || endSec <= startSec) {
    return res.status(400).json({ error: 'Waktu start/end tidak valid' });
  }

  const ytUrl   = `https://www.youtube.com/watch?v=${videoId}`;
  const outFile = path.join(TEMP_DIR, `${videoId}-${Date.now()}.mp4`);
  const hasCookies = fs.existsSync(COOKIES_FILE);
  const cookieArg  = hasCookies ? ['--cookies', COOKIES_FILE] : [];

  try {
    console.log(`[clip] ${videoId}  ${startSec}s → ${endSec}s  cookies=${hasCookies}`);

    // 1) Download via yt-dlp
    const args = [
      '-f', 'best[height<=720]/best',
      '-o', outFile,
      '--no-playlist', '--no-warnings', '--no-overwrites',
      '--merge-output-format', 'mp4',
      ...cookieArg,
      ytUrl,
    ];

    await run(YT_DLP, args);

    if (!fs.existsSync(outFile)) throw new Error('Download gagal — file tidak ditemukan');

    // 2) Trim via ffmpeg (fast, re-mux only)
    const clipFile = path.join(TEMP_DIR, `${videoId}-clip-${Date.now()}.mp4`);
    await run(FFMPEG, [
      '-y', '-ss', String(startSec),
      '-i', outFile,
      '-t', String(endSec - startSec),
      '-c', 'copy', '-movflags', '+faststart',
      clipFile,
    ]);

    // 3) Cleanup
    fs.unlink(outFile, () => {});

    const safeTitle = `clip-${videoId}`;
    res.download(clipFile, `${safeTitle}.mp4`, (err) => {
      setTimeout(() => {
        fs.unlink(outFile, () => {});
        fs.unlink(clipFile, () => {});
      }, 120_000);
      if (err && !res.headersSent) res.status(500).json({ error: 'Gagal kirim file' });
    });
  } catch (e) {
    console.error('[/api/clip]', e.message);
    fs.unlink(outFile, () => {});
    const blocked = e.message.includes('Sign in to confirm') ||
                    e.message.includes('Login') ||
                    e.message.includes('HTTP Error 400');
    res.status(500).json({
      error: blocked
        ? 'Server ini (IP datacenter) diblokir YouTube. Jalankan di komputer lokal, atau-setup cookies YouTube.'
        : 'Gagal buat clip. Video mungkin age-restricted/private.',
    });
  }
});

// ── POST /api/setup-cookies  (save cookie file) ──
app.post('/api/setup-cookies', express.raw({ type: 'text/plain' }), (req, res) => {
  try {
    fs.writeFileSync(COOKIES_FILE, req.body.toString());
    const lines = (req.body.toString().match(/\n/g) || []).length;
    res.json({ ok: true, lines });
  } catch (e) {
    res.status(500).json({ error: 'Gagal simpan cookies' });
  }
});

// ── GET /api/health ──
app.get('/api/health', (_, res) => {
  res.json({
    status: 'ok',
    ytDlpOk: true,
    cookiesFile: fs.existsSync(COOKIES_FILE),
  });
});

// ── moment-iq: local AI engine ──
const { findBestMoments } = require('./lib/moment-iq');

// ── GET /api/auto-clip — analisa & cari momen terbaik ──
app.get('/api/auto-clip', async (req, res) => {
  const { url, length } = req.query;
  const videoId = parseVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Link YouTube tidak valid' });

  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const rawFile = path.join(TEMP_DIR, `auto-${videoId}-${Date.now()}.mp4`);
  const hasCookies = fs.existsSync(COOKIES_FILE);
  const clipLen = Math.min(90, Math.max(15, parseInt(length) || 40));

  try {
    console.log(`[auto-clip] ${videoId} len=${clipLen}s`);

    // 1) Download resolusi rendah (audio yang penting utk analisa)
    await run(YT_DLP, [
      '-f', 'b[height<=360]/b/wv',
      '-o', rawFile,
      '--no-playlist', '--no-warnings', '--no-overwrites',
      ...(['--cookies', COOKIES_FILE].filter(() => hasCookies)),
      ytUrl,
    ]);

    // 2) Analisa energi audio → momen terbaik
    const { moments, duration } = await findBestMoments(rawFile, { clipLen, topN: 5 });
    fs.unlink(rawFile, () => {});

    res.json({
      videoId,
      url: ytUrl,
      duration,
      clips: moments,
    });
  } catch (e) {
    console.error('[/api/auto-clip]', e.message);
    fs.unlink(rawFile, () => {});
    const blocked = e.message.includes('Sign in') || e.message.includes('Login') ||
                    e.message.includes('HTTP Error 400');
    res.status(500).json({
      error: blocked
        ? 'Server ini (IP datacenter) diblokir YouTube. Jalankan di komputer lokal / upload cookies.'
        : ('Gagal analisa video: ' + e.message.slice(0, 200)),
    });
  }
});

// ── GET /api/auto-export — download 1 momen jadi file clip ──
app.get('/api/auto-export', async (req, res) => {
  const { url, start, end, vertical } = req.query;
  const videoId = parseVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Link tidak valid' });

  const startSec = Math.max(0, parseFloat(start) || 0);
  const endSec = parseFloat(end) || startSec + 30;
  if (endSec <= startSec) return res.status(400).json({ error: 'end harus > start' });

  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const outFile = path.join(TEMP_DIR, `exp-${videoId}-${Date.now()}.mp4`);
  const hasCookies = fs.existsSync(COOKIES_FILE);
  const height = vertical === '1' ? '1080' : '720';

  try {
    console.log(`[auto-export] ${videoId} ${startSec}"s→${endSec}s vertical=${vertical}`);

    // 1) download
    await run(YT_DLP, [
      '-f', `bv*[height<=${height}]+ba/b[height<=${height}]/b`,
      '-o', outFile,
      '--no-playlist', '--no-warnings', '--no-overwrites',
      '--merge-output-format', 'mp4',
      ...(['--cookies', COOKIES_FILE].filter(() => hasCookies)),
      ytUrl,
    ]);

    // 2) cut — 9:16 needs reencode, landscape copy
    const cutFile = path.join(TEMP_DIR, `cut-${videoId}-${Date.now()}.mp4`);
    const ffmpegArgs = ['-y', '-ss', String(startSec), '-i', outFile,
      '-t', String(endSec - startSec)];

    if (vertical === '1') {
      ffmpegArgs.push(
        '-vf', 'crop=ih*9/16:ih,scale=720:1280,setsar=1',
        '-c:v', 'libx264', '-preset', 'faster', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
      );
    } else {
      ffmpegArgs.push('-c', 'copy');
    }
    ffmpegArgs.push('-movflags', '+faststart', cutFile);
    await run(FFMPEG, ffmpegArgs);
    fs.unlink(outFile, () => {});

    const mode = vertical === '1' ? 'vertical-9x16' : 'horizontal';
    res.download(cutFile, `clip-${videoId}-${Math.round(startSec)}s-${mode}.mp4`, (err) => {
      setTimeout(() => {
        fs.unlink(outFile, () => {});
        fs.unlink(cutFile, () => {});
      }, 120_000);
      if (err && !res.headersSent) res.status(500).json({ error: 'Gagal kirim file' });
    });
  } catch (e) {
    console.error('[/api/auto-export]', e.message);
    fs.unlink(outFile, () => {});
    res.status(500).json({
      error: e.message.includes('Sign in')
        ? 'Diblokir YouTube — IP datacenter. Jalankan lokal / upload cookies.'
        : 'Gagal export: ' + e.message.slice(0, 200),
    });
  }
});


app.listen(PORT, () => {
  console.log(`\n🎬 YouTube Clipper jalan di http://localhost:${PORT}\n`);
  console.log('   Catatan: Jika YouTube blokir download, cek bagian SETUP COOKIES di README.\n');
});
