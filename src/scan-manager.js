// ============================================================
//  TTFC Scan Manager
//  
//  첫 실행: 전체 스캔 + 로딩 오버레이 + GitHub 저장
//  이후 실행: 백그라운드 체크 → 새 에피소드 발견 시 알림 + GitHub 자동 저장
// ============================================================

const path = require('path');
const fs = require('fs');
const { app, Notification } = require('electron');
const log = require('electron-log');
const TTFCScanner = require('./scanner');
const GitHubSync = require('./github-sync');

class ScanManager {
    constructor(options = {}) {
        // GitHub 설정
        this.github = new GitHubSync({
            owner: options.githubOwner || '',
            repo: options.githubRepo || '',
            token: options.githubToken || '',
            filePath: options.githubFile || 'data/ttfc-database.json',
        });

        this.scanner = new TTFCScanner();
        this.mainWindow = null;
        this.tray = null;

        // 로컬 캐시 (GitHub 못 쓸 때 대비)
        this.localPath = path.join(app.getPath('userData'), 'ttfc-database.json');
        this.data = null;

        // 백그라운드 체크 간격 (밀리초)
        this.checkInterval = options.checkInterval || 30 * 60 * 1000; // 30분
        this._checkTimer = null;
    }

    setMainWindow(win) { this.mainWindow = win; }
    setTray(tray) { this.tray = tray; }

    // ══════════════════════════════════════
    //  시작 (앱 실행 시 호출)
    // ══════════════════════════════════════

    async start() {
        log.info('[ScanManager] Starting...');

        // 1. 기존 데이터 로드 (GitHub → 로컬 순)
        this.data = await this._loadData();

        // 2. 첫 실행인지 판단
        const isFirstRun = !this.data || !this.data.lastFullScan;

        if (isFirstRun) {
            log.info('[ScanManager] First run detected → Full scan');
            await this._runFullScan();
        } else {
            log.info('[ScanManager] Data exists → Background check');
            // 약간의 딜레이 후 백그라운드 체크
            setTimeout(() => this._runQuickCheck(), 15000);
        }

        // 3. 주기적 백그라운드 체크 시작
        this._startPeriodicCheck();
    }

    // ══════════════════════════════════════
    //  전체 스캔 (첫 실행, 로딩 오버레이)
    // ══════════════════════════════════════

