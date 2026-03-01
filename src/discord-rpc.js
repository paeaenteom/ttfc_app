// ============================================================
//  Discord RPC v5 - Queue System
//  
//  Discord rate limit: ~5 setActivity per 20s
//  Solution: Queue + debounce + priority system
//  Critical updates (play/pause/seek/episode) always go through
// ============================================================

const RPC = require('discord-rpc');
const log = require('electron-log');

const MIN_UPDATE_INTERVAL = 2000; // Discord 안전 간격 (2초 - 재생변경 빠른 반영)

class DiscordRichPresence {
    constructor(clientId) {
        this.clientId = clientId;
        this.client = null;
        this.connected = false;
        this.reconnectTimer = null;

        this.currentState = {
            isWatching: false,
            isPlaying: false,
            seriesName: '',
            episodeTitle: '',
            episodeNumber: '',
            currentTime: 0,
            duration: 0,
            thumbnail: '',
            pageTitle: '',
            pageUrl: '',
        };

        this._lastSent = {
            episode: '',
            playing: null,
            currentTime: 0,
            duration: 0,
        };

        // Queue system
        this._lastApiCall = 0;
        this._pendingUpdate = null;
        this._pendingTimer = null;
        this._refreshTimer = null;

        // 5분 비활동 → RPC 끄기
        this._idleTimer = null;
        this._IDLE_TIMEOUT = 5 * 60 * 1000;
    }

    connect() {
        if (this.connected) return;
        this.client = new RPC.Client({ transport: 'ipc' });

        const origRequest = this.client.request.bind(this.client);
        this.client.request = (cmd, args, evt) => {
            if (cmd === 'SET_ACTIVITY' && args && args.activity) {
                args.activity.type = 3;  // Watching (시청 중)
                args.activity.status_display_type = 2;  // 사이드바에 details 표시
            }
            return origRequest(cmd, args, evt);
        };

        this.client.on('ready', () => {
            this.connected = true;
            log.info('[RPC] Connected:', this.client.user?.username);
            this._sendNow({
                details: '東映特撮ファンクラブ',
                largeImageKey: 'ttfc_logo',
                largeImageText: '東映特撮ファンクラブ',
                instance: false,
                buttons: [{ label: '東映特撮ファンクラブ', url: 'https://pc.tokusatsu-fc.jp/' }]
            });
        });

        this.client.on('disconnected', () => {
            this.connected = false;
            this._stopRefreshTimer();
            this._scheduleReconnect();
        });

        this.client.login({ clientId: this.clientId }).catch((err) => {
            log.warn('[RPC] Connect failed:', err.message);
            this.connected = false;
            this._scheduleReconnect();
        });
    }

    disconnect() {
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        this._stopRefreshTimer();
        if (this._pendingTimer) { clearTimeout(this._pendingTimer); this._pendingTimer = null; }
        if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
        if (this.client) {
            try { this.client.clearActivity(); this.client.destroy(); } catch (e) {}
            this.client = null;
        }
        this.connected = false;
    }

