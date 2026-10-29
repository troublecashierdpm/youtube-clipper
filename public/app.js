/* ===== YouTube Clipper — Frontend Logic ===== */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const urlInput     = $('urlInput');
  const fetchBtn     = $('fetchBtn');
  const autoBtn      = $('autoBtn');
  const inputError   = $('inputError');
  const videoSection = $('videoSection');
  const autoPanel    = $('autoPanel');
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
  const autoResults  = $('autoResults');
  const autoLoading  = $('autoLoading');
  const autoLoadingText = $('autoLoadingText');
  const autoError    = $('autoError');
  const clipLen      = $('clipLen');
  const vertical     = $('vertical');
  const cookieInput  = $('cookieInput');
  const cookieBtn    = $('cookieBtn');
  const cookieStatus = $('cookieStatus');

  let videoId = null;
  let duration = 0;
  let ytPlayerObj = null;
  let currentMode = 'manual'; // manual | auto
  let lastAutoResults = null;

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

  const showErr = (el, msg) => { el.textContent = msg; el.classList.remove('hidden'); };
  const hideErr = (el) => { el.textContent = ''; el.classList.add('hidden'); };

  // ── Tabs ──
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      currentMode = t.dataset.tab;

      fetchBtn.classList.toggle('hidden', currentMode !== 'manual');
      autoBtn.classList.toggle('hidden', currentMode !== 'auto');
      autoPanel.classList.toggle('hidden', currentMode !== 'auto');
    });
  });
  // Trigger default state
  document.querySelector('.tab.active').click();

  // ── Manual: update labels ──
  const updateLabels = () => {
    const s = (+startRange.value / 100) * duration;
    const e = (+endRange.value / 100) * duration;
    startDisplay.textContent = fmt(s);
    endDisplay.textContent   = fmt(e);
    clipLabel.textContent = `Durasi clip: ${fmt(s)} – ${fmt(e)}  (${fmt(e - s)})`;
  };

  // ── YouTube IFrame API ──
  window.onYouTubeIframeAPIReady = () => {
    window.__ytReady = true;
    if (videoId) initPlayer();
  };

  function initPlayer() {
    if (!videoId) return;
    if (ytPlayerObj?.destroy) ytPlayerObj.destroy();
    ytPlayerObj = new YT.Player('ytPlayer', {
      videoId,
      playerVars: { autoplay: 0, modestbranding: 1, rel: 0, fs: 0 },
      events: {
        onReady: () => {
          duration = ytPlayerObj.getDuration?.() || duration;
          updateLabels();
        },
        onStateChange: (e) => {
          // nilainya playing state
          if (e.data === YT.PlayerState.PLAYING && !duration) {
            duration = ytPlayerObj.getDuration?.() || 0;
            updateLabels();
          }
        }
      }
    });
  }

  // ── Fetch Info (Mode Manual) ──
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

      startRange.value = 0;
      endRange.value = 100;
      updateLabels();

      // YT API mungkin belum ready
      if (window.__ytReady) initPlayer();

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

  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') {
    if (currentMode === 'manual') fetchBtn.click();
    else autoBtn.click();
  } });

  // ── Range events ──
  startRange.addEventListener('input', () => {
    if (+startRange.value >= +endRange.value) startRange.value = Math.max(0, +endRange.value - 1);
    updateLabels();
  });
  endRange.addEventListener('input', () => {
    if (+endRange.value <= +startRange.value) endRange.value = Math.min(100, +startRange.value + 1);
    updateLabels();
  });

  const markStart = () => {
    if (!videoId) return;
    try {
      const t = ytPlayerObj?.getCurrentTime?.();
      if (t > 0) {
        startRange.value = Math.round((t / duration) * 100);
        if (+startRange.value >= +endRange.value) startRange.value = Math.max(0, +endRange.value - 1);
        updateLabels();
        return;
      }
    } catch (_) {}
    startRange.value = Math.min(95, +startRange.value + 5);
    updateLabels();
  };
  const markEnd = () => {
    if (!videoId) return;
    try {
      const t = ytPlayerObj?.getCurrentTime?.();
      if (t > 0) {
        endRange.value = Math.round((t / duration) * 100);
        if (+endRange.value <= +startRange.value) endRange.value = Math.min(100, +startRange.value + 1);
        updateLabels();
        return;
      }
    } catch (_) {}
    endRange.value = Math.max(5, +endRange.value - 5);
    updateLabels();
  };
  markStartBtn.addEventListener('click', markStart);
  markEndBtn.addEventListener('click', markEnd);

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'i' || e.key === 'I') markStart();
    if (e.key === 'o' || e.key === 'O') markEnd();
  });

  // ── Clip & Download (Manual) ──
  clipBtn.addEventListener('click', async () => {
    hideErr(clipError);
    clipBtn.disabled = true;
    progressWrap.classList.remove('hidden');
    progressText.textContent = 'Mengunduh & memotong video…';

    const s = Math.round((+startRange.value / 100) * duration);
    const e = Math.round((+endRange.value / 100) * duration);

    try {
      const r = await fetch(`/api/clip?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&start=${s}&end=${e}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Gagal buat clip');
      }
      await downloadBlob(r);
      progressText.textContent = '✅ Clip siap!';
    } catch (e) {
      showErr(clipError, e.message);
      progressText.textContent = 'Gagal.';
    } finally {
      clipBtn.disabled = false;
      setTimeout(() => progressWrap.classList.add('hidden'), 5000);
    }
  });

  async function downloadBlob(resp) {
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const cd = resp.headers.get('content-disposition') || '';
    a.download = cd.match(/filename="?([^"]+)"?/)?.[1] || 'clip.mp4';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 120_000);
  }

  // ── Auto Clip (AI) ──
  autoBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    hideErr(autoError);
    hideErr(inputError);
    autoResults.innerHTML = '';
    if (!url) return showErr(inputError, 'Tempel link YouTube-nya dulu.');

    autoBtn.disabled = true;
    autoLoading.classList.remove('hidden');

    const len = clipLen.value;
    let stage = 0;
    const stages = ['Mengunduh video…', 'Analisa energi audio…', 'Ranking momen…'];
    intHandler = setInterval(() => {
      autoLoadingText.textContent = stages[Math.min(stage++, stages.length - 1)];
    }, 1500);

    try {
      const r = await fetch(`/api/auto-clip?url=${encodeURIComponent(url)}&length=${len}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Gagal analisa');

      lastAutoResults = d;
      renderResults(d.clips);
    } catch (e) {
      showErr(autoError, e.message);
    } finally {
      autoBtn.disabled = false;
      autoLoading.classList.add('hidden');
      clearInterval(intHandler);
    }
  });

  let intHandler = null;

  function scoreColor(score) {
    if (score >= 8) return '#00c853';    // green
    if (score >= 6) return '#ffab00';    // amber
    if (score >= 4) return '#ff9100';    // orange
    return '#ff6b6b';                    // red
  }

  function renderResults(clips) {
    autoResults.innerHTML = '';

    if (!clips.length) {
      autoResults.innerHTML = '<p class="no-res">Tidak ada momen memuaskan ditemukan. Coba durasi lain.</p>';
      return;
    }

    // Header info
    const h = document.createElement('div');
    h.className = 'auto-results-header';
    h.innerHTML = `<h3>🔥 ${clips.length} Momen Terbaik ditemukan</h3><p>Rank AI berdasarkan energi audio: momentum, spike, dan posisi dalam video.</p>`;
    autoResults.appendChild(h);

    const grid = document.createElement('div');
    grid.className = 'clips-grid';
    autoResults.appendChild(grid);

    // Tampilkan sorted by score desc
    [...clips].sort((a, b) => b.score - a.score).forEach((clip, i) => {
      const card = document.createElement('div');
      card.className = 'clip-card';
      const color = scoreColor(clip.score);
      const badge = i === 0 ? '⭐ Terbaik' : '';
      card.style.setProperty('--score-color', color);

      card.innerHTML = `
        <div class="clip-head">
          <span class="clip-rank" style="background:${color}">#${i + 1}</span>
          ${badge ? `<span class="clip-badge">${badge}</span>` : ''}
          <span class="clip-score" style="color:${color}">${clip.score}/10</span>
        </div>
        <div class="clip-time">
          <b>${fmt(clip.start)} → ${fmt(clip.end)}</b>
          <small>(${fmt(clip.end - clip.start)} durasi)</small>
        </div>
        <div class="clip-why">${clip.reason || '—'}</div>
        <div class="clip-actions">
          <a class="btn primary" href="/api/auto-export?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${clip.videoId || videoId}`)}&start=${clip.start}&end=${clip.end}&vertical=${vertical.checked ? '1' : '0'}" download>
            ⬇️ Unduh ${vertical.checked ? '📱 vertikal' : '🖥 landscape'}
          </a>
          <a class="btn ghost" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${clip.videoId || videoId}&t=${clip.start}">
            ▶️ Preview
          </a>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  // ── Cookie upload ──
  cookieBtn.addEventListener('click', async () => {
    const file = cookieInput.files[0];
    if (!file) return;
    const text = await file.text();
    const r = await fetch('/api/setup-cookies', { method: 'POST', body: text });
    const d = await r.json();
    cookieStatus.textContent = r.ok ? `✅ ${d.lines} cookies tersimpan.`  : `❌ ${d.error}`;
    cookieStatus.style.color = r.ok ? '#4caf50' : '#ff6b6b';
  });
})();
