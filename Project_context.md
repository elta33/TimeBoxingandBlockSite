# Focus Timeboxer — Project Context

Chrome 확장 프로그램. `declarativeNetRequest` 기반 스케줄형 웹사이트 차단 시스템.

---

## 파일 구조

```
background.js       — Service Worker. DNR 규칙 생성 및 업데이트 전담
storage.js          — chrome.storage CRUD + 전역 상태 변수
render-day.js       — 하루 뷰 도넛 SVG 렌더링
options.js          — 공통 유틸, 주간 뷰, 폼 로직, 이벤트 바인딩, 진입점
options.html        — UI 마크업 + 인라인 CSS (별도 CSS 파일 없음)
block.html          — 차단 시 리다이렉트되는 페이지
manifest.json       — MV3, permissions: storage / declarativeNetRequest / alarms
```

### options.html 스크립트 로드 순서 (순서 고정, 변경 불가)
```html
<script src="storage.js"></script>
<script src="render-day.js"></script>
<script src="options.js"></script>
```
세 파일 모두 전역 스코프 공유 (모듈 시스템 없음).

---

## 데이터 구조

### chrome.storage.local 키
| 키 | 타입 | 설명 |
|----|------|------|
| `generalList` | `string[]` | 차단 박스 활성 시간대에만 차단되는 도메인 목록 |
| `permanentList` | `string[]` | 항상 차단되는 도메인 목록 |
| `dailyBoxes` | `Box[]` | 하루 뷰 박스 (요일 무관, 매일 적용) |
| `weeklyBoxes` | `Box[]` | 일주일 뷰 박스 (요일 필터 적용) |
| `weekStartMonday` | `boolean` | 주 시작 요일 설정 |

### Box 객체 구조
```js
{
  name: string,           // 박스 이름
  startTime: "HH:MM",     // 시작 시각
  endTime: "HH:MM",       // 종료 시각 (자정 초과 가능)
  mode: 'block' | 'allow',
  days: number[],         // 0=월…6=일. dailyBoxes는 항상 [] (background.js에서 강제)
  customDomains: [
    { domain: string, mode: 'block' | 'allow' }
  ]
}
```

### 요일 인덱스 변환 주의
- **storage/내부 로직**: 0=월, 1=화, …, 6=일
- **JS `Date.getDay()`**: 0=일, 1=월, …, 6=토
- background.js 변환: `(new Date().getDay() + 6) % 7`

### 다중 요일 박스 저장 방식
박스 생성 시 선택된 요일 수만큼 단일 요일 항목으로 분리 저장.
→ 독립 삭제 보장 (한 요일 삭제가 다른 요일에 영향 없음)

---

## DNR 규칙 우선순위 체계

| 우선순위 | 대상 | 액션 |
|---------|------|------|
| 100 | permanentList | redirect (항상 차단) |
| 50 | customDomains | block → redirect / allow → allow |
| 10 | generalList | redirect (차단 박스 활성 시만 등록) |

### 핵심 제약 및 해결책
**Chrome DNR 제약:** `allow` 액션은 `block` 액션만 무력화하고, `redirect` 액션은 무력화하지 못함.

**결과:** 우선순위로 "커스텀 allow vs generalList redirect" 충돌 해결 불가.

**해결책:** `finalAllowSet`에 커스텀 allow 도메인을 기록 → generalList 규칙 등록 자체를 건너뜀.
우선순위 조정으로 해결하는 방식은 이미 시도했으나 불가능함 — 재시도 불필요.

---

## 파일별 전역 변수 및 주요 함수

### storage.js
**전역 변수**
- `currentView` — `'day'` | `'week'`
- `currentBoxes` — 현재 렌더된 박스 배열

**함수**
| 함수 | 설명 |
|------|------|
| `getBoxKey()` | currentView → `'dailyBoxes'` \| `'weeklyBoxes'` |
| `loadSettings()` | storage 읽기 → renderList + renderBoxes 호출 |
| `addToList(inputId, storageKey, ulId, warnId)` | 도메인 리스트 항목 추가 |
| `deleteItem(storageKey, index)` | 도메인 리스트 항목 삭제 |
| `deleteBox(index)` | 박스 삭제 |
| `deleteCustomDomain(boxIndex, cdIndex, onDone?)` | 커스텀 도메인 삭제. onDone 없으면 loadSettings() |
| `updateCustomMode(boxIndex, cdIndex, newMode, onDone?)` | 커스텀 도메인 모드 변경 |
| `setBoxMasterMode(boxIndex, newMode, onDone?)` | 박스 내 커스텀 도메인 전체 모드 일괄 변경 |
| `clearAll(storageKey, confirmMsg, inputIdsToClear?)` | 리스트 전체 초기화 |

