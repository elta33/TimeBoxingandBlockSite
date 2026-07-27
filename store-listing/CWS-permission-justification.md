# CWS 심사 대응 — 권한 정당화 기술서 (Permission Justification)

TBB(FocusBox)가 `host_permissions: ["<all_urls>"]` + `declarativeNetRequestWithHostAccess`를 함께 요청하는 것에 대한 Chrome Web Store(CWS) 심사 대응 문서. Developer Dashboard의 **Privacy practices** 탭에 그대로 붙여넣을 수 있도록 한국어/영어 텍스트를 같이 준비했다(리뷰어가 자동번역에 의존하는 경우가 많아 영어본을 병기하는 것이 반려 리스크를 줄인다).

> **최종 검토 기준 커밋:** `d245fad`(2026-07-27). 이 커밋 기준으로 3장의 모든 코드 근거(파일:라인), DNR 우선순위(100/50/30/10/5), 그리고 "네트워크 호출 전무"(코드베이스 전체에 `fetch`/`XMLHttpRequest`/`eval`/`WebSocket`/`sendBeacon` 0건) 주장을 전수 재검증해 일치를 확인했다. `manifest.json`의 permissions 목록이 바뀌면(권한 추가/삭제) 이 문서도 같이 갱신할 것 — 특히 3장의 코드 근거(파일명:라인)는 리팩터링 시 어긋나기 쉽다.
>
> **이번 재검수 기준 매니페스트 권한 전체:** `storage`, `unlimitedStorage`, `declarativeNetRequest`, `declarativeNetRequestWithHostAccess`, `alarms`, `windows`, `scripting`, `tabs` + `host_permissions: ["<all_urls>"]`. (`activeTab`은 제거된 상태 유지, 3-5장.)
>
> **이번 재검수에서 반영한 주요 변경:** (1) `pro.js`(TBB Pro 부분 유료화 feature-flag) 신설 — **현재는 "출시 기념 전 기능 무료" 모드라 결제/라이선스 검증도, 외부 통신도 없다.** 따라서 현 제출의 데이터 공시·권한 정당화는 그대로 유효하나, 향후 유료화 전환 시 반드시 재심사가 필요하므로 별도 절(7장)로 명시. (2) 코드 근거 라인 번호를 현재 코드에 맞춰 재대조. (3) **Single purpose 설명(단일 목적) 텍스트를 2장에 신규 작성** — 붙여넣기용 영문/한글 병기. (4) **Privacy policy 페이지 게시 완료** — `https://elta33.github.io/TBB-Privacy_Policy/` (GitHub Pages, 5장 5개 항목 전부 포함 확인). 체크리스트 3번 해결. (5) `d245fad` 기준 전 파일:라인 인용·DNR 우선순위·네트워크 무통신 주장을 전수 재검증(오류 없음).

---

## 1. CWS 심사 프로세스가 실제로 어떻게 진행되는가

1. **제출 시 자동 스캔** — 정적 분석(코드 유사도, 난독화 탐지, 알려진 악성 패턴, minified/원격 로드 코드 여부)이 먼저 돈다. TBB는 `importScripts`로 자체 로컬 파일만 불러오고 `fetch`/`XMLHttpRequest`/`eval`이 코드베이스에 전혀 없으므로("원격 코드 사용" 질문에 명확히 "아니오"로 답할 수 있음) 이 단계 리스크는 낮다.
2. **권한 기반 트리거로 수동 심사 큐 편입** — `host_permissions`에 `<all_urls>`(또는 이에 준하는 광범위 패턴)가 있거나, `declarativeNetRequestWithHostAccess`/`scripting`/`tabs`처럼 Google이 "powerful permission"으로 분류한 권한이 있으면 자동으로 사람이 보는 심사 큐로 넘어간다. **TBB는 이 조건에 정확히 해당한다.**
3. **Developer Dashboard "Privacy practices" 탭 작성 요구** — 아래 항목이 비어 있거나 부실하면 자동 검증 단계에서부터 제출이 막히거나(필수 필드 미입력), 사람 심사에서 반려된다.
   - **Single purpose description** (확장 전체의 단일 목적 설명, 1개) — **본 문서 2장에 붙여넣기용 텍스트 작성**
   - **Permission justification** — 매니페스트에 선언된 "민감" 권한 각각에 대해 별도 텍스트박스가 자동 생성됨(TBB 기준: host permissions, `declarativeNetRequest`/`declarativeNetRequestWithHostAccess`, `scripting`, `tabs`. `activeTab`은 미사용이 확인되어 제거 완료 — 3-5장 참고)
   - **Data usage disclosure** — 수집/사용하는 데이터 카테고리 체크박스 + "판매하지 않음/핵심 기능과 무관한 용도로 쓰지 않음/신용평가에 쓰지 않음" 인증 체크
   - **Privacy policy** — 반드시 **실제로 호스팅된 URL**이어야 함(텍스트 붙여넣기 불가). 그 페이지 안에 호스트 권한으로 처리하는 데이터에 대한 구체적 언급이 있어야 함
