'use strict';
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium';
const OUT_FILE = path.resolve(__dirname, 'cookies.txt');

(async () => {
  console.log('🔐 Membuka YouTube di browser (login jika perlu)…');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // Buka YouTube & tunggu user login
  await page.goto('https://www.youtube.com/', { waitUntil: 'networkidle2', timeout: 30_000 });
  console.log('⏳ Biarkan browser terbuka…');
  await new Promise(r => setTimeout(r, 8000));

  // Cek apakah sudah login
  const isLoggedIn = await page.evaluate(() => {
    const avatar = document.querySelector('#avatar-btn') ||
                   document.querySelector('yt-icon-button.ytd-topbar-menu-button-renderer') ||
                   document.querySelector('button#avatar');
    return !!avatar;
  });

  console.log(isLoggedIn ? '✅ Login detected' : '⚠️  Belum login — login dulu di browser!');

  // Jika belum login, tunggu input user
  if (!isLoggedIn) {
    console.log('🔗 Buka: https://www.youtube.com');
    console.log('⏳ Menunggu 20 detik untuk login manual…');
    await new Promise(r => setTimeout(r, 20000));
  }

  const cookies = await page.cookies([
    'https://www.youtube.com',
    'https://www.google.com',
  ]);
  await browser.close();

  if (!cookies.length) {
    console.error('❌ Cookies kosong');
    process.exit(1);
  }

  // Format Netscape
  const lines = ['# Netscape HTTP Cookie File\n\n'];
  for (const c of cookies) {
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const exp = c.expires > 0 ? Math.floor(c.expires) : 9999999999;
    lines.push(`${c.domain}\t${c.domain.startsWith('.') ? 'TRUE' : 'FALSE'}\t${c.path || '/'}\t${secure}\t${exp}\t${c.name}\t${c.value}\n`);
  }

  fs.writeFileSync(OUT_FILE, lines.join(''));
  console.log(`\n✅ ${cookies.length} cookies → ${OUT_FILE}`);
  console.log('   Jalankan ulang:  node server.js');
})().catch(e => {
  console.error('ERR:', e.message);
  process.exit(1);
});
