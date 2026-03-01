// ============================================================
//  GitHub Sync - 작품/에피소드 데이터를 GitHub에 저장/로드
//  
//  GitHub API (Contents API) 사용
//  저장 파일: data/ttfc-database.json
// ============================================================

const https = require('https');
const log = require('electron-log');

class GitHubSync {
    constructor(options = {}) {
        this.owner = options.owner || '';
        this.repo = options.repo || '';
        this.token = options.token || '';
        this.filePath = options.filePath || 'data/ttfc-database.json';
        this._sha = null; // 파일 SHA (업데이트 시 필요)
    }

    isConfigured() {
        return !!(this.owner && this.repo && this.token);
    }

    // ── GitHub API 요청 ──
    _request(method, apiPath, body = null) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: apiPath,
                method,
                headers: {
                    'Authorization': `token ${this.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'TTFC-Viewer-App',
                    'Content-Type': 'application/json',
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(json);
                        } else {
                            reject(new Error(`GitHub API ${res.statusCode}: ${json.message || data}`));
                        }
                    } catch (e) {
                        reject(new Error(`GitHub API parse error: ${e.message}`));
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(30000, () => { req.destroy(); reject(new Error('GitHub API timeout')); });

            if (body) req.write(JSON.stringify(body));
            req.end();
        });
    }

    // ── 데이터 로드 (GitHub에서) ──
    async load() {
        if (!this.isConfigured()) {
            log.warn('[GitHub] Not configured');
            return null;
        }

        try {
            const result = await this._request(
                'GET',
                `/repos/${this.owner}/${this.repo}/contents/${this.filePath}`
            );

            this._sha = result.sha;
            const content = Buffer.from(result.content, 'base64').toString('utf-8');
            const data = JSON.parse(content);
            log.info('[GitHub] Loaded:', Object.keys(data.shows || {}).length, 'shows');
            return data;
        } catch (e) {
            if (e.message.includes('404')) {
                log.info('[GitHub] No existing data file (first run)');
                return null;
            }
            log.error('[GitHub] Load failed:', e.message);
            return null;
        }
    }

    // ── 데이터 저장 (GitHub에) ──
    async save(data) {
        if (!this.isConfigured()) {
            log.warn('[GitHub] Not configured, cannot save');
            return false;
        }

        try {
            // 저장 전에 최신 SHA 가져오기 (충돌 방지)
            try {
                const existing = await this._request(
                    'GET',
                    `/repos/${this.owner}/${this.repo}/contents/${this.filePath}`
                );
                this._sha = existing.sha;
            } catch (e) {
                // 파일이 없으면 새로 만듦
                if (!e.message.includes('404')) throw e;
                this._sha = null;
            }

            const content = Buffer.from(
                JSON.stringify(data, null, 2), 'utf-8'
            ).toString('base64');

            const body = {
                message: `[TTFC] 데이터 업데이트 (${new Date().toLocaleString('ko-KR')})`,
                content,
            };
            if (this._sha) body.sha = this._sha;

            const result = await this._request(
                'PUT',
                `/repos/${this.owner}/${this.repo}/contents/${this.filePath}`,
                body
            );

            this._sha = result.content.sha;
            log.info('[GitHub] Saved:', Object.keys(data.shows || {}).length, 'shows');
            return true;
        } catch (e) {
            log.error('[GitHub] Save failed:', e.message);
            return false;
        }
    }

    // ── 부분 업데이트 (새 에피소드만 추가) ──
    async updateShows(updatedShows) {
        if (!this.isConfigured()) return false;

        try {
            // 현재 데이터 로드
            let data = await this.load();
            if (!data) {
                data = { shows: {}, lastFullScan: null, lastUpdate: null };
            }

            // 업데이트된 작품만 덮어쓰기
            for (const show of updatedShows) {
                data.shows[show.id] = show;
            }
            data.lastUpdate = new Date().toISOString();

            // 저장
            return await this.save(data);
        } catch (e) {
            log.error('[GitHub] Update failed:', e.message);
            return false;
        }
    }
}

module.exports = GitHubSync;
