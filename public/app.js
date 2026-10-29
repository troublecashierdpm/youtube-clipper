/* ===== YouTube Clipper — Frontend Logic ===== */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const urlInput     = $('urlInput');
  const fetchBtn     = $('fetchBtn');
  const inputError   = $('inputError');
  const videoSection = $('videoSection');
  const thumbEl      = $('thumb');
  const titleEl      = $('title');
  const channelEl    = $('channel');
  const ytPlayer     = $('ytPlayer');
  const startRange   = $('startRange');
  const endRange     = $('endRange');
  const startDisplay = $('startDisplay');
  const endDisplay   = $('endDisplay');
  const clipLabel    = $('clipLabel');
  const markStartBtn = $('markStart');
  const markEndBtn   = $('markEnd');
  const clipBtn      = $('clipBtn');
  const progressWrap = $('progressWrap');
  const progressText = $('progressText');
  const clipError    = $('clipError');
  const cookieInput  = $('cookieInput');
  const cookieBtn    = $('cookieBtn');
  const cookieStatus = $('cookieStatus');

  let videoId  = null;
  let duration = 0;
  let ytPlayerObj = null;

  // ── Format time ──
  const fmt = (s) => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`
      : `${m}:${String(r).padStart(2,'0')}`;
  };

  const showErr = (el, msg) => {
    el.textContent = msg; el.classList.remove('hidden');
  };
  const hideErr = (el) => {
    el.textContent = ''; el.classList.add('hidden');
  };

  const updateLabels = () => {
    const s = (parseFloat(startRange.value) / 100) * duration;
    const e = (parseFloat(endRange.value) / 100) * duration;
    startDisplay.textContent = fmt(s);
    endDisplay.textContent   = fmt(e);
    const len = e - s;
    clipLabel.textContent = `Durasi clip: ${fmt(s)} – ${fmt(e)}  (${fmt(len)})`;
    if (ytPlayerObj && ytPlayerObj.getCurrentTime) {
      try {
        const t = ytPlayerObj.getCurrentTime();
        if (t > 0) {
          document.getElementById('clipLabel').style.opacity = (Math.abs(t-s) < 2 || Math.abs(t-e) < 2) ? '1' : '0.7';
        }
      } catch (_) {}
    }
  };

  // ── Load YT IFrame API ──
  let apiReady = false;
  const onYT = window.onYouTubeIframeAPIReady;
  if (typeof onYT === 'function') onYT();
  window.onYouTubeIframeAPIReady = () => { apiReady = true; initPlayer(); };

  if (!document.getElementById('ytapi')) {
    const s = document.createElement('script');
    s.id = 'ytapi';
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }

  function initPlayer() {
    if (!videoId || !apiReady) return;
    if (ytPlayerObj) {
      ytPlayerObj.destroy();
      ytPlayerObj = null;
    }
    ytPlayerObj = new YT.Player(ytPlayer, {
      videoId,
      playerVars: {
        autoplay: 0,
        modestbranding: 1,
        rel: 0,
        fs: 0,
      },
      events: {
        onStateChange(e) {
          if (e.data === YT.PlayerState.PLAYING) {
            // sync range to player time periodically
          }
        }
      }
    });
  }

  // ── Fetch Info ──
  fetchBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    hideErr(inputError);
    if (!url) return showErr(inputError, 'Tempel link YouTube-nya dulu.');

    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Memuat…';

    try {
      const r = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Gagal');

      videoId = d.videoId;
      duration = d.duration || 0;

      thumbEl.src = d.thumbnail;
      titleEl.textContent = d.title;
      channelEl.textContent = d.channel;

      if (d.duration) {
        duration = d.duration;
      } else {
        // fetch dari YouTube Data API fallback
        const apiR = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
        const apiD = await apiR.json();
        if (apiD.html) {
          const m = apiD.html.match(/duration=(\d+)/);
          // noembed tidak kasih durasi, estimasi dari iframe
        }
      }

      startRange.value = 0;
      endRange.value   = 100;
      updateLabels();

      initPlayer();

      videoSection.classList.remove('hidden');
      clipBtn.disabled = false;
      videoSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      showErr(inputError, e.message);
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'Cari Video';
    }
  });

  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchBtn.click(); });

  // ── Range events ──
  startRange.addEventListener('input', () => {
    if (+startRange.value >= +endRange.value) {
      startRange.value = Math.max(0, +endRange.value - 1);
    }
    updateLabels();
  });
  endRange.addEventListener('input', () => {
    if (+endRange.value <= +startRange.value) {
      endRange.value = Math.min(100, +startRange.value + 1);
    }
    updateLabels();
  });

  // ── Mark Start / End ──
  const markStart = () => {
    if (!videoId) return;
    try {
      const t = ytPlayerObj?.getCurrentTime?.();
      if (t > 0) {
        startRange.value = Math.round((t / duration) * 100);
        if (+startRange.value >= +endRange.value) {
          startRange.value = Math.max(0, +endRange.value - 1);
        }
        updateLabels();
        return;
      }
    } catch (_) {}
    // fallback: nudge +5%
    startRange.value = Math.min(95, +startRange.value + 5);
    updateLabels();
  };

  const markEnd = () => {
    if (!videoId) return;
    try {
      const t = ytPlayerObj?.getCurrentTime?.();
      if (t > 0) {
        endRange.value = Math.round((t / duration) * 100);
        if (+endRange.value <= +startRange.value) {
          endRange.value = Math.min(100, +startRange.value + 1);
        }
        updateLabels();
        return;
      }
    } catch (_) {}
    endRange.value = Math.max(5, +endRange.value - 5);
    updateLabels();
  };

  markStartBtn.addEventListener('click', markStart);
  markEndBtn.addEventListener('click', markEnd);

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'i' || e.key === 'I') markStart();
    if (e.key === 'o' || e.key === 'O') markEnd();
  });

  // ── Clip & Download ──
  clipBtn.addEventListener('click', async () => {
    hideErr(clipError);
    clipBtn.disabled = true;
    progressWrap.classList.remove('hidden');
    progressText.textContent = 'Mengunduh & memotong video…';

    const s = Math.round((+startRange.value / 100) * duration);
    const e = Math.round((+endRange.value / 100) * duration);

    try {
      const r = await fetch(`/api/clip?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&start=${s}&end=${e}`);
      const ct = r.headers.get('content-type') || '';

      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Gagal buat clip');
      }

      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${titleEl.textContent.replace(/[^\w ]+/g,'').slice(0,40) || 'clip'}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      progressText.textContent = '✅ Clip siap!';
    } catch (e) {
      showErr(clipError, e.message);
      progressText.textContent = 'Gagal.';
    } finally {
      clipBtn.disabled = false;
      setTimeout(() => progressWrap.classList.add('hidden'), 5000);
    }
  });

  // ── Cookie upload ──
  cookieBtn.addEventListener('click', async () => {
    const file = cookieInput.files[0];
    if (!file) return;
    const text = await file.text();
    const r = await fetch('/api/setup-cookies', {
      method: 'POST',
      body: text,
    });
    const d = await r.json();
    cookieStatus.textContent = r.ok
      ? `✅ ${d.lines} cookies tersimpan. Coba unduh lagi.`
      : `❌ ${d.error}`;
    cookieStatus.style.color = r.ok ? '#4caf50' : '#ff6b6b';
  });
})();
