// ============================================================
//  TTFC Viewer - Full Scanner
//  전체 작품 + 에피소드 스캔 (로딩 오버레이 + 진행 보고)
// ============================================================

const { BrowserWindow } = require('electron');
const log = require('electron-log');

const TTFC_URL = 'https://pc.tokusatsu-fc.jp/';

class FullScanner {
    constructor(onProgress) {
        this.onProgress = onProgress || (() => {});
        this.scanning = false;
        this._checker = null;
    }

    // ═══════════════════════════════
    //  전체 스캔 (차단형)
    // ═══════════════════════════════

    async scan() {
        if (this.scanning) return null;
        this.scanning = true;

        log.info('[Scanner] === 전체 스캔 시작 ===');
        this.onProgress('init', 0, 0, '스캔 준비 중...');

        let checker;
        try {
            checker = new BrowserWindow({
                show: false, width: 1280, height: 800,
                webPreferences: { nodeIntegration: false, contextIsolation: true }
            });
            this._checker = checker;

            // ── 1단계: 작품 목록 수집 ──
            this.onProgress('collecting', 0, 0, 'TTFC 홈페이지 로딩...');
            await checker.loadURL(TTFC_URL);
            await this._wait(5000);

            for (let i = 0; i < 8; i++) {
                await checker.webContents.executeJavaScript('window.scrollBy(0, 1500)');
                await this._wait(1000);
            }

            let shows = await this._scrapeShowLinks(checker);
            log.info('[Scanner] 홈:', shows.length, '작품');

            // 카테고리 + 더보기 페이지
            const extraPages = [
                { url: TTFC_URL + 'genre', name: '장르별' },
                { url: TTFC_URL + 'new', name: '신작' },
                { url: TTFC_URL + 'ranking', name: '랭킹' },
            ];

            for (let p = 0; p < extraPages.length; p++) {
                const page = extraPages[p];
                this.onProgress('collecting', p + 1, extraPages.length, `${page.name} 목록 수집 중...`);
                try {
                    await checker.loadURL(page.url);
                    await this._wait(4000);
                    for (let i = 0; i < 10; i++) {
                        await checker.webContents.executeJavaScript('window.scrollBy(0, 1500)');
                        await this._wait(800);
                        await checker.webContents.executeJavaScript(`
                            (function() {
                                const btns = document.querySelectorAll('button, a, span, div');
                                for (const b of btns) {
                                    const t = b.textContent.trim();
                                    if (t === 'もっと見る' || t === 'MORE' || t === 'more' || t === '더 보기') { b.click(); return; }
                                }
                            })();
                        `).catch(() => {});
                        await this._wait(500);
                    }
                    const more = await this._scrapeShowLinks(checker);
                    const ids = new Set(shows.map(s => s.id));
                    const newOnes = more.filter(s => !ids.has(s.id));
                    if (newOnes.length > 0) { shows = [...shows, ...newOnes]; log.info('[Scanner]', page.name, '+', newOnes.length); }
                } catch (e) { log.warn('[Scanner]', page.name, '실패'); }
            }

            log.info('[Scanner] 총', shows.length, '작품 발견');
            if (shows.length === 0) { this.scanning = false; return { shows: [], lastFullScan: new Date().toISOString(), totalShows: 0, totalEpisodes: 0 }; }

            // ── 2단계: 각 작품 에피소드 스캔 ──
            const results = [];
            await checker.loadURL(TTFC_URL);
            await this._wait(3000);

            for (let i = 0; i < shows.length; i++) {
                const show = shows[i];
                this.onProgress('scanning', i + 1, shows.length, show.name);

                try {
                    const showUrl = `https://pc.tokusatsu-fc.jp/contents?contentId=${show.id}&contentType=0`;
                    await checker.webContents.executeJavaScript(`window.location.href = '${showUrl}';`);
                    await this._wait(4000);

                    // 에피소드 더보기 스크롤
                    for (let s = 0; s < 5; s++) {
                        await checker.webContents.executeJavaScript('window.scrollBy(0, 1000)');
                        await this._wait(500);
                        await checker.webContents.executeJavaScript(`
                            (function() { const btns = document.querySelectorAll('button, a, span, div');
                            for (const b of btns) { const t = b.textContent.trim(); if (t === 'もっと見る' || t === 'MORE') { b.click(); return; } } })();
                        `).catch(() => {});
                        await this._wait(500);
                    }

                    const detail = await checker.webContents.executeJavaScript(`
                        (function() {
                            const titleEl = document.querySelector('div.title') || document.querySelector('h1');
                            const name = titleEl ? titleEl.textContent.trim() : '';
                            const epEls = document.querySelectorAll('span.title');
                            const episodes = [];
                            epEls.forEach(el => {
                                const t = el.textContent.trim();
                                if (t.length > 2) {
                                    const m = t.match(/^(Case\\s*\\d+|第\\s*\\d+\\s*話|EP\\.?\\s*\\d+|Mission\\s*\\d+|Ｍｉｓｓｉｏｎ\\s*\\d+)\\s*[「『\\[　\\s]\\s*(.+?)\\s*[」』\\]]?\\s*$/i);
                                    if (m) episodes.push({ number: m[1].trim(), title: m[2].trim(), full: t });
                                    else episodes.push({ number: '', title: t, full: t });
                                }
                            });
                            let thumb = '';
                            const og = document.querySelector('meta[property="og:image"]');
                            if (og) thumb = og.content || '';
                            if (!thumb) { const imgs = document.querySelectorAll('img');
                                for (const img of imgs) { const src = img.src || '';
                                    if (src && !src.includes('logo') && !src.includes('icon') && (img.naturalWidth > 200 || img.width > 200)) { thumb = src; break; } } }
                            return { name, episodes, episodeCount: episodes.length, thumbnail: thumb };
                        })();
                    `);

                    results.push({
                        id: show.id, name: detail.name || show.name, url: show.url,
                        episodes: detail.episodes, episodeCount: detail.episodeCount,
                        thumbnail: detail.thumbnail || '', lastChecked: new Date().toISOString(),
                    });
                    log.info(`[Scanner] (${i+1}/${shows.length}) ${detail.name || show.name}: ${detail.episodeCount}화`);
                } catch (e) {
                    log.warn(`[Scanner] (${i+1}/${shows.length}) ${show.name} 실패`);
                    results.push({ id: show.id, name: show.name, url: show.url, episodes: [], episodeCount: 0, thumbnail: '', lastChecked: new Date().toISOString(), error: true });
                }

                if (i < shows.length - 1) await this._wait(2000);
            }

            this.onProgress('done', shows.length, shows.length, '스캔 완료!');
            log.info('[Scanner] === 완료 ===', results.length, '작품,', results.reduce((s, r) => s + r.episodeCount, 0), '화');

            this.scanning = false;
            return {
                lastFullScan: new Date().toISOString(),
                totalShows: results.length,
                totalEpisodes: results.reduce((s, r) => s + r.episodeCount, 0),
                shows: results,
            };
        } catch (e) {
            log.error('[Scanner] 에러:', e.message);
            this.scanning = false;
            return null;
        } finally {
            try { if (checker) checker.close(); } catch (e) {}
            this._checker = null;
        }
    }