### render-day.js
**전역 변수**
- `dayViewClockInterval` — 1분 타이머 ID. renderBoxes()에서 뷰 전환 시 정리

**전역 함수**
| 함수 | 설명 |
|------|------|
| `minsToAngle(mins)` | 분 → SVG 각도 (12시 방향 기준) |
| `polarToXY(cx, cy, r, angleDeg)` | 극좌표 → 직교좌표 |
| `renderDayView(boxes, wrap)` | 도넛 뷰 렌더링 진입점 |

**renderDayView 내부 클로저 (외부 비노출)**
`drawBgArcs`, `makeArcPath`, `renderCenter`, `renderClockHand`, `renderDetailArea`, `selectBox`, `pulseBox`, `makeSegPath`

**외부 노출 패턴**
- `wrap._pulseBox = pulseBox` — options.js의 겹침 감지에서 호출

### options.js
**전역 상수/변수**
- `TOTAL_MINS = 1440`
- `PX_PER_MIN = 80/60` (주간 뷰, 1시간=80px)
- `TOTAL_HEIGHT = TOTAL_MINS * PX_PER_MIN`
- `stagingCustomDomains` — 박스 생성 폼의 임시 커스텀 도메인 배열
- `weekStartMonday` — 주 시작 요일 상태

**공통 유틸**
| 함수 | 설명 |
|------|------|
| `cleanDomain(d)` | URL → 순수 도메인 (http/www/슬래시 제거) |
| `timeToMins(timeStr)` | `"HH:MM"` → 분 |
| `triggerBounceAndWarn(element, warnId, msg)` | 바운스 애니메이션 + 경고 텍스트 표시 |
| `hideWarn(warnId)` | 경고 텍스트 숨김 |
| `renderList(elementId, items, storageKey, warnId)` | 차단 관리 탭 도메인 리스트 렌더링 |
| `createCustomDomainItemUI(domain, mode, idPrefix, elType, onModeChange, onDelete)` | 커스텀 도메인 아이템 DOM 팩토리 (하루/주간/스테이징 공통) |
| `initViewTabs(onViewChange?)` | 하루/일주일 탭 이벤트 바인딩 |

**주간 뷰**
| 함수 | 설명 |
|------|------|
| `minsToPx(mins)` | 분 → px |
| `buildTimeAxis(labelCol, bodyEl, slotCount)` | 시간축 레이블 + 구분선 생성 |
| `buildBoxCard(box, boxIndex, isWeek)` | 주간 뷰 박스 카드 DOM 생성 |
| `renderWeekDetailPanel(box, boxIndex)` | 스케줄러 하단 커스텀 도메인 패널 (주간 뷰 전용) |
| `syncDaySelector()` | 요일 선택기를 weekStartMonday에 맞게 재렌더 |
| `getWeekOrder()` | weekStartMonday에 따른 `{label, dow}[]` 반환 |
| `renderWeekView(boxes, wrap, scrollToMins?)` | 주간 뷰 렌더링 진입점 |

**뷰 디스패처 및 스테이징**
| 함수 | 설명 |
|------|------|
| `renderBoxes(boxes, scrollToMins?)` | currentView에 따라 renderDayView / renderWeekView 분기 |
| `renderStagingList()` | 박스 추가 폼 임시 커스텀 도메인 목록 렌더링 |
| `removeStagingDomain(index)` | 스테이징 목록 항목 제거 |

---

## 주요 DOM ID

