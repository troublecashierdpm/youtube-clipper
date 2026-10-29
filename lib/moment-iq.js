/**
 * moment-iq.js — Local AI engine: analisa audio energy curve per detik,
 * deteksi puncak "moment" (hook/hype/penekanan), pilih & score segmen terbaik.
 *
 * Metode: energy-based peak detection (dipakai tools auto-clipper klasik).
 * Futur enhancement: ranking via LLM kalau ada OPENAI_API_KEY / GEMINI_API_KEY.
 */
'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ffmpeg bisa beda lokasi antar OS → scan PATH + lokasi umum, fallback 'ffmpeg'
function findFfmpeg() {
  const isWin = process.platform === 'win32';
  const ext = isWin ? '.exe' : '';
  const HOME = process.env.HOME || process.env.USERPROFILE || '';
  const winLinks = process.env.localappdata
    ? path.join(process.env.localappdata, 'Microsoft', 'WinGet', 'Links') : '';
  const cands = [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
    HOME && path.join(HOME, 'bin'),
    winLinks,
    '/usr/local/bin', '/usr/bin', '/snap/bin', '/opt/homebrew/bin',
  ].filter(Boolean);
  for (const dir of cands) {
    const full = path.join(dir, 'ffmpeg' + ext);
    if (fs.existsSync(full)) return full;
  }
  return 'ffmpeg';
}

const FFMPEG = findFfmpeg();

/** Jalankan ffmpeg, return {stdout,stderr} */
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, stderr });
        if (err.code === 'ENOENT') {
          reject(new Error('ffmpeg tidak terinstall di server/app ini.\n' +
            'Install:\n' +
            '  sudo apt install -y ffmpeg    (Debian/Ubuntu)\n' +
            '  apk add ffmpeg                (Alpine)\n' +
            '  brew install ffmpeg           (macOS)\n' +
            '  winget install ffmpeg         (Windows)'));
        } else {
          reject(new Error(stderr?.slice(-2000) || err.message));
        }
      });
  });
}

/**
 * Analisa energi audio per-detik dari sebuah file.
 * Return Float32Array — nilai 0..1, indeks = detik.
 * Metode: decode ke PCM mono, RMS per detik (presisi & cepat).
 */
async function analyzeEnergy(file) {
  // decode audio → raw float32 mono
  const raw = path.join(os.tmpdir(), `miq-${Date.now()}.pcm`);
  await runFfmpeg([
    '-y', '-i', file,
    '-ac', '1', '-ar', '16000',
    '-f', 'f32le', raw,
  ]);

  const buf = fs.readFileSync(raw);
  fs.unlink(raw, () => {});
  const samples = buf.length / 4;
  if (samples < 16_000) throw new Error('Gagal analisa audio (terlalu sedikit)');

  const RATE = 16_000;
  const duration = Math.floor(samples / RATE);
  const energy = new Float32Array(duration);

  // RMS per detik
  for (let s = 0; s < duration; s++) {
    const offset = s * RATE;
    let sumSq = 0;
    for (let i = 0; i < RATE; i++) {
      const f = buf.readFloatLE((offset + i) * 4);
      sumSq += f * f;
    }
    energy[s] = Math.sqrt(sumSq / RATE);
  }

  // normalisasi 0..1 (dB scale: 0 → sangat senyap, 1 → keras)
  let max = 0;
  for (let s = 0; s < duration; s++) if (energy[s] > max) max = energy[s];
  if (max > 0) {
    for (let s = 0; s < duration; s++) {
      energy[s] /= max;
    }
  }
  return { energy, duration };
}


/**
 * Pilih N segmen terbaik: window bergerak, score = rata2 energy + bonus puncak + bonus posisi awal.
 */
function pickTopMoments(energy, duration, { clipLen = 40, topN = 5, minOverlap = 8 } = {}) {
  if (duration <= clipLen) return [{ start: 0, end: duration, score: 5.0 }];

  const scores = [];
  for (let s = 0; s + clipLen <= duration; s += 1) {
    // rata-rata energi window
    let sum = 0, peak = 0, variance = 0, prev = -1;
    for (let i = s; i < s + clipLen; i++) {
      const e = energy[i];
      sum += e;
      if (e > peak) peak = e;
      if (prev >= 0) variance += Math.abs(e - prev); // "dynamic" = bagus di shortform
      prev = e;
    }
    const avg = sum / clipLen;
    const dyn = variance / clipLen;
    const posBonus = Math.exp(-s / 45) * 0.9; // menit pertama sering paling menarik
    const score = avg * 5.5 + peak * 2.2 + dyn * 1.6 + posBonus;
    scores.push({ start: s, score });
  }

  // Sort desc, ambil non-overlapping
  scores.sort((a, b) => b.score - a.score);
  const maxScore = scores[0]?.score || 1;
  const picked = [];
  for (const cand of scores) {
    if (picked.every(p => Math.abs(p.start - cand.start) >= clipLen - minOverlap)) {
      picked.push(cand);
    }
    if (picked.length >= topN) break;
  }

  return picked
    .map(p => ({
      start: p.start,
      end: p.start + clipLen,
      score: Math.min(9.9, Math.round((p.score / maxScore) * 9.9 * 10) / 10),
      reason: describe(p.score, energy, p.start, clipLen),
    }))
    .sort((a, b) => b.start - a.start); // tampil kronologis di UI pertama
}

function describe(score, energy, start, clipLen) {
  if (score > 7) return ' energi tinggi & konsisten — momentum kuat';
  if (score > 5) return ' momentum bagus di tengah jalan';
  if (score > 3) return ' cukup hidup, ada spike audio';
  return ' audio datar — momen reflektif';
}

/**
 * Wrapper utama: file mp4 → list momen terbaik scored.
 */
async function findBestMoments(file, opts = {}) {
  const { energy, duration } = await analyzeEnergy(file);
  const moments = pickTopMoments(energy, duration, opts);
  return { moments, duration };
}

module.exports = { findBestMoments, analyzeEnergy, pickTopMoments };
