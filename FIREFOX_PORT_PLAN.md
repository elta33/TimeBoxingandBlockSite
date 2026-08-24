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

```
build-firefox.cmd            # dist/firefox 생성
build-firefox.cmd -Package   # + AMO 제출용 zip
```

`.cmd`를 거치는 이유: 윈도우 기본 실행 정책이 `Restricted`라 `.ps1`을 직접 실행하면 `UnauthorizedAccess` 오류가 난다. 래퍼가 **그 프로세스에서만** `-ExecutionPolicy Bypass`로 우회하므로 시스템 설정은 건드리지 않는다. (실행 정책을 영구히 바꾸고 싶다면 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`를 직접 실행하면 되지만, 래퍼로 충분하다.)

인코딩 주의: `build-firefox.ps1`은 **UTF-8 BOM**으로 저장해야 한다(PowerShell 5.1이 BOM 없는 UTF-8을 ANSI로 읽어 한글 출력이 깨진다). `build-firefox.cmd`는 반대로 **ASCII만** 써야 한다(cmd.exe가 배치 파일을 ANSI로 읽어, 한글 주석이 깨지면 명령으로 오해석된다).

- **크롬**: `chrome://extensions` → 리포 루트를 unpacked 로드 (지금까지와 동일)
- **파이어폭스**: `about:debugging#/runtime/this-firefox` → "임시 부가 기능 로드" → `dist\firefox\manifest.json`
  - 임시 로드는 브라우저를 닫으면 사라진다. 소스를 고치면 **재빌드 → 다시 로드**해야 한다(dist는 복사본이라 자동 반영되지 않는다).
  - 두 브라우저에 동시에 설치해두고 병행 테스트해도 서로 간섭하지 않는다.

## 3. 남은 작업

### P1 — 실기기 검증 (가장 큰 비용, 여기서 회색지대가 판명된다)

파이어폭스 128 이상에서 `dist/firefox`를 임시 로드하고 아래를 순서대로 확인한다. 확장 API 동작은 코드 추적으로 대체할 수 없다.

**우선순위 A — 깨지면 확장이 무의미한 항목**
- [o] background(event page)가 뜨는가. `about:debugging`의 "검사"에서 콘솔 에러 없이 `updateBlockingRules` 로그("우선순위 규칙 업데이트 성공! …")가 찍히는가
- [o] 옵션 페이지에서 차단 도메인 추가 → 저장 → 재진입 시 유지되는가 (shim이 정상 동작하는지의 실질 테스트)
- [o] 상시 차단 도메인 접속 시 `block.html`로 리다이렉트되는가
- [o] **`block.html?domain=…&reason=…` 쿼리스트링이 전달되는가** ← 회색지대. 차단 화면에 도메인명과 사유 문구가 제대로 뜨는지로 판별
- [o] 타임박스 활성 시간대에 일반 차단 리스트가 걸리고, 커스텀 허용 도메인은 통과하는가 (`finalAllowSet` 우회가 파이어폭스 우선순위 해석에서도 성립하는지)

**우선순위 B — 파이어폭스 고유 리스크**
- [o] `options_ui.open_in_tab: true`가 먹히는가. 무시되고 `about:addons` 안 좁은 프레임에 갇히면 → `runtime.openOptionsPage()` 경로로 우회하거나 `open_in_tab` 제거 후 레이아웃 대응
- [o] event page 언로드 후 재기동 시 포모도로가 정상인가. **1분 알람 틱**(`timeboxTicker`)이 계속 오는지, 화면을 30분 이상 방치했다가 페이즈가 제때 전환되는지 — service worker와 언로드 타이밍이 달라 여기가 가장 미묘하다
- [o] `storage.sync`: 파이어폭스 계정 미로그인 상태에서 local 폴백이 동작하는가. 설정 탭의 동기화 상태 표시가 맞는가
- [o] 한글(IDN) 도메인 등록 시 punycode 정규화가 동일하게 되는가

**우선순위 C — 기능 전반**
- [o] SPA 차단: 유튜브 홈에서 영상 클릭, 인스타 사이드바 이동 (파이어폭스 147 미만이면 `page-world.js`의 history 패치 폴백 경로를 타므로, 가능하면 147 미만과 이상 양쪽에서 확인)
  - 1차 테스트에서 **버그 발견 → 수정 → 크롬·파이어폭스 양쪽 재검증 완료**(아래 5절)
- [o] 쇼츠/인스타 강력 차단: `registerContentScripts` 등록·해제, 코스메틱 숨김, 토글 시 열린 탭 자동 새로고침
- [o] 포모도로 PiP: 파이어폭스 151+ 는 항상 위 승격, 그 미만은 일반 popup 창 폴백 (`documentPictureInPicture` feature-detect)
- [o] 팝업 UI, 통계 탭, 도넛 뷰, 투두 패널, 다크모드, ko/en 로케일 전환
- [o] export/import, PIN 잠금

### P2 — AMO 제출

**버전 정책 결정 (2026-08-20):** CWS의 `1.0`은 이미 게시된 상태이고 거기엔 SPA 차단 버그(5절)가 들어 있다. 따라서 **`1.0.1`을 양 스토어에 동일하게 제출한다.** AMO의 첫 릴리스는 `1.0`이 아니라 `1.0.1`이 된다 — 같은 버전 번호가 서로 다른 내용을 가리키는 상황을 첫 릴리스부터 만들지 않기 위함이다.

- [x] 버전 `1.0.1`로 상향 (`manifest.json`)
- [x] 배경 이미지 압축 완료 — 45MB → 2.1MB (가로 2560px, JPEG 품질 85). 패키지 44MB → 2.2MB
- [ ] **CWS `1.0.1` 업데이트 제출** — SPA 차단 버그 수정이 크롬 사용자에게도 필요하다. AMO보다 먼저 또는 동시에
- [ ] `gecko.id` 확정. 현재 `focusbox@elta33.github.io`로 넣어뒀다. **AMO에 한 번 등록하면 사실상 변경 불가**(변경 시 별개 확장으로 취급되고 `storage.sync` 데이터도 끊긴다). 도메인을 따로 쓸 계획이 있으면 제출 전에 바꿀 것
- [ ] `strict_min_version` 확정. 현재 `128.0` (= `world: "MAIN"`과 DNR 동적 규칙이 안정적으로 들어간 버전)
- [ ] 스토어 리스팅: `store-listing/` 자산 대부분 재활용 가능. 스크린샷의 크롬 UI 크롬(chrome) 부분이 보이면 파이어폭스 기준으로 다시 캡처
- [ ] 권한 사유 설명: `store-listing/CWS-permission-justification.md`를 AMO 리뷰어 노트용으로 옮겨 적는다. AMO는 사람 리뷰 비중이 높아 `<all_urls>`와 DNR 사용 이유를 명확히 쓰는 편이 심사가 빠르다
- [ ] 등록비 없음(CWS는 1회 $5). 소스코드 제출 의무는 **없다** — 이 빌드는 파일 복사와 JSON 병합뿐이고 minify/번들/트랜스파일이 없다
- [ ] **서명본 최종 확인** — AMO 심사 통과 후 서명된 버전을 정식 설치해서, 임시 로드로는 검증할 수 없었던 항목을 확인한다: `storage.sync`의 실제 기기 간 동기화(양쪽 프로필에 같은 Firefox 계정 로그인 필요), 브라우저 재시작 후 확장 유지, 자동 업데이트

### P3 — 병행 운영 규칙

- **버전 번호는 양쪽 동일하게 유지한다.** 한쪽만 급히 고쳐야 할 때도 버전은 같이 올리고, 스토어별로 제출 시점만 다르게 한다. 버전이 갈리기 시작하면 "어느 스토어에 무엇이 나가 있는지"를 사람이 기억해야 한다
- 릴리스 순서: 소스 수정 → 크롬 루트에서 검증 → `build-firefox.cmd -Package` → 파이어폭스에서 검증 → CWS 업로드 → AMO 업로드

## 4. 유지보수 시 지켜야 할 것

1. **`dist/`는 절대 직접 편집하지 않는다.** 수정은 항상 리포 루트에.
2. **background 의존 파일을 추가하면 두 곳을 같이 고친다** — `background.js`의 `importScripts(...)`와 `manifest.firefox.json`의 `background.scripts`. 순서도 일치시켜야 한다(`storage-api.js`가 `background.js`보다 먼저). 빌드 스크립트가 "scripts에 있는데 산출물에 없는 파일"은 잡아주지만, "importScripts에만 추가하고 scripts에 빠뜨린" 경우는 못 잡는다 — 파이어폭스에서만 조용히 undefined가 된다.
3. **새 에셋 디렉터리를 만들면** `build-firefox.ps1`의 `$assetDirs`에 추가한다. 루트의 `.js`/`.html`/`.css`는 자동 포함된다.
4. **Promise 스타일 `chrome.*` 호출을 콘텐츠 스크립트에 추가하면** `browser-shim.js`를 해당 콘텐츠 스크립트 목록에도 주입해야 한다(현재는 콜백 스타일만 써서 제외돼 있다).
5. 매니페스트 권한/키를 추가할 때는 루트 `manifest.json`에만 넣으면 양쪽에 반영된다. 파이어폭스에서만 달라야 하는 키일 때만 `manifest.firefox.json`에 넣는다.

## 5. 이식 검증 중 발견된 크롬 공통 버그

### SPA 차단 유실 (`content.js` 쓰로틀) — 수정 및 재검증 완료

**증상:** 차단 리스트에 `youtube.com/watch`를 등록해도 **유튜브 홈에서 썸네일을 클릭해 진입하면 차단되지 않았다.** 주소창 직접 입력이나 재생 중 새로고침은 정상 차단(DNR 경로). 크롬·파이어폭스 양쪽에서 동일하게 재현 — 브라우저 무관한 로직 버그다.

**원인:** `content.js`의 200ms 쓰로틀이 leading-edge 방식이라 창 안에 들어온 이벤트를 **버렸다**. 유튜브는 썸네일 클릭 한 번에 경유 URL(홈)과 목적지 URL(`/watch`)을 연달아 알려오는데, 앞의 경유 URL이 타이머를 소모하고 정작 차단 대상인 목적지가 유실됐다. 진단 로그로 확인된 실제 순서:

```
[page] notify → https://www.youtube.com/
[page] notify → https://www.youtube.com/watch?v=...
[content] checkBlock 요청 → https://www.youtube.com/      ← 경유 URL만 검사됨
[content] 쓰로틀에 스킵됨 (버려짐) → https://www.youtube.com/watch?v=...   ← 목적지 유실
```

**수정:** 쓰로틀에 trailing edge를 추가했다. 창 안의 이벤트는 마지막 URL 하나만 남겨뒀다가 창이 끝날 때 반드시 처리한다. 중간 경유 URL은 이미 지나간 주소라 검사할 이유가 없고 실제 도착지는 항상 마지막이므로, 마지막 하나만 보장하면 충분하다. 요청량은 창당 최대 2회(즉시 1 + 창 끝 1)로 묶여 원래 목적인 폭주 방어는 그대로 유지된다.

**영향 범위:** 이 버그는 **CWS에 나가 있는 현재 버전에도 존재한다.** 파이어폭스 출시와 별개로 크롬 업데이트에 포함시켜야 한다. 유튜브뿐 아니라 경유 URL을 거치는 모든 SPA에서 같은 유실이 발생했을 가능성이 있다.

**같은 패턴의 선례:** `strong-block-selectors.js`에서도 시간 기반 쓰로틀이 몰린 이벤트를 유실·지연시키는 문제를 겪고 rAF 디바운스로 교체한 기록이 있다(파일 상단 주석). 이벤트 유실이 조용한 오작동으로 이어지는 자리에는 "버리는 쓰로틀"을 쓰지 않는다는 원칙으로 볼 것.

## 6. 별개 이슈 (이식과 무관)

### 배경 이미지 용량 — 해결 (1.0.1)

`images/`의 기본 배경 이미지 5장이 총 45MB였다(`Default_3.jpeg` 혼자 21.9MB, 원본 7431x4043). 화면 배경으로 쓰기엔 과도한 해상도라 **가로 2560px / JPEG 품질 85**로 리사이즈했다.

**이전 방식과의 차이:** CWS 1.0 제출 때는 리포 원본을 그대로 두고 스크래치패드에 스테이징 디렉터리를 만들어 그 안의 이미지만 sharp로 최적화해 패키지를 만들었다(그래서 리포의 45MB는 CWS 패키지에 그대로 들어가지는 않았다). 다만 그 스크립트와 파라미터는 스크래치패드가 정리되면서 소실됐고, 지금은 어떤 해상도·품질을 썼는지 복원할 수 없다. 이번에는 **최적화 결과를 리포에 커밋**해서, 릴리스마다 수동 재작업할 필요를 없애고 크롬·파이어폭스 두 패키지에 동일한 파일이 나가도록 했다. 빌드는 계속 단순 복사로 유지된다(변환 도구가 파이프라인에 없으므로 AMO 소스 제출 의무도 그대로 발생하지 않는다).

| 파일 | 이전 | 이후 |
|---|---|---|
| Default_1.jpeg | 5069x5681 · 8.85MB | 2560x2869 · 0.91MB |
| Default_2.jpeg | 5430x3620 · 4.4MB | 2560x1707 · 0.37MB |
| Default_3.jpeg | 7431x4043 · 21.9MB | 2560x1393 · 0.22MB |
| Default_4.jpeg | 8000x4000 · 4.08MB | 2560x1280 · 0.31MB |
| Default_5.jpeg | 6240x4160 · 5.5MB | 2560x1707 · 0.30MB |

전체 패키지 44MB → 2.2MB. 파일명은 그대로라 `customLinks`의 `imgName` 참조는 영향받지 않는다. 원본은 git 이력에 남아 있으므로 화질이 부족하면 `git checkout <이전커밋> -- images/`로 되돌린 뒤 더 큰 해상도로 다시 줄이면 된다.
