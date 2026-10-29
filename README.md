# YouTube Clipper

Potong & unduh segmen video YouTube tanpa software tambahan.

## Fitur
- 🎬 Masukkan link YouTube, preview inline dengan iframe player
- ✂️ Tentukan rentang mulai–selesai via slider atau langsung dari player
- ⬇️ Unduh video sudah terpotong (MP4, 720p max)
- ⌨️ Shortcut keyboard: **I** = mark mulai, **O** = mark selesai
- 🔧 Support cookies untuk video age-restricted/private

## Install & Jalankan

```bash
cd youtube-clipper
npm install
npm start
# Buka http://localhost:3001
```

## Setup Cookies (Penting!)

YouTube memblokir server berbasis IP datacenter. Jika download gagal,
aktifkan cookies YouTube:

### Cara 1: Browser Extension (Recommended)
1. Install ekstensi **EditThisCookie** atau **Cookie-Editor**
2. Buka youtube.com, login (jika perlu)
3. Eksport cookies → simpan ke file `cookies.txt` di folder `youtube-clipper/`
4. Format cookies.txt: `Netscape HTTP Cookie File` (format yt-dlp)

### Cara 2: Via curl (Chrome DevTools)
1. Buka youtube.com di browser → DevTools → Application → Cookies
2. Copy semua cookie satu-per-satu ke format Netscape:
   ```
   .youtube.com  TRUE  /  FALSE  9999999999  LOGIN  1
   .youtube.com  TRUE  /  FALSE  9999999999  SID  <token>
   ...
   ```
3. Simpan ke `cookies.txt`

### Cara 3: CLI Setup Script
```bash
# Jalankan sekali, akan buka browser dan export cookies
node setup-cookies.js
```

## Troubleshooting

### "Sign in to confirm you're not a bot"
- IP server diblokir YouTube → gunakan cookies (langkah di atas)
- Atau jalankan aplikasi di komputer lokal (bukan cloud/VM)

### "HTTP Error 400"
- Sama dengan di atas, perlu cookies

### Error lainnya
```bash
yt-dlp --version          # harus 2024.x atau lebih baru
ffmpeg -version           # harus terinstall
node -c server.js         # cek syntax
```

## Struktur Project

```
youtube-clipper/
├── server.js          # Backend (Express)
├── lib/
│   └── yt-browser.js  # Chromium-based extraction (opsional)
├── public/
│   ├── index.html     # UI
│   ├── style.css
│   └── app.js         # Frontend logic
├── cookies.txt        # (opsional) YouTube cookies
├── setup-cookies.js   # Setup script
└── temp/              # File sementara (auto-cleanup)
```