    _scheduleReconnect() {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, 10000);
    }

    // ══════════════════════════════════════
    //  From preload
    // ══════════════════════════════════════

    updateFromVideoState(data) {
        if (!data) return;

        const settings = data._settings;
        delete data._settings;

        Object.assign(this.currentState, data);
        this.currentState._settings = settings || {};
        const s = this.currentState;

        if (!s.isWatching) {
            this._lastSent = { episode: '', playing: null, currentTime: 0, duration: 0 };
            this._stopRefreshTimer();
            this._queueUpdate('browsing');
            return;
        }

        // ── 변경 감지 ──
        const newEp = s.episodeNumber + s.episodeTitle + s.seriesName;
        const playChanged = s.isPlaying !== this._lastSent.playing;
        const episodeChanged = newEp !== this._lastSent.episode;
        const seeked = Math.abs(s.currentTime - this._lastSent.currentTime) > 3;
        const durationLoaded = s.duration > 0 && this._lastSent.duration === 0;
        const firstWatch = this._lastSent.playing === null;

        if (!playChanged && !episodeChanged && !seeked && !durationLoaded && !firstWatch) return;

        // _lastSent 업데이트
        this._lastSent.episode = newEp;
        this._lastSent.playing = s.isPlaying;
        this._lastSent.currentTime = s.currentTime;
        this._lastSent.duration = s.duration;

        // 재생/일시정지 변경은 즉시 반영 (큐 무시)
        if (playChanged) {
            this._forceUpdate('watching');
        } else {
            this._queueUpdate('watching');
        }

        // 재생 시작 → 주기적 리프레시 (타임스탬프 보정)
        if (s.isPlaying) {
            this._startRefreshTimer();
        } else {
            this._stopRefreshTimer();
        }
    }

    updateFromNavigation(data) {
        if (!data) return;
        this.currentState.pageTitle = data.title || '';
        this.currentState.pageUrl = data.url || '';
        if (!data.isVideoPage) {
            this.currentState.isWatching = false;
            this._lastSent = { episode: '', playing: null, currentTime: 0, duration: 0 };
            this._stopRefreshTimer();
            this._queueUpdate('browsing');
        }
    }

    // ══════════════════════════════════════
    //  Queue System
    // ══════════════════════════════════════

    _queueUpdate(type) {
        const now = Date.now();
        const elapsed = now - this._lastApiCall;

        // 쿨다운 지났으면 즉시 전송
        if (elapsed >= MIN_UPDATE_INTERVAL) {
            this._flushUpdate(type);
            return;
        }

        // 쿨다운 중 → 대기 (새 업데이트가 이전 것을 덮어씀)
        this._pendingUpdate = type;

        if (!this._pendingTimer) {
            const waitTime = MIN_UPDATE_INTERVAL - elapsed + 100;
            this._pendingTimer = setTimeout(() => {
                this._pendingTimer = null;
                if (this._pendingUpdate) {
                    const t = this._pendingUpdate;
                    this._pendingUpdate = null;
                    this._flushUpdate(t);
                }
            }, waitTime);
        }
    }

    // 재생/일시정지 변경 → 큐 무시하고 즉시 전송
    _forceUpdate(type) {
        if (this._pendingTimer) {
            clearTimeout(this._pendingTimer);
            this._pendingTimer = null;
        }
        this._pendingUpdate = null;
        this._flushUpdate(type);
    }

    _flushUpdate(type) {
        if (type === 'watching') {
            this._buildAndSendWatching();
        } else {
            this._buildAndSendBrowsing();
        }
    }

    // 재생 중 30초마다 타임스탬프 보정
    _startRefreshTimer() {
        this._stopRefreshTimer();
        this._refreshTimer = setInterval(() => {
            if (this.currentState.isWatching && this.currentState.isPlaying) {
                this._queueUpdate('watching');
            }
        }, 30000);
    }

    _stopRefreshTimer() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
    }

    // ══════════════════════════════════════
    //  Activity Builders
    // ══════════════════════════════════════

    _buildAndSendWatching() {
        const s = this.currentState;
        const settings = s._settings || {};

        // details = 작품명 → Discord 사이드바 이름 밑에 표시
        const seriesName = s.seriesName || '東映特撮ファンクラブ';

        // state = 에피소드 → 프로필 팝업 2줄째
        let episodeText = '';
        if (settings.showEpisode !== false) {
            if (s.episodeNumber && s.episodeTitle) {
                episodeText = `${s.episodeNumber} ${s.episodeTitle}`;
            } else if (s.episodeTitle) {
                episodeText = s.episodeTitle;
            } else if (s.episodeNumber) {
                episodeText = s.episodeNumber;
            }
        }

        const largeImage = (settings.showThumbnail !== false && s.thumbnail)
            ? s.thumbnail : 'ttfc_logo';

        const activity = {
            details: seriesName,
            state: episodeText || undefined,
            largeImageKey: largeImage,
            largeImageText: seriesName,
            smallImageKey: s.isPlaying ? 'ttfc_play' : 'ttfc_pause',
            smallImageText: s.isPlaying ? '재생 중' : '일시정지',
            instance: false,
            buttons: [{ label: '東映特撮ファンクラブ', url: 'https://pc.tokusatsu-fc.jp/' }]
        };

        // 타임스탬프: 재생 중일 때만 (Discord가 자동 카운트다운)
        const timeMode = settings.timeMode || 'progress';
        if (timeMode !== 'none' && settings.showTime !== false && s.duration > 0) {
            const now = Math.floor(Date.now() / 1000);
            if (s.isPlaying) {
                if (timeMode === 'progress') {
                    activity.startTimestamp = now - s.currentTime;
                    activity.endTimestamp = now + (s.duration - s.currentTime);
                } else if (timeMode === 'remaining') {
                    activity.endTimestamp = now + (s.duration - s.currentTime);
                }
            }
            // 일시정지 → 타임스탬프 없음 (카운트다운 자동 멈춤)
        }

        this._sendNow(activity);
    }

    _buildAndSendBrowsing() {
        const url = this.currentState.pageUrl || '';
        let details = '사이트 탐색 중';

        if (url.includes('/login')) details = '로그인 중...';
        else if (url.includes('/search')) details = '작품 검색 중';
        else if (url.includes('/mypage')) details = '마이페이지';

        this._sendNow({
            details,
            largeImageKey: 'ttfc_logo',
            largeImageText: '東映特撮ファンクラブ',
            startTimestamp: Math.floor(Date.now() / 1000),
            instance: false,
            buttons: [{ label: '東映特撮ファンクラブ', url: 'https://pc.tokusatsu-fc.jp/' }]
        });
    }

    // ══════════════════════════════════════
    //  Discord API (단일 호출 지점)
    // ══════════════════════════════════════

    _sendNow(activity) {
        if (!this.connected || !this.client) return;
        this._lastApiCall = Date.now();
        this._resetIdleTimer();
        try {
            this.client.setActivity(activity);
        } catch (err) {
            log.error('[RPC] Failed:', err.message);
        }
    }

    _resetIdleTimer() {
        if (this._idleTimer) clearTimeout(this._idleTimer);
        this._idleTimer = setTimeout(() => {
            log.info('[RPC] 5분 비활동 → Activity 제거');
            this._stopRefreshTimer();
            try { if (this.client) this.client.clearActivity(); } catch (e) {}
        }, this._IDLE_TIMEOUT);
    }

    clearActivity() {
        if (!this.connected || !this.client) return;
        this._stopRefreshTimer();
        if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
        try { this.client.clearActivity(); } catch (e) {}
    }
}

module.exports = DiscordRichPresence;
