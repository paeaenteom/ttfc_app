// ============================================================
//  TTFC Viewer v3 - Main Process
//  東映特撮ファンクラブ PC App
//  Features: Discord RPC, Shortcuts, Notifications, Ambient,
//            Auto Update, Full Scan + GitHub Sync
// ============================================================

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, dialog, globalShortcut, Notification } = require('electron');
const path = require('path');
const https = require('https');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');
const DiscordRPC = require('./discord-rpc');
const { setupProtocol, handleDeepLink, findDeepLink } = require('./protocol');
const ScanManager = require('./scan-manager');

// ── 로그 설정 ──
log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// ── 설정 저장소 ──
const store = new Store({
    defaults: {
        rpc: {
            enabled: true,
            autoConnect: true,
            showTime: true,
            timeMode: 'progress',
            showSeries: true,
            showEpisode: true,
            showThumbnail: true,
            idleTimeout: 0,
        },
        shortcuts: {
            mediaKeys: true,
            customKeys: true,
        },
        notifications: {
            enabled: true,
            newEpisode: true,
            newShow: true,
            checkInterval: 30,      // 체크 간격 (분) — 기본 30분
        },
        watchlist: [],
        knownShows: [],
        translate: {
            enabled: false,
            lang: 'ko',
        },
        quality: {
            autoHighest: true,
        },
        autoStart: false,
    }
});

// ── 설정 ──
const TTFC_URL = 'https://pc.tokusatsu-fc.jp/';
const DISCORD_APP_ID = '946694629506555955';

let mainWindow = null;
let splashWindow = null;
let tray = null;
let discordRPC = null;
let idleTimer = null;
let translateCSS = null;

// ── 스캔 매니저 (전체 스캔 + GitHub 저장) ──
const scanManager = new ScanManager({
    // ★★★ 여기에 네 GitHub 정보 입력! ★★★
    githubOwner: 'paeaenteom',
    githubRepo: 'ttfc_app',
    githubToken: process.env.GH_TOKEN || '',   // 환경변수에서 자동으로 가져옴
    githubFile: 'data/ttfc-database.json',
    checkInterval: (store.get('notifications.checkInterval') || 30) * 60 * 1000,
});

// ── Windows SMTC (미디어 오버레이) 활성화 ──
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService');

// ── Windows 작업표시줄 아이콘 ──
if (process.platform === 'win32') {
    app.setAppUserModelId('com.ttfc.viewer');
}

// ── 단일 인스턴스 ──
setupProtocol();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', (event, argv) => {
        const deepLink = findDeepLink(argv);
        if (deepLink) {
            handleDeepLink(deepLink, mainWindow);
        } else if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// ════════════════════════════════════════
//  스플래시 화면 (로딩)
// ════════════════════════════════════════

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 400,
        height: 300,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    const splashHTML = `data:text/html;charset=utf-8,
    <!DOCTYPE html>
    <html><head><style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { display:flex; justify-content:center; align-items:center; height:100vh;
               background: linear-gradient(135deg, %231a1a2e, %2316213e, %230f3460);
               border-radius: 12px; font-family: 'Segoe UI', sans-serif; color: white;
               -webkit-app-region: drag; overflow: hidden; }
        .container { text-align: center; }
        h1 { font-size: 28px; margin-bottom: 8px; letter-spacing: 2px; }
        .sub { font-size: 13px; opacity: 0.7; margin-bottom: 24px; }
        .loader { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.2);
                  border-top: 3px solid %23e94560; border-radius: 50%;
                  animation: spin 0.8s linear infinite; margin: 0 auto; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style></head><body>
    <div class="container">
        <h1>TTFC Viewer</h1>
        <p class="sub">東映特撮ファンクラブ</p>
        <div class="loader"></div>
    </div>
    </body></html>`;

    splashWindow.loadURL(splashHTML);
    splashWindow.center();
}

// ════════════════════════════════════════
//  메인 윈도우
// ════════════════════════════════════════