### 차단 관리 탭
| ID | 설명 |
|----|------|
| `generalList` | 일반 차단 도메인 `<ul>` |
| `permanentList` | 상시 차단 도메인 `<ul>` |
| `generalDomainInput` | 일반 차단 입력 |
| `permanentDomainInput` | 상시 차단 입력 |
| `addGeneralBtn` | 일반 차단 추가 버튼 |
| `addPermanentBtn` | 상시 차단 추가 버튼 |
| `clearGeneralBtn` | 일반 차단 초기화 버튼 |
| `clearPermanentBtn` | 상시 차단 초기화 버튼 |
| `generalWarn` / `permanentWarn` | 경고 텍스트 span |

### 스케줄러 탭 — 박스 추가 폼
| ID | 설명 |
|----|------|
| `boxName` | 박스 이름 입력 |
| `startTime` / `endTime` | 시간 입력 |
| `modeBlock` / `modeAllow` | radio `name="boxMode"` |
| `daySelectRow` | 요일 선택 행 (주간 뷰일 때만 표시) |
| `customDomainInput` | 커스텀 도메인 입력 |
| `addCustomStagingBtn` | 커스텀 도메인 추가 버튼 |
| `masterStgBlockBtn` / `masterStgAllowBtn` | 스테이징 일괄 모드 버튼 |
| `stagingCustomList` | 스테이징 커스텀 도메인 `<ul>` |
| `addBoxBtn` | 박스 생성 완료 버튼 |
| `boxWarn` | 겹침 경고 텍스트 span |
| `clearBoxesBtn` | 박스 전체 초기화 버튼 |

### 스케줄러 탭 — 뷰
| ID | 설명 |
|----|------|
| `timetableWrap` | 하루/주간 뷰 렌더링 컨테이너 |
| `weekDetailPanel` | 주간 뷰 박스 클릭 시 하단 커스텀 도메인 패널 |
| `weekStartToggleWrap` | 주 시작 요일 토글 (주간 뷰일 때만 표시) |
| `weekStartSun` / `weekStartMon` | radio `name="weekStart"` |

### 탭 구조
| ID | 설명 |
|----|------|
| `tab-block` | 차단 관리 탭 패널 |
| `tab-scheduler` | 타임박스 스케줄러 탭 패널 |

---

## 현재 구현된 기능 요약

**하루 뷰**
- SVG 도넛 원형 차트 (520×520)
- 박스 세그먼트 클릭 → 바깥 밀림 선택 효과 + 하단 커스텀 도메인 패널
- 현재 시각 황금색 바늘 + 배지 (1분마다 갱신)
- 빈 시간대 회색 호(arc) 배경
- 중앙 텍스트: 선택 없을 때 MM-DD, 선택 시 박스 정보

**주간 뷰**
- 1시간 단위 세로 시간표 7컬럼
- sticky 헤더, 드래그 스크롤 (height 520px)
- 주 시작 일/월 토글
- 오늘 요일 강조 (`#faad14`)
- 박스 클릭 → 스케줄러 하단 커스텀 도메인 패널 (같은 박스 재클릭 시 토글 닫힘)

**겹침 감지**
- 직접 비교 + 자정 초과 시 +24h 시프트 두 케이스 처리
- 하루 뷰: 겹치는 세그먼트 펄스 애니메이션 2회 (`wrap._pulseBox`)
- 주간 뷰: 겹치는 요일 DaySelector 바운스 + 해당 박스 카드 바운스 + 스크롤 이동
- 공통: `boxWarn` 경고 텍스트 + `startTime` 포커스

**스크롤 위치 보존**
- `wrap._weekScrollTop`으로 삭제/업데이트 후 스크롤 위치 유지
- 박스 생성 시 `startTime` 기준으로 자동 스크롤 (40px 오프셋)

---

## 파일 간 의존 관계

```
storage.js
  └─ 선언: currentView, currentBoxes, getBoxKey()
  └─ 호출: renderList(), renderBoxes() ← options.js 정의

render-day.js
  └─ 참조: TOTAL_MINS, timeToMins() ← options.js 정의
  └─ 참조: currentBoxes, deleteBox(), setBoxMasterMode(),
           updateCustomMode(), deleteCustomDomain(),
           createCustomDomainItemUI() ← options.js / storage.js 정의
  └─ 노출: dayViewClockInterval ← options.js renderBoxes()에서 정리

options.js
  └─ 모든 전역 변수/함수 참조 가능 (최상위 오케스트레이터)
```
