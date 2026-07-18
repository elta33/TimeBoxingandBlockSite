# CWS 심사 대응 — 권한 정당화 기술서 (Permission Justification)

TBB(FocusBox)가 `host_permissions: ["<all_urls>"]` + `declarativeNetRequestWithHostAccess`를 함께 요청하는 것에 대한 Chrome Web Store(CWS) 심사 대응 문서. Developer Dashboard의 **Privacy practices** 탭에 그대로 붙여넣을 수 있도록 한국어/영어 텍스트를 같이 준비했다(리뷰어가 자동번역에 의존하는 경우가 많아 영어본을 병기하는 것이 반려 리스크를 줄인다).

---

## 1. CWS 심사 프로세스가 실제로 어떻게 진행되는가

1. **제출 시 자동 스캔** — 정적 분석(코드 유사도, 난독화 탐지, 알려진 악성 패턴, minified/원격 로드 코드 여부)이 먼저 돈다. TBB는 `importScripts`로 자체 로컬 파일만 불러오고 `fetch`/`XMLHttpRequest`/`eval`이 코드베이스에 전혀 없으므로("원격 코드 사용" 질문에 명확히 "아니오"로 답할 수 있음) 이 단계 리스크는 낮다.
2. **권한 기반 트리거로 수동 심사 큐 편입** — `host_permissions`에 `<all_urls>`(또는 이에 준하는 광범위 패턴)가 있거나, `declarativeNetRequestWithHostAccess`/`scripting`/`tabs`처럼 Google이 "powerful permission"으로 분류한 권한이 있으면 자동으로 사람이 보는 심사 큐로 넘어간다. **TBB는 이 조건에 정확히 해당한다.**
3. **Developer Dashboard "Privacy practices" 탭 작성 요구** — 아래 항목이 비어 있거나 부실하면 자동 검증 단계에서부터 제출이 막히거나(필수 필드 미입력), 사람 심사에서 반려된다.
   - **Single purpose description** (확장 전체의 단일 목적 설명, 1개)
   - **Permission justification** — 매니페스트에 선언된 "민감" 권한 각각에 대해 별도 텍스트박스가 자동 생성됨(TBB 기준: host permissions, `declarativeNetRequest`, `scripting`, `tabs`, `activeTab`)
   - **Data usage disclosure** — 수집/사용하는 데이터 카테고리 체크박스 + "판매하지 않음/핵심 기능과 무관한 용도로 쓰지 않음/신용평가에 쓰지 않음" 인증 체크
   - **Privacy policy** — 반드시 **실제로 호스팅된 URL**이어야 함(텍스트 붙여넣기 불가). 그 페이지 안에 호스트 권한으로 처리하는 데이터에 대한 구체적 언급이 있어야 함
4. **심사 기간** — 통상 수 시간~수 주. `<all_urls>` + DNR 조합처럼 민감 권한이 섞인 신규 제출은 **최초 제출에서 바로 승인되지 않고 1회 이상의 "추가 정보 요청"을 받는 경우가 흔함**. 이는 정상적인 과정이지 특별히 코드에 문제가 있다는 신호가 아니다.
5. **흔한 반려 사유** (TBB에 적용해 미리 점검할 것):
   - Justification 텍스트가 "필요해서", "기능을 위해" 수준으로 너무 일반적 — **구체적으로 어떤 파일의 어떤 코드가 그 권한을 왜 쓰는지** 매핑해야 함 (본 문서 2장이 그 매핑)
   - Single purpose와 실제 기능이 여러 개로 흩어져 "다목적 확장"처럼 보임 — TBB는 "웹사이트 차단 기반 시간관리(타임박싱/포모도로)"라는 하나의 목적으로 서술 가능하지만, 포모도로/통계/PIN/커스터마이징 등 부가기능이 많으므로 심사자가 "왜 이 모든 기능이 하나의 목적인가"를 되물을 수 있음 → single purpose 서술에서 이들을 전부 "차단을 통한 시간관리"의 하위 수단으로 명시적으로 묶어야 함
   - 요청 권한 대비 매니페스트상 실제 사용 근거가 안 보이는 경우 — TBB는 반대로 실제 코드가 전체 도메인에서 동작해야 하는 정당한 케이스지만, **`activeTab`은 매니페스트에 선언돼 있으나 코드 어디서도 쓰이지 않음**(아래 2-5장). 미사용 권한은 그 자체로 반려 사유가 될 수 있으므로 제거 권장.
   - Privacy policy 페이지가 일반적인 템플릿이라 host permission으로 처리하는 데이터를 구체적으로 언급하지 않음

---

## 2. 권한별 정당화 매핑 (코드 근거 포함)

