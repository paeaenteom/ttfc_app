# 🎬 TTFC Viewer

東映特撮ファンクラブ PC 전용 앱 + Discord Rich Presence

## Discord RPC 다이나믹 표시

```
┌─────────────────────────────────────┐
│  보고있음  東映特撮ファンクラブ          │
│  ┌─────┐  仮面ライダーゼッツ           │
│  │TTFC │  Case1  始まる               │
│  │LOGO │  ▶ (12:30 / 24:00)          │
│  └─────┘                             │
│  ⏱ 11:30 남음                        │
│            >> 東映特撮ファンクラブ       │
└─────────────────────────────────────┘
```

## 기능

- TTFC 사이트를 PC 앱으로 (Electron)
- **Discord RPC 다이나믹**: 작품명 / 에피소드 / 재생시간 자동 감지
- 재생 ▶ / 일시정지 ⏸ 아이콘 변경
- 남은 시간 카운트다운
- 시스템 트레이 최소화
- **자동 업데이트** (GitHub Releases)
- 스플래시 로딩 화면

---

## 설치 방법

### A. 설치 파일 (.exe) 사용 (추천)

1. [Releases](https://github.com/YOUR_GITHUB_USERNAME/ttfc-viewer/releases) 에서 `TTFC-Viewer-Setup-x.x.x.exe` 다운로드
2. 실행 → 설치
3. 바탕화면 또는 시작 메뉴에서 **TTFC Viewer** 실행

### B. 직접 빌드

```bash
# 1. 소스 다운로드 후 폴더로 이동
cd ttfc-app

# 2. build.bat 더블클릭 (또는)
npm install
npm run build

# 3. dist/ 폴더에 설치 파일 생성됨
#    TTFC-Viewer-Setup-1.0.0.exe
```

---

## Discord Developer Portal 설정 (필수)

App ID: `930474217865101372`

### 1. Activity Type 변경

1. https://discord.com/developers/applications → `930474217865101372`
2. **General Information**
3. **Activity Type** → **WATCHING** 선택
4. Save

> ⚠️ 이걸 안 하면 "하고있음"으로 뜹니다. "보고있음"으로 하려면 반드시 WATCHING!

### 2. Rich Presence 이미지 등록

**Rich Presence** → **Art Assets** 에서 이미지 업로드:

| 키 이름 | 용도 | 권장 크기 |
|---------|------|----------|
| `ttfc_logo` | 메인 로고 (큰 이미지) | 512x512 |
| `play_icon` | 재생 중 ▶ (작은 이미지) | 128x128 |
| `pause_icon` | 일시정지 ⏸ (작은 이미지) | 128x128 |

---

## 자동 업데이트 설정 (배포자용)

### GitHub Releases 기반 업데이트

1. `package.json`에서 `build.publish.owner`와 `repo` 수정

```json
"publish": {
  "provider": "github",
  "owner": "YOUR_GITHUB_USERNAME",
  "repo": "ttfc-viewer"
}
```

2. GitHub Personal Access Token 생성
   - https://github.com/settings/tokens
   - 권한: `repo`

3. 새 버전 배포

```bash
# package.json version 올리기 (예: 1.0.0 → 1.1.0)

# 환경변수 설정
set GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# 빌드 + GitHub Release 업로드
npm run publish
```

4. 사용자 앱이 자동으로 업데이트 감지 → 다운로드 → 설치

### 업데이트 흐름

```
앱 시작 (30초 후) → 업데이트 확인
                  → 새 버전 발견 → 다이얼로그 "다운로드?" 
                  → 다운로드 완료 → "지금 재시작?"
                  → 재시작 → 자동 설치
                  
6시간마다 백그라운드 체크
```

---

## 파일 구조

```
ttfc-app/
├── src/
│   ├── main.js           # Electron 메인 (윈도우, 트레이, 업데이트)
│   ├── preload.js         # TTFC DOM에서 영상 정보 추출
│   └── discord-rpc.js     # Discord Rich Presence 모듈
├── assets/
│   ├── icon.png           # 앱 아이콘 (256x256)
│   ├── icon.ico           # Windows 아이콘
│   └── tray-icon.png      # 트레이 아이콘 (16x16)
├── package.json
├── build.bat              # 빌드 스크립트
├── start.bat              # 개발 실행
├── publish.bat            # 업데이트 배포
└── README.md
```

## 단축키

| 키 | 기능 |
|----|------|
| F5 | 새로고침 |
| F11 | 전체화면 |
| F12 | 개발자 도구 |
| Alt+← | 뒤로 |
| Alt+→ | 앞으로 |
| Ctrl++ | 확대 |
| Ctrl+- | 축소 |
| Ctrl+0 | 원래 크기 |

## 트러블슈팅

### RPC가 안 뜸
- Discord가 실행 중인지 확인
- 메뉴 → Discord → RPC 재연결

### "하고있음"으로 뜸
- Developer Portal → Activity Type → **WATCHING** 변경

### 영상 정보 안 잡힘
- F12 → 콘솔에서 `[TTFC]` 로그 확인
- `preload.js`의 셀렉터를 실제 사이트에 맞춰 수정 필요할 수 있음

### 업데이트 안 됨
- 메뉴 → 도움말 → 업데이트 확인
- GitHub Releases에 latest 버전 있는지 확인
