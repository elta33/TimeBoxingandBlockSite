# FocusBox: WebsiteBlock & TimeBoxing Planner — 프로젝트 개요

## 1. 개요

**FocusBox**는 Manifest V3 기반의 Chrome 확장 프로그램으로, 타임박싱 스케줄러와 웹사이트 차단 기능을 통해 사용자의 집중력을 향상시킨다.

- 설정한 시간대(타임박스)에 지정된 웹사이트를 자동으로 차단
- 항상 차단할 사이트(상시 차단)와 스케줄에 따라 차단할 사이트(일반 차단)를 구분 관리
- 유튜브 쇼츠·인스타그램 릴스/탐색 등 특정 기능만 골라 막는 강력 차단
- 포모도로 타이머와 연동하여 작업 시간 중 추가 차단 적용
- 차단 화면을 사용자 지정 이미지·인용구로 꾸밀 수 있음
- 집중 시간·차단 횟수·포모도로 완료 사이클 등 활동 통계를 기록·시각화
- 포모도로 프리셋으로 자주 쓰는 설정을 저장·복원하고, 사이클별 시간·차단 도메인을 개별 오버라이드 가능
- 설정 페이지 내 플로팅 할일(Todo) 패널로 집중 중 할 일 관리
- PIN 잠금으로 박스 수정·삭제·초기화 등 파괴적 조작을 보호
- 크롬 계정 기반 기기 간 설정 동기화 (`chrome.storage.sync`)
- 최초 설치 시 온보딩 체크리스트로 초기 설정 유도
- 라이트/다크 모드 지원 (시스템 설정 자동 감지, 토글로 고정)
- 한국어/영어 현지화 지원

---

## 2. 파일 구조

```
TimeBoxingandBlockSite/
├── manifest.json          # 확장 선언 (MV3, 퍼미션, 스크립트 등록)
│
├── background.js          # Service Worker — DNR 규칙 관리, 알람, SPA 차단 판별
│
├── popup.html / popup.js  # 툴바 아이콘 클릭 시 나타나는 팝업
├── options.html            # 전체 설정 페이지 (5개 탭)
├── options-core.js         # PIN 잠금 + 도메인 리스트 유틸 + 타임박스 스케줄러 + 내보내기/불러오기
├── options-stats.js        # 통계 탭 렌더링 (바 차트/상위 도메인/포모도로 통계/시간대 분포/스트릭 달력)
├── options-init.js         # 옵션 페이지 부트스트랩 (DOMContentLoaded — 온보딩, 탭 전환, 다크모드, PIN, 동기화 배지)
├── options-pomodoro.js     # 포모도로 타이머 탭 UI (표시/틱/프리셋/사이클·도메인 고급 설정)
├── pomodoro-shared.js      # 사이클별 시간 계산 공용 로직 — background.js(importScripts)/options-pomodoro.js/pomodoro-pip.js 공유
├── storage-api.js          # TBBStorage.get/set — sync/local 자동 라우팅 레이어 (전 스크립트 공유)
├── storage.js              # 설정 페이지 전역 상태 + CRUD 헬퍼 (TBBStorage 위에 구축)
├── render-day.js           # 하루 도넛(원형) 타임테이블 SVG 렌더러
│
├── block.html / block.js  # 차단 페이지 (배경 이미지, 인용구, 커스텀 UI)
│
├── content.js             # Isolated World: SPA 내비게이션 감지 → background 차단 요청
├── page-world.js          # MAIN World: pushState/replaceState 후킹 → content.js 알림
│
├── strong-block-selectors.css      # 쇼츠·인스타 요소 코스메틱 숨김 (속성/구조 선택자)
├── strong-block-selectors.js       # CSS로 못 잡는 텍스트 기반 요소 숨김 (쇼츠 칩, 인스타 추천 헤더 등)
├── strong-block-insta-caughtup.css # 인스타 "모두 확인했습니다" 카드 숨김 (팔로우 게시물 표시 옵션 off일 때만 등록)
│
├── pomodoro-pip.html / pomodoro-pip.js  # Picture-in-Picture 포모도로 창
│
├── theme.js               # 다크모드 적용·동기화 (options/popup/pip에서 로드, block.html 제외)
├── todo.js                # 플로팅 할일 패널 (드래그 가능, options.html & block.html 공유)
├── i18n.js                # __MSG_key__ 처리 및 T() 헬퍼 함수
├── styles/
│   ├── tokens.css         # 공용 CSS 컬러 토큰 (tomato/blue/green/amber 계열 + 다크모드 오버라이드)
│   └── components.css     # 공통 컴포넌트 CSS
├── _locales/
│   ├── ko/messages.json   # 한국어 문자열
│   └── en/messages.json   # 영어 문자열
└── store-listing/         # 크롬 웹스토어 심사·등록 자산 (설명, 권한 사유, 프로모션 타일 등 — 런타임 무관)
```