    async _runFullScan() {
        // 오버레이 표시
        this._sendOverlay('show');

        // 진행상황 콜백
        this.scanner.onProgress((p) => {
            this._sendOverlay('progress', p);
            if (this.tray) {
                this.tray.setToolTip(`TTFC - 스캔 중: ${p.message || ''}`);
            }
        });

        try {
            const result = await this.scanner.fullScan();

            if (result && result.shows) {
                this.data = result;

                // GitHub 저장
                this._sendOverlay('progress', { phase: 'saving', current: 0, total: 0, message: '' });
                const saved = await this.github.save(result);

                if (saved) {
                    log.info('[ScanManager] Full scan saved to GitHub');
                } else {
                    log.warn('[ScanManager] GitHub save failed, saving locally');
                }

                // 로컬에도 저장 (백업)
                this._saveLocal(result);

                // 완료 오버레이
                const total = Object.keys(result.shows).length;
                this._sendOverlay('progress', { phase: 'done', current: total, total, message: '' });

                // 2초 뒤 오버레이 숨김
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {
            log.error('[ScanManager] Full scan error:', e.message);
        }

        this._sendOverlay('hide');
        if (this.tray) this.tray.setToolTip('TTFC Viewer');
    }

    // ══════════════════════════════════════
    //  빠른 체크 (백그라운드, 차단 없음)
    // ══════════════════════════════════════

    async _runQuickCheck() {
        if (!this.data) return;

        log.info('[ScanManager] Quick check starting...');
        if (this.tray) this.tray.setToolTip('TTFC - 업데이트 확인 중...');

        try {
            const { newEpisodes, newShows } = await this.scanner.quickCheck(this.data);

            // 새 작품 발견
            for (const show of newShows) {
                this.data.shows[show.id] = show;
                this._notify(`🆕 새 작품: ${show.name}`, `${show.episodeCount}개 에피소드`);
                log.info('[ScanManager] New show:', show.name);
            }

            // 새 에피소드 발견
            for (const ep of newEpisodes) {
                this.data.shows[ep.id] = {
                    ...this.data.shows[ep.id],
                    episodeCount: ep.episodeCount,
                    episodes: ep.episodes,
                    lastEpisode: ep.lastEpisode,
                    scannedAt: ep.scannedAt,
                };

                const newNames = ep.newEpisodes.map(e => e.title).join(', ');
                this._notify(
                    `🔔 ${ep.name}`,
                    `새 에피소드 ${ep.newCount}개: ${newNames}`
                );
                log.info('[ScanManager] New episodes:', ep.name, '+' + ep.newCount);
            }

            // 변경사항 있으면 자동 저장 (차단 없이)
            if (newEpisodes.length > 0 || newShows.length > 0) {
                this.data.lastUpdate = new Date().toISOString();

                // GitHub 백그라운드 저장 (await 안 함 = 비차단)
                this.github.save(this.data).then(ok => {
                    if (ok) log.info('[ScanManager] Auto-saved to GitHub');
                    else log.warn('[ScanManager] GitHub auto-save failed');
                }).catch(e => log.error('[ScanManager] GitHub auto-save error:', e.message));

                // 로컬 저장
                this._saveLocal(this.data);
            } else {
                log.info('[ScanManager] No new content found');
            }

        } catch (e) {
            log.error('[ScanManager] Quick check error:', e.message);
        }

        if (this.tray) this.tray.setToolTip('TTFC Viewer');
    }

    // ══════════════════════════════════════
    //  주기적 체크
    // ══════════════════════════════════════

    _startPeriodicCheck() {
        if (this._checkTimer) clearInterval(this._checkTimer);
        this._checkTimer = setInterval(() => {
            this._runQuickCheck();
        }, this.checkInterval);
        log.info('[ScanManager] Periodic check every', this.checkInterval / 60000, 'min');
    }

    stop() {
        if (this._checkTimer) { clearInterval(this._checkTimer); this._checkTimer = null; }
        this.scanner.cancel();
    }

    // ══════════════════════════════════════
    //  데이터 로드/저장
    // ══════════════════════════════════════

    async _loadData() {
        // GitHub에서 먼저 시도
        if (this.github.isConfigured()) {
            try {
                const data = await this.github.load();
                if (data) {
                    this._saveLocal(data); // 로컬에 캐시
                    return data;
                }
            } catch (e) {
                log.warn('[ScanManager] GitHub load failed:', e.message);
            }
        }

        // 로컬에서 로드
        return this._loadLocal();
    }

    _loadLocal() {
        try {
            if (fs.existsSync(this.localPath)) {
                const raw = fs.readFileSync(this.localPath, 'utf-8');
                return JSON.parse(raw);
            }
        } catch (e) {
            log.warn('[ScanManager] Local load failed:', e.message);
        }
        return null;
    }

    _saveLocal(data) {
        try {
            fs.writeFileSync(this.localPath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e) {
            log.warn('[ScanManager] Local save failed:', e.message);
        }
    }

    // ══════════════════════════════════════
    //  유틸리티
    // ══════════════════════════════════════

    _sendOverlay(action, progressData) {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        try {
            if (action === 'show' || action === 'hide') {
                this.mainWindow.webContents.send('scan-overlay', { action });
            } else if (action === 'progress') {
                this.mainWindow.webContents.send('scan-overlay', { action: 'progress', ...progressData });
            }
        } catch (e) {}
    }

    _notify(title, body) {
        try {
            if (Notification.isSupported()) {
                const n = new Notification({ title, body, icon: undefined });
                n.on('click', () => {
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.show();
                        this.mainWindow.focus();
                    }
                });
                n.show();
            }
        } catch (e) {
            log.warn('[ScanManager] Notification failed:', e.message);
        }
    }

    // ══════════════════════════════════════
    //  외부에서 데이터 조회
    // ══════════════════════════════════════

    getShowCount() {
        return this.data ? Object.keys(this.data.shows || {}).length : 0;
    }

    getLastScanTime() {
        return this.data ? this.data.lastFullScan : null;
    }

    getAllShows() {
        return this.data ? this.data.shows || {} : {};
    }
}

module.exports = ScanManager;