function createMainWindow() {
    let winIcon;
    try {
        winIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.ico'));
        if (winIcon.isEmpty()) throw new Error('ico empty');
    } catch (e) {
        winIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
    }

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 600,
        show: false,
        title: 'TTFC Viewer',
        icon: winIcon,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
        },
        frame: true,
        autoHideMenuBar: true,
        backgroundColor: '#000000',
    });

    // ── 메뉴 ──
    const menu = Menu.buildFromTemplate([
        {
            label: 'TTFC',
            submenu: [
                { label: '🏠 홈으로', click: () => mainWindow.loadURL(TTFC_URL) },
                { type: 'separator' },
                { label: '새로고침', accelerator: 'F5', click: () => mainWindow.reload() },
                { label: '← 뒤로', accelerator: 'Alt+Left', click: () => mainWindow.webContents.goBack() },
                { label: '→ 앞으로', accelerator: 'Alt+Right', click: () => mainWindow.webContents.goForward() },
                { type: 'separator' },
                { label: '브라우저에서 열기', click: () => shell.openExternal(mainWindow.webContents.getURL()) },
                { type: 'separator' },
                { label: '🔑 브라우저 로그인 가져오기', click: () => importBrowserCookies() },
                { type: 'separator' },
                { label: '⭐ 현재 작품 즐겨찾기 추가', click: () => addCurrentToWatchlist() },
                { label: '📋 즐겨찾기 목록 보기', click: () => showWatchlistDialog() },
                { type: 'separator' },
                { label: '종료', accelerator: 'Alt+F4', click: () => { app.isQuitting = true; app.quit(); } }
            ]
        },
        {
            label: 'Discord',
            submenu: [
                {
                    label: '📡 RPC 활성화',
                    type: 'checkbox',
                    checked: store.get('rpc.enabled'),
                    click: (m) => {
                        store.set('rpc.enabled', m.checked);
                        m.checked ? discordRPC.connect() : (discordRPC.clearActivity(), discordRPC.disconnect());
                        log.info(`[RPC] ${m.checked ? '활성화' : '비활성화'}`);
                    }
                },
                {
                    label: '🔄 자동 연결',
                    type: 'checkbox',
                    checked: store.get('rpc.autoConnect'),
                    click: (m) => { store.set('rpc.autoConnect', m.checked); }
                },
                { type: 'separator' },
                { label: '🔌 활동 제거', click: () => { if (discordRPC) discordRPC.clearActivity(); } },
                { label: '🔁 재연결', click: () => { if (discordRPC) { discordRPC.disconnect(); setTimeout(() => discordRPC.connect(), 1000); } } },
                { type: 'separator' },
                {
                    label: '⏱ 시간 표시',
                    submenu: [
                        { label: '경과 + 남은 시간 (진행바)', type: 'radio', checked: store.get('rpc.timeMode') === 'progress', click: () => { store.set('rpc.timeMode', 'progress'); store.set('rpc.showTime', true); } },
                        { label: '남은 시간만', type: 'radio', checked: store.get('rpc.timeMode') === 'remaining', click: () => { store.set('rpc.timeMode', 'remaining'); store.set('rpc.showTime', true); } },
                        { label: '시간 숨기기', type: 'radio', checked: store.get('rpc.timeMode') === 'none', click: () => { store.set('rpc.timeMode', 'none'); store.set('rpc.showTime', false); } },
                    ]
                },
                { label: '📺 시리즈명 표시', type: 'checkbox', checked: store.get('rpc.showSeries'), click: (m) => { store.set('rpc.showSeries', m.checked); } },
                { label: '📝 에피소드명 표시', type: 'checkbox', checked: store.get('rpc.showEpisode'), click: (m) => { store.set('rpc.showEpisode', m.checked); } },
                { label: '🖼️ 썸네일 표시', type: 'checkbox', checked: store.get('rpc.showThumbnail'), click: (m) => { store.set('rpc.showThumbnail', m.checked); } },
                { type: 'separator' },
                {
                    label: '⏰ 비활성 시간 제한',
                    submenu: [
                        { label: '끔', type: 'radio', checked: store.get('rpc.idleTimeout') === 0, click: () => { store.set('rpc.idleTimeout', 0); clearIdleTimer(); } },
                        { label: '5분', type: 'radio', checked: store.get('rpc.idleTimeout') === 5, click: () => { store.set('rpc.idleTimeout', 5); } },
                        { label: '10분', type: 'radio', checked: store.get('rpc.idleTimeout') === 10, click: () => { store.set('rpc.idleTimeout', 10); } },
                        { label: '30분', type: 'radio', checked: store.get('rpc.idleTimeout') === 30, click: () => { store.set('rpc.idleTimeout', 30); } },
                    ]
                },
                { type: 'separator' },
                {
                    label: '⚙️ 설정 초기화',
                    click: () => {
                        store.set('rpc', store.store.rpc || { enabled: true, autoConnect: true, showTime: true, timeMode: 'progress', showSeries: true, showEpisode: true, showThumbnail: true, idleTimeout: 0 });
                        dialog.showMessageBox(mainWindow, { type: 'info', title: 'Discord RPC', message: 'RPC 설정이 초기화되었습니다.\n메뉴에 반영하려면 앱을 재시작하세요.' });
                    }
                }
            ]
        },
        {
            label: '설정',
            submenu: [
                {
                    label: '⌨️ 단축키',
                    submenu: [
                        {
                            label: '미디어 키 사용 (재생/일시정지/다음/이전)',
                            type: 'checkbox',
                            checked: store.get('shortcuts.mediaKeys'),
                            click: (m) => {
                                store.set('shortcuts.mediaKeys', m.checked);
                                m.checked ? registerMediaKeys() : unregisterMediaKeys();
                            }
                        },
                        { type: 'separator' },
                        { label: 'Space — 재생/일시정지', enabled: false },
                        { label: 'Ctrl+→ — 10초 앞으로', enabled: false },
                        { label: 'Ctrl+← — 10초 뒤로', enabled: false },
                        { label: 'Ctrl+Shift+→ — 다음 에피소드', enabled: false },
                        { label: 'Ctrl+Shift+← — 이전 에피소드', enabled: false },
                        { label: 'F11 — 전체화면', enabled: false },
                    ]
                },
                { type: 'separator' },
                {
                    label: '🔔 알림',
                    submenu: [
                        {
                            label: '알림 활성화',
                            type: 'checkbox',
                            checked: store.get('notifications.enabled'),
                            click: (m) => { store.set('notifications.enabled', m.checked); }
                        },
                        {
                            label: '새 에피소드 알림',
                            type: 'checkbox',
                            checked: store.get('notifications.newEpisode'),
                            click: (m) => { store.set('notifications.newEpisode', m.checked); }
                        },
                        {
                            label: '🆕 새 작품 알림',
                            type: 'checkbox',
                            checked: store.get('notifications.newShow'),
                            click: (m) => { store.set('notifications.newShow', m.checked); }
                        },
                        { type: 'separator' },
                        {
                            label: '⏱️ 체크 간격',
                            submenu: [
                                { label: '15분', type: 'radio', checked: store.get('notifications.checkInterval') === 15, click: () => { store.set('notifications.checkInterval', 15); } },
                                { label: '30분', type: 'radio', checked: store.get('notifications.checkInterval') === 30, click: () => { store.set('notifications.checkInterval', 30); } },
                                { label: '1시간', type: 'radio', checked: store.get('notifications.checkInterval') === 60, click: () => { store.set('notifications.checkInterval', 60); } },
                                { label: '2시간', type: 'radio', checked: store.get('notifications.checkInterval') === 120, click: () => { store.set('notifications.checkInterval', 120); } },
                            ]
                        },
                        { type: 'separator' },
                        {
                            label: '📊 스캔 정보',
                            click: () => {
                                const count = scanManager.getShowCount();
                                const lastScan = scanManager.getLastScanTime();
                                const lastStr = lastScan ? new Date(lastScan).toLocaleString('ko-KR') : '없음';
                                dialog.showMessageBox(mainWindow, {
                                    type: 'info', title: 'TTFC 스캔 정보',
                                    message: `기록된 작품: ${count}개\n마지막 전체 스캔: ${lastStr}`
                                });
                            }
                        },
                        {
                            label: '🔔 테스트 알림 보내기',
                            click: () => {
                                showNotification('TTFC Viewer', '알림이 정상 작동합니다!', 'ttfc_logo');
                            }
                        }
                    ]
                },
            ]
        },
        {
            label: '보기',
            submenu: [
                { label: '확대', accelerator: 'CmdOrCtrl+Plus', click: () => mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5) },
                { label: '축소', accelerator: 'CmdOrCtrl+-', click: () => mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5) },
                { label: '원래 크기', accelerator: 'CmdOrCtrl+0', click: () => mainWindow.webContents.setZoomLevel(0) },
                { type: 'separator' },
                { label: '전체화면', accelerator: 'F11', click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
                { type: 'separator' },
                { label: '개발자 도구', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() }
            ]
        },
        {
            label: '번역',
            submenu: [
                {
                    label: '🌐 번역 활성화',
                    type: 'checkbox',
                    checked: store.get('translate.enabled'),
                    click: (m) => {
                        store.set('translate.enabled', m.checked);
                        if (m.checked) applyTranslation(store.get('translate.lang'));
                        else removeTranslation();
                    }
                },
                { type: 'separator' },
                {
                    label: '🇰🇷 한국어',
                    type: 'radio',
                    checked: store.get('translate.lang') === 'ko',
                    click: () => {
                        store.set('translate.lang', 'ko');
                        if (store.get('translate.enabled')) applyTranslation('ko');
                    }
                },
                {
                    label: '🇯🇵 일본어 (원문)',
                    type: 'radio',
                    checked: store.get('translate.lang') === 'ja',
                    click: () => {
                        store.set('translate.lang', 'ja');
                        removeTranslation();
                    }
                },
            ]
        },
        {
            label: '영상',
            submenu: [
                {
                    label: '📥 현재 영상 다운로드',
                    accelerator: 'CmdOrCtrl+D',
                    click: () => downloadCurrentVideo()
                },
                { type: 'separator' },
                {
                    label: '🎬 항상 최고 화질',
                    type: 'checkbox',
                    checked: store.get('quality.autoHighest'),
                    click: (m) => {
                        store.set('quality.autoHighest', m.checked);
                        if (m.checked) applyAutoHighestQuality();
                    }
                },
            ]
        },
        {
            label: '도움말',
            submenu: [
                { label: `TTFC Viewer v${app.getVersion()}`, enabled: false },
                { type: 'separator' },
                { label: '업데이트 확인', click: () => checkForUpdatesManual() },
                { type: 'separator' },
                { label: 'GitHub', click: () => shell.openExternal('https://github.com/paeaenteom/ttfc_app') }
            ]
        }
    ]);
    Menu.setApplicationMenu(menu);

    // TTFC 로드
    mainWindow.loadURL(TTFC_URL);

    // User-Agent
    mainWindow.webContents.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // 외부 링크 → 기본 브라우저
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (!url.startsWith('https://pc.tokusatsu-fc.jp')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    // ── New Relic 완전 차단 ──
    const { session: appSession } = require('electron');
    appSession.defaultSession.webRequest.onBeforeRequest(
        { urls: [
            '*://*.nr-data.net/*',
            '*://*.newrelic.com/*',
            '*://bam.nr-data.net/*',
            '*://js-agent.newrelic.com/*',
        ] },
        (details, callback) => { callback({ cancel: true }); }
    );

    // ── CORS 우회 (영상 CDN) ──
    appSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const url = details.url || '';
        if (url.includes('cloudfront.net') ||
            url.includes('bn-sfs.com') ||
            url.includes('brightcove') ||
            url.includes('akamaized.net')) {
            const headers = { ...details.responseHeaders };
            const hasACAO = Object.keys(headers).some(k =>
                k.toLowerCase() === 'access-control-allow-origin'
            );
            if (!hasACAO) {
                headers['Access-Control-Allow-Origin'] = ['*'];
                headers['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS'];
                headers['Access-Control-Allow-Headers'] = ['*'];
            }
            callback({ responseHeaders: headers });
        } else {
            callback({ cancel: false });
        }
    });

    // NR 스크립트 제거 + 콘솔 필터링
    mainWindow.webContents.on('dom-ready', () => {
        mainWindow.webContents.executeJavaScript(`
            document.querySelectorAll('script').forEach(s => {
                if (s.textContent.includes('NREUM') || s.textContent.includes('newrelic') || 
                    (s.src && (s.src.includes('newrelic') || s.src.includes('nr-data')))) {
                    s.remove();
                }
            });
            if (!window._nrConsolePatched) {
                const origWarn = console.warn;
                const origError = console.error;
                const origLog = console.log;
                const nrFilter = (orig) => function(...args) {
                    const msg = args.join(' ');
                    if (msg.includes('New Relic') || msg.includes('NREUM') || 
                        msg.includes('newrelic') || msg.includes('nr-spa') ||
                        msg.includes('ChunkLoadError') || msg.includes('nr-data')) return;
                    return orig.apply(console, args);
                };
                console.warn = nrFilter(origWarn);
                console.error = nrFilter(origError);
                console.log = nrFilter(origLog);
                window._nrConsolePatched = true;
                console.clear();
            }
        `).catch(() => {});
    });

    // 로드 완료 → 스플래시 닫고 메인 표시
    mainWindow.webContents.on('did-finish-load', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close();
            splashWindow = null;
        }
        if (!process.argv.includes('--hidden')) {
            mainWindow.show();
            mainWindow.focus();
        }

        // 번역 적용
        if (store.get('translate.enabled') && store.get('translate.lang') !== 'ja') {
            setTimeout(() => applyTranslation(store.get('translate.lang')), 1500);
        }
        // 최고 화질 자동 적용
        if (store.get('quality.autoHighest')) {
            setTimeout(() => applyAutoHighestQuality(), 2000);
        }
        // Windows SMTC 미디어 핸들러 등록
        injectMediaSessionHandlers();

        // ★ 스캔 매니저 시작 (5초 대기 후 - 로그인 처리 시간)
        scanManager.setMainWindow(mainWindow);
        setTimeout(() => {
            scanManager.start();
        }, 5000);
    });

    mainWindow.webContents.on('did-navigate-in-page', () => {
        if (store.get('translate.enabled') && store.get('translate.lang') !== 'ja') {
            setTimeout(() => applyTranslation(store.get('translate.lang')), 1500);
        }
        if (store.get('quality.autoHighest')) {
            setTimeout(() => applyAutoHighestQuality(), 2000);
        }
        setTimeout(injectMediaSessionHandlers, 1000);
    });

    // 닫기 → 트레이
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });

    return mainWindow;
}