---

## 3. 핵심 기능

### 3-1. 웹사이트 차단 (Declarative Net Request)

차단은 Chrome의 `declarativeNetRequest` API(DNR)로 구현된다. 페이지 로드마다 크롬 엔진이 규칙을 직접 평가하므로 별도 요청 인터셉트 코드가 필요 없다.

**차단 유형과 DNR 우선순위:**

| 유형 | 조건 | 우선순위 | 리다이렉트 파라미터 |
|------|------|---------|--------------|
| 상시 차단 (`permanentList`) | 항상 | 100 | `?domain=…&reason=permanent` |
| 포모도로 차단 (`pomodoroList`) | 포모도로 work 페이즈 중 | 30 | `?domain=…&reason=pomodoro` |
| 커스텀 허용 (`customDomains`) | 활성 타임박스 내 예외 | 50 | — (allow) |
| 일반 차단 (`generalList`) | 활성 타임박스 시간 내 | 10 | `?domain=…&reason=general` |
| 강력 차단 (쇼츠/인스타) | 토글 on | 5 (최하위) | 사이트 홈으로 redirect (block.html 아님) |

> **DNR 제약 우회:** Chrome DNR에서 `allow` 액션은 `block` 액션만 무력화하고 `redirect`는 무력화하지 못한다. 따라서 "커스텀 허용 → 일반 차단 리다이렉트" 충돌은 우선순위 규칙이 아닌 **차단 규칙 자체를 등록하지 않는** 방식으로 해결한다. 같은 이유로 두 군데에서 같은 패턴을 쓴다 — generalList는 `finalAllowSet`으로, 포모도로 프리셋의 허용 예외는 `pomodoroActiveDomainOverride.allow`로 규칙 생성을 건너뛴다.

규칙은 `updateBlockingRules()`가 생성하며, 실제 차단 판정(SPA 경로)은 `shouldUrlBeBlocked()`가 같은 우선순위 로직을 JS로 재현한다. 도메인 매칭은 정확히 일치하거나 서브도메인(`.example.com`)일 때 성립한다.

### 3-2. SPA 차단 (History API 후킹)

DNR은 최초 페이지 로드만 잡는다. YouTube Shorts처럼 `pushState`/`replaceState`로 URL이 바뀌는 SPA 내비게이션은 별도로 처리한다.

```
page-world.js (MAIN World)
  └─ pushState / replaceState 오버라이드
      └─ window.postMessage({ type: '__TBB_NAV__', url })
          └─ content.js (Isolated World)
              └─ chrome.runtime.sendMessage({ type: 'checkBlock', url })
                  └─ background.js → shouldUrlBeBlocked()
                      └─ 일반 차단이면 location.replace(block.html?reason=…&domain=…)
                      └─ reason이 shorts/insta면 사이트 홈으로 location.replace (3-3 참고)
```

악성 사이트의 postMessage 폭주를 막기 위해 200ms 쓰로틀이 적용된다.

일반 차단 경로의 리다이렉트에는 `domain` 파라미터가 포함되어 통계 로깅에 활용된다.

### 3-3. 강력 차단 (쇼츠 / 인스타그램)

도메인 전체가 아니라 유튜브 쇼츠·인스타그램 릴스/탐색 같은 **특정 기능만** 골라 막는다. 차단 관리 탭 상단의 카드에서 사이트별 토글(`shortsBlockEnabled` / `instaBlockEnabled`)로 켜고 끈다. 두 방향을 함께 쓴다:

**1) 페이지 이동 차단 (리다이렉트)**

- **DNR (계급 5, 최하위)**: `youtube.com/shorts`, `instagram.com/{explore,reels,p}` 진입을 사이트 홈으로 redirect. block.html이 아니라 조용히 홈으로 되돌린다. 최하위라 상시(100)·포모도로(30)·일반(10) 차단이 이미 걸려 있으면 그쪽이 이겨 block.html이 뜬다.
- **SPA 폴백**: 홈 피드에서 썸네일 클릭 등 내부 이동은 DNR이 못 잡으므로 `shouldUrlBeBlocked()`가 `reason: 'shorts' | 'insta'`를 반환하고, `content.js`가 사이트 홈으로 `location.replace`한다. 경로 매칭은 정확 일치 또는 하위 경로(`/reels/…`)만 인정해 `/reelsguy` 같은 사용자명 오매칭을 막는다.

**2) 코스메틱 숨김 (요소 제거)**

`chrome.scripting.registerContentScripts`로 `document_start`에 CSS/JS를 동적 등록한다(토글 off 시 unregister). 정적 주입이라 페이지 CSP를 우회하고 깜빡임이 없다.

- CSS(`strong-block-selectors.css`): 속성·구조 선택자로 잡히는 요소 — `document_start`부터 즉시 적용되어 무지연
- JS(`strong-block-selectors.js`): 순수 텍스트로만 구분되는 요소(쇼츠 검색 필터 칩, 인스타 "추천 게시물" 헤더) — `MutationObserver` + rAF 디바운스로 처리(CSS보다 늦어 노출 시간 최소화가 한계)
- 인스타 하위 옵션 `instaShowFollowedPosts`: 팔로우 계정 게시물을 홈에 남긴다. off일 때만 `strong-block-insta-caughtup.css`("모두 확인했습니다" 카드 숨김)를 등록 목록에 포함 — JS 조건 분기 대신 파일 자체를 넣고 빼 CSS 무지연 이점을 유지
- 토글 변경 시 이미 열린 유튜브·인스타 탭은 `chrome.tabs.reload`로 자동 새로고침 (기존 content script가 옛 상태로 돌고 있어서)

### 3-4. 타임박스 스케줄러

타임박스는 두 종류로 저장된다:

| 스토리지 키 | 설명 | 요일 필드 |
|------------|------|---------|
| `dailyBoxes` | 하루 뷰 박스 (매일 동일 적용) | `days: []` (빈 배열 = 매일) |
| `weeklyBoxes` | 주간 뷰 박스 (요일 지정) | `days: [0,1,...]` (0=월~6=일) |

각 박스 객체 구조:
```js
{
  name: "집중 코딩 시간",
  startTime: "09:00",
  endTime: "12:00",
  mode: "block",
  days: [0, 1, 2, 3, 4],       // 월~금 (weeklyBoxes만)
  customDomains: [              // 이 박스 동안 허용할 도메인
    { domain: "github.com", mode: "allow" }
  ]
}
```

자정을 넘기는 박스(예: 22:00~02:00)도 지원하며, 뷰에서 두 조각으로 분할 렌더링한다.

박스 **추가**뿐 아니라 **수정**도 지원한다 (`_editingBoxIndex`로 수정 대상을 추적하며, 완료·취소 시 추가 모드로 복귀).

### 3-5. 포모도로 타이머

`pomodoroState` 스토리지로 상태를 공유하며, background.js / options-pomodoro.js / pomodoro-pip.js 세 곳이 동시에 구독한다. 사이클별 시간 계산(`_resolveCycleTimes`/`_findCycleOverride`/`_cycleOverrideDiffs`)은 `pomodoro-shared.js`에 공용으로 구현되어 있다 (background.js는 `importScripts`로, options-pomodoro.js/pomodoro-pip.js는 `<script>` 태그로 로드).

