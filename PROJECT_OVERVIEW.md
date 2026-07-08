# FocusBox: WebsiteBlock & TimeBoxing Planner — 프로젝트 개요

## 1. 개요

**FocusBox**는 Manifest V3 기반의 Chrome 확장 프로그램으로, 타임박싱 스케줄러와 웹사이트 차단 기능을 통해 사용자의 집중력을 향상시킨다.

- 설정한 시간대(타임박스)에 지정된 웹사이트를 자동으로 차단
- 항상 차단할 사이트(상시 차단)와 스케줄에 따라 차단할 사이트(일반 차단)를 구분 관리
- 포모도로 타이머와 연동하여 작업 시간 중 추가 차단 적용
- 차단 화면을 사용자 지정 이미지·인용구로 꾸밀 수 있음
- 집중 시간·차단 횟수·포모도로 완료 사이클 등 활동 통계를 기록·시각화
- 포모도로 프리셋으로 자주 쓰는 설정을 저장·복원하고, 사이클별 시간을 개별 오버라이드 가능
- 설정 페이지 내 플로팅 할일(Todo) 패널로 집중 중 할 일 관리
- PIN 잠금으로 삭제·초기화 등 파괴적 조작을 보호
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
├── options.html / options.js  # 전체 설정 페이지 (5개 탭)
├── storage.js             # options.js가 공유하는 스토리지 CRUD 헬퍼
├── render-day.js          # 하루 도넛(원형) 타임테이블 SVG 렌더러
│
├── block.html / block.js  # 차단 페이지 (배경 이미지, 인용구, 커스텀 UI)
│
├── content.js             # Isolated World: SPA 내비게이션 감지 → background 차단 요청
├── page-world.js          # MAIN World: pushState/replaceState 후킹 → content.js 알림
│
├── pomodoro-pip.html / pomodoro-pip.js  # Picture-in-Picture 포모도로 창
│
├── todo.js                # 플로팅 할일 패널 (드래그 가능, options.html & block.html 공유)
├── i18n.js                # __MSG_key__ 처리 및 T() 헬퍼 함수
└── _locales/
    ├── ko/messages.json   # 한국어 문자열
    └── en/messages.json   # 영어 문자열
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

> **DNR 제약 우회:** Chrome DNR에서 `allow` 액션은 `block` 액션만 무력화하고 `redirect`는 무력화하지 못한다. 따라서 "커스텀 허용 → 일반 차단 리다이렉트" 충돌은 우선순위 규칙이 아닌 **generalList 규칙 자체를 등록하지 않는** 방식으로 해결한다 (`finalAllowSet`).

### 3-2. SPA 차단 (History API 후킹)

DNR은 최초 페이지 로드만 잡는다. YouTube Shorts처럼 `pushState`/`replaceState`로 URL이 바뀌는 SPA 내비게이션은 별도로 처리한다.

```
page-world.js (MAIN World)
  └─ pushState / replaceState 오버라이드
      └─ window.postMessage({ type: '__TBB_NAV__', url })
          └─ content.js (Isolated World)
              └─ chrome.runtime.sendMessage({ type: 'checkBlock', url })
                  └─ background.js → shouldUrlBeBlocked()
                      └─ 차단이면 location.replace(block.html?reason=...)
```

악성 사이트의 postMessage 폭주를 막기 위해 200ms 쓰로틀이 적용된다.

SPA 경로를 통한 리다이렉트에도 `domain` 파라미터가 포함되어 통계 로깅에 활용된다.

### 3-3. 타임박스 스케줄러

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

### 3-4. 포모도로 타이머

`pomodoroState` 스토리지로 상태를 공유하며, background.js / options.js / pomodoro-pip.js 세 곳이 동시에 구독한다.

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
- `options.js` / `pomodoro-pip.js`: setInterval 기반 1초 tick으로 카운트다운 표시 및 페이즈 전환
- 경쟁 조건 방지: UI가 먼저 전환했을 경우 `advancedAt`이 10초 이내이면 background가 중복 전환하지 않음
- **PiP 창**: `chrome.windows.create({ type: 'popup' })`로 별도 창 생성, `pipWindowId`로 이미 열린 창 재사용
- **Always on Top**: 설정 토글 활성화 시 PiP 창을 Document PiP API 방식으로 승격(`pomodoro-pip.js` L272~)