// ════════════════════════════════════════
//  Windows SMTC (미디어 오버레이)
// ════════════════════════════════════════

function injectMediaSessionHandlers() {
    if (!mainWindow) return;
    mainWindow.webContents.executeJavaScript(`
        (function() {
            if (window._ttfcMediaHandlersSet) return;
            window._ttfcMediaHandlersSet = true;

            const getVideo = () => document.querySelector('.video-js video') || document.querySelector('video');

            const handlers = [
                ['play', () => { const v = getVideo(); if (v) v.play(); }],
                ['pause', () => { const v = getVideo(); if (v) v.pause(); }],
                ['previoustrack', () => {
                    const items = document.querySelectorAll('span.title');
                    for (let i = 0; i < items.length; i++) {
                        const li = items[i].closest('li') || items[i].closest('a');
                        if (li && li.querySelector('.playing, [class*="playing"]')) {
                            if (i > 0) { items[i-1].click(); }
                            break;
                        }
                    }
                }],
                ['nexttrack', () => {
                    const items = document.querySelectorAll('span.title');
                    for (let i = 0; i < items.length; i++) {
                        const li = items[i].closest('li') || items[i].closest('a');
                        if (li && li.querySelector('.playing, [class*="playing"]')) {
                            if (i < items.length - 1) { items[i+1].click(); }
                            break;
                        }
                    }
                }],
                ['seekbackward', (d) => { const v = getVideo(); if (v) v.currentTime = Math.max(v.currentTime - (d.seekOffset || 10), 0); }],
                ['seekforward', (d) => { const v = getVideo(); if (v) v.currentTime = Math.min(v.currentTime + (d.seekOffset || 10), v.duration || 0); }],
                ['seekto', (d) => { const v = getVideo(); if (v) v.currentTime = d.seekTime; }],
                ['stop', () => { const v = getVideo(); if (v) { v.pause(); v.currentTime = 0; } }],
            ];
            for (const [action, handler] of handlers) {
                try { navigator.mediaSession.setActionHandler(action, handler); } catch(e) {}
            }
        })();
    `).catch(() => {});
}

