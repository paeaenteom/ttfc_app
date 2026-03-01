// ============================================================
//  TTFC Viewer - Preload v7
//  Features: Video state, Shortcuts, New Episode Detection,
//            Full Scan Loading Overlay
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ttfcBridge', { getVersion: () => '7.0.0' });

let pollInterval = null;
let lastUrl = '';

window.addEventListener('DOMContentLoaded', () => {
    console.log('[TTFC] Preload v7 loaded');

    // 복사 방지 해제
    document.addEventListener('copy', (e) => e.stopImmediatePropagation(), true);
    document.addEventListener('selectstart', (e) => e.stopImmediatePropagation(), true);
    document.addEventListener('contextmenu', (e) => e.stopImmediatePropagation(), true);

    const unblock = document.createElement('style');
    unblock.textContent = '* { -webkit-user-select: text !important; user-select: text !important; }';
    document.head.appendChild(unblock);

    sendNav();
    startPolling();
    setupShortcuts();
    setupScanOverlay();
});

// ============================================================
//  Scan Loading Overlay (전체 스캔 시 앱 차단)
// ============================================================

function setupScanOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'ttfc-scan-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(10, 10, 15, 0.97);
        display: none; flex-direction: column; justify-content: center; align-items: center;
        z-index: 99999; font-family: 'Segoe UI', 'Noto Sans KR', sans-serif;
        color: #fff; cursor: not-allowed;
    `;

    overlay.innerHTML = `
        <div style="text-align: center; max-width: 500px; padding: 40px;">
            <div style="font-size: 48px; margin-bottom: 16px;">📡</div>
            <h1 id="scan-title" style="font-size: 22px; font-weight: 700; margin-bottom: 8px; color: #fff;">
                TTFC 전체 스캔 중
            </h1>
            <p id="scan-message" style="font-size: 14px; color: #aaa; margin-bottom: 32px; line-height: 1.6;">
                모든 작품과 에피소드를 수집하고 있습니다...
            </p>
            <div style="width: 100%; background: #222; border-radius: 8px; overflow: hidden; height: 8px; margin-bottom: 12px;">
                <div id="scan-progress-bar" style="
                    width: 0%; height: 100%;
                    background: linear-gradient(90deg, #00A1D6, #FB7299);
                    border-radius: 8px;
                    transition: width 0.4s ease;
                "></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: #888;">
                <span id="scan-count">0 / 0</span>
                <span id="scan-percent">0%</span>
            </div>
            <p id="scan-current" style="
                font-size: 13px; color: #666; margin-top: 20px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                max-width: 460px;
            "></p>
            <div id="scan-spinner" style="
                width: 32px; height: 32px; margin: 24px auto 0;
                border: 3px solid rgba(255,255,255,0.1);
                border-top: 3px solid #00A1D6;
                border-radius: 50%;
                animation: ttfc-spin 0.8s linear infinite;
            "></div>
        </div>
        <style>
            @keyframes ttfc-spin { to { transform: rotate(360deg); } }
            #ttfc-scan-overlay * { pointer-events: none !important; }
        </style>
    `;

    document.body.appendChild(overlay);

    ipcRenderer.on('scan-overlay', (event, data) => {
        const el = document.getElementById('ttfc-scan-overlay');
        if (!el) return;

        switch (data.action) {
            case 'show':
                el.style.display = 'flex';
                break;
            case 'hide':
                el.style.display = 'none';
                break;
            case 'progress': {
                const { phase, current, total, message } = data;
                const titleEl = document.getElementById('scan-title');
                const msgEl = document.getElementById('scan-message');
                const barEl = document.getElementById('scan-progress-bar');
                const countEl = document.getElementById('scan-count');
                const percentEl = document.getElementById('scan-percent');
                const currentEl = document.getElementById('scan-current');
                const spinnerEl = document.getElementById('scan-spinner');

                if (phase === 'init' || phase === 'loading' || phase === 'collecting') {
                    if (titleEl) titleEl.textContent = 'TTFC 전체 스캔 중';
                    if (msgEl) msgEl.textContent = message || '준비 중...';
                    if (barEl) barEl.style.width = '0%';
                    if (countEl) countEl.textContent = '';
                    if (percentEl) percentEl.textContent = '';
                    if (currentEl) currentEl.textContent = '';
                }
                if (phase === 'scanning' && total > 0) {
                    const pct = Math.round((current / total) * 100);
                    if (titleEl) titleEl.textContent = `에피소드 스캔 중 (${current}/${total})`;
                    if (msgEl) msgEl.textContent = message || '';
                    if (barEl) barEl.style.width = pct + '%';
                    if (countEl) countEl.textContent = `${current} / ${total}`;
                    if (percentEl) percentEl.textContent = pct + '%';
                    if (currentEl) currentEl.textContent = message || '';
                }
                if (phase === 'saving') {
                    if (titleEl) titleEl.textContent = 'GitHub에 저장 중...';
                    if (msgEl) msgEl.textContent = '데이터를 GitHub에 업로드하고 있습니다.';
                    if (barEl) barEl.style.width = '100%';
                    if (percentEl) percentEl.textContent = '저장 중...';
                }
                if (phase === 'done') {
                    if (titleEl) titleEl.textContent = '✅ 스캔 완료!';
                    if (msgEl) msgEl.textContent = `${total}개 작품 스캔 완료!`;
                    if (barEl) barEl.style.width = '100%';
                    if (percentEl) percentEl.textContent = '100%';
                    if (countEl) countEl.textContent = `${total} / ${total}`;
                    if (spinnerEl) spinnerEl.style.display = 'none';
                }
                break;
            }
        }
    });
}

// ============================================================
//  URL Change Detection
// ============================================================

setInterval(() => {
    if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        if (!document.querySelector('.video-js')) {
            ipcRenderer.send('video-state-update', {
                isWatching: false, isPlaying: false,
                seriesName: '', episodeTitle: '', episodeNumber: '',
                currentTime: 0, duration: 0, thumbnail: '',
            });
        }
        sendNav();
    }
}, 800);

function sendNav() {
    ipcRenderer.send('page-navigation', {
        url: window.location.href,
        title: document.title || '',
        isVideoPage: !!document.querySelector('.video-js'),
    });
}

// ============================================================
//  Video State Polling
// ============================================================

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(sendUpdate, 2000);

    let lastPlayState = null;
    setInterval(() => {
        try {
            const video = document.querySelector('.video-js video');
            if (!video) return;
            const playing = !video.paused;
            if (playing !== lastPlayState) {
                lastPlayState = playing;
                sendUpdate();
            }
        } catch (e) {}
    }, 100);

    function attachVideoEvents() {
        const video = document.querySelector('.video-js video');
        if (!video || video._ttfcEventsAttached) return;
        ['play', 'pause', 'seeked', 'loadedmetadata', 'ended'].forEach(evt => {
            video.addEventListener(evt, () => { sendUpdate(); setTimeout(sendUpdate, 500); });
        });
        const observer = new MutationObserver(() => { setTimeout(sendUpdate, 500); setTimeout(sendUpdate, 2000); });
        observer.observe(video, { attributes: true, attributeFilter: ['src'] });
        video._ttfcEventsAttached = true;
    }

    attachVideoEvents();
    setTimeout(attachVideoEvents, 1000);
    setTimeout(attachVideoEvents, 3000);
    new MutationObserver(() => attachVideoEvents()).observe(document.body, { childList: true, subtree: true });

    document.addEventListener('click', (e) => {
        const container = e.target.closest('a[href], li');
        if (container && container.querySelector('span.title')) {
            setTimeout(sendUpdate, 1000);
            setTimeout(sendUpdate, 2500);
        }
    }, true);
}

function sendUpdate() {
    const vjs = document.querySelector('.video-js');
    const video = document.querySelector('.video-js video, video');
    if (!vjs && !video) return;
    const info = extractInfo(vjs, video);
    if (info.duration === 0 && info.isWatching) setTimeout(sendUpdate, 2000);
    ipcRenderer.send('video-state-update', info);
}

// ============================================================
//  Shortcuts
// ============================================================

function setupShortcuts() {
    ipcRenderer.on('shortcut-command', (event, cmd) => {
        console.log('[TTFC] Shortcut command:', cmd);
        executeCommand(cmd);
    });

    document.addEventListener('keydown', (e) => {
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

        const vjs = document.querySelector('.video-js');
        const video = vjs ? vjs.querySelector('video') : null;

        if (e.key === ' ' || e.code === 'Space') {
            if (video) { e.preventDefault(); e.stopPropagation(); executeCommand('toggle-play'); return; }
        }
        if (e.key === 'f' || e.key === 'F') {
            if (video) {
                e.preventDefault(); e.stopPropagation();
                if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
                else { const p = vjs || video; if (p.requestFullscreen) p.requestFullscreen().catch(() => {}); else if (p.webkitRequestFullscreen) p.webkitRequestFullscreen(); }
                return;
            }
        }
        if (!vjs) return;
        if (e.ctrlKey && e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); executeCommand('next-episode'); return; }
        if (e.ctrlKey && e.shiftKey && e.key === 'ArrowLeft') { e.preventDefault(); executeCommand('prev-episode'); return; }
        if (e.ctrlKey && !e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); executeCommand('seek-forward'); return; }
        if (e.ctrlKey && !e.shiftKey && e.key === 'ArrowLeft') { e.preventDefault(); executeCommand('seek-backward'); return; }
        if (video && !e.ctrlKey && !e.shiftKey) {
            if (e.key === 'ArrowRight') { e.preventDefault(); video.currentTime = Math.min(video.duration, video.currentTime + 5); setTimeout(sendUpdate, 300); return; }
            if (e.key === 'ArrowLeft') { e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); setTimeout(sendUpdate, 300); return; }
        }
        if ((e.key === 'm' || e.key === 'M') && video) { e.preventDefault(); video.muted = !video.muted; return; }
    });
}

function executeCommand(cmd) {
    const vjs = document.querySelector('.video-js');
    const video = vjs ? vjs.querySelector('video') : null;
    switch (cmd) {
        case 'toggle-play': if (!video) return; if (video.paused) video.play().catch(() => {}); else video.pause(); setTimeout(sendUpdate, 300); break;
        case 'pause': if (video && !video.paused) video.pause(); break;
        case 'seek-forward': if (!video) return; video.currentTime = Math.min(video.duration, video.currentTime + 10); setTimeout(sendUpdate, 300); break;
        case 'seek-backward': if (!video) return; video.currentTime = Math.max(0, video.currentTime - 10); setTimeout(sendUpdate, 300); break;
        case 'next-episode': clickEpisodeOffset(1); break;
        case 'prev-episode': clickEpisodeOffset(-1); break;
    }
}

function clickEpisodeOffset(offset) {
    const episodes = document.querySelectorAll('span.title');
    if (episodes.length < 2) return;
    let currentIdx = -1;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT,
        { acceptNode: (n) => n.textContent.includes('再生中') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
    if (walker.nextNode()) {
        let container = walker.currentNode.parentElement;
        for (let i = 0; i < 8; i++) {
            if (!container) break;
            const span = container.querySelector('span.title');
            if (span) { episodes.forEach((ep, idx) => { if (ep === span) currentIdx = idx; }); break; }
            container = container.parentElement;
        }
    }
    const targetIdx = currentIdx + offset;
    if (targetIdx >= 0 && targetIdx < episodes.length) {
        const target = episodes[targetIdx];
        let clickable = target.closest('a[href], li, [role="button"]') || target;
        clickable.click();
        setTimeout(sendUpdate, 2000);
        setTimeout(sendUpdate, 4000);
    }
}

// ============================================================
//  Extract Info
// ============================================================

function extractInfo(vjs, videoEl) {
    const video = videoEl || (vjs && vjs.querySelector('video')) || document.querySelector('video');
    let playing = false;
    if (video) playing = !video.paused && !video.ended && video.readyState > 2;
    else if (vjs) playing = vjs.classList.contains('vjs-playing') && !vjs.classList.contains('vjs-paused');

    let currentTime = 0, duration = 0;
    if (video && video.duration > 0) { currentTime = Math.floor(video.currentTime); duration = Math.floor(video.duration); }
    else if (vjs) {
        const curEl = vjs.querySelector('.vjs-current-time-display');
        const durEl = vjs.querySelector('.vjs-duration-display');
        if (curEl) currentTime = parseTime(curEl.textContent);
        if (durEl) duration = parseTime(durEl.textContent);
    }

    let seriesName = '';
    const titleDiv = document.querySelector('div.title');
    if (titleDiv) seriesName = titleDiv.textContent.trim();

    const ep = findCurrentEpisode();
    let episodeNumber = '', episodeTitle = '';
    if (ep.text) {
        const m = ep.text.match(/^(Case\s*\d+|第\s*\d+\s*話|EP\.?\s*\d+|Ｍｉｓｓｉｏｎ\s*\d+|Mission\s*\d+)\s*[「『\[　\s]\s*(.+?)\s*[」』\]]?\s*$/i);
        if (m) { episodeNumber = m[1].trim(); episodeTitle = m[2].trim(); }
        else episodeTitle = ep.text;
    }

    if (!seriesName) {
        const og = document.querySelector('meta[property="og:title"]');
        if (og) { const c = og.getAttribute('content') || ''; if (c && !c.includes('東映特撮ファンクラブ')) seriesName = c; }
    }

    return {
        isWatching: true, isPlaying: playing,
        seriesName: seriesName || '東映特撮ファンクラブ',
        episodeTitle, episodeNumber,
        currentTime, duration,
        thumbnail: ep.thumbnail || '',
    };
}

function findCurrentEpisode() {
    let text = '', thumbnail = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT,
        { acceptNode: (n) => n.textContent.includes('再生中') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
    while (walker.nextNode()) {
        let container = walker.currentNode.parentElement;
        for (let i = 0; i < 8; i++) {
            if (!container) break;
            const span = container.querySelector('span.title');
            if (span && span.textContent.trim().length > 2) {
                text = span.textContent.trim();
                const img = container.querySelector('img');
                if (img) thumbnail = img.src || img.getAttribute('data-src') || '';
                break;
            }
            container = container.parentElement;
        }
        if (text) break;
    }
    if (!text) {
        const first = document.querySelector('span.title');
        if (first) {
            text = first.textContent.trim();
            const p = first.parentElement?.parentElement;
            if (p) { const img = p.querySelector('img'); if (img) thumbnail = img.src || ''; }
        }
    }
    if (!thumbnail) {
        const og = document.querySelector('meta[property="og:image"]');
        if (og) thumbnail = og.getAttribute('content') || '';
    }
    return { text, thumbnail };
}

function parseTime(str) {
    if (!str) return 0;
    const c = str.replace(/[^0-9:]/g, '').trim();
    if (!c) return 0;
    const p = c.split(':').map(Number);
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 60 + p[1];
    return p[0] || 0;
}