```js
// pomodoroState 구조
{
  active: true,
  phase: "work",      // "work" | "rest" | "done" | "idle"
  endTime: 1700000000000,   // Unix ms
  cycle: 1,
  totalCycles: 4,
  pausedRemaining: null,    // 일시정지 시 남은 초
  advancedAt: 1700000000000 // 페이즈 전환 시각 (중복 전환 가드)
}
```

- `background.js`: 1분 알람(`timeboxTicker`)마다 `checkPomodoroPhase()` 호출 → endTime 초과 시 페이즈 자동 전환
- `options-pomodoro.js` / `pomodoro-pip.js`: setInterval 기반 1초 tick으로 카운트다운 표시 및 페이즈 전환
- 경쟁 조건 방지: UI가 먼저 전환했을 경우 `advancedAt`이 10초 이내이면 background가 중복 전환하지 않음
- **PiP 창**: `chrome.windows.create({ type: 'popup' })`로 별도 창 생성, `pipWindowId`로 이미 열린 창 재사용
- **Always on Top**: 설정 토글 활성화 시 PiP 창을 Document PiP API 방식으로 승격(`pomodoro-pip.js` L272~)

**포모도로 프리셋 (`pomodoroPresets`):**

현재 설정(workMins, restMins, cycles, cycleOverrides, blockOverrides)을 이름을 붙여 저장하고 한 번 클릭으로 복원할 수 있다. 목록은 4개씩 페이지네이션된다.

**프리셋별 차단 도메인 커스텀 (`blockOverrides` → `pomodoroActiveDomainOverride`):**

프리셋마다 포모도로 차단 목록을 다르게 가져갈 수 있다.

- `allow`: `pomodoroList`에 있지만 이 프리셋에서만 예외로 허용할 도메인
- `extra`: 이 프리셋에서만 추가로 차단할 도메인

적용 시 `_applyPomoBlockOverride()`가 `extra`를 라이브 `pomodoroList`에 병합하고, 활성 오버라이드를 `pomodoroActiveDomainOverride`에 기록한다. 다른 프리셋으로 전환하면 이전 `extra`를 먼저 롤백해 잔여물이 남지 않는다.

`allow` 도메인은 `pomodoroList`에서 지우지 않고 **DNR 규칙 생성 시에만 건너뛴다** — 프리셋 없이 되돌아오면 다시 차단되어야 하고, `allow` 액션은 `redirect`를 이길 수 없기 때문이다(3-1의 `finalAllowSet`과 같은 이유).

**포모도로 고급 설정 (`pomodoroCycleOverrides`):**

사이클 번호마다 workMins/restMins를 기본값과 다르게 오버라이드할 수 있다. 프리셋에 포함되어 함께 저장·복원된다.

```js
// pomodoroCycleOverrides 구조
[{ cycle: 2, workMins: 50, restMins: 10 }]   // 2번째 사이클만 50/10분

// pomodoroPresets 구조
[{
  name: "딥워크",
  workMins: 90, restMins: 20, cycles: 3,
  cycleOverrides: [{ cycle: 2, workMins: 50, restMins: 10 }],
  blockOverrides: { allow: ["github.com"], extra: ["reddit.com"] }  // 없으면 일반 프리셋
}]
```

### 3-6. 통계 시스템

집중 활동 이력을 `focusEvents` / `focusStreak` 두 키에 누적 저장하며, 최대 30일치를 보관한다.

**데이터 수집 경로:**

| 수집 주체 | 트리거 | 기록 내용 |
|---------|--------|---------|
| `background.js` (`_statsLogBoxMinute`) | 1분 알람, 활성 타임박스 내 | `day.focusMins += 1` |
| `background.js` (`_statsLogPomoSession`) | 포모도로 work 페이즈 종료 | `day.pomoSessions.push({ ts, durationMins })` |
| `block.js` (`logBlockEvent` IIFE) | block.html 로드 시 (`domain` 파라미터 존재) | `day.blocks.push({ domain, reason, ts })` |

세 경로 모두 기록과 동시에 `focusStreak`을 갱신하고(`_statsUpdateStreak` / `block.js`의 `_statsStreak`), 30일이 지난 레코드를 잘라낸다.

`focusEvents` 일별 레코드 구조:
```js
{
  date: "2026-06-28",
  focusMins: 42,
  blocks: [{ domain: "youtube.com", reason: "general", ts: 1719500000 }],
  pomoSessions: [{ ts: 1719501000, durationMins: 25 }]
}
```

`focusStreak` 구조:
```js
{ current: 5, longest: 12, lastDate: "2026-06-28" }
```

**통계 탭 시각화 (`options-stats.js`):**

| 구성 요소 | 함수 | 내용 |
|---------|------|------|
| 히어로 카드 | `renderStats` | 스트릭 일수, 집중 시간, 차단 횟수 |
| 집중 시간 바 차트 | `_renderBlockBarChart` | 일별 focusMins 막대 그래프 (오늘 강조) |
| 상위 차단 도메인 | `_renderTopDomains` | 기간 내 차단 빈도 상위 도메인 랭킹 |
| 포모도로 통계 | `_renderPomoStats` | 오늘/7일/30일 완료 사이클·집중 시간 |
| 차단 시간대 분포 | `_renderHeatmap` | 0~23시 차단 횟수 SVG 막대 그래프 (함수명은 히트맵 시절 잔재) |
| 스트릭 달력 | `_renderStreakCalendar` | 날짜별 활동 유무 달력 |

기간 필터는 오늘 / 7일 / 30일 세 가지이며 탭 클릭 시 `renderStats(period)`를 재호출한다.

### 3-7. 할일 리스트 (Todo 패널)

`todo.js`가 제공하는 플로팅 패널로, `options.html`과 `block.html`에 동시에 삽입된다.

```
todoTrigger (드래그 가능한 플로팅 아이콘)
  └─ 클릭 → todoPopup (미완료 목록)
               ├─ 입력창 + 추가 버튼 (Enter 지원)
               ├─ 미완료 항목 (체크박스·삭제 버튼)
               └─ 완료 배지 클릭 → todoDonePopup (완료 목록)
```

- 아이콘 위치는 드래그로 이동 가능하며 `todoTriggerPos`에 저장 (마그넷 스프링 애니메이션 포함)
- `chrome.storage.onChanged`로 실시간 동기화 → options 탭과 block 페이지가 같은 목록을 공유
- 미완료 개수 배지가 아이콘에 표시됨

### 3-8. PIN 잠금

삭제·수정·초기화 등 파괴적 조작을 PIN(4자 이상, 최대 20자)으로 보호한다.

- PIN은 무작위 salt + SHA-256 해시로 저장 (`lockPin: { hash, salt, enabled }`) — 평문은 저장하지 않음
- 보호 대상 액션: 개별 박스 수정·삭제(주간 뷰 + 도넛 뷰 양쪽), 박스 전체 삭제, 하루 스케줄 비활성화, PIN 해제
- 잠긴 조작을 시도하면 `_openPinModal()`이 모달을 띄우고, 검증 성공 시에만 콜백 실행 (실패 시 shake 애니메이션)
- PIN 미설정 시 모든 조작 허용 (기본값)
- PIN 설정·변경·비활성화 UI는 **설정** 탭에 위치

### 3-9. 다크모드 시스템

`theme.js`가 options.html / popup.html / pomodoro-pip.html 세 화면에서 공통으로 로드된다.

- 최초 진입 시 `prefers-color-scheme` 시스템 설정을 읽어 `darkModeEnabled` 스토리지에 저장
- 이후에는 저장 값 기준 — 설정 탭 토글로 변경 가능
- `<html data-theme="dark | light">` 속성으로 CSS 스코프를 제어하며, `styles/tokens.css`의 `:root[data-theme="dark"]` 블록이 색상 변수를 오버라이드
- `localStorage`(`tbb-theme`)에도 캐시하여 chrome.storage 비동기 응답 전 깜빡임(FOUC) 방지
- **block.html은 이 시스템 제외** — 이미 자체 다크 오버레이 테마라 토글과 무관하므로 `theme.js`를 로드하지 않는다

### 3-10. 온보딩 체크리스트

최초 설치 시 차단 관리 탭 상단에 진행형 체크리스트 카드를 띄워 초기 설정을 유도한다.

- `background.js`의 `onInstalled`에서 `onboardingDismissed`가 `undefined`일 때만 노출 대상으로 판정 — 즉 **신규 설치에만** 보이고 기존 사용자에겐 뜨지 않는다
- 단계: ① 차단할 사이트 추가 ② 타임박스 만들기 (각 단계는 해당 데이터 존재 여부로 자동 체크)
- 각 단계의 버튼은 해당 탭으로 이동시키며, 닫기 버튼(또는 완료)은 `onboardingDismissed: true`를 저장해 다시 뜨지 않게 한다

### 3-11. 기기 간 동기화 상태 표시

`chrome.storage.sync`는 실패해도 조용해서 "다른 기기에 왜 반영이 안 되지?"에 답할 수단이 없었다. `storage-api.js`가 sync 성공·실패·용량 축소 이력을 `_syncStatus`(local 전용)에 남기고, 설정 탭이 이를 배지로 노출한다.

| 상태 | 표시 |
|------|------|
| 성공 | 마지막 동기화 시각 |
| 실패 | 실패 시각 + "이 기기에만 저장됨" |
| 기록 없음 | "동기화 기록 없음" |
| 용량 축소 발생 | "통계 데이터는 최근 14일치만 동기화됨" 추가 표기 |

### 3-12. 도메인 입력 편의 기능

| 기능 | 구현 | 동작 |
|------|------|------|
| 리스트 검색 | `_initDomainSearchInputs` / `_applyDomainFilter` | 6개 도메인 리스트(상시·일반·포모도로·박스 커스텀·고급 설정)에 실시간 필터 |
| 기본 도메인 추천 | `_initDomainSuggestions` | 추가 입력이 비어있을 때 포커스하면 인기 도메인 드롭다운 표시, 클릭 시 즉시 등록 |

추천 드롭다운은 `click`이 아닌 `mousedown` + `preventDefault()`로 처리한다 — `click`은 그 전에 input이 blur되며 드롭다운이 닫혀 클릭이 씹히기 때문이다.

### 3-13. 차단 화면 커스터마이징

`block.html`에서 제공하는 기능:

- 배경 이미지 (`customBgImages`): 파일 업로드 → Base64로 저장. 기본 제공 이미지 5장은 `{ name, builtin: 'images/…' }` 형태로 경로만 참조하고, 업로드분은 `{ name, data: 'data:image/…' }`로 실 데이터를 담는다
- 인용구 (`customQuotes`): 텍스트 입력 → 스토리지 저장. 스토리지가 비어 있으면 현지화된 기본 인용구 5개를 최초 1회 시딩
- 이미지-인용구 링크 (`customLinks`): `{ imgName, quote }` 쌍으로 묶어 함께 표시
- 링크가 없으면 이미지·인용구를 각각 랜덤 선택

---

## 4. 데이터 스토리지

`storage-api.js`의 `TBBStorage.get/set`이 키별로 `chrome.storage.sync`/`chrome.storage.local`을 자동 라우팅한다 (호출부는 area를 신경 쓰지 않음). sync 대상은 크로스 기기 동기화가 의미 있고 크기·쓰기빈도가 안전한 키만 선별했다 — 활성 타이머·창 위치·Base64 이미지처럼 기기별 상태이거나 sync 용량(8KB/아이템) 위험이 큰 키는 의도적으로 local에 고정했다. 신규 sync 키 추가 시 `storage-api.js`의 `TBB_SYNC_KEYS`만 수정하면 된다.