let _smtcLastKey = '';

function updateSMTC(data) {
    if (!mainWindow || !data) return;

    const title = data.episodeNumber
        ? `${data.episodeNumber} ${data.episodeTitle}`
        : (data.episodeTitle || '再生中');
    const artist = data.seriesName || '東映特撮ファンクラブ';
    const thumb = data.thumbnail || '';
    const mediaKey = title + artist;
    const metaChanged = mediaKey !== _smtcLastKey;
    if (metaChanged) _smtcLastKey = mediaKey;

    const js = `
        (function() {
            if (!navigator.mediaSession) return;
            const video = document.querySelector('.video-js video') || document.querySelector('video');
            if (!video) return;
            navigator.mediaSession.playbackState = ${data.isPlaying ? "'playing'" : "'paused'"};
            ${metaChanged ? `
            const artwork = ${thumb ? `[
                { src: '${thumb}', sizes: '96x96', type: 'image/jpeg' },
                { src: '${thumb}', sizes: '256x256', type: 'image/jpeg' },
                { src: '${thumb}', sizes: '512x512', type: 'image/jpeg' }
            ]` : '[]'};
            navigator.mediaSession.metadata = new MediaMetadata({
                title: ${JSON.stringify(title)},
                artist: ${JSON.stringify(artist)},
                album: '東映特撮ファンクラブ',
                artwork: artwork,
            });
            ` : ''}
            if (${data.duration} > 0) {
                try {
                    navigator.mediaSession.setPositionState({
                        duration: ${data.duration},
                        playbackRate: video.playbackRate || 1,
                        position: Math.min(${data.currentTime}, ${data.duration}),
                    });
                } catch(e) {}
            }
        })();
    `;
    mainWindow.webContents.executeJavaScript(js).catch(() => {});
}

