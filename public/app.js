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
      videoId = d.videoId; // penting! sebelumnya null → link export jadi ?v=null
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

    // Attention curve
    if (lastAutoResults?.energy) {
      const wrap = document.createElement('div');
      wrap.className = 'curve-wrap';
      wrap.innerHTML = '<canvas id="curveCanvas"></canvas><small>▲ kurva energi audio — pita warna = momen terpilih (makin terang = score makin tinggi)</small>';
      autoResults.appendChild(wrap);
      requestAnimationFrame(() => drawCurve(wrap.querySelector('canvas'), lastAutoResults.energy, lastAutoResults.duration, clips));
    }

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
        <div class="clip-thumb-wrap">
          <img class="clip-thumb" loading="lazy"
            src="/api/thumb?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}&start=${clip.start}"
            onerror="this.closest('.clip-thumb-wrap').classList.add('no-thumb'); this.remove()" alt="thumbnail momen" />
          <span class="clip-num" style="background:${color}">#${i + 1}</span>
          ${badge ? `<span class="clip-badge">${badge}</span>` : ''}
        </div>
        <div class="clip-head">
          <span class="clip-score" style="color:${color}">${clip.score}/10</span>
          <span class="clip-time"><b>${fmt(clip.start)} → ${fmt(clip.end)}</b><small>(${fmt(clip.end - clip.start)})</small></span>
        </div>
        <div class="clip-why">${clip.reason || '—'}</div>
        <div class="clip-actions">
          <button class="btn primary btn-dl" data-url="https://www.youtube.com/watch?v=${videoId}" data-start="${clip.start}" data-end="${clip.end}">
            ⬇️ Unduh ${vertical.checked ? '📱 vertikal' : '🖥 landscape'}
          </button>
          <button class="btn ghost btn-pv" data-url="https://www.youtube.com/watch?v=${videoId}" data-start="${clip.start}" data-end="${clip.end}">
            🎬 Preview
          </button>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  // ── Gambar attention curve di canvas ──
  function drawCurve(canvas, energyStr, duration, clips) {
    if (!canvas || !energyStr) return;
    const data = energyStr.split(',').map(Number);
    const W = canvas.clientWidth || 640;
    const H = 120;
    canvas.width = W * 2;            // retina
    canvas.height = H * 2;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    const pad = 4;

    // garis dasar
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);

    // pita highlight momen (chronological)
    ctx.globalAlpha = 0.22;
    for (const c of clips) {
      const x0 = pad + (c.start / duration) * (W - pad * 2);
      const x1 = pad + (c.end / duration) * (W - pad * 2);
      ctx.fillStyle = scoreColor(c.score);
      ctx.fillRect(x0, 0, x1 - x0, H);
    }
    ctx.globalAlpha = 1;

    // kurva
    const n = data.length;
    ctx.beginPath();
    ctx.moveTo(pad, H - pad);
    for (let p = 0; p < n; p++) {
      const x = pad + (p / (n - 1)) * (W - pad * 2);
      const y = (H - pad) - (data[p] / 100) * (H - pad * 2);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W - pad, H - pad);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(255,0,51,0.55)');
    grad.addColorStop(1, 'rgba(255,0,51,0.08)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (let p = 0; p < n; p++) {
      const x = pad + (p / (n - 1)) * (W - pad * 2);
      const y = (H - pad) - (data[p] / 100) * (H - pad * 2);
      p === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#ff0033';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // label durasi
    ctx.fillStyle = '#888';
    ctx.font = '10px system-ui';
    ctx.fillText('0:00', pad + 2, H - 1);
    const mid = fmt(Math.floor(duration / 2));
    ctx.fillText(mid, W / 2 - 10, H - 1);
    ctx.fillText(fmt(duration), W - pad - 24, H - 1);
  }

  // ── Preview inline: fetch /api/preview lalu sisipkan <video> di card ──
  autoResults.addEventListener('click', async (ev) => {
    const pvBtn = ev.target.closest('.btn-pv');
    if (!pvBtn) return;

    const card = pvBtn.closest('.clip-card');
    const existing = card.querySelector('.clip-preview');
    if (existing) {
      existing.remove(); // toggle close
      pvBtn.textContent = '🎬 Preview di sini';
      return;
    }

    const qs = new URLSearchParams({
      url: pvBtn.dataset.url,
      start: pvBtn.dataset.start,
      end: pvBtn.dataset.end,
    });

    pvBtn.disabled = true;
    const label = pvBtn.textContent;
    pvBtn.textContent = '⏳ Membuat preview…';
    hideErr(autoError);

    try {
      const r = await fetch(`/api/preview?${qs}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const d = await r.json();
      const wrap = document.createElement('div');
      wrap.className = 'clip-preview';
      wrap.innerHTML = `
        <video controls preload="metadata" src="${d.file}" style="width:100%;border-radius:6px;background:#000"></video>
        <small>Momen ${fmt(+pvBtn.dataset.start)} → ${fmt(+pvBtn.dataset.end)} (360p preview)</small>
      `;
      card.insertBefore(wrap, card.querySelector('.clip-actions'));
      pvBtn.textContent = '✕ Tutup preview';
      // Mulai load
      wrap.querySelector('video').play().catch(() => {});
    } catch (e) {
      showErr(autoError, e.message);
      pvBtn.textContent = '❌ Gagal — coba lagi';
    } finally {
      pvBtn.disabled = false;
      if (pvBtn.textContent.startsWith('❌')) {
        setTimeout(() => { pvBtn.textContent = label; }, 4000);
      }
    }
  });

  // ── Download handler (delegasi utk semua tombol .btn-dl) ──
  autoResults.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.btn-dl');
    if (!btn) return;

    const isVertical = vertical.checked ? '1' : '0';
    const qs = new URLSearchParams({
      url: btn.dataset.url,
      start: btn.dataset.start,
      end: btn.dataset.end,
      vertical: isVertical,
    });

    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '⏳ Mengunduh segmen…';
    hideErr(autoError);

    // Info progres: setelah 20dtk kasih tau masih proses
    const killer = setTimeout(() => {
      btn.textContent = '⏳ Masih mengunduh — video panjang butuh 1–2 menit…';
    }, 20_000);

    // Timeout total 10 menit
    const ctrl = new AbortController();
    const killer2 = setTimeout(() => ctrl.abort(), 600_000);

    try {
      const r = await fetch(`/api/auto-export?${qs}`, { signal: ctrl.signal });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      await downloadBlob(r);
      btn.textContent = '✅ Terunduh!';
      clearTimeout(killer);
    } catch (e) {
      showErr(autoError, e.name === 'AbortError'
        ? 'Timeout 10 menit — unduhan terlalu lama. Coba durasi/lebih kecil atau resolusi 720p.'
        : e.message);
      btn.textContent = '❌ Gagal — coba lagi';
    } finally {
      clearTimeout(killer);
      clearTimeout(killer2);
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = label;
      }, 3000);
    }
  });

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
