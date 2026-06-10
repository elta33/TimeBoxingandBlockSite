# options.js 분할 결과

기존 단일 파일 `options.js` (~1056줄)를 3개 파일로 분리.  
`options.html`의 script 태그도 로드 순서에 맞게 수정됨.

---

## 로드 순서 (options.html)

```html
<script src="storage.js"></script>
<script src="render-day.js"></script>
<script src="options.js"></script>
```

전역 변수 의존성 때문에 순서가 고정됨.  
`storage.js`가 `currentView`, `currentBoxes`, `getBoxKey()`를 선언하므로 반드시 먼저 로드.

---

## 파일별 역할 및 함수 목록

### `storage.js` (~110줄)
**역할:** `chrome.storage.local` CRUD 전담. 전역 상태 변수 선언 포함.  
렌더링 로직 없음. "저장/로드/삭제가 안 됨" 류 버그는 이 파일만 확인하면 됨.

**전역 상태 (다른 파일에서 참조)**
- `currentView` — 현재 뷰 (`'day'` | `'week'`)
- `currentBoxes` — 현재 렌더된 박스 배열

**함수**
| 함수 | 설명 |
|------|------|
| `getBoxKey()` | currentView에 따라 `'dailyBoxes'` 또는 `'weeklyBoxes'` 반환 |
| `loadSettings()` | storage에서 전체 설정 읽어 renderList + renderBoxes 호출 |
| `addToList()` | generalList / permanentList 도메인 추가 |
| `deleteItem()` | generalList / permanentList 항목 삭제 |
| `deleteBox()` | 박스 삭제 |
| `deleteCustomDomain()` | 박스 내 커스텀 도메인 삭제 |
| `updateCustomMode()` | 박스 내 커스텀 도메인 모드(차단/허용) 변경 |
| `setBoxMasterMode()` | 박스 내 커스텀 도메인 전체 모드 일괄 변경 |
| `clearAll()` | 리스트 전체 초기화 (confirm 포함) |

---

### `render-day.js` (~280줄)
**역할:** 하루 뷰 도넛 SVG 전체. `renderDayView(boxes, wrap)` 하나가 진입점.  
내부 함수 전부 `renderDayView` 클로저 안에 있음 (외부 노출 없음).  
"도넛 SVG 렌더링 버그 / 시계 바늘 / 세그먼트 선택 / 펄스 애니메이션" 관련 작업은 이 파일만 넘기면 됨.

**외부 노출 함수 (전역)**
| 함수 | 설명 |
|------|------|
| `minsToAngle(mins)` | 분 → SVG 각도 변환 |
| `polarToXY(cx, cy, r, angleDeg)` | 극좌표 → 직교좌표 변환 |
| `renderDayView(boxes, wrap)` | 도넛 뷰 전체 렌더링 진입점 |

**`renderDayView` 내부 클로저 함수 (외부 비노출)**
| 함수 | 설명 |
|------|------|
| `drawBgArcs()` | 빈 시간대 배경 호 그리기 |
| `makeArcPath()` | 호 SVG path 문자열 생성 |
| `renderCenter(box)` | 도넛 중앙 텍스트 (박스 정보 또는 날짜/힌트) |
| `renderClockHand()` | 현재 시각 바늘 + 배지 렌더링 (1분마다 갱신) |
| `renderDetailArea(box, boxIndex)` | 선택된 박스의 커스텀 도메인 상세 패널 |
| `selectBox(idx)` | 세그먼트 선택/해제 + translate 애니메이션 |
| `pulseBox(idx)` | 겹침 경고 펄스 (2회 push-return). `wrap._pulseBox`로 외부 노출 |
| `makeSegPath()` | 도넛 세그먼트 path 문자열 생성 |

**외부 노출 변수**
- `dayViewClockInterval` — 전역. 뷰 전환 시 `renderBoxes`에서 정리함

---

### `options.js` (~500줄)
**역할:** 공통 유틸, 주간 뷰, 스테이징 폼, 이벤트 바인딩, DOMContentLoaded 진입점.  
storage.js와 render-day.js의 함수를 호출하는 최상위 오케스트레이터.