| 키 | 영역 | 타입 | 설명 |
|----|------|------|------|
| `permanentList` | sync | `string[]` | 상시 차단 도메인 목록 |
| `generalList` | sync | `string[]` | 일반 차단 도메인 목록 |
| `dailyBoxes` | sync | `Box[]` | 하루 타임박스 배열 |
| `weeklyBoxes` | sync | `Box[]` | 주간 타임박스 배열 |
| `dailyScheduleEnabled` | sync | `boolean` | 하루 스케줄 활성화 여부 (기본 true) |
| `weekStartMonday` | sync | `boolean` | 주 시작 요일 (false=일요일) |
| `shortsBlockEnabled` | sync | `boolean` | 유튜브 쇼츠 강력 차단 on/off |
| `instaBlockEnabled` | sync | `boolean` | 인스타그램 강력 차단 on/off |
| `instaShowFollowedPosts` | sync | `boolean` | 인스타 강력 차단 시 팔로우 계정 게시물은 홈에 남김 (하위 옵션) |
| `focusEvents` | sync | `DayEvent[]` | 일별 집중 활동 이력 (최대 30일, sync 용량 초과 시 14일로 자동 축소) |
| `focusStreak` | sync | `object` | `{ current, longest, lastDate }` |
| `todoItems` | sync | `object[]` | 할일 항목 `[{ id, text, done }]` |
| `pomodoroSettings` | sync | `object` | `{ workMins, restMins, cycles }` |
| `pomodoroPresets` | sync | `object[]` | 저장된 포모도로 프리셋 목록 |
| `pomodoroCycleOverrides` | sync | `object[]` | 사이클별 시간 오버라이드 `[{ cycle, workMins, restMins }]` |
| `pomodoroList` | sync | `string[]` | 포모도로 차단 도메인 목록 |
| `customQuotes` | sync | `string[]` | 차단 화면 인용구 |
| `customLinks` | sync | `object[]` | 이미지-인용구 쌍 링크 `[{ imgName, quote }]` (참조하는 이미지가 sync 안 되는 커스텀 업로드면 다른 기기에서 매칭 안 될 수 있음 — graceful degradation) |
| `pomodoroState` | local | `object` | 포모도로 현재 상태 (활성 타이머 — 기기 간 경합 방지 위해 로컬 고정) |
| `pomodoroActiveDomainOverride` | local | `object` \| `null` | 현재 적용 중인 프리셋의 도메인 커스텀 `{ allow, extra }` (활성 상태라 로컬) |
| `onboardingDismissed` | local | `boolean` | 온보딩 카드 닫힘 여부 (신규 설치 판별 겸용 — 기기별 노출이라 로컬) |
| `_syncStatus` | local | `object` | sync 성공·실패·축소 이력 `{ lastSuccessAt, lastErrorAt, lastError, trimmedFocusEventsAt }` (기기마다 사정이 달라 절대 sync 안 함) |
| `pipWindowId` | local | `number` | PiP 창 ID (기기별 값) |
| `pomodoroPipPos` | local | `object` | PiP 창 위치 `{ left, top }` (기기별 값) |
| `customBgImages` | local | `object[]` | 차단 화면 배경 이미지 `[{ name, builtin?, data? }]` (Base64 — sync 용량 초과 확정이라 로컬 고정) |
| `lockPin` | local | `object` | PIN 잠금 정보 `{ hash, salt, enabled }` (기기별로 다르게 쓰고 싶다는 사용자 판단으로 로컬 유지) |
| `todoTriggerPos` | local | `object` | Todo 아이콘 위치 `{ left, top }` (기기별 값) |
| `darkModeEnabled` | local | `boolean` | 다크모드 활성화 여부 (사용자 요청으로 로컬 유지, 최초 진입 시 시스템 설정으로 초기화) |
| `_syncMigrationDone_v1` / `_syncMigrationDone_v2` | local | `boolean` | local→sync 1회성 마이그레이션 완료 플래그 (v1: 차단설정·통계, v2: 투두·포모도로 설정/프리셋·차단화면 문구/링크) |

---

## 5. 설정 페이지 탭 구성 (`options.html`)

| 탭 | 기능 |
|----|------|
| **차단 관리** | 온보딩 체크리스트(신규 설치 시) + 강력 차단 카드(쇼츠/인스타 토글) + 상시 차단 / 일반 차단 도메인 추가·삭제·검색 |
| **타임박스 스케줄러** | 박스 추가·수정 폼 + 하루(도넛) / 주간(세로 타임테이블) 뷰 |
| **포모도로 타이머** | 타이머 설정, 시작/일시정지/중지, PiP(Always on Top 옵션), 프리셋 저장·적용, 사이클별·도메인별 고급 설정, 포모도로 전용 차단 목록 |
| **통계** | 집중 시간·차단 횟수·스트릭·포모도로·시간대 분포 시각화 (오늘/7일/30일 필터) |
| **설정** | 전체 데이터 JSON 내보내기 / 불러오기, PIN 잠금, 다크모드 토글, 동기화 상태 배지 |