**포모도로 프리셋 (`pomodoroPresets`):**

현재 설정(workMins, restMins, cycles, cycleOverrides)을 이름을 붙여 저장하고 한 번 클릭으로 복원할 수 있다.

**포모도로 고급 설정 (`pomodoroCycleOverrides`):**

사이클 번호마다 workMins/restMins를 기본값과 다르게 오버라이드할 수 있다. 프리셋에 포함되어 함께 저장·복원된다.

```js
// pomodoroCycleOverrides 구조
[{ cycle: 2, workMins: 50, restMins: 10 }]   // 2번째 사이클만 50/10분

// pomodoroPresets 구조
[{
  name: "딥워크",
  workMins: 90, restMins: 20, cycles: 3,
  cycleOverrides: [{ cycle: 2, workMins: 50, restMins: 10 }]
}]
```

### 3-5. 통계 시스템

집중 활동 이력을 `focusEvents` / `focusStreak` 두 키에 누적 저장하며, 최대 30일치를 보관한다.

**데이터 수집 경로:**

| 수집 주체 | 트리거 | 기록 내용 |
|---------|--------|---------|
| `background.js` (`_statsLogBoxMinute`) | 1분 알람, 활성 타임박스 내 | `day.focusMins += 1` |
| `background.js` (`_statsLogPomoSession`) | 포모도로 work 페이즈 종료 | `day.pomoSessions.push({ ts, durationMins })` |
| `block.js` (`logBlockEvent` IIFE) | block.html 로드 시 (`domain` 파라미터 존재) | `day.blocks.push({ domain, reason, ts })` |

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

**통계 탭 시각화 (`options.js`):**

| 구성 요소 | 함수 | 내용 |
|---------|------|------|
| 히어로 카드 | `renderStats` | 스트릭 일수, 집중 시간, 차단 횟수 |
| 집중 시간 바 차트 | `_renderBlockBarChart` | 일별 focusMins 막대 그래프 (오늘 강조) |
| 상위 차단 도메인 | `_renderTopDomains` | 기간 내 차단 빈도 상위 도메인 랭킹 |
| 포모도로 통계 | `_renderPomoStats` | 오늘/7일/30일 완료 사이클·집중 시간 |
| 차단 시간대 분포 | `_renderHeatmap` | 0~23시 히트맵 |
| 스트릭 달력 | `_renderStreakCalendar` | 날짜별 활동 유무 달력 |

기간 필터는 오늘 / 7일 / 30일 세 가지이며 탭 클릭 시 `renderStats(period)`를 재호출한다.

### 3-6. 할일 리스트 (Todo 패널)

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

### 3-7. PIN 잠금

삭제·초기화·일정 비활성화 등 파괴적 조작을 PIN(4~8자리 숫자)으로 보호한다.

- PIN은 무작위 salt + SHA-256 해시로 저장 (`lockPin: { hash, salt, enabled }`)
- 보호 대상 액션: 박스 전체 삭제, 데이터 초기화, 하루 스케줄 토글
- PIN 미설정 시 모든 조작 허용 (기본값)
- PIN 설정·변경·비활성화 UI는 **설정** 탭에 위치

### 3-8. 차단 화면 커스터마이징

`block.html`에서 제공하는 기능:

- 배경 이미지: 파일로 업로드 → `chrome.storage.local`에 Base64로 저장
- 인용구: 텍스트 입력 → 스토리지 저장
- 이미지-인용구 링크: 특정 이미지와 인용구를 쌍으로 묶어 함께 표시
- 미선택 시 기본 인용구 5개 중 랜덤 표시

---

## 4. 데이터 스토리지 (`chrome.storage.local`)

