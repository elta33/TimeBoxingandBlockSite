# 파이어폭스 병행 운영 계획 (Chrome + Firefox)

TBB(FocusBox)를 크롬 웹 스토어와 AMO(addons.mozilla.org) 양쪽에서 병행 운영하기 위한 구조와 절차.

## 0. 원칙

**소스는 1벌, 산출물만 2벌.** 리포지토리를 복사하거나 플랫폼별 브랜치를 만들지 않는다. 브랜치는 지금까지처럼 기능 단위로만 쓴다.

```
리포 루트 (git 관리, 손으로 편집하는 유일한 곳)
├── manifest.json              ← 크롬용 원본. 크롬은 루트를 그대로 unpacked 로드 (기존 워크플로 무변경)
├── manifest.firefox.json      ← 파이어폭스 오버레이 (변경되는 top-level 키만)
├── browser-shim.js            ← 양쪽 빌드에 동일 포함. 크롬에서는 no-op
├── build-firefox.ps1          ← manifest 병합 + 파일 복사 → dist/firefox
└── dist/                      ← .gitignore. 생성물이므로 절대 직접 편집하지 않는다
    ├── firefox/               ← 파이어폭스가 로드
    └── focusbox-firefox-<ver>.zip  ← AMO 제출용 (-Package)
```

두 산출물의 실질적 차이는 `manifest.json` 하나뿐이다. `.js`/`.html`/`.css`/`_locales`/에셋은 100% 동일한 파일이 복사된다.

## 1. 완료된 세팅

| 파일 | 변경 | 이유 |
|---|---|---|
| `browser-shim.js` (신규) | `if (typeof browser !== 'undefined') globalThis.chrome = browser;` | 파이어폭스의 `chrome.*`는 콜백 전용이라 Promise를 반환하지 않는다. `storage-api.js`/`background.js`가 `await chrome.storage.*`를 쓰므로 그대로 두면 저장 계층 전체가 조용히 깨진다. 파이어폭스 `browser.*`는 Promise + 콜백을 모두 받으므로 이 한 줄로 두 스타일이 살아난다. 크롬에는 `browser` 전역이 없어 no-op |
| `options.html` / `popup.html` / `block.html` / `pomodoro-pip.html` | 첫 `<script>` 앞에 `browser-shim.js` 추가 | `storage-api.js`(Promise 기반)를 로드하는 4개 페이지. 콘텐츠 스크립트(`content.js`, `strong-block-selectors.js`)는 콜백 스타일만 써서 제외 |
| `background.js` | `importScripts(...)`를 `typeof importScripts === 'function'` 가드로 감싸고 목록 맨 앞에 `browser-shim.js` 추가 | 크롬은 service worker라 `importScripts`로 읽고, 파이어폭스는 event page라 `importScripts`가 아예 없다. 파이어폭스는 `manifest.firefox.json`의 `background.scripts`가 같은 순서로 로드 |
| `manifest.firefox.json` (신규) | `background.scripts`, `browser_specific_settings.gecko` | `background` 키를 통째로 교체해 `service_worker`를 제거. `storage.sync`를 쓰려면 `gecko.id`가 필수 |
| `build-firefox.ps1` (신규) | 병합 + 복사 + 검증 + 선택적 zip | 병합이 어긋나면(크롬 키 잔존, 스크립트 누락) 파이어폭스에서 background가 안 뜨는데 원인 파악이 어려워, 빌드 단계에서 바로 실패시킨다 |
| `.gitignore` (신규) | `dist/` | 생성물 |

크롬 쪽 동작 변화는 없다. 추가된 `browser-shim.js`는 크롬에서 아무 일도 하지 않고, `importScripts` 가드는 크롬에서 항상 참이다.

## 2. 빌드 · 로드

```powershell
powershell -File build-firefox.ps1            # dist/firefox 생성
powershell -File build-firefox.ps1 -Package   # + AMO 제출용 zip
```

- **크롬**: `chrome://extensions` → 리포 루트를 unpacked 로드 (지금까지와 동일)
- **파이어폭스**: `about:debugging#/runtime/this-firefox` → "임시 부가 기능 로드" → `dist\firefox\manifest.json`
  - 임시 로드는 브라우저를 닫으면 사라진다. 소스를 고치면 **재빌드 → 다시 로드**해야 한다(dist는 복사본이라 자동 반영되지 않는다).
  - 두 브라우저에 동시에 설치해두고 병행 테스트해도 서로 간섭하지 않는다.

## 3. 남은 작업

### P1 — 실기기 검증 (가장 큰 비용, 여기서 회색지대가 판명된다)

파이어폭스 128 이상에서 `dist/firefox`를 임시 로드하고 아래를 순서대로 확인한다. 확장 API 동작은 코드 추적으로 대체할 수 없다.

**우선순위 A — 깨지면 확장이 무의미한 항목**
- [ ] background(event page)가 뜨는가. `about:debugging`의 "검사"에서 콘솔 에러 없이 `updateBlockingRules` 로그("우선순위 규칙 업데이트 성공! …")가 찍히는가
- [ ] 옵션 페이지에서 차단 도메인 추가 → 저장 → 재진입 시 유지되는가 (shim이 정상 동작하는지의 실질 테스트)
- [ ] 상시 차단 도메인 접속 시 `block.html`로 리다이렉트되는가
- [ ] **`block.html?domain=…&reason=…` 쿼리스트링이 전달되는가** ← 회색지대. 차단 화면에 도메인명과 사유 문구가 제대로 뜨는지로 판별
- [ ] 타임박스 활성 시간대에 일반 차단 리스트가 걸리고, 커스텀 허용 도메인은 통과하는가 (`finalAllowSet` 우회가 파이어폭스 우선순위 해석에서도 성립하는지)