### 2-1. `host_permissions: ["<all_urls>"]`

**왜 특정 도메인 목록으로 좁힐 수 없는가:** TBB의 핵심 기능은 사용자가 옵션 페이지에서 **차단하고 싶은 도메인을 자유 텍스트로 직접 입력**하는 것이다(`generalList`/`permanentList`/`dailyBoxes.customDomains` 등). 즉 어떤 사이트를 차단할지는 매니페스트 작성 시점이 아니라 **각 사용자가 설치 후 런타임에 결정**하며, 그 값은 무제한이다. 따라서:
- SPA 내비게이션 감지용 콘텐츠 스크립트(`page-world.js`, `content.js`, `manifest.json:32-44`)는 사용자가 어떤 사이트를 차단 목록에 넣을지 사전에 알 수 없으므로 모든 사이트에 주입되어야 한다.
- `block.html`을 리다이렉트 대상으로 노출하는 `web_accessible_resources`(`manifest.json:45-58`)도 동일한 이유로 `<all_urls>`가 필요하다.

**영문 justification (붙여넣기용):**
> This extension lets users block arbitrary websites they choose at runtime (entered as free-text domains in the options page), for time-boxing and Pomodoro-based focus sessions. Because the set of blocked domains is entirely user-defined and unbounded, the extension cannot be scoped to a fixed list of domains at install time. Broad host access is required so that (1) the SPA-navigation-detection content scripts (`page-world.js`, `content.js`) can detect in-page navigation on any domain the user has chosen to block, and (2) the block/redirect page (`block.html`) can be reached via redirect from any domain. No data is read from page content — the scripts only observe URL/navigation changes to decide whether to redirect.

**한글 justification:**
> 이 확장은 사용자가 설정 화면에서 자유롭게 입력한 임의의 웹사이트를 시간관리(타임박싱/포모도로) 목적으로 차단하는 기능을 제공합니다. 차단 대상 도메인은 전적으로 사용자가 결정하며 그 범위에 제한이 없으므로, 설치 시점에 고정된 도메인 목록으로 권한 범위를 좁힐 수 없습니다. 광범위한 호스트 권한이 필요한 이유는 (1) 사용자가 차단 목록에 추가한 어떤 도메인에서든 SPA 내비게이션(URL 변경)을 감지해야 하고, (2) 차단 시 리다이렉트되는 안내 페이지(block.html)가 어떤 도메인에서 리다이렉트되어 오더라도 열릴 수 있어야 하기 때문입니다. 콘텐츠 스크립트는 페이지 콘텐츠를 읽지 않으며, 오직 URL/내비게이션 변경만 관찰하여 차단 여부를 판단합니다.

### 2-2. `declarativeNetRequest` + `declarativeNetRequestWithHostAccess`

**코드 근거:** `background.js`의 `updateBlockingRules()`가 사용자의 차단 목록(`permanentList`/`generalList`/타임박스별 `customDomains`)을 `chrome.declarativeNetRequest.updateDynamicRules()`로 변환해 리다이렉트 규칙을 생성한다(우선순위: 상시 차단 100 > 커스텀 도메인 허용 50 > 포모도로 30 > 일반 차단 10 > 쇼츠/릴스 코스메틱 폴백 5). 규칙 대상 URL이 사용자가 임의로 추가한 도메인이므로, DNR이 그 도메인에 대해 규칙을 적용하려면 해당 호스트에 대한 권한(`WithHostAccess`)이 있어야 한다 — 이는 `<all_urls>` 요청과 **동일한 근본 이유(임의 사용자 지정 도메인)를 공유**하는 종속적 권한이다.

**영문 justification:**
> `declarativeNetRequest`/`declarativeNetRequestWithHostAccess` is used exclusively to redirect navigation requests to the extension's own block page (`block.html`) when the requested URL matches a domain the user has explicitly added to their block list. Rules are generated dynamically from user-configured domain lists (`chrome.declarativeNetRequest.updateDynamicRules`) — no rules are pre-shipped for specific third-party sites except two narrow, optional "distraction cosmetic" redirects (YouTube Shorts, Instagram Reels/Explore) that are opt-in via a settings toggle and only redirect within those two domains. Host access is required because the rule targets are user-defined and cannot be known in advance.