    // ═══════════════════════════════
    //  빠른 체크 (새 에피소드만, 비차단)
    // ═══════════════════════════════

    async quickCheck(savedData) {
        if (this.scanning || !savedData?.shows) return [];
        this.scanning = true;
        log.info('[Scanner] 빠른 체크 시작...');

        const newEpisodes = [];
        let checker;
        try {
            checker = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { nodeIntegration: false, contextIsolation: true } });
            await checker.loadURL(TTFC_URL);
            await this._wait(4000);

            for (let i = 0; i < savedData.shows.length; i++) {
                const show = savedData.shows[i];
                if (show.error) continue;
                try {
                    await checker.webContents.executeJavaScript(`window.location.href = 'https://pc.tokusatsu-fc.jp/contents?contentId=${show.id}&contentType=0';`);
                    await this._wait(3500);
                    const result = await checker.webContents.executeJavaScript(`
                        (function() {
                            const eps = document.querySelectorAll('span.title');
                            const list = []; eps.forEach(el => { const t = el.textContent.trim(); if (t.length > 2) list.push(t); });
                            let thumb = ''; const og = document.querySelector('meta[property="og:image"]'); if (og) thumb = og.content || '';
                            return { count: list.length, last: list[list.length - 1] || '', thumb };
                        })();
                    `);

                    if (result.count > show.episodeCount) {
                        const diff = result.count - show.episodeCount;
                        // 새 에피소드 상세
                        const newEps = await checker.webContents.executeJavaScript(`
                            (function() { const eps = document.querySelectorAll('span.title'); const list = [];
                            eps.forEach(el => { const t = el.textContent.trim(); if (t.length > 2) {
                                const m = t.match(/^(Case\\s*\\d+|第\\s*\\d+\\s*話|EP\\.?\\s*\\d+|Mission\\s*\\d+)\\s*[「『\\[　\\s]\\s*(.+?)\\s*[」』\\]]?\\s*$/i);
                                if (m) list.push({ number: m[1].trim(), title: m[2].trim(), full: t }); else list.push({ number: '', title: t, full: t }); } }); return list; })();
                        `);
                        newEpisodes.push({ show, diff, newCount: result.count, newEpisodes: newEps, lastEpisode: result.last, thumbnail: result.thumb || show.thumbnail });
                        show.episodeCount = result.count;
                        show.episodes = newEps;
                        show.lastChecked = new Date().toISOString();
                        log.info('[Scanner] 새 에피소드!', show.name, '+' + diff);
                    }
                } catch (e) { log.warn('[Scanner]', show.name, '실패'); }
                if (i < savedData.shows.length - 1) await this._wait(1500);
            }
        } catch (e) { log.error('[Scanner] 빠른 체크 에러:', e.message);
        } finally { try { if (checker) checker.close(); } catch (e) {} this.scanning = false; }

        log.info('[Scanner] 빠른 체크 완료. 새:', newEpisodes.length);
        return newEpisodes;
    }

    async _scrapeShowLinks(checker) {
        return await checker.webContents.executeJavaScript(`
            (function() { const r = [], seen = new Set();
            document.querySelectorAll('a[href*="contentId"], a[href*="/show/"], a[href*="contents"]').forEach(el => {
                const href = el.href || ''; const m = href.match(/contentId=(\\d+)/) || href.match(/\\/show\\/(\\d+)/) || href.match(/contents\\/(\\d+)/);
                if (!m) return; const id = m[1]; if (seen.has(id)) return; seen.add(id);
                const tc = el.querySelector('.title, span, p, h3, img[alt]'); let t = '';
                if (tc && tc.tagName === 'IMG') t = tc.alt || ''; else if (tc) t = tc.textContent.trim(); else t = el.textContent.trim();
                if (t.length > 1 && t.length < 100) r.push({ id, name: t, url: href }); }); return r; })();
        `);
    }

    _wait(ms) { return new Promise(r => setTimeout(r, ms)); }
    stop() { this.scanning = false; try { if (this._checker) this._checker.close(); } catch (e) {} }
}

module.exports = FullScanner;