**우선순위 B — 파이어폭스 고유 리스크**
- [ ] `options_ui.open_in_tab: true`가 먹히는가. 무시되고 `about:addons` 안 좁은 프레임에 갇히면 → `runtime.openOptionsPage()` 경로로 우회하거나 `open_in_tab` 제거 후 레이아웃 대응
- [ ] event page 언로드 후 재기동 시 포모도로가 정상인가. **1분 알람 틱**(`timeboxTicker`)이 계속 오는지, 화면을 30분 이상 방치했다가 페이즈가 제때 전환되는지 — service worker와 언로드 타이밍이 달라 여기가 가장 미묘하다
- [ ] `storage.sync`: 파이어폭스 계정 미로그인 상태에서 local 폴백이 동작하는가. 설정 탭의 동기화 상태 표시가 맞는가
- [ ] 한글(IDN) 도메인 등록 시 punycode 정규화가 동일하게 되는가

**우선순위 C — 기능 전반**
- [ ] SPA 차단: 유튜브 홈에서 영상 클릭, 인스타 사이드바 이동 (파이어폭스 147 미만이면 `page-world.js`의 history 패치 폴백 경로를 타므로, 가능하면 147 미만과 이상 양쪽에서 확인)
- [ ] 쇼츠/인스타 강력 차단: `registerContentScripts` 등록·해제, 코스메틱 숨김, 토글 시 열린 탭 자동 새로고침
- [ ] 포모도로 PiP: 파이어폭스 151+ 는 항상 위 승격, 그 미만은 일반 popup 창 폴백 (`documentPictureInPicture` feature-detect)
- [ ] 팝업 UI, 통계 탭, 도넛 뷰, 투두 패널, 다크모드, ko/en 로케일 전환
- [ ] export/import, PIN 잠금

### P2 — AMO 제출

- [ ] `gecko.id` 확정. 현재 `focusbox@elta33.github.io`로 넣어뒀다. **AMO에 한 번 등록하면 사실상 변경 불가**(변경 시 별개 확장으로 취급되고 `storage.sync` 데이터도 끊긴다). 도메인을 따로 쓸 계획이 있으면 제출 전에 바꿀 것
- [ ] `strict_min_version` 확정. 현재 `128.0` (= `world: "MAIN"`과 DNR 동적 규칙이 안정적으로 들어간 버전)
- [ ] 스토어 리스팅: `store-listing/` 자산 대부분 재활용 가능. 스크린샷의 크롬 UI 크롬(chrome) 부분이 보이면 파이어폭스 기준으로 다시 캡처
- [ ] 권한 사유 설명: `store-listing/CWS-permission-justification.md`를 AMO 리뷰어 노트용으로 옮겨 적는다. AMO는 사람 리뷰 비중이 높아 `<all_urls>`와 DNR 사용 이유를 명확히 쓰는 편이 심사가 빠르다
- [ ] 등록비 없음(CWS는 1회 $5). 소스코드 제출 의무는 **없다** — 이 빌드는 파일 복사와 JSON 병합뿐이고 minify/번들/트랜스파일이 없다

### P3 — 병행 운영 규칙

- **버전 번호는 양쪽 동일하게 유지한다.** 한쪽만 급히 고쳐야 할 때도 버전은 같이 올리고, 스토어별로 제출 시점만 다르게 한다. 버전이 갈리기 시작하면 "어느 스토어에 무엇이 나가 있는지"를 사람이 기억해야 한다
- 릴리스 순서: 소스 수정 → 크롬 루트에서 검증 → `build-firefox.ps1 -Package` → 파이어폭스에서 검증 → CWS 업로드 → AMO 업로드
- CWS는 이미 1.0이 제출된 상태다. 이번 세팅 변경은 크롬 동작에 영향이 없으므로 다음 정기 업데이트에 함께 올리면 된다

## 4. 유지보수 시 지켜야 할 것

1. **`dist/`는 절대 직접 편집하지 않는다.** 수정은 항상 리포 루트에.
2. **background 의존 파일을 추가하면 두 곳을 같이 고친다** — `background.js`의 `importScripts(...)`와 `manifest.firefox.json`의 `background.scripts`. 순서도 일치시켜야 한다(`storage-api.js`가 `background.js`보다 먼저). 빌드 스크립트가 "scripts에 있는데 산출물에 없는 파일"은 잡아주지만, "importScripts에만 추가하고 scripts에 빠뜨린" 경우는 못 잡는다 — 파이어폭스에서만 조용히 undefined가 된다.
3. **새 에셋 디렉터리를 만들면** `build-firefox.ps1`의 `$assetDirs`에 추가한다. 루트의 `.js`/`.html`/`.css`는 자동 포함된다.
4. **Promise 스타일 `chrome.*` 호출을 콘텐츠 스크립트에 추가하면** `browser-shim.js`를 해당 콘텐츠 스크립트 목록에도 주입해야 한다(현재는 콜백 스타일만 써서 제외돼 있다).
5. 매니페스트 권한/키를 추가할 때는 루트 `manifest.json`에만 넣으면 양쪽에 반영된다. 파이어폭스에서만 달라야 하는 키일 때만 `manifest.firefox.json`에 넣는다.

## 5. 별개 이슈 (이식과 무관)

`images/`의 기본 배경 이미지 5장이 총 45MB다(`Default_3.jpeg` 혼자 21.9MB). 크롬 빌드에도 그대로 들어가 있어 설치 용량과 스토어 업로드에 부담이 된다. 화면 표시용 해상도로 리사이즈 + JPEG 품질 조정하면 장당 수백 KB 수준으로 줄어든다. 파이어폭스 이식과 독립적으로 처리할 것.