### 타임테이블 뷰

- **하루 뷰 (도넛)**: SVG 원형 시계로 24시간을 표현. 박스를 클릭하면 커스텀 예외 도메인을 인라인 편집
- **주간 뷰**: 요일 × 시간 격자 테이블. 요일 헤더 클릭 시 해당 요일 전용 팝업 모달 오픈

---

## 6. 팝업 (`popup.html`)

확장 아이콘 클릭 시 300px 너비의 팝업 표시:

1. **현재 페이지** 도메인 표시 + 상시/일반 차단 여부 배지, 없으면 빠른 추가 버튼
2. **하루 스케줄 토글** — 비활성화 시 generalList 차단 전체 중단
3. **현재 활성 박스** + **다음 예정 박스** (최대 2개)
4. **포모도로 상태** — 타이머가 돌고 있을 때만 노출. 남은 시간을 1초 tick으로 표시하고, PiP 창을 열거나(없으면 생성) 기존 창에 포커스하는 버튼 제공

---

## 7. 국제화 (i18n)

`i18n.js`가 `chrome.i18n.getMessage()`를 래핑하여 `T(key, [...substitutions])` 헬퍼를 제공한다.

HTML에서는 `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-aria-label` 속성으로 자동 치환한다.

기본 로케일은 `ko`(한국어)이며 `en`(영어)를 지원한다.

---

## 8. 퍼미션

| 퍼미션 | 용도 |
|--------|------|
| `storage` | 모든 설정 저장 |
| `declarativeNetRequest` + `declarativeNetRequestWithHostAccess` | 동적 차단 규칙 |
| `alarms` | 1분 주기 타임박스/포모도로 체크 |
| `windows` | PiP 창 생성·관리 |
| `scripting` | 강력 차단 코스메틱 스크립트 동적 등록/해제 (`registerContentScripts`) |
| `tabs` | 강력 차단 토글 변경 시 열린 유튜브·인스타 탭 자동 새로고침 |
| `<all_urls>` (host) | DNR 리다이렉트 및 content script 삽입 |

> `options_page` 대신 `options_ui`(`open_in_tab: true`)를 쓴다 — 설정 페이지를 좁은 임베드 패널이 아니라 전체 탭으로 연다. `activeTab`은 더 이상 쓰지 않아 제거됐다(현재 탭 URL은 `tabs` 권한으로 조회).

---

## 9. 알려진 설계 제약

- **DNR `allow` vs `redirect`**: Chrome DNR은 `allow`가 `redirect`를 이길 수 없다. 커스텀 허용 도메인은 규칙 우선순위가 아닌 generalList 등록 필터링으로 구현해야 한다.
- **SPA 차단 폴백**: content.js는 초기 로드 시에도 `requestBlockCheck(location.href)`를 호출해 DNR 리다이렉트 실패를 보완한다.
- **포모도로 경쟁 조건**: background alarms와 UI tick이 동시에 페이즈 전환을 시도할 수 있어 `advancedAt` 필드로 10초 이내 중복 전환을 가드한다.
- **Base64 이미지 저장**: `chrome.storage.local` 용량 한도(10MB)에 유의가 필요하다.
- **다크모드 FOUC**: MV3 CSP가 `<head>` 인라인 `<script>`를 차단해 테마를 동기적으로 확정할 수 없다. `theme.js`는 외부 스크립트로 로드되며, chrome.storage 응답 전 깜빡임은 `localStorage` 캐시(`tbb-theme`)를 먼저 읽어 완화한다.
- **sync 용량 한도**: `chrome.storage.sync`는 아이템당 8KB다. `storage-api.js`가 7500B 안전선을 두고 초과 시 `focusEvents`를 14일치로 자동 축소하며, sync 쓰기 실패 시 local에 폴백 저장한다(`_tbbGet`이 폴백분을 보완해 읽음).
