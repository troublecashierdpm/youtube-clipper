'use strict';

const express = require('express');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// ── Resolve binari: yt-dlp & ffmpeg bisa beda lokasi antar OS / Python setup ──
function findBinary(name) {
  const isWin = process.platform === 'win32';
  const ext = isWin ? '.exe' : '';
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
  ];
  const HOME = process.env.HOME || process.env.USERPROFILE || '';
  const winWinget = process.env.localappdata
    ? path.join(process.env.localappdata, 'Microsoft', 'WinGet', 'Links') : '';
  const winPy = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Python', 'Scripts') : '';
  dirs.push(
    HOME && path.join(HOME, '.local', 'bin'),
    HOME && path.join(HOME, '.local', 'pipx', 'bin'),
    HOME && path.join(HOME, 'bin'),
    winPy, winWinget,
    '/usr/local/bin', '/usr/bin', '/snap/bin', '/opt/homebrew/bin',
    '/usr/local/sbin', '/sbin', '/bin',
  );

  for (const dir of dirs.filter(Boolean)) {
    const full = path.join(dir, name + ext);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

const YTDLP_FOUND = findBinary('yt-dlp');
const FFMPEG_FOUND = findBinary('ffmpeg');
const YT_DLP = YTDLP_FOUND || 'yt-dlp';
const FFMPEG = FFMPEG_FOUND || 'ffmpeg';

function missingMsg(name) {
  return name === 'yt-dlp'
    ? '❌ yt-dlp tidak ditemukan.\nInstall:\n  pip install -U yt-dlp\n  pipx install yt-dlp\n  winget install yt-dlp.yt-dlp (Windows)\n  brew install yt-dlp (macOS)\n  sudo apt install yt-dlp (Debian/Ubuntu)'
    : '❌ ffmpeg tidak ditemukan.\nInstall:\n  sudo apt install -y ffmpeg (Debian/Ubuntu)\n  apk add ffmpeg (Alpine)\n  brew install ffmpeg (macOS)\n  winget install ffmpeg (Windows)';
}

console.log(`🔧 yt-dlp  → ${YTDLP_FOUND || '❌ TIDAK KETEMU'}`);
console.log(`🔧 ffmpeg  → ${FFMPEG_FOUND || '❌ TIDAK KETEMU'}`);
if (!YTDLP_FOUND) console.log(missingMsg('yt-dlp'));
if (!FFMPEG_FOUND) console.log(missingMsg('ffmpeg'));

const app = express();
const PORT = process.env.PORT || 3001;
const TEMP_DIR = path.resolve(__dirname, 'temp');
const COOKIES_FILE = path.resolve(__dirname, 'cookies.txt');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serve temp/ dgn Range support → <video> bisa seek
app.use('/temp', express.static(TEMP_DIR));

// ── Jalanin command, stderr ditampilkan LIVE di terminal ──
// opts.onLine(chunk) — callback utk update progress job
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    console.log(`▶️  [proc] ${path.basename(cmd)} ${args.filter(a => !a.includes('cookies')).join(' ').slice(0, 160)}`);
    const p = spawn(cmd, args);
    let acc = '';
    let buf = '';
    const onData = (d) => {
      acc += d;
      if (acc.length > 60_000) acc = acc.slice(-30_000);
      process.stdout.write(d); // live — penting untuk diagnose 'stuck'
      if (opts.onLine) {
        buf += d;
        const lines = buf.split(/[\r\n]+/);
        buf = lines.pop();
        for (const line of lines) if (line.trim()) opts.onLine(line.trim());
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => {
      if (e.code === 'ENOENT') reject(new Error(missingMsg(path.basename(cmd, '.exe'))));
      else reject(new Error(e.message));
    });
    p.on('close', (code) => {
      if (code === 0) resolve(acc);
      else {
        const tail = acc.trim().split(/[\r\n]+/).filter(Boolean).slice(-3).join(' | ').slice(0, 400);
        reject(new Error(`exit ${code}: ${tail}`));
      }
    });
  });
}

// ── Cari file hasil yt-dlp (template pakai %(ext)s) ──
function pickOutput(base) {
  const files = fs.readdirSync(TEMP_DIR)
    .filter(f => f.startsWith(base) && !f.endsWith('.part') && !f.match(/\.f\d+\./) && !f.endsWith('.tmp'));
  if (!files.length) return null;
  files.sort();
  return path.join(TEMP_DIR, files[0]);
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

function parseTime(t) {
  const str = String(t).trim();
  if (!str) return NaN;
  if (/^\d+(\.\d+)?$/.test(str)) return Number(str);
  const parts = str.split(':').map(Number);
  let s = 0;
  for (const p of parts) { if (isNaN(p)) return NaN; s = s * 60 + p; }
  return s;
}

// detik → "HH:MM:SS" utk --download-sections
function toHHMMSS(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map(n => String(n).padStart(2, '0')).join(':');
}

function cleanErr(msg) {
  return String(msg).trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 220);
}

function checkTools() {
  const missing = [];
  if (!YTDLP_FOUND) missing.push('yt-dlp');
  if (!FFMPEG_FOUND) missing.push('ffmpeg');
  return missing.length ? missingMsg(missing[0]) : null;
}

// helper: https GET
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

// ── Bersihkan temp: file > 15 menit dibuang, setiap 5 menit ──
setInterval(() => {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(TEMP_DIR)) {
      const full = path.join(TEMP_DIR, f);
      const st = fs.statSync(full);
      if (now - st.mtimeMs > 15 * 60_000) fs.unlink(full, () => {});
    }
  } catch (_) {}
}, 5 * 60_000);

// ═══════════════ ENDPOINT ═══════════════

// ── GET /api/info — metadata (oEmbed; tanpa streaming) ──
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  const videoId = parseVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Link YouTube tidak valid' });

  try {
    const raw = await httpsGet(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { 'User-Agent': 'Mozilla/5.0 (compatible)' }
    );
    const oembed = JSON.parse(raw);
    res.json({
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: oembed.title || 'Tanpa Judul',
      channel: oembed.author_name || 'Unknown',
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    });
  } catch (e) {
    console.error('[/api/info]', e.message);
    res.status(500).json({ error: 'Gagal ambil info video. Coba lagi.' });
  }
});

// ── GET /api/clip — clip manual, download-sections ──
app.get('/api/clip', async (req, res) => {
  const { url, start, end } = req.query;
  const videoId = parseVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Link YouTube tidak valid' });

  const toolErr = checkTools();
  if (toolErr) return res.status(500).json({ error: toolErr });

  const startSec = parseTime(start);
  const endSec = parseTime(end);
  if (isNaN(startSec) || isNaN(endSec) || endSec <= startSec) {
    return res.status(400).json({ error: 'Waktu start/end tidak valid' });
  }

  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const base = `${videoId}-sec-${Date.now()}`;
  const cookies = fs.existsSync(COOKIES_FILE) ? ['--cookies', COOKIES_FILE] : [];

  try {
    console.log(`[clip] ${videoId} ${startSec}s → ${endSec}s`);
    await run(YT_DLP, [
      '-f', 'bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/b[height<=720]/b',
      '-o', path.join(TEMP_DIR, `${base}.%(ext)s`),
      '--download-sections', `*${toHHMMSS(startSec)}-${toHHMMSS(endSec)}`,
      '--force-keyframes-at-cuts',
      '--no-playlist', '--no-warnings', '--no-overwrites',
      ...cookies,
      ytUrl,
    ]);

    const seg = pickOutput(base);
    if (!seg) throw new Error('Segmen tidak terunduh');

    // mux ringan → faststart
    const finalF = `${base}-final.mp4`;
    await run(FFMPEG, ['-y', '-i', seg, '-c', 'copy', '-movflags', '+faststart',
      path.join(TEMP_DIR, finalF)]);
    fs.unlink(seg, () => {});

    res.download(path.join(TEMP_DIR, finalF), `clip-${videoId}-${Math.round(startSec)}s.mp4`, () => {
      setTimeout(() => fs.unlink(path.join(TEMP_DIR, finalF), () => {}), 15 * 60_000);
    });
  } catch (e) {
    console.error('[/api/clip]', cleanErr(e.message));
    res.status(500).json({
      error: e.message.includes('Sign in')
        ? 'YouTube blokir download (butuh cookies). Upload cookies.txt di bawah.'
        : 'Gagal buat clip: ' + cleanErr(e.message),
    });
  }
});

// ── AUTO ──
const { findBestMoments, downsampleCurve } = require('./lib/moment-iq');

// antrean thumbnail — biar 5 kartu tidak spawn yt-dlp serentak
let thumbChain = Promise.resolve();
function withThumbLock(fn) {
  const next = thumbChain.then(fn, fn);
  thumbChain = next.catch(() => {});
  return next;
}

