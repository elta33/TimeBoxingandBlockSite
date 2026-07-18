# CWS 스토어 등록 텍스트 (Store Listing Copy)

Chrome Web Store **Store listing** 탭에 그대로 붙여넣기 위한 텍스트. 영어가 기본(default) 언어로 필수이며, 한국어는 로케일 추가 시 사용한다. 실제 기능 세트(`_locales/*/messages.json`, `background.js`, `options-*.js`)를 근거로 작성했다.

---

## 기본 필드

| 필드 | 값 |
|------|-----|
| **Item title** (45자 이내) | `FocusBox: Website Blocker & Timeboxing Planner` |
| **Category** | Productivity / Workflow & Planning |
| **Default language** | English (en) — 필수 |
| **Primary language** | Korean (ko) — 로케일 병행 시 |

> 참고: `manifest.json`의 `name`은 `__MSG_appName__` → 현재 en/ko 모두 `FocusBox: WebsiteBlock & TimeBoxing Planner`. 스토어 title과 표기를 맞추려면(WebsiteBlock → Website Blocker) 로케일의 `appName`도 함께 손볼지 결정할 것. **표기 통일은 별도 확인 후 진행**(리터럴 이름 변경이라 사용자 판단 사항).

---

## Summary (짧은 설명, 132자 이내 · 한 줄 · HTML 불가)

**EN (필수):**
```
Block distracting sites and plan real focus time with timeboxing and Pomodoro. Track streaks and stats — 100% private, on-device.
```
(약 127자)

**KO:**
```
방해되는 사이트를 차단하고, 타임박싱과 포모도로로 진짜 집중 시간을 계획하세요. 스트릭·통계 제공, 데이터는 100% 기기 안에서만.
```

---

## Detailed description (상세 설명)

### EN (default — 필수)

```
FocusBox turns "just block sites" into a real focus system: decide WHAT to block, WHEN it applies, and SEE how much you actually focused — without a single byte leaving your device.

■ WEBSITE BLOCKING, TWO LEVELS
• Always Block — sites that are off-limits around the clock.
• General Block — sites blocked only while a timebox is active, so you can allow them off-hours.
Blocked pages redirect to a calm block screen (with your own images and quotes, if you like).

■ TIMEBOXING SCHEDULER
Draw block boxes by day and time to plan a day or a full week. While a box is active, your General Block list kicks in automatically. Per-box exceptions let you keep a specific site open inside an otherwise-blocked window.

■ POMODORO TIMER
Work/rest cycles with savable presets, per-cycle time overrides (Advanced Settings), a session-only block list, and a floating Picture-in-Picture window that stays on top while you work.

■ FOCUS STATS
Focus streak, daily/7-day/30-day focus time, block counts, top blocked domains, an hour-of-day block heatmap, and Pomodoro totals — so you can see the habit forming.

■ STRONGER, PER-SITE BLOCKING (optional)
Opt-in toggles to hide YouTube Shorts and trim Instagram down to Stories & DMs — for the sites where a plain domain block is too blunt.

■ NICE TO HAVE
Dark mode · Lock PIN (protects deletes/resets on this device) · Cross-device sync via your Chrome account · Full data export/import · A draggable to-do panel.

■ PRIVACY FIRST
FocusBox makes no network requests. It has no analytics, no accounts, and no servers. Your block lists, schedules, and stats stay in Chrome's own storage on your device (optionally synced through your Google account, never to us). The extension only observes the URL you navigate to in order to decide whether to redirect — it never reads page content.
```

### KO

```
FocusBox는 "사이트 차단"을 진짜 집중 시스템으로 바꿉니다. 무엇을, 언제 차단할지 정하고, 실제로 얼마나 집중했는지까지 확인하세요. 데이터는 단 1바이트도 기기를 벗어나지 않습니다.

■ 두 단계 웹사이트 차단
• 상시 차단 — 시간과 무관하게 항상 막을 사이트.
• 일반 차단 — 타임박스가 활성화된 시간에만 차단되어, 그 외 시간엔 허용.
차단된 페이지는 차분한 안내 화면으로 이동합니다(원하면 직접 넣은 이미지·문구로 꾸밀 수 있어요).

■ 타임박싱 스케줄러
요일·시간대별 차단 박스를 그려 하루 또는 일주일을 계획하세요. 박스가 활성화되면 일반 차단 목록이 자동 적용됩니다. 박스별 예외로 특정 사이트만 열어둘 수도 있습니다.

■ 포모도로 타이머
작업/휴식 반복, 프리셋 저장, 회차별 시간 예외(고급 설정), 세션 전용 차단 리스트, 그리고 작업 중 항상 위에 떠 있는 PiP(픽처인픽처) 창까지.

■ 집중 통계
연속 집중 스트릭, 오늘·7일·30일 집중 시간, 차단 횟수, 상위 차단 도메인, 시간대별 차단 히트맵, 포모도로 누적까지 — 습관이 쌓이는 걸 눈으로 확인하세요.

■ 사이트별 강력 차단 (선택)
유튜브 쇼츠 숨김, 인스타그램을 스토리·DM만 남기고 정리 — 단순 도메인 차단으로는 부족한 사이트를 위한 옵션.

■ 그 외
다크 모드 · 잠금 PIN(이 기기의 삭제/초기화 보호) · Chrome 계정 기기간 동기화 · 전체 데이터 내보내기/불러오기 · 드래그 가능한 할 일 패널.

■ 프라이버시 우선
FocusBox는 어떤 네트워크 요청도 하지 않습니다. 분석 도구도, 계정도, 서버도 없습니다. 차단 목록·스케줄·통계는 기기의 Chrome 저장소에만 보관되며(선택 시 Google 계정을 통해서만 동기화, 개발자에게 전송되지 않음), 확장은 차단 여부 판단을 위해 이동하려는 URL만 관찰할 뿐 페이지 내용을 읽지 않습니다.
```

---

## 스크린샷 캡션 제안 (5장 기준)

스토어 스크린샷은 최대 5장. 각 장의 의도와 캡션(이미지 위에 얹을 짧은 문구) 초안:

1. **타임박스 스케줄러(도넛/주간 뷰)** — "Plan your day. Block distractions on schedule."
2. **차단 안내 화면(block.html, 커스텀 배경+문구)** — "A calm wall between you and the rabbit hole."
3. **포모도로 타이머 + PiP** — "Focus in cycles. Keep the timer on top."
4. **집중 통계(스트릭/히트맵/차트)** — "See the habit forming."
5. **팝업(현재 페이지 상태 + 한 번에 차단 추가)** — "Block the current site in one click."

캡션은 이미지에 태워도 되고, 스토어는 캡션 필드가 없으므로 넣을 거면 이미지 합성 시 얹어야 함.