**한글 justification:**
> `declarativeNetRequest`/`declarativeNetRequestWithHostAccess`는 사용자가 차단 목록에 명시적으로 추가한 도메인으로의 접속 요청을 확장 자체의 차단 안내 페이지(block.html)로 리다이렉트하는 용도로만 사용됩니다. 규칙은 사용자가 설정한 도메인 목록으로부터 동적으로 생성되며(`updateDynamicRules`), 특정 제3자 사이트에 대한 규칙이 기본 내장되어 있지 않습니다(예외: 사용자가 설정에서 별도로 켜야 하는 선택적 "강력 차단" 옵션 2개 — 유튜브 쇼츠, 인스타그램 릴스/탐색 — 이 경우도 해당 두 도메인 내부로만 리다이렉트합니다). 규칙 대상이 사용자 정의 도메인이라 사전에 알 수 없으므로 호스트 접근 권한이 필요합니다.

### 2-3. `scripting`

**코드 근거:** `background.js`의 `updateShortsCosmetic()`/`updateInstaCosmetic()`이 `chrome.scripting.registerContentScripts`/`unregisterContentScripts`를 사용해, 사용자가 "강력 차단" 옵션을 켰을 때만 `youtube.com`/`instagram.com`에 한정된 코스메틱 CSS/JS를 동적으로 등록한다(`matches: ["*://*.youtube.com/*"]`, `["*://*.instagram.com/*"]` — `<all_urls>`가 아닌 특정 도메인).

**영문 justification:**
> `scripting` is used to dynamically register/unregister a small CSS+JS content script (`strong-block-selectors.css/js`) scoped to `*://*.youtube.com/*` and `*://*.instagram.com/*` only, and only while the user has opted into the "strong block" toggle for that specific site in settings. Its sole purpose is hiding UI elements that link to distracting sections (e.g., the Shorts shelf/tab, Reels/Explore icons) — a cosmetic aid to the domain-blocking feature. Dynamic registration (rather than static manifest content scripts) is used so the scripts are only injected when the user has explicitly enabled the corresponding toggle.

**한글 justification:**
> `scripting`은 사용자가 설정에서 해당 사이트의 "강력 차단" 토글을 켰을 때만, `youtube.com`/`instagram.com`으로 범위가 한정된 코스메틱 CSS/JS(`strong-block-selectors.css/js`)를 동적으로 등록/해제하는 데 사용됩니다. 목적은 쇼츠 선반, 릴스/탐색 아이콘 등 주의를 분산시키는 메뉴 요소를 화면에서 숨기는 것으로, 도메인 차단 기능을 보조하는 코스메틱 기능입니다. 매니페스트 정적 등록 대신 동적 등록을 쓰는 이유는 사용자가 해당 토글을 명시적으로 켰을 때만 주입되도록 하기 위함입니다.

### 2-4. `tabs`

**코드 근거:**
- `background.js:243-250` — 강력 차단 토글 on/off 시 이미 열려있는 관련 탭(유튜브/인스타그램)만 새로고침(`chrome.tabs.query({url: [...]})` → `chrome.tabs.reload`)해 토글 변경을 즉시 반영.
- `popup.js:364` — 팝업이 열릴 때 현재 활성 탭의 URL을 읽어 "이 사이트를 차단 목록에 추가" UI를 제공.

**영문 justification:**
> `tabs` is used for two narrow purposes: (1) reloading only the already-open YouTube/Instagram tabs when the user toggles the strong-block feature for that site, so the change applies immediately without a full browser restart, and (2) reading the active tab's URL when the popup opens, to let the user add the current site to their block list with one click.

**한글 justification:**
> `tabs`는 두 가지 좁은 목적에만 사용됩니다: (1) 강력 차단 토글을 켜거나 끌 때, 이미 열려 있는 해당 사이트(유튜브/인스타그램) 탭만 새로고침하여 브라우저 재시작 없이 즉시 반영, (2) 팝업을 열 때 현재 활성 탭의 URL을 읽어 "이 사이트를 차단 목록에 추가" 버튼을 제공.

### 2-5. `activeTab` — 제출 전 제거 권장

코드베이스 전체에서 `chrome.tabs.executeScript`/`chrome.scripting.executeScript` 등 `activeTab`이 실제로 필요한 API 호출이 **한 건도 없다**. `host_permissions: ["<all_urls>"]`가 이미 모든 탭의 URL 접근을 상시 보장하므로 `activeTab`은 현재 아무 기능도 추가하지 않는 죽은 선언이다.

**권장 조치:** `manifest.json`에서 `activeTab`을 제거할 것. 사용하지 않는 권한은 (a) 심사자가 "이건 왜 필요한가"를 되묻는 불필요한 리스크 포인트가 되고, (b) 정당화 문서 작성 대상이 하나 늘어나 반려 확률만 올라간다. 제거해도 기능 손실이 없다.

### 2-6. `alarms`, `storage`, `windows` (참고용, 통상 민감 권한으로 분류되지 않음)