function clearSMTC() {
    _smtcLastKey = '';
    if (!mainWindow) return;
    mainWindow.webContents.executeJavaScript(`
        if (navigator.mediaSession) {
            navigator.mediaSession.metadata = null;
            navigator.mediaSession.playbackState = 'none';
        }
    `).catch(() => {});
}

// ════════════════════════════════════════
//  단축키 (미디어키)
// ════════════════════════════════════════

function registerMediaKeys() {
    log.info('[Shortcut] 미디어키 → MediaSession API (SMTC) 위임');
}

function unregisterMediaKeys() {
    // MediaSession이 처리하므로 해제할 것 없음
}

// ════════════════════════════════════════
//  알림
// ════════════════════════════════════════

function downloadThumbnail(url) {
    return new Promise((resolve) => {
        if (!url) return resolve(null);

        if (url.startsWith('data:')) {
            try {
                const img = nativeImage.createFromDataURL(url);
                return resolve(img.isEmpty() ? null : img);
            } catch (e) { return resolve(null); }
        }

        const { net } = require('electron');
        const timeout = setTimeout(() => resolve(null), 8000);

        try {
            const request = net.request(url);
            const chunks = [];
            request.on('response', (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    const location = response.headers.location;
                    if (location) {
                        clearTimeout(timeout);
                        return resolve(downloadThumbnail(Array.isArray(location) ? location[0] : location));
                    }
                }
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => {
                    clearTimeout(timeout);
                    try {
                        const buf = Buffer.concat(chunks);
                        if (buf.length < 100) return resolve(null);
                        const img = nativeImage.createFromBuffer(buf);
                        resolve(img.isEmpty() ? null : img);
                    } catch (e) { resolve(null); }
                });
            });
            request.on('error', () => { clearTimeout(timeout); resolve(null); });
            request.end();
        } catch (e) {
            clearTimeout(timeout);
            resolve(null);
        }
    });
}

async function showNotification(title, body, thumbnailUrl, clickUrl) {
    if (!store.get('notifications.enabled')) return;
    try {
        let icon = null;
        if (thumbnailUrl && (thumbnailUrl.startsWith('http') || thumbnailUrl.startsWith('data:'))) {
            icon = await downloadThumbnail(thumbnailUrl);
            log.info('[Notif] Thumbnail result:', icon ? 'OK' : 'FAILED', thumbnailUrl.substring(0, 80));
        }

        const notif = new Notification({
            title,
            body,
            icon: icon || path.join(__dirname, '..', 'assets', 'icon.png'),
            silent: false,
            urgency: 'critical',
            timeoutType: 'never',
        });
        notif.on('click', () => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
                if (clickUrl) {
                    mainWindow.webContents.executeJavaScript(
                        `window.location.href = '${clickUrl}';`
                    ).catch(() => mainWindow.loadURL(clickUrl));
                }
            }
        });
        notif.show();
        log.info('[Notif]', title, '-', body);
    } catch (e) {
        log.warn('[Notif] Failed:', e.message);
    }
}

// ════════════════════════════════════════
//  즐겨찾기 (수동 추가/보기만 - 스캔은 ScanManager가 처리)
// ════════════════════════════════════════

async function addCurrentToWatchlist() {
    if (!mainWindow) return;

    try {
        const info = await mainWindow.webContents.executeJavaScript(`
            (function() {
                const url = window.location.href;
                const match = url.match(/contentId=(\\d+)/) || url.match(/\\/show\\/(\\d+)/);
                if (!match) return null;

                const id = match[1];
                const titleEl = document.querySelector('div.title') || document.querySelector('h1');
                const name = titleEl ? titleEl.textContent.trim() : document.title;

                const episodes = document.querySelectorAll('span.title');
                const epList = [];
                episodes.forEach(el => {
                    const t = el.textContent.trim();
                    if (t.length > 2) epList.push(t);
                });

                return { id, name, url, episodeCount: epList.length, lastEpisode: epList[epList.length - 1] || '' };
            })();
        `);

        if (!info) {
            dialog.showMessageBox(mainWindow, {
                type: 'warning', title: '즐겨찾기',
                message: '작품 페이지에서만 추가할 수 있습니다.\n작품 상세 페이지로 이동해주세요.'
            });
            return;
        }

        const watchlist = store.get('watchlist') || [];
        if (watchlist.some(w => w.id === info.id)) {
            dialog.showMessageBox(mainWindow, {
                type: 'info', title: '즐겨찾기',
                message: `"${info.name}"은(는) 이미 즐겨찾기에 있습니다.`
            });
            return;
        }

        watchlist.push({
            id: info.id,
            name: info.name,
            url: info.url,
            episodeCount: info.episodeCount,
            lastEpisode: info.lastEpisode,
            lastChecked: Date.now(),
        });

        store.set('watchlist', watchlist);
        showNotification('⭐ 즐겨찾기 추가', `"${info.name}" (${info.episodeCount}화)`);
        log.info('[Watchlist] Added:', info.name, info.episodeCount, 'episodes');
    } catch (e) {
        log.error('[Watchlist] Add failed:', e.message);
    }
}

function showWatchlistDialog() {
    const watchlist = store.get('watchlist') || [];

    if (watchlist.length === 0) {
        dialog.showMessageBox(mainWindow, {
            type: 'info', title: '즐겨찾기',
            message: '즐겨찾기가 비어있습니다.\n작품 페이지에서 "⭐ 현재 작품 즐겨찾기 추가"를 눌러주세요.'
        });
        return;
    }

    const listText = watchlist.map((w, i) =>
        `${i + 1}. ${w.name}  (${w.episodeCount}화)`
    ).join('\n');

    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: `즐겨찾기 (${watchlist.length}개)`,
        message: listText,
        buttons: ['확인', '전체 삭제'],
        defaultId: 0,
    }).then(result => {
        if (result.response === 1) {
            dialog.showMessageBox(mainWindow, {
                type: 'warning', title: '즐겨찾기 전체 삭제',
                message: '정말 모든 즐겨찾기를 삭제하시겠습니까?',
                buttons: ['취소', '삭제'],
                defaultId: 0,
            }).then(r => {
                if (r.response === 1) {
                    store.set('watchlist', []);
                    showNotification('즐겨찾기', '모든 즐겨찾기가 삭제되었습니다.');
                }
            });
        }
    });
}

// ════════════════════════════════════════
//  최고 화질 자동 적용
// ════════════════════════════════════════

async function applyAutoHighestQuality() {
    if (!mainWindow || !mainWindow.webContents) return;
    try {
        await mainWindow.webContents.executeJavaScript(`
            (function() {
                const player = document.querySelector('.video-js');
                if (!player || !player.player) return;
                const p = player.player;
                const levels = p.qualityLevels ? p.qualityLevels() : null;
                if (levels && levels.length > 0) {
                    let maxHeight = 0;
                    let maxIdx = 0;
                    for (let i = 0; i < levels.length; i++) {
                        if (levels[i].height > maxHeight) {
                            maxHeight = levels[i].height;
                            maxIdx = i;
                        }
                    }
                    for (let i = 0; i < levels.length; i++) {
                        levels[i].enabled = (i === maxIdx);
                    }
                }
            })();
        `);
        log.info('[Quality] 최고 화질 자동 적용');
    } catch (e) {
        log.warn('[Quality] 적용 실패:', e.message);
    }
}

// ════════════════════════════════════════
//  번역 시스템
// ════════════════════════════════════════

const TRANSLATIONS = {
    ko: `
        .navbar-brand b::after { content: ' (TTFC)'; font-size: 0.7em; color: #aaa; }
    `
};