**공통 유틸**
| 함수/상수 | 설명 |
|-----------|------|
| `cleanDomain(d)` | URL → 순수 도메인 정규화 |
| `triggerBounceAndWarn()` | 경고 텍스트 표시 + 바운스 애니메이션 |
| `hideWarn(warnId)` | 경고 텍스트 숨김 |
| `TOTAL_MINS` | 24 × 60 = 1440 (render-day.js도 참조) |
| `timeToMins(timeStr)` | `"HH:MM"` → 분 변환 (render-day.js도 참조) |
| `renderList()` | 차단 관리 탭 generalList / permanentList 렌더링 |
| `createCustomDomainItemUI()` | 커스텀 도메인 아이템 DOM 팩토리 (하루/주간/스테이징 공통) |
| `initViewTabs()` | 하루/일주일 탭 클릭 이벤트 바인딩 |

**주간 뷰 전용**
| 함수/상수 | 설명 |
|-----------|------|
| `PX_PER_MIN`, `TOTAL_HEIGHT` | 주간 뷰 픽셀 스케일 상수 |
| `minsToPx(mins)` | 분 → px 변환 |
| `buildTimeAxis()` | 시간축 레이블 + 구분선 생성 |
| `buildBoxCard()` | 주간 뷰 박스 카드 DOM 생성 |
| `buildDetailPanel()` | 주간 뷰 박스 카드 내 커스텀 도메인 팝업 패널 |
| `weekStartMonday` | 주 시작 요일 상태 (`false`=일요일) |
| `syncDaySelector()` | 요일 선택기 순서를 weekStartMonday에 맞게 재렌더 |
| `getWeekOrder()` | weekStartMonday에 따른 요일 순서 배열 반환 |
| `renderWeekView()` | 주간 뷰 렌더링 진입점 |

**뷰 디스패처 및 스테이징**
| 함수 | 설명 |
|------|------|
| `renderBoxes(boxes, scrollToMins)` | currentView에 따라 renderDayView / renderWeekView 분기 |
| `renderStagingList()` | 박스 추가 폼의 임시 커스텀 도메인 목록 렌더링 |
| `removeStagingDomain(index)` | 스테이징 목록 항목 제거 |

**폼 유틸**
| 함수 | 설명 |
|------|------|
| `getFormattedTime(inputId)` | time input 값 읽기 |
| `clearCustomTimeInputs()` | 시작/종료 시간 input 초기화 |
| `getSelectedDays()` | 체크된 요일 값 배열로 반환 |
| `clearDaySelection()` | 요일 체크박스 전체 해제 |

**이벤트 바인딩 (최상위 레벨)**
- `addCustomStagingBtn`, `masterStgBlockBtn`, `masterStgAllowBtn` — 스테이징 커스텀 도메인
- `addBoxBtn` — 박스 생성 (겹침 검사 포함)
- `addGeneralBtn`, `addPermanentBtn` — 도메인 리스트 추가
- `clearGeneralBtn`, `clearPermanentBtn`, `clearBoxesBtn` — 초기화

**DOMContentLoaded**
- 메인 탭 클릭 바인딩
- 주 시작 토글 storage 복원 + change 핸들러
- `initViewTabs()` + `loadSettings()` 초기 호출
- 입력 시 경고 숨김 바인딩

---

## 파일 간 의존 관계

```
storage.js
  └─ 선언: currentView, currentBoxes, getBoxKey()
  └─ 호출: renderList(), renderBoxes() ← options.js에서 정의

render-day.js
  └─ 참조: TOTAL_MINS, timeToMins() ← options.js에서 정의
  └─ 참조: currentBoxes, deleteBox(), setBoxMasterMode(),
           updateCustomMode(), deleteCustomDomain(),
           createCustomDomainItemUI() ← options.js / storage.js에서 정의
  └─ 노출: dayViewClockInterval ← options.js의 renderBoxes()에서 정리

options.js
  └─ 참조: 위 두 파일의 전역 변수/함수 모두
  └─ 오케스트레이터 역할
```

> **주의:** 세 파일 모두 전역 스코프를 공유함 (모듈 시스템 없음).  
> 로드 순서(`storage.js → render-day.js → options.js`) 반드시 유지.