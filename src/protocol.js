// ============================================================
//  TTFC Viewer - Deep Link Protocol Handler (SPA 대응)
//  ttfc:// URL → TTFC 콘텐츠로 이동
// ============================================================
//
//  지원 URL:
//    ttfc://show/12345    → 콘텐츠 페이지
//    ttfc://search/키워드  → 검색 페이지
//    ttfc://               → 홈
//
//  SPA 문제 해결:
//    TTFC는 SPA라서 loadURL()로 직접 콘텐츠 URL을 열면
//    앱이 초기화되지 않아 빈 페이지가 뜸.
//    → 이미 로딩된 상태면 executeJavaScript로 SPA 내 이동
//    → 콜드 스타트면 홈 로딩 후 SPA 내 이동
//
// ============================================================

const { app } = require('electron');
const path = require('path');
const log = require('electron-log');

const TTFC_BASE = 'https://pc.tokusatsu-fc.jp';

// ── 프로토콜 등록 ──
function setupProtocol() {
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient('ttfc', process.execPath, [path.resolve(process.argv[1])]);
        }
    } else {
        app.setAsDefaultProtocolClient('ttfc');
    }
    log.info('[Protocol] ttfc:// 프로토콜 등록 완료');
}

// ── URL 파싱 ──
function parseDeepLink(url) {
    if (!url) return null;

    // ttfc://show/12345
    const showMatch = url.match(/ttfc:\/\/show\/(\d+)/);
    if (showMatch) {
        return `${TTFC_BASE}/contents?contentId=${showMatch[1]}&contentType=0`;
    }

    // ttfc://search/키워드
    const searchMatch = url.match(/ttfc:\/\/search\/(.+)/);
    if (searchMatch) {
        return `${TTFC_BASE}/search?keyword=${searchMatch[1]}`;
    }

    // ttfc:// (기본)
    return TTFC_BASE;
}

// ── 딥링크 처리 (SPA 대응) ──
function handleDeepLink(url, mainWindow) {
    if (!url || !mainWindow) return;

    const targetUrl = parseDeepLink(url);
    if (!targetUrl) return;

    log.info(`[Protocol] 딥링크: ${url} → ${targetUrl}`);

    // 윈도우 표시
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();

    const currentUrl = mainWindow.webContents.getURL();

    if (currentUrl.includes('pc.tokusatsu-fc.jp')) {
        // ── 이미 TTFC 로딩됨 → SPA 내부 이동 ──
        log.info('[Protocol] SPA 내부 이동');
        mainWindow.webContents.executeJavaScript(
            `window.location.href = '${targetUrl}';`
        ).catch(err => {
            log.error('[Protocol] SPA 이동 실패, loadURL 폴백:', err);
            mainWindow.loadURL(targetUrl);
        });
    } else {
        // ── 콜드 스타트 / 다른 페이지 → 홈 먼저 로딩 후 이동 ──
        log.info('[Protocol] 콜드 스타트 → 홈 로딩 후 이동');
        mainWindow.loadURL(TTFC_BASE);
        mainWindow.webContents.once('did-finish-load', () => {
            // 홈 로딩 완료 후 잠시 대기 (SPA 초기화 시간)
            setTimeout(() => {
                log.info('[Protocol] SPA 초기화 완료 → 콘텐츠 이동');
                mainWindow.webContents.executeJavaScript(
                    `window.location.href = '${targetUrl}';`
                ).catch(err => log.error('[Protocol] 이동 실패:', err));
            }, 1500);
        });
    }
}

// ── argv에서 ttfc:// 찾기 ──
function findDeepLink(argv) {
    return argv.find(a => a.startsWith('ttfc://')) || null;
}

module.exports = { setupProtocol, handleDeepLink, findDeepLink };