// ── GET /api/auto-clip — analisa & ranking momen ──
app.get('/api/auto-clip', async (req, res) => {
  const { url, length } = req.query;
  const videoId = parseVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Link YouTube tidak valid' });

  const toolErr = checkTools();
  if (toolErr) return res.status(500).json({ error: toolErr });

  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const base = `au-${videoId}-${Date.now()}`;
  const cookies = fs.existsSync(COOKIES_FILE) ? ['--cookies', COOKIES_FILE] : [];
  const clipLen = Math.min(90, Math.max(15, parseInt(length) || 40));

  try {
    console.log(`[auto-clip] ${videoId} len=${clipLen}s`);
    await run(YT_DLP, [
      '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '-o', path.join(TEMP_DIR, `${base}.%(ext)s`),
      '--no-playlist', '--no-warnings', '--no-overwrites',
      ...cookies,
      ytUrl,
    ]);

    const audioFile = pickOutput(base);
    if (!audioFile) throw new Error('Audio tidak terunduh');

    const { moments, duration, energy } = await findBestMoments(audioFile, { clipLen, topN: 5 });
    fs.unlink(audioFile, () => {});

    const curve = downsampleCurve(energy, 700);
    res.json({ videoId, url: ytUrl, duration, clips: moments, energy: curve });
  } catch (e) {
    console.error('[/api/auto-clip]', cleanErr(e.message));
    res.status(500).json({
      error: e.message.includes('Sign in')
        ? 'YouTube blokir (butuh cookies).'
        : 'Gagal analisa: ' + cleanErr(e.message),
    });
  }
});

// ── JOB EXPORT: klik → job di background → UI polling status+percent ──
const jobs = new Map(); // id → { status, stage, percent, error, file, progressLabel }

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (job) Object.assign(job, patch);
}

// parseLine: update job dari output yt-dlp
function makeMonitor(id) {
  return (line) => {
    const pct = line.match(/\[download\]\s+(\d{1,3}(?:\.\d)?)%/);
    if (pct) {
      updateJob(id, { stage: 'download', percent: Math.round(parseFloat(pct[1])) });
      return;
    }
    if (line.startsWith('frame=')) {
      const t = line.match(/time=(\d{2}:\d{2}:\d{2})/);
      const fps = line.match(/fps=\s*(\d+\.\d)/);
      updateJob(id, {
        stage: 'process',
        label: `Memotong/menggabung (ffmpeg)… ${t ? t[1] : ''} @${fps ? fps[1] : '?'}fps`,
      });
      return;
    }
    if (line.includes('[Merger]') || line.includes('Merging formats')) {
      updateJob(id, { stage: 'merge', label: 'Menggabung video + audio…' });
    } else if (line.includes('[FixupM') || line.includes('Correcting container')) {
      updateJob(id, { stage: 'fixup', label: 'Merapikan kontainer…' });
    }
  };
}