4. **심사 기간** — 통상 수 시간~수 주. `<all_urls>` + DNR 조합처럼 민감 권한이 섞인 신규 제출은 **최초 제출에서 바로 승인되지 않고 1회 이상의 "추가 정보 요청"을 받는 경우가 흔함**. 이는 정상적인 과정이지 특별히 코드에 문제가 있다는 신호가 아니다.
5. **흔한 반려 사유** (TBB에 적용해 미리 점검할 것):
   - Justification 텍스트가 "필요해서", "기능을 위해" 수준으로 너무 일반적 — **구체적으로 어떤 파일의 어떤 코드가 그 권한을 왜 쓰는지** 매핑해야 함 (본 문서 3장이 그 매핑)
   - Single purpose와 실제 기능이 여러 개로 흩어져 "다목적 확장"처럼 보임 — TBB는 "웹사이트 차단 기반 시간관리(타임박싱/포모도로)"라는 하나의 목적으로 서술 가능하지만, 포모도로/통계/PIN/커스터마이징 등 부가기능이 많으므로 심사자가 "왜 이 모든 기능이 하나의 목적인가"를 되물을 수 있음 → single purpose 서술에서 이들을 전부 "차단을 통한 시간관리"의 하위 수단으로 명시적으로 묶어야 함 (본 문서 2장이 그 서술)
   - 요청 권한 대비 매니페스트상 실제 사용 근거가 안 보이는 경우 — TBB는 반대로 실제 코드가 전체 도메인에서 동작해야 하는 정당한 케이스다. 이전에는 `activeTab`이 매니페스트에 선언돼 있으나 코드 어디서도 쓰이지 않는 죽은 권한이었는데(3-5장 참고), **제거 완료**되어 이 리스크는 해소됨 — 향후 새 권한을 추가할 때마다 실제 API 호출 근거가 있는지 먼저 grep으로 확인하는 습관을 유지할 것.
   - Privacy policy 페이지가 일반적인 템플릿이라 host permission으로 처리하는 데이터를 구체적으로 언급하지 않음

---

## 2. Single purpose 설명 (단일 목적)

CWS Developer Dashboard의 **Privacy practices → Single purpose description** 필드에 그대로 붙여넣을 텍스트다. 이 필드는 **하나의 명확한 목적**을 요구하며, 부가기능이 많은 확장일수록 "이 기능들이 왜 전부 하나의 목적인가"를 리뷰어가 되묻는다(1장 5번 반려 사유). 따라서 아래 서술은 **포모도로·통계·PIN·커스터마이징 등 모든 부가기능을 "차단 기반 시간관리"라는 단일 목적의 하위 수단으로 명시적으로 묶는다.** 프레이밍은 "무엇을(WHAT) 차단할지 · 언제(WHEN) 적용할지 · 결과가 어땠는지(RESULT)를 한 워크플로우로 잇는다"이다.

**핵심 한 줄 (영문, 필드 상단 필수):**
> FocusBox is a focus tool that blocks distracting websites on a schedule the user controls (timeboxing and Pomodoro); every other feature exists only to support that single blocking-based time-management workflow.