async function applyTranslation(lang) {
    if (!mainWindow || !mainWindow.webContents) return;
    await removeTranslation();

    if (lang === 'ja' || !lang) return;

    try {
        if (TRANSLATIONS[lang]) {
            translateCSS = await mainWindow.webContents.insertCSS(TRANSLATIONS[lang]);
        }

        if (lang === 'ko') {
            await mainWindow.webContents.executeJavaScript(`
                (function() {
                    if (window._ttfcTranslated) return;
                    window._ttfcTranslated = true;

                    const map = {
                        'トップページ': '홈',
                        'お気に入り': '즐겨찾기',
                        '購入動画': '구매 동영상',
                        'ログアウト': '로그아웃',
                        '検索キーワードを入力': '검색어 입력',
                        '再生': '재생',
                        '一覧': '목록',
                        '次の話': '다음 화',
                        '前の話': '이전 화',
                        'もっと見る': '더 보기',
                        '配信中': '배포 중',
                        '特別配信': '특별 배포',
                    };

                    function translateNode(node) {
                        if (node.nodeType === 3) {
                            let text = node.textContent;
                            for (const [ja, ko] of Object.entries(map)) {
                                text = text.replace(ja, ko);
                            }
                            if (text !== node.textContent) node.textContent = text;
                        }
                    }

                    function translateAll() {
                        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                        while (walker.nextNode()) translateNode(walker.currentNode);
                    }

                    translateAll();
                    const obs = new MutationObserver(() => setTimeout(translateAll, 300));
                    obs.observe(document.body, { childList: true, subtree: true });
                    window._ttfcTranslateObs = obs;
                })();
            `);
        }

        log.info('[Translate] 번역 적용:', lang);
    } catch (e) {
        log.warn('[Translate] 적용 실패:', e.message);
    }
}

async function removeTranslation() {
    if (!mainWindow || !mainWindow.webContents) return;
    try {
        if (translateCSS) {
            await mainWindow.webContents.removeInsertedCSS(translateCSS);
            translateCSS = null;
        }
        await mainWindow.webContents.executeJavaScript(`
            if (window._ttfcTranslateObs) { window._ttfcTranslateObs.disconnect(); window._ttfcTranslateObs = null; }
            window._ttfcTranslated = false;
        `);
    } catch (e) {
        translateCSS = null;
    }
}

// ════════════════════════════════════════
//  시스템 트레이
// ════════════════════════════════════════

function createTray() {
    let trayIcon;
    try {
        const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico');
        const pngPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
        trayIcon = nativeImage.createFromPath(icoPath);
        if (trayIcon.isEmpty()) {
            trayIcon = nativeImage.createFromPath(pngPath);
        }
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
        if (trayIcon.isEmpty()) throw new Error('no icon');
    } catch (e) {
        trayIcon = nativeImage.createFromBuffer(
            Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIklEQVQ4T2P8z8Dwn4EIwMgwagDDqAEMowYwjBoAAwACHAAR5XI1YAAAAABJRU5ErkJggg==', 'base64'),
            { width: 16, height: 16 }
        );
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('TTFC Viewer - 東映特撮ファンクラブ');

    const contextMenu = Menu.buildFromTemplate([
        { label: '🎬 TTFC Viewer 열기', click: () => { mainWindow.show(); mainWindow.focus(); } },
        { type: 'separator' },
        { label: '🏠 홈으로', click: () => { mainWindow.show(); mainWindow.loadURL(TTFC_URL); } },
        { label: '🔄 새로고침', click: () => mainWindow.reload() },
        { type: 'separator' },
        { label: '📡 Discord RPC', type: 'checkbox', checked: store.get('rpc.enabled'), click: (item) => {
            store.set('rpc.enabled', item.checked);
            item.checked ? discordRPC.connect() : discordRPC.disconnect();
        }},
        { label: '🚀 Windows 시작 시 자동 실행', type: 'checkbox', checked: store.get('autoStart'), click: (item) => {
            store.set('autoStart', item.checked);
            app.setLoginItemSettings({
                openAtLogin: item.checked,
                args: ['--hidden']
            });
        }},
        { type: 'separator' },
        { label: '🔍 업데이트 확인', click: () => checkForUpdatesManual() },
        { type: 'separator' },
        { label: '❌ 종료', click: () => { app.isQuitting = true; app.quit(); } }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });

    return tray;
}

// ════════════════════════════════════════
//  자동 업데이트
// ════════════════════════════════════════

function setupAutoUpdater() {
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch(err => {
            log.info('[Updater] 업데이트 서버 연결 불가');
        });
    }, 30000);

    setInterval(() => {
        autoUpdater.checkForUpdates().catch(() => {});
    }, 6 * 60 * 60 * 1000);

    autoUpdater.on('checking-for-update', () => { log.info('[Updater] 업데이트 확인 중...'); });

    autoUpdater.on('update-available', (info) => {
        log.info('[Updater] 새 버전:', info.version);
        if (!mainWindow) return;
        showNotification('TTFC Viewer 업데이트', `새 버전 v${info.version}을 사용할 수 있습니다!`);
        dialog.showMessageBox(mainWindow, {
            type: 'info', title: 'TTFC Viewer 업데이트',
            message: `새 버전이 있습니다! (v${info.version})`,
            detail: `현재: v${app.getVersion()}\n최신: v${info.version}\n\n지금 다운로드하시겠습니까?`,
            buttons: ['다운로드', '나중에'], defaultId: 0, cancelId: 1,
        }).then(({ response }) => {
            if (response === 0) {
                autoUpdater.downloadUpdate();
                sendToRenderer('update-status', { status: 'downloading', version: info.version });
            }
        });
    });

    autoUpdater.on('update-not-available', () => { log.info('[Updater] 최신 버전입니다.'); });

    autoUpdater.on('download-progress', (progress) => {
        log.info(`[Updater] 다운로드: ${Math.round(progress.percent)}%`);
        sendToRenderer('update-status', { status: 'downloading', percent: Math.round(progress.percent) });
    });

    autoUpdater.on('update-downloaded', (info) => {
        log.info('[Updater] 다운로드 완료:', info.version);
        if (!mainWindow) return;
        dialog.showMessageBox(mainWindow, {
            type: 'info', title: 'TTFC Viewer 업데이트',
            message: '업데이트 다운로드 완료!',
            detail: `v${info.version}을 설치하려면 앱을 다시 시작합니다.`,
            buttons: ['지금 재시작', '나중에'], defaultId: 0, cancelId: 1,
        }).then(({ response }) => {
            if (response === 0) autoUpdater.quitAndInstall(false, true);
        });
    });

    autoUpdater.on('error', (err) => { log.error('[Updater] 에러:', err.message); });
}