// Jalankan export di background; update job.errors kalau gagal
function startExportJob(id, { videoId, startSec, endSec, isVertical }) {
  (async () => {
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const cookies = fs.existsSync(COOKIES_FILE) ? ['--cookies', COOKIES_FILE] : [];
    const height = isVertical ? '1080' : '720';
    const base = `ex-${videoId}-${Date.now()}`;
    const finalName = `clip-${videoId}-${Math.round(startSec)}s-${isVertical ? 'vertical' : 'horizontal'}.mp4`;
    const monitor = makeMonitor(id);

    updateJob(id, { stage: 'resolve', label: 'Mengambil info video…' });

    // ── PENTING: hanya ambil H.264 (avc1) + AAC — kontainernya match
    //    → tanpa re-encode saat merge (AV1+Opus memaksa transcode VP9 2fps = 25 menit!)
    const dlArgs = [
      '-f', `bv*[vcodec^=avc1][height<=${height}]+ba[acodec^=mp4a]/b[height<=${height}][vcodec^=avc1]/bv*[height<=${height}]+ba/b[height<=${height}]/b`,
      '-o', path.join(TEMP_DIR, `${base}.%(ext)s`),
      '--download-sections', `*${toHHMMSS(startSec)}-${toHHMMSS(endSec)}`,
      '--force-keyframes-at-cuts',
      '--merge-output-format', 'mp4',
      '--newline', '--no-playlist', '--no-warnings', '--no-overwrites',
      '-N', '4',
      ...cookies,
      ytUrl,
    ];
    updateJob(id, { stage: 'download', label: 'Mengunduh segmen (H.264, tanpa transcode)…', percent: 0 });
    let seg;
    try {
      await run(YT_DLP, dlArgs, { onLine: monitor });
      seg = pickOutput(base);
    } catch (eSeg) {
      if (String(eSeg.message).includes('ENOENT')) throw eSeg;
      console.error('[job]', 'download-sections gagal, fallback full download:', cleanErr(eSeg.message));
      // Fallback: best pre-merged 360p (h264+aac, cepat, tanpa merge) → cut manual
      updateJob(id, { stage: 'download', label: 'Mengunduh 360p utuh (fallback)…', percent: 0 });
      await run(YT_DLP, [
        '-f', 'best[height<=360]/best',
        '-o', path.join(TEMP_DIR, `${base}.%(ext)s`),
        '--newline', '--no-playlist', '--no-warnings', '--no-overwrites',
        ...cookies,
        ytUrl,
      ], { onLine: monitor });
      seg = pickOutput(base);
    }
    if (!seg) throw new Error('Segmen tidak terunduh');

    // Kalau hasil belo bukan mp4 (contoh webm), mux ke mp4? — libx264 pada final dinyala hanya bila vertical.
    const isMp4 = seg.toLowerCase().endsWith('.mp4');

    // ── 2) final: 9:16 → re-encode; landscape → copy (h264+mp4 → copy instan)
    updateJob(id, { stage: 'process', percent: 100, label: isVertical ? 'Encoding vertikal 9:16…' : 'Mux final…' });
    const finalArgs = ['-y'];
    if (isVertical) {
      finalArgs.push(
        '-i', seg,
        '-vf', 'crop=ih*9/16:ih,scale=720:1280,setsar=1',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
      );
    } else if (!isMp4) {
      // hasil per-muxed webm (jarang — fallback chain) → re-encode murah 480p
      finalArgs.push(
        '-i', seg,
        '-vf', 'scale=-2:480',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
        '-c:a', 'aac', '-b:a', '128k',
      );
    } else {
      finalArgs.push('-i', seg, '-c', 'copy');
    }
    finalArgs.push('-movflags', '+faststart', path.join(TEMP_DIR, finalName));
    await run(FFMPEG, finalArgs, { onLine: monitor });
    fs.unlink(seg, () => {});

    updateJob(id, { status: 'done', stage: 'ready', percent: 100, file: finalName, label: 'Siap disimpan!' });
  })().catch(e => {
    console.error('[job]', id, cleanErr(e.message));
    updateJob(id, {
      status: 'error',
      stage: 'error',
      error: e.message.includes('Sign in')
        ? 'YouTube blokir download (butuh cookies).'
        : cleanErr(e.message),
    });
  });
}

// POST /api/export-start — mulai job
app.post('/api/export-start', express.json(), (req, res) => {
  const { url, start, end, vertical } = req.body || {};
  const videoId = parseVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Link tidak valid' });
  const toolErr = checkTools();
  if (toolErr) return res.status(500).json({ error: toolErr });

  const startSec = Math.max(0, parseTime(start) || 0);
  const endSec = parseTime(end) || startSec + 30;
  if (endSec <= startSec) return res.status(400).json({ error: 'end harus > start' });

  const id = crypto.randomUUID().slice(0, 8);
  jobs.set(id, { status: 'running', stage: 'init', percent: 0, label: 'Inisialisasi…' });
  startExportJob(id, { videoId, startSec, endSec, isVertical: vertical === true || vertical === '1' });

  res.json({ ok: true, id });
});

// GET /api/export-status/:id
app.get('/api/export-status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job tidak ditemukan' });
  res.json(job);
});

// GET /api/auto-export — sekarang hanya penanda status job (dipakai UI polling)
app.get('/api/auto-export', (req, res) => {
  return res.status(410).json({ error: 'Gunakan /api/export-start + /api/export-status/:id' });
});