- `alarms` — `background.js:444`, 1분 간격 타임박스/포모도로 틱(`timeboxTicker`) 갱신. 사용자 데이터 접근 없음.
- `storage` — 모든 설정을 `chrome.storage.local`/`chrome.storage.sync`에만 저장(`storage-api.js`). 외부 서버 전송 없음.
- `windows` — 포모도로 PiP(Picture-in-Picture) 창 생성/포커스(`pomodoro-pip.js`).

이 세 권한은 CWS 심사에서 보통 "powerful permission" 카테고리로 분류되지 않아 별도 justification 텍스트박스가 안 뜨는 경우가 많지만, Data usage 탭 서술에서 "왜 필요한가"를 한 줄씩 언급해두면 반려 리스크를 더 줄일 수 있다.

---

## 3. Data usage disclosure 탭 작성 가이드

Dashboard의 "Data usage" 섹션은 카테고리별 체크 + 3개 인증 문구로 구성된다. TBB 코드베이스 전체에 `fetch`/`XMLHttpRequest`가 전혀 없고(직접 확인함), 원격 서버로 어떤 데이터도 전송되지 않는다 — 이는 강력한 근거이므로 반드시 활용할 것.

**체크해야 할 카테고리:**
- **Web history** — 콘텐츠 스크립트가 URL 변경을 관찰해 차단 여부를 판단하므로 "사용함(Used)"으로 체크. 단, **기기 밖으로 전송되지 않고, 저장/로깅되지도 않으며, 오직 즉시 차단 판단에만 쓰이고 버려진다**는 점을 서술란에 명시.
- 그 외 카테고리(개인식별정보, 위치, 금융, 건강, 인증정보, 개인 커뮤니케이션 등)는 **모두 미해당(체크 안 함)** — TBB는 페이지 콘텐츠를 읽지 않고 URL만 본다.

**3개 인증 체크박스** — 전부 해당 사실이므로 체크 가능:
- [x] 데이터를 제3자에게 판매하지 않음 (수집 자체를 안 하므로 자명)
- [x] 확장의 핵심 기능과 무관한 목적으로 데이터를 사용/전송하지 않음
- [x] 신용평가/대출 심사 목적으로 사용하지 않음

**서술 예시 (영문):**
> TBB does not transmit any data off the user's device. All settings (block lists, schedules, statistics) are stored only in `chrome.storage.local`/`chrome.storage.sync` (the latter is Google's own account-sync mechanism, not a third-party server). The extension observes the URL of the page currently being navigated to, compares it against the user's own block list, and either allows navigation or redirects to a local block page — no browsing history is logged, retained, or transmitted anywhere, including to the developer.

---

## 4. Privacy Policy 페이지에 반드시 포함할 내용

CWS는 **텍스트가 아니라 실제로 접근 가능한 URL**을 요구한다(GitHub Pages, Notion 공개 페이지, 개인 도메인 등 아무 곳이나 가능). 아래 항목이 빠지면 "host permission을 요청하는데 privacy policy가 그 사용처를 설명하지 않는다"는 사유로 반려될 수 있다.

1. 확장이 수집하는 데이터가 없다는 명시적 진술(위 3장 서술 재사용 가능)
2. `<all_urls>` 호스트 권한을 요청하는 이유를 사용자 눈높이로 한 번 더 설명(예: "귀하가 어떤 사이트를 차단 목록에 추가하시든 그 사이트에서 차단 기능이 작동해야 하므로...")
3. 로컬 저장(chrome.storage) vs 서버 전송 여부 — "서버로 전송되지 않는다"를 명확히
4. Chrome 계정 동기화(`chrome.storage.sync`) 사용 시 그 데이터가 Google 계정 인프라를 통해 이동한다는 점(개발자가 별도로 수집하지 않는다는 점과 구분해서 서술)
5. 문의 연락처(이메일 등)

---

## 5. 제출 전 체크리스트

- [ ] `manifest.json`에서 미사용 `activeTab` 제거 (2-5장)
- [ ] Single purpose 설명에 포모도로/통계/PIN 등 부가기능을 "차단 기반 시간관리"의 하위 수단으로 명시적으로 연결
- [ ] Privacy policy 페이지를 실제 URL로 게시 (4장 내용 포함)
- [ ] Data usage 탭에서 Web history만 체크 + 3개 인증 전부 체크 (3장)
- [ ] 각 권한 justification 텍스트박스에 2장의 영문 문단을 우선 붙여넣기(리뷰어 자동번역 오류 방지), 필요시 한글 병기
- [ ] 최초 제출 후 "추가 정보 요청"이 오면 정상적인 절차로 간주하고, 요청받은 구체적 질문에 코드 근거(파일명:라인)로 답변