**전체 서술 (영문 — 붙여넣기용):**
> **Single purpose:** FocusBox helps users focus by blocking distracting websites on a schedule they control. Every feature is a means to that one end, not a separate product:
> - **What is blocked** — Users define their own block lists at two levels: "always block" (off-limits around the clock) and "general block" (blocked only while a timebox is active). Optional per-site "strong blocking" narrows this to specific distracting sections (e.g., YouTube Shorts, Instagram Reels/Explore) when a whole-domain block is too blunt.
> - **When it applies** — The timeboxing scheduler and the Pomodoro timer decide *when* the general/session block lists take effect, turning "block sites" into "block sites during the times I chose to focus."
> - **At the moment of distraction** — Blocked navigations redirect to an in-extension block screen (customizable with the user's own images and quotes) that interrupts autopilot.
> - **Measuring the result** — Focus statistics and streaks record how much the blocking actually helped (focus time, block counts, Pomodoro cycles) so the habit can be sustained.
> - **Supporting options** — PIN lock (protects the block settings from being disabled on impulse), dark mode, Chrome-account sync, data export/import, and a to-do panel exist only to protect, configure, and carry that same blocking-based time-management workflow.
>
> The extension does nothing outside this purpose. It makes no network requests, has no accounts or analytics, and no browsing data ever leaves the device — it only observes the URL being navigated to in order to decide whether to redirect.

**전체 서술 (한글):**
> **단일 목적:** FocusBox는 사용자가 스스로 정한 스케줄에 따라 방해되는 웹사이트를 차단하여 집중을 돕는 도구입니다. 모든 기능은 별개의 제품이 아니라 이 하나의 목적을 위한 수단입니다.
> - **무엇을 차단할지** — 사용자가 직접 두 단계로 차단 목록을 정합니다: "상시 차단"(항상 막을 사이트)과 "일반 차단"(타임박스가 활성화된 시간에만 차단). 도메인 전체 차단이 과한 사이트를 위해, 특정 기능만 막는 선택적 "강력 차단"(유튜브 쇼츠, 인스타그램 릴스/탐색 등)을 제공합니다.
> - **언제 적용할지** — 타임박싱 스케줄러와 포모도로 타이머가 일반/세션 차단 목록이 *언제* 발동할지를 정합니다. 즉 "사이트를 차단한다"를 "내가 집중하기로 정한 시간에 사이트를 차단한다"로 바꿔 줍니다.
> - **딴짓하려는 순간** — 차단된 이동은 확장 자체의 차단 안내 화면(사용자가 직접 넣은 이미지·문구로 꾸밀 수 있음)으로 리다이렉트되어 무의식적 습관을 끊어 줍니다.
> - **결과 측정** — 집중 통계와 스트릭이 차단이 실제로 얼마나 도움이 됐는지(집중 시간, 차단 횟수, 포모도로 사이클)를 기록해 습관을 이어 가게 합니다.
> - **보조 옵션** — PIN 잠금(차단 설정을 충동적으로 해제하지 못하게 보호), 다크 모드, Chrome 계정 동기화, 데이터 내보내기/불러오기, 할 일 패널은 오직 이 "차단 기반 시간관리" 워크플로우를 보호·구성·유지하기 위해서만 존재합니다.
>
> 확장은 이 목적 밖의 어떤 일도 하지 않습니다. 네트워크 요청이 없고, 계정·분석 도구도 없으며, 어떤 브라우징 데이터도 기기를 벗어나지 않습니다 — 차단 여부 판단을 위해 이동하려는 URL만 관찰할 뿐입니다.

> **분량 주의:** Single purpose 필드는 짧은 단일 목적을 선호한다. 필드 길이 제한에 걸리면 위 "핵심 한 줄"만 넣고, 부가기능 매핑(불릿)은 Store listing 상세 설명(`store-description.md`)이 이미 같은 프레이밍으로 담고 있으므로 그쪽으로 갈음해도 된다. 리뷰어가 "왜 다목적이 아닌가"를 되물으면 위 불릿 전문을 추가 정보 답변으로 제출한다.

---

## 3. 권한별 정당화 매핑 (코드 근거 포함)

### 3-1. `host_permissions: ["<all_urls>"]`

**왜 특정 도메인 목록으로 좁힐 수 없는가:** TBB의 핵심 기능은 사용자가 옵션 페이지에서 **차단하고 싶은 도메인을 자유 텍스트로 직접 입력**하는 것이다(`generalList`/`permanentList`/`dailyBoxes.customDomains` 등). 즉 어떤 사이트를 차단할지는 매니페스트 작성 시점이 아니라 **각 사용자가 설치 후 런타임에 결정**하며, 그 값은 무제한이다. 따라서:
- SPA 내비게이션 감지용 콘텐츠 스크립트(`page-world.js`, `content.js`, `manifest.json:35-47`)는 사용자가 어떤 사이트를 차단 목록에 넣을지 사전에 알 수 없으므로 모든 사이트에 주입되어야 한다.
- `block.html`을 리다이렉트 대상으로 노출하는 `web_accessible_resources`(`manifest.json:48-61`)도 동일한 이유로 `<all_urls>`가 필요하다.

**영문 justification (붙여넣기용):**
> This extension lets users block arbitrary websites they choose at runtime (entered as free-text domains in the options page), for time-boxing and Pomodoro-based focus sessions. Because the set of blocked domains is entirely user-defined and unbounded, the extension cannot be scoped to a fixed list of domains at install time. Broad host access is required so that (1) the SPA-navigation-detection content scripts (`page-world.js`, `content.js`) can detect in-page navigation on any domain the user has chosen to block, and (2) the block/redirect page (`block.html`) can be reached via redirect from any domain. No data is read from page content — the scripts only observe URL/navigation changes to decide whether to redirect.

**한글 justification:**
> 이 확장은 사용자가 설정 화면에서 자유롭게 입력한 임의의 웹사이트를 시간관리(타임박싱/포모도로) 목적으로 차단하는 기능을 제공합니다. 차단 대상 도메인은 전적으로 사용자가 결정하며 그 범위에 제한이 없으므로, 설치 시점에 고정된 도메인 목록으로 권한 범위를 좁힐 수 없습니다. 광범위한 호스트 권한이 필요한 이유는 (1) 사용자가 차단 목록에 추가한 어떤 도메인에서든 SPA 내비게이션(URL 변경)을 감지해야 하고, (2) 차단 시 리다이렉트되는 안내 페이지(block.html)가 어떤 도메인에서 리다이렉트되어 오더라도 열릴 수 있어야 하기 때문입니다. 콘텐츠 스크립트는 페이지 콘텐츠를 읽지 않으며, 오직 URL/내비게이션 변경만 관찰하여 차단 여부를 판단합니다.

### 3-2. `declarativeNetRequest` + `declarativeNetRequestWithHostAccess`

**코드 근거:** `background.js`의 `updateBlockingRules()`가 사용자의 차단 목록(`permanentList`/`generalList`/타임박스별 `customDomains`)을 `chrome.declarativeNetRequest.updateDynamicRules()`로 변환해 리다이렉트 규칙을 생성한다(우선순위: 상시 차단 100 > 커스텀 도메인 허용 50 > 포모도로 30 > 일반 차단 10 > 쇼츠/릴스 코스메틱 폴백 5). 규칙 대상 URL이 사용자가 임의로 추가한 도메인이므로, DNR이 그 도메인에 대해 규칙을 적용하려면 해당 호스트에 대한 권한(`WithHostAccess`)이 있어야 한다 — 이는 `<all_urls>` 요청과 **동일한 근본 이유(임의 사용자 지정 도메인)를 공유**하는 종속적 권한이다.

**영문 justification:**
> `declarativeNetRequest`/`declarativeNetRequestWithHostAccess` is used exclusively to redirect navigation requests to the extension's own block page (`block.html`) when the requested URL matches a domain the user has explicitly added to their block list. Rules are generated dynamically from user-configured domain lists (`chrome.declarativeNetRequest.updateDynamicRules`) — no rules are pre-shipped for specific third-party sites except two narrow, optional "distraction cosmetic" redirects (YouTube Shorts, Instagram Reels/Explore) that are opt-in via a settings toggle and only redirect within those two domains. Host access is required because the rule targets are user-defined and cannot be known in advance.

**한글 justification:**
> `declarativeNetRequest`/`declarativeNetRequestWithHostAccess`는 사용자가 차단 목록에 명시적으로 추가한 도메인으로의 접속 요청을 확장 자체의 차단 안내 페이지(block.html)로 리다이렉트하는 용도로만 사용됩니다. 규칙은 사용자가 설정한 도메인 목록으로부터 동적으로 생성되며(`updateDynamicRules`), 특정 제3자 사이트에 대한 규칙이 기본 내장되어 있지 않습니다(예외: 사용자가 설정에서 별도로 켜야 하는 선택적 "강력 차단" 옵션 2개 — 유튜브 쇼츠, 인스타그램 릴스/탐색 — 이 경우도 해당 두 도메인 내부로만 리다이렉트합니다). 규칙 대상이 사용자 정의 도메인이라 사전에 알 수 없으므로 호스트 접근 권한이 필요합니다.

### 3-3. `scripting`

**코드 근거:** `background.js`의 `updateShortsCosmetic()`/`updateInstaCosmetic()`이 `chrome.scripting.registerContentScripts`/`unregisterContentScripts`를 사용해, 사용자가 "강력 차단" 옵션을 켰을 때만 `youtube.com`/`instagram.com`에 한정된 코스메틱 CSS/JS를 동적으로 등록한다(`matches: ["*://*.youtube.com/*"]`, `["*://*.instagram.com/*"]` — `<all_urls>`가 아닌 특정 도메인).

**영문 justification:**
> `scripting` is used to dynamically register/unregister a small CSS+JS content script (`strong-block-selectors.css/js`) scoped to `*://*.youtube.com/*` and `*://*.instagram.com/*` only, and only while the user has opted into the "strong block" toggle for that specific site in settings. Its sole purpose is hiding UI elements that link to distracting sections (e.g., the Shorts shelf/tab, Reels/Explore icons) — a cosmetic aid to the domain-blocking feature. Dynamic registration (rather than static manifest content scripts) is used so the scripts are only injected when the user has explicitly enabled the corresponding toggle.

**한글 justification:**
> `scripting`은 사용자가 설정에서 해당 사이트의 "강력 차단" 토글을 켰을 때만, `youtube.com`/`instagram.com`으로 범위가 한정된 코스메틱 CSS/JS(`strong-block-selectors.css/js`)를 동적으로 등록/해제하는 데 사용됩니다. 목적은 쇼츠 선반, 릴스/탐색 아이콘 등 주의를 분산시키는 메뉴 요소를 화면에서 숨기는 것으로, 도메인 차단 기능을 보조하는 코스메틱 기능입니다. 매니페스트 정적 등록 대신 동적 등록을 쓰는 이유는 사용자가 해당 토글을 명시적으로 켰을 때만 주입되도록 하기 위함입니다.

### 3-4. `tabs`

**코드 근거:**
- `background.js:243-250` — 강력 차단 토글 on/off 시 이미 열려있는 관련 탭(유튜브/인스타그램)만 새로고침(`chrome.tabs.query({url: [...]})` → `chrome.tabs.reload`)해 토글 변경을 즉시 반영.
- `popup.js:387` — 팝업이 열릴 때 현재 활성 탭의 URL을 읽어 "이 사이트를 차단 목록에 추가" UI를 제공.

**영문 justification:**
> `tabs` is used for two narrow purposes: (1) reloading only the already-open YouTube/Instagram tabs when the user toggles the strong-block feature for that site, so the change applies immediately without a full browser restart, and (2) reading the active tab's URL when the popup opens, to let the user add the current site to their block list with one click.

**한글 justification:**
> `tabs`는 두 가지 좁은 목적에만 사용됩니다: (1) 강력 차단 토글을 켜거나 끌 때, 이미 열려 있는 해당 사이트(유튜브/인스타그램) 탭만 새로고침하여 브라우저 재시작 없이 즉시 반영, (2) 팝업을 열 때 현재 활성 탭의 URL을 읽어 "이 사이트를 차단 목록에 추가" 버튼을 제공.

### 3-5. `activeTab` — 제거됨 (조치 완료)

코드베이스 전체에서 `chrome.tabs.executeScript`/`chrome.scripting.executeScript` 등 `activeTab`이 실제로 필요한 API 호출이 **한 건도 없었다**. `host_permissions: ["<all_urls>"]`가 이미 모든 탭의 URL 접근을 상시 보장하므로 아무 기능도 추가하지 않는 죽은 선언이었음을 확인하고 `manifest.json`에서 **제거했다**(더 이상 매니페스트에 없음). 사용하지 않는 권한을 남겨두면 (a) 심사자가 "이건 왜 필요한가"를 되묻는 불필요한 리스크 포인트가 되고, (b) 정당화해야 할 대상이 하나 늘어나 반려 확률만 올라가므로, 향후 권한을 추가할 때도 실제 사용 근거 없이 "혹시 필요할까봐" 선언하지 않을 것.

### 3-6. `unlimitedStorage` (신규 추가됨)

**코드 근거:** 차단 화면(`block.html`/`block.js`)에서 사용자가 직접 업로드하는 커스텀 배경 이미지(`customBgImages`)를 Base64로 `chrome.storage.local`에 저장하는데(`block.js:26`, `STORE_IMGS='customBgImages'`), 이미지 데이터는 금방 `chrome.storage.local`의 기본 용량 상한(약 10MB)을 채운다. `unlimitedStorage`는 이 **로컬 저장 용량 상한만 해제**하는 권한으로, 새로운 데이터 접근 범위(호스트, 탭, 사용자 활동 등)를 추가하지 않는다 — CWS도 통상 이 권한을 "powerful permission"으로 분류하지 않아 별도 justification 텍스트박스가 안 뜨는 경우가 많지만, Data usage 탭 서술에 한 줄 포함해두면 안전하다. (`block.js:250-254`의 `saveImages()`가 `chrome.storage.local.set(...).catch()`로 저장 실패 시 콘솔 로그 + 사용자 알림(`alert(T('custImageSaveFailed'))`)을 띄우는 방어 코드도 이 용량 이슈를 배경으로 추가됨 — 상한 해제와는 별개로 디스크 자체가 부족한 경우까지 대비.)

**영문 justification (필요시):**
> `unlimitedStorage` removes the default ~10MB cap on `chrome.storage.local` so that user-uploaded Base64 background images for the block screen don't silently fail to save. It does not grant access to any new category of data — all image data remains local to the device and is never transmitted.

### 3-7. `alarms`, `storage`, `windows` (참고용, 통상 민감 권한으로 분류되지 않음)

- `alarms` — `background.js:444`, 1분 간격 타임박스/포모도로 틱(`timeboxTicker`) 갱신. 사용자 데이터 접근 없음.
- `storage` — 모든 설정을 `chrome.storage.local`/`chrome.storage.sync`에만 저장(`storage-api.js`). 외부 서버 전송 없음.
- `windows` — 포모도로 PiP(Picture-in-Picture) 창 생성/포커스/정리. `popup.js:341`(`chrome.windows.create`로 PiP 창 생성), `pomodoro-pip.js`(창 위치·포커스 관리), `background.js:480`(`chrome.windows.onRemoved`로 PiP 창 닫힘 감지 후 상태 정리). 확장 자체의 창만 다루며 다른 창의 콘텐츠에는 접근하지 않음.

이 세 권한은 CWS 심사에서 보통 "powerful permission" 카테고리로 분류되지 않아 별도 justification 텍스트박스가 안 뜨는 경우가 많지만, Data usage 탭 서술에서 "왜 필요한가"를 한 줄씩 언급해두면 반려 리스크를 더 줄일 수 있다.

---

## 4. Data usage disclosure 탭 작성 가이드

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

> **Pro 유료화 관련 주의 (현 시점 무관, 7장 참고):** `pro.js`가 저장하는 `proEntitlement`(grandfathered 플래그 등)도 전적으로 로컬/`chrome.storage.sync`에만 있으며 현재는 어떤 결제·라이선스 검증 통신도 하지 않는다. 즉 위 "네트워크 통신 전무" 서술은 현 제출에서 여전히 100% 사실이다. **단, 이 서술은 라이선스 검증 서버 통신이 도입되는 순간(7장) 더는 사실이 아니게 되므로, 유료화 배포 전 반드시 이 탭을 재작성해야 한다.**

---

## 5. Privacy Policy 페이지에 반드시 포함할 내용

> **✅ 게시 완료 (2026-07-27):** **https://elta33.github.io/TBB-Privacy_Policy/** — GitHub Pages로 게시됨(영문 기본 + 한국어 버전 링크, 로그인 없이 접근 가능한 HTTPS). Dashboard "Privacy policy" 필드에 **이 URL을 입력**한다. 라이브 페이지가 아래 5개 항목을 모두 포함함을 확인했다(무수집 진술 · `<all_urls>` 사유 · 로컬 저장 vs 서버 전송 · `chrome.storage.sync` = Google 계정 인프라 경유 · 문의 이메일 `tbbbusiness33@gmail.com`). 페이지 내용을 바꿀 때는 아래 5개 항목이 계속 충족되는지 재확인할 것.

CWS는 **텍스트가 아니라 실제로 접근 가능한 URL**을 요구한다(GitHub Pages, Notion 공개 페이지, 개인 도메인 등 아무 곳이나 가능). 아래 항목이 빠지면 "host permission을 요청하는데 privacy policy가 그 사용처를 설명하지 않는다"는 사유로 반려될 수 있다.

1. 확장이 수집하는 데이터가 없다는 명시적 진술(위 4장 서술 재사용 가능)
2. `<all_urls>` 호스트 권한을 요청하는 이유를 사용자 눈높이로 한 번 더 설명(예: "귀하가 어떤 사이트를 차단 목록에 추가하시든 그 사이트에서 차단 기능이 작동해야 하므로...")
3. 로컬 저장(chrome.storage) vs 서버 전송 여부 — "서버로 전송되지 않는다"를 명확히
4. Chrome 계정 동기화(`chrome.storage.sync`) 사용 시 그 데이터가 Google 계정 인프라를 통해 이동한다는 점(개발자가 별도로 수집하지 않는다는 점과 구분해서 서술)
5. 문의 연락처(이메일 등)

---

## 6. 제출 전 체크리스트

- [x] `manifest.json`에서 미사용 `activeTab` 제거 (3-5장, 완료)
- [x] Single purpose 설명에 포모도로/통계/PIN 등 부가기능을 "차단 기반 시간관리"의 하위 수단으로 명시적으로 연결 (2장에 영문/한글 붙여넣기용 텍스트 작성 완료 — 제출 시 Dashboard에 붙여넣기)
- [x] Privacy policy 페이지를 실제 URL로 게시 — **https://elta33.github.io/TBB-Privacy_Policy/** (5장 5개 항목 전부 포함 확인, 2026-07-27). Dashboard "Privacy policy" 필드에 이 URL 입력.
- [ ] Data usage 탭에서 Web history만 체크 + 3개 인증 전부 체크 (4장)
- [ ] 각 권한 justification 텍스트박스에 3장의 영문 문단을 우선 붙여넣기(리뷰어 자동번역 오류 방지), 필요시 한글 병기 — `unlimitedStorage`는 텍스트박스가 안 뜨면 Data usage 서술에만 포함해도 무방 (3-6장)
- [ ] Single purpose 필드에 2장 텍스트 붙여넣기(길이 제한 시 "핵심 한 줄"만) — 실제 Dashboard 입력 시점에 처리
- [ ] 최초 제출 후 "추가 정보 요청"이 오면 정상적인 절차로 간주하고, 요청받은 구체적 질문에 코드 근거(파일명:라인)로 답변
- [x] **현 제출 시점 확인:** `pro.js`의 `TBB_PRO_LAUNCH_FREE === true` → 결제/라이선스 검증·외부 통신 없음. "네트워크 통신 전무" 서술이 유효함을 재확인 (7장)
- [ ] **(유료화 전환 시에만)** 7장의 재심사 트리거 4종 완료 여부 확인 — 아직 유료화 안 했으면 이 항목은 건드리지 않는다

---

## 7. Pro 부분 유료화(`pro.js`) — 현 제출 영향 없음 + 유료화 시 재심사 트리거

`pro.js`는 TBB Pro 부분 유료화를 위한 **feature-flag 인프라**다. 지금 당장 CWS 심사 서술을 바꿀 필요는 없지만, "왜 지금은 안 바꿔도 되는지"와 "언제 반드시 바꿔야 하는지"를 못 박아 두어 나중에 무심코 유료화 배포를 하면서 데이터 공시를 빠뜨리는 사고를 막는다.

**현재 상태 (현 제출):**
- 마스터 스위치 `TBB_PRO_LAUNCH_FREE = true`(`pro.js:23`) — "출시 기념 전 기능 무료" 모드. 모든 사용자가 모든 기능을 무료로 쓰며, 이 기간 실행 사용자는 grandfathered(영구 무료)로 각인된다.
- 이 모드에서 `_tbbComputeActive()`는 캐시·라이선스와 무관하게 항상 `true`를 반환하므로(`pro.js:62-69`) **결제·라이선스 검증 로직이 실행되지 않으며, 어떤 외부 서버 통신도 발생하지 않는다.**
- 저장하는 유일한 데이터는 `proEntitlement`(`{ grandfathered, license, updatedAt }` 형태) 하나로, `TBBStorage`를 통해 로컬/계정 sync에만 저장된다(`pro.js:53-59`, `background.js:453·459`의 `ensureGrandfather()` 호출). 새로운 데이터 카테고리도, 외부 전송도 없다.
- **결론:** 3장 권한 정당화와 4장 데이터 공시(네트워크 통신 전무)는 현 제출에서 100% 그대로 유효하다. 새 권한도 추가되지 않았다(`pro.js`는 기존 `storage`만 사용).

**리뷰어가 물어볼 수 있는 것 대비:** "Pro/결제 기능이 있는데 왜 결제 관련 권한·통신이 없나?"라고 물으면 — "현재 빌드는 전 기능 무료 모드이고 결제 경로가 코드상 비활성(dead)이며, 유료화 시 별도 버전으로 재심사를 받겠다"고 답한다. `pro.js:14-23` 주석이 이 의도를 코드 자체에 남겨 두었다.

**⚠️ 유료화 전환 시 반드시 함께 가야 하는 재심사 트리거 (4종, `pro.js:18-22` 주석과 동일):**
1. `TBB_PRO_LAUNCH_FREE = false`로 바꾸는 것이 곧 "과금 시작"이다 — 이 커밋 단독으로 배포 금지.
2. `_tbbComputeActive`의 license 분기(결제·라이선스 검증) 구현. **여기서 외부 서버 통신이 도입될 가능성이 높다** → 도입되는 순간 "네트워크 통신 전무" 전제가 깨진다.
3. **개인정보처리방침(5장) + CWS Data usage 공시(4장) 갱신** — 라이선스/결제 검증으로 오가는 데이터(주문 토큰, 라이선스 키, 결제 프로세서 식별자 등)의 카테고리·수신자·목적을 새로 기재. 결제 프로세서가 제3자면 "제3자와 공유" 체크 상태도 재검토.
4. `manifest.json`의 `version` 상향 후 **재심사 제출**. Pro 기능 호출부에 `TBBPro.has('...')` 게이트 + UI 자물쇠도 함께.

> 요약: **지금은 손댈 것이 없다.** 이 절은 미래의 자신(또는 다음 작업자)이 유료화 배포 직전에 다시 펼쳐 볼 체크포인트다.

---

## (참고) 게시 안내 — CWS 제출용 URL 만들기

> **현재 상태: 게시 완료.** `https://elta33.github.io/TBB-Privacy_Policy/` (GitHub Pages, 별도 저장소 `TBB-Privacy_Policy`). 아래 안내는 향후 이전·재게시 시 참고용으로 남겨 둔다.

CWS Developer Dashboard의 "Privacy policy" 필드에는 이 텍스트를 붙여넣을 수 없고, **공개 접근 가능한 HTTPS URL**을 넣어야 합니다. 아래 중 하나로 게시하십시오.

- **GitHub Pages (권장):** 이 저장소에 `docs/privacy-policy.md`(또는 `index.md`)로 넣고 Settings → Pages에서 소스를 지정하면 `https://<사용자명>.github.io/<저장소>/privacy-policy` 형태의 안정적인 URL이 생깁니다.
- **공개 Notion 페이지:** 페이지 우측 상단 "Share → Publish"로 웹 게시(공개 접근 허용)한 뒤 그 URL 사용.

**주의(재검증 완료):** 로그인 없이 접근 가능한 HTTPS 여야 하며, 리뷰 봇이 크롤링하므로 404·리다이렉트 루프·플레이스홀더 페이지면 반려됩니다. 또한 **수시로 바뀌는 GitHub README 링크가 아니라 안정적인 URL**을 쓰라는 것이 공식 권고입니다(README는 예고 없이 바뀔 수 있음). 로그인이 필요한 Google Docs 링크는 부적합합니다.
</content>
</invoke>
