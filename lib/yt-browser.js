/**
 * yt-browser.js — Chromium-based YouTube metadata & stream extraction
 * Bypass bot-check dengan real browser + CDP
 */
'use strict';

const puppeteer = require('puppeteer');

const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium';
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR || '/tmp/clipper-chrome';

/**
 * Fetch video info via Chromium (bypass bot check).
 * Returns { videoId, title, channel, duration, thumbnail, streamUrl }
 */
async function fetchVideoInfo(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        `--user-data-dir=${PROFILE_DIR}`,
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 720 });

    // Intercept network utk player response & streaming URLs
    let playerResponse = null;
    let streamUrls = [];
    page.on('response', async (res) => {
      const reqUrl = res.request().url();
      if (reqUrl.includes('youtubei/v1/player') && res.status() === 200) {
        try {
          const json = await res.json();
          if (json?.playabilityStatus?.status === 'OK' && json?.streamingData) {
            playerResponse = json;
            const urls = [];
            if (json.streamingData.formats) urls.push(...json.streamingData.formats);
            if (json.streamingData.adaptiveFormats) urls.push(...json.streamingData.adaptiveFormats);
            streamUrls = urls.filter((f) => f.url || f.signatureCipher);
          }
        } catch (_) {}
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('video', { timeout: 15_000 }).catch(() => {});

    // Try to extract data via page.evaluate
    const data = await page.evaluate(() => {
      const pr = window.ytInitialPlayerResponse || {};
      const vd = pr.videoDetails || {};
      const md = pr.microformat?.playerMicroformatRenderer || {};
      return {
        status: pr.playabilityStatus?.status,
        reason: pr.playabilityStatus?.reason,
        videoId: vd.videoId,
        title: vd.title,
        channel: vd.author,
        durationSec: parseInt(vd.lengthSeconds || '0', 10),
        thumbnail:
          (pr.videoDetails?.thumbnail?.thumbnails || []).slice(-1)[0]?.url ||
          md.thumbnail?.thumbnails?.slice(-1)[0]?.url ||
          '',
        keywords: vd.keywords || [],
        viewCount: vd.viewCount,
      };
    });

    // Kalau page.evaluate gagal (blocked), pakai hasil intercept
    if (!data.durationSec && playerResponse) {
      const vd = playerResponse.videoDetails || {};
      data.title = data.title || vd.title;
      data.channel = data.channel || vd.author;
      data.durationSec = data.durationSec || parseInt(vd.lengthSeconds || '0', 10);
    }

    data.url = url;
    data.videoId = videoId;
    data.streamUrls = streamUrls;
    data.blocked = data.status === 'LOGIN_REQUIRED';

    return data;
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}

module.exports = { fetchVideoInfo };

// CLI test
if (require.main === module) {
  const videoId = process.argv[2];
  if (!videoId) {
    console.error('Usage: node yt-browser.js <videoId>');
    process.exit(1);
  }
  fetchVideoInfo(videoId)
    .then((d) => {
      console.log(JSON.stringify({
        videoId: d.videoId,
        title: d.title,
        channel: d.channel,
        durationSec: d.durationSec,
        thumbnail: d.thumbnail?.slice(0, 80),
        blocked: d.blocked,
        streamCount: d.streamUrls.length,
        reason: d.reason,
      }, null, 2));
    })
    .catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