| 키 | 타입 | 설명 |
|----|------|------|
| `permanentList` | `string[]` | 상시 차단 도메인 목록 |
| `generalList` | `string[]` | 일반 차단 도메인 목록 |
| `dailyBoxes` | `Box[]` | 하루 타임박스 배열 |
| `weeklyBoxes` | `Box[]` | 주간 타임박스 배열 |
| `dailyScheduleEnabled` | `boolean` | 하루 스케줄 활성화 여부 (기본 true) |
| `weekStartMonday` | `boolean` | 주 시작 요일 (false=일요일) |
| `pomodoroState` | `object` | 포모도로 현재 상태 |
| `pomodoroSettings` | `object` | `{ workMins, restMins, cycles }` |
| `pomodoroList` | `string[]` | 포모도로 차단 도메인 목록 |
| `pipWindowId` | `number` | PiP 창 ID |
| `blockBgImages` | `object[]` | 차단 화면 배경 이미지 (Base64) |
| `blockQuotes` | `string[]` | 차단 화면 인용구 |
| `blockLinks` | `object[]` | 이미지-인용구 쌍 링크 |
| `focusEvents` | `DayEvent[]` | 일별 집중 활동 이력 (최대 30일) |
| `focusStreak` | `object` | `{ current, longest, lastDate }` |
| `pomodoroPresets` | `object[]` | 저장된 포모도로 프리셋 목록 |
| `pomodoroCycleOverrides` | `object[]` | 사이클별 시간 오버라이드 `[{ cycle, workMins, restMins }]` |
| `lockPin` | `object` | PIN 잠금 정보 `{ hash, salt, enabled }` |
| `todoItems` | `object[]` | 할일 항목 `[{ id, text, done }]` |
| `todoTriggerPos` | `object` | Todo 아이콘 위치 `{ left, top }` |

---

## 5. 설정 페이지 탭 구성 (`options.html`)

| 탭 | 기능 |
|----|------|
| **차단 관리** | 상시 차단 / 일반 차단 도메인 추가·삭제 |
| **타임박스 스케줄러** | 박스 추가 폼 + 하루(도넛) / 주간(세로 타임테이블) 뷰 |
| **포모도로 타이머** | 타이머 설정, 시작/일시정지/중지, PiP(Always on Top 옵션), 프리셋 저장·적용, 사이클별 고급 설정, 포모도로 전용 차단 목록 |
| **통계** | 집중 시간·차단 횟수·스트릭·포모도로·히트맵 시각화 (오늘/7일/30일 필터) |
| **설정** | 전체 데이터 JSON 내보내기 / 불러오기 |

### 타임테이블 뷰

- **하루 뷰 (도넛)**: SVG 원형 시계로 24시간을 표현. 박스를 클릭하면 커스텀 예외 도메인을 인라인 편집
- **주간 뷰**: 요일 × 시간 격자 테이블. 요일 헤더 클릭 시 해당 요일 전용 팝업 모달 오픈

---

## 6. 팝업 (`popup.html`)

확장 아이콘 클릭 시 300px 너비의 팝업 표시:

1. **현재 페이지** 도메인 표시 + 상시/일반 차단 여부 배지, 없으면 빠른 추가 버튼
2. **하루 스케줄 토글** — 비활성화 시 generalList 차단 전체 중단
3. **현재 활성 박스** + **다음 예정 박스** (최대 2개)

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
| `activeTab` | 팝업에서 현재 탭 URL 조회 |
| `windows` | PiP 창 생성·관리 |
| `<all_urls>` (host) | DNR 리다이렉트 및 content script 삽입 |

---

## 9. 알려진 설계 제약

- **DNR `allow` vs `redirect`**: Chrome DNR은 `allow`가 `redirect`를 이길 수 없다. 커스텀 허용 도메인은 규칙 우선순위가 아닌 generalList 등록 필터링으로 구현해야 한다.
- **SPA 차단 폴백**: content.js는 초기 로드 시에도 `requestBlockCheck(location.href)`를 호출해 DNR 리다이렉트 실패를 보완한다.
- **포모도로 경쟁 조건**: background alarms와 UI tick이 동시에 페이즈 전환을 시도할 수 있어 `advancedAt` 필드로 10초 이내 중복 전환을 가드한다.
- **Base64 이미지 저장**: `chrome.storage.local` 용량 한도(10MB)에 유의가 필요하다.