// ── GET /api/thumb — frame JPG di titik start (utk kartu momen) ──
app.get('/api/thumb', async (req, res) => {
  const { url, start } = req.query;
  const videoId = parseVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Link tidak valid' });
  if (!FFMPEG_FOUND) return res.status(500).json({ error: 'ffmpeg belum terinstall' });

  const startSec = Math.max(0, parseTime(start) || 0);
  const cookies = fs.existsSync(COOKIES_FILE) ? ['--cookies', COOKIES_FILE] : [];

  // serial via lock
  const file = await withThumbLock(async () => {
    const f = path.join(TEMP_DIR, `th-${videoId}-${Math.floor(startSec)}.jpg`);
    if (fs.existsSync(f)) return f;               // cache per-detik
    console.log(`[thumb] ${videoId} @${startSec}s`);
    const base = `th-${videoId}-${Date.now()}`;
    try {
      await run(YT_DLP, [
        '-f', 'bv*[height<=480]/b[height<=480]/b',
        '-o', path.join(TEMP_DIR, `${base}.%(ext)s`),
        '--download-sections', `*${toHHMMSS(startSec)}-${toHHMMSS(startSec + 2)}`,
        '--no-playlist', '--no-warnings', '--no-overwrites',
        ...cookies,
        `https://www.youtube.com/watch?v=${videoId}`,
      ]);
      const seg = pickOutput(base);
      if (!seg) throw new Error('seg tidak ada');
      await run(FFMPEG, ['-y', '-ss', '1', '-i', seg,
        '-vframes', '1', '-q:v', '5', f]);
      fs.unlink(seg, () => {});
    } catch (e) {
      console.error('[/api/thumb]', cleanErr(e.message));
      throw e;
    }
    return f;
  }).catch(() => null);

  if (!file || !fs.existsSync(file)) {
    return res.status(500).json({ error: 'Gagal ambil thumbnail' });
  }
  res.sendFile(file);
});

// ── GET /api/preview — siapkan video preview kecil utk ditampilkan di web ──
app.get('/api/preview', async (req, res) => {
  const { url, start, end } = req.query;
  const videoId = parseVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Link tidak valid' });

  const toolErr = checkTools();
  if (toolErr) return res.status(500).json({ error: toolErr });

  const startSec = Math.max(0, parseTime(start) || 0);
  const endSec = parseTime(end) || startSec + 30;
  if (endSec <= startSec) return res.status(400).json({ error: 'end harus > start' });

  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const base = `pv-${videoId}-${Date.now()}`;
  const cookies = fs.existsSync(COOKIES_FILE) ? ['--cookies', COOKIES_FILE] : [];

  try {
    console.log(`[preview] ${videoId} ${startSec}s→${endSec}s`);
    // 360p cukup untuk preview → cepet
    await run(YT_DLP, [
      '-f', 'bv*[vcodec^=avc1][height<=360]+ba[acodec^=mp4a]/b[height<=360]/b',
      '-o', path.join(TEMP_DIR, `${base}.%(ext)s`),
      '--download-sections', `*${toHHMMSS(startSec)}-${toHHMMSS(endSec)}`,
      '--force-keyframes-at-cuts',
      '--no-playlist', '--no-warnings', '--no-overwrites',
      ...cookies,
      ytUrl,
    ]);
    const seg = pickOutput(base);
    if (!seg) throw new Error('Segmen preview tidak terunduh');

    const finalName = `${base}-preview.mp4`;
    await run(FFMPEG, ['-y', '-i', seg, '-c', 'copy', '-movflags', '+faststart',
      path.join(TEMP_DIR, finalName)]);
    fs.unlink(seg, () => {});

    console.log(`[preview] siap: /temp/${finalName}`);
    res.json({ ok: true, file: `/temp/${finalName}` });
  } catch (e) {
    console.error('[/api/preview]', cleanErr(e.message));
    res.status(500).json({
      error: e.message.includes('Sign in')
        ? 'YouTube blokir download (butuh cookies).'
        : 'Gagal buat preview: ' + cleanErr(e.message),
    });
  }
});

// ── cookies ──
app.post('/api/setup-cookies', express.raw({ type: 'text/plain' }), (req, res) => {
  try {
    fs.writeFileSync(COOKIES_FILE, req.body.toString());
    res.json({ ok: true, lines: (req.body.toString().match(/\n/g) || []).length });
  } catch (e) {
    res.status(500).json({ error: 'Gagal simpan cookies' });
  }
});

app.get('/api/health', (_, res) => {
  res.json({
    status: 'ok',
    ytDlpOk: !!YTDLP_FOUND,
    ffmpegOk: !!FFMPEG_FOUND,
    cookiesFile: fs.existsSync(COOKIES_FILE),
  });
});

app.listen(PORT, () => {
  console.log(`\n🎬 YouTube Clipper → http://localhost:${PORT}\n`);
});