function checkForUpdatesManual() {
    autoUpdater.checkForUpdates().then((result) => {
        if (!result || !result.updateInfo) {
            dialog.showMessageBox(mainWindow, {
                type: 'info', title: '업데이트 확인',
                message: '현재 최신 버전입니다.', detail: `v${app.getVersion()}`, buttons: ['확인']
            });
        }
    }).catch((err) => {
        dialog.showMessageBox(mainWindow, {
            type: 'warning', title: '업데이트 확인 실패',
            message: '업데이트 서버에 연결할 수 없습니다.', detail: err.message, buttons: ['확인']
        });
    });
}

function sendToRenderer(channel, data) {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send(channel, data);
    }
}

// ════════════════════════════════════════
//  IPC: preload → main
// ════════════════════════════════════════

ipcMain.on('video-state-update', (event, data) => {
    if (store.get('rpc.enabled') && discordRPC) {
        data._settings = {
            showTime: store.get('rpc.showTime'),
            timeMode: store.get('rpc.timeMode'),
            showSeries: store.get('rpc.showSeries'),
            showEpisode: store.get('rpc.showEpisode'),
            showThumbnail: store.get('rpc.showThumbnail'),
        };
        discordRPC.updateFromVideoState(data);
    }

    if (data.isWatching) {
        clearIdleTimer();
        updateSMTC(data);
    } else {
        clearSMTC();
    }
});

ipcMain.on('page-navigation', (event, data) => {
    if (store.get('rpc.enabled') && discordRPC) {
        discordRPC.updateFromNavigation(data);
    }
    if (!data.isVideoPage) {
        startIdleTimer();
        clearSMTC();
    } else {
        clearIdleTimer();
    }
});

ipcMain.handle('get-page-info', async () => {
    if (!mainWindow) return null;
    const url = mainWindow.webContents.getURL();
    const title = await mainWindow.webContents.executeJavaScript('document.title');
    return { url, title };
});

// ── Idle Timer ──
function startIdleTimer() {
    clearIdleTimer();
    const minutes = store.get('rpc.idleTimeout');
    if (!minutes || minutes <= 0) return;
    idleTimer = setTimeout(() => {
        if (discordRPC && store.get('rpc.enabled')) {
            log.info(`[RPC] 비활성 ${minutes}분 초과 → 활동 숨김`);
            discordRPC.clearActivity();
        }
    }, minutes * 60 * 1000);
}

function clearIdleTimer() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

// ════════════════════════════════════════
//  앱 시작
// ════════════════════════════════════════

app.whenReady().then(() => {
    log.info(`[TTFC] 앱 시작 v${app.getVersion()}`);

    const startHidden = process.argv.includes('--hidden');

    app.setLoginItemSettings({
        openAtLogin: store.get('autoStart'),
        args: ['--hidden']
    });

    if (!startHidden) createSplashWindow();

    createMainWindow();

    if (startHidden) {
        mainWindow.hide();
        log.info('[TTFC] 숨김 모드로 시작 (트레이)');
    }

    // 트레이
    createTray();

    // ★ 스캔 매니저에 트레이 연결
    scanManager.setTray(tray);

    // Discord RPC
    discordRPC = new DiscordRPC(DISCORD_APP_ID);
    if (store.get('rpc.enabled') && store.get('rpc.autoConnect')) {
        discordRPC.connect();
        log.info('[RPC] 자동 연결 시작');
    }

    // 미디어키 등록
    if (store.get('shortcuts.mediaKeys')) {
        registerMediaKeys();
    }

    // 자동 업데이트
    setupAutoUpdater();

    // ttfc:// 링크로 앱이 시작된 경우
    const startLink = findDeepLink(process.argv);
    if (startLink) {
        mainWindow.webContents.once('did-finish-load', () => {
            handleDeepLink(startLink, mainWindow);
        });
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        } else {
            mainWindow.show();
        }
    });
});

app.on('before-quit', () => {
    app.isQuitting = true;
    globalShortcut.unregisterAll();
    scanManager.stop();
    if (discordRPC) discordRPC.disconnect();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
