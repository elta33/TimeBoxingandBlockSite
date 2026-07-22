# CWS 스토어 에셋 현황 및 제작 가이드

Chrome Web Store 제출에 필요한 이미지 에셋의 상태와 제작 방법.

## 요구 사양 (CWS 기준)

| 에셋 | 사양 | 필수 | 상태 |
|------|------|------|------|
| 스토어 아이콘 | 128×128 PNG | 필수 | ✅ `icons/icon128.png` |
| 스크린샷 | 1280×800 **또는** 640×400 PNG/JPEG, 1~5장 | 최소 1장 필수 | 🟨 2/5 — `screenshots/screenshot-02-block*.png`, `screenshot-04-pomodoro*.png`(재캡처 권장, 아래 §2) |
| 작은 프로모션 타일 | 440×280 PNG/JPEG | 선택(권장) | ✅ `promo-small-440x280.png`(EN) · `promo-small-440x280.ko.png`(KO) |
| 마퀴 프로모션 타일 | 1400×560 | 선택 | ⬜ 미제작 (필요 시 동일 방식으로 생성 가능) |

> 스토어 아이콘은 등록 시 **512×512** 원본 업로드가 요구되는 경우가 있음(대시보드가 128로 리사이즈). 현재 최대 소스가 128이므로, 512 원본이 필요하면 벡터/고해상도 원본에서 재추출할 것.

## 1. 작은 프로모션 타일 (완료)

- 결과물:
  - EN(기본): `promo-small-440x280.png` — "Block sites. / Own your time." · `Timeboxing · Website blocker · Pomodoro · Stats`
  - KO(ko 로케일 병행 시): `promo-small-440x280.ko.png` — "차단하고, / 시간의 주인이 되세요." · `타임박싱 · 웹사이트 차단 · 포모도로 · 통계`
- **디자인 원본(source of truth): Claude Design 프로젝트** "FocusBox 프로모션 타일 디자인"의 `Promo Tile 440x280.dc.html`. 레이아웃/색/폰트 변경은 거기서 하고, 아래 정적 HTML로 export(바인딩 해석)해서 렌더한다.
- 로컬 소스(렌더용): `promo-small-440x280.source.html`(EN) / `promo-small-440x280.ko.source.html`(KO). 둘 다 실제 `icons/icon128.png`를 base64 임베드하며, 문구만 다르고 레이아웃·색·아이콘·워드마크는 동일하다.
- 디자인 스펙(현행): 배경 플랫 `#10141f`, 액센트 tomato `#ff6347`(본체 `styles/tokens.css`와 통일), 폰트 **Sora**(워드마크·슬로건)+**Manrope**(서브라인, Google Fonts), 상단우측 톤링+하단좌측 화이트링+tomato 액센트 아크.
- 스토어 default language가 English이므로 **EN 타일이 기본 제출본**. KO 타일은 리스팅을 ko 로케일로 병행 등록할 때만 사용.

### 재생성 방법 (Windows / headless Chrome)

```bash
# EN, KO 각각. <SP>는 OneDrive 밖의 임시 폴더(예: %TEMP%\...\scratchpad)
"C:/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --no-first-run --hide-scrollbars \
  --force-device-scale-factor=1 --user-data-dir="<SP>/cr-profile" \
  --virtual-time-budget=4000 --window-size=440,280 \
  --screenshot="<SP>/en.png" \
  "<이 폴더의 절대경로>/promo-small-440x280.source.html"
# 그 뒤 <SP>/en.png → promo-small-440x280.png 로 복사 (KO도 동일)
```

- `--window-size`가 정확한 출력 픽셀을 결정한다. 다른 크기(예: 1400×560 마퀴)가 필요하면 HTML의 `.tile`/`html,body` 크기와 `--window-size`를 함께 바꾸면 된다.
- **폰트는 Google Fonts(Sora/Manrope)를 렌더 시점에 네트워크로 받는다.** `--virtual-time-budget`(ms)을 주지 않으면 스크린샷이 폰트 로드 전에 찍혀 fallback(맨 시스템 sans)으로 나온다. 오프라인/결정론이 필요하면 woff2를 base64로 `@font-face` 임베드할 것. (한글은 Sora에 글리프가 없어 시스템 한글 폰트로 fallback되는 게 정상)
- `--user-data-dir`을 별도 지정하지 않으면 실행 중인 실제 Chrome과 프로필이 충돌해 "액세스 거부"로 저장이 실패한다(경험적으로 확인됨).
- 추가로, `--screenshot` 출력 경로를 **OneDrive 동기화 폴더 안**으로 직접 지정하면 헤드리스 Chrome이 "액세스 거부(0x5)"로 저장 실패하는 경우가 있다. OneDrive 밖(임시 폴더)에 저장한 뒤 복사할 것.

## 2. 스크린샷 (사용자 작업 필요)

스크린샷은 **실제 확장 UI**를 보여줘야 하며, 이 프로젝트는 dev 서버 없는 MV3 확장이라
`options.html` 등을 그냥 브라우저 탭에 띄우면 `chrome.storage`/i18n 치환/실데이터가 없어
빈 화면으로 렌더된다(→ 정적 렌더로는 쓸만한 스크린샷이 안 나옴). 따라서:

### 2-1. 캡처 (사용자)

1. `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램 로드"로 이 폴더 로드.
2. 데모용 데이터를 미리 채운다(빈 화면 방지):
   - 상시/일반 차단 목록에 2~3개 도메인
   - 타임박스 1~2개(현재 시간에 활성 박스 하나 포함하면 도넛 뷰가 채워짐)
   - 통계 화면은 며칠 사용 후가 이상적(스트릭/히트맵이 채워짐)
3. 아래 5개 화면을 캡처. 창을 정확히 1280×800으로 맞추기 어려우면 **더 크게 캡처 후 리사이즈/크롭**해도 됨(비율 1.6:1 유지):
   - 타임박스 스케줄러(도넛 또는 주간 뷰)
   - 차단 안내 화면(`block.html`, 커스텀 배경/문구 적용 상태)
   - 포모도로 타이머(+ PiP 창)
   - 집중 통계(스트릭 · 차트 · 히트맵)
   - 팝업(현재 페이지 상태 + 원클릭 차단 추가)
4. 캡처 PNG를 `store-listing/assets/screenshots/raw/`에 저장.

### 2-2. 1280×800 합성 (확립된 템플릿)

디자인 원본(source of truth): **Claude Design 프로젝트 "FocusBox Screenshots"**
(`FocusBox Screenshots.dc.html`). 레이아웃/색/폰트 변경은 거기서 하고,
아래 정적 HTML로 export해서 렌더한다 — 프로모션 타일과 동일한 워크플로우.

**템플릿 구조 (1280×800):**

| 영역 | 스펙 |
|------|------|
| 배경 | 플랫 `#10141f` + 우상단 tomato 톤링/액센트 아크 + 좌하단 화이트 링 (프로모션 타일과 동일) |
| 브랜드 락업 | `top:38px left:72px` — 실제 `icons/icon128.png` 30px + `Focus`(흰) `Box`(tomato) Sora 700/22px |
| 캡션 밴드 | 상단 220px, 좌우 패딩 72px. 헤드라인 Sora 800/44px(강조어만 `#ff6347`) + 서브라인 Manrope 600/19px `#8b93a7` |
| 캡처 슬롯 | `left:72 top:220 w:1136 h:508`, radius 16, `box-shadow 0 24px 60px rgba(0,0,0,.5)` |

> **핵심 규칙: 슬롯 rect(1136×508 = 2.236:1)를 먼저 고정하고, 실캡처를 그 비율에 맞춰 크롭한다.**
> 페이지 전체를 다 넣지 말고 의미 있는 영역만 크롭하는 게 가독성에 낫다.
> 소스 HTML에서는 `object-fit:cover` + `object-position`으로 초점만 조절하면 되므로
> 이미지 편집 도구 없이 CSS만으로 크롭이 끝난다(예: 4200×2400 캡처 → `center 28%`).

**완료분:**

| 슬라이드 | 결과물 | 소스 HTML | 원본 캡처 |
|---|---|---|---|
| 2 (차단 화면) | `screenshots/screenshot-02-block{,.ko}.png` | `screenshot-02-block{,.ko}.source.html` | `block-{en,ko}.png` (4200×2400) |
| 4 (포모도로+PiP) | `screenshots/screenshot-04-pomodoro{,.ko}.png` | `screenshot-04-pomodoro{,.ko}.source.html` | `pomodoro-{en,ko}.png` (1566×890 / 1600×879) |

> ⚠️ **캡처 구도가 결과물 품질을 결정한다 — 슬라이드 4에서 실제로 겪은 것.**
>
> 1차 캡처는 PiP가 카드 **아래로** 늘어져 bbox가 약 1335×815(**1.64:1**)였다. 슬롯(2.236:1)에
> 넣으려면 **60%까지 축소**해야 해서 UI 텍스트가 스토어 캐러셀 크기에서 안 읽혔다. 사각형
> 크롭으로는 "카드 + 아래로 늘어진 PiP"를 담으면서 좌하단 빈 영역만 뺄 수 없다.
>
> 2차 캡처에서 **PiP를 카드 세로 범위 안으로 올려** 재촬영하니 bbox가 약 1336×583(**2.29:1**)이
> 되어 슬롯에 거의 맞고, 축소율이 60% → **82%**로 올라갔다(UI 약 1.4배).
>
> **규칙 ①: 떠 있는 창(PiP 등)은 본문 카드와 세로 범위가 겹치도록 드래그한 뒤 찍을 것.**
> **규칙 ②: 떠 있는 창이 다른 카드의 "내용"을 가리지 않는 위치에 둘 것.** 2차 캡처는 PiP가
> 차단 리스트의 도메인 이름만 정확히 덮어서, 행에 휴지통 아이콘만 남아 목록이 비어 보인다.
> 이건 크롭으로 못 고친다 — PiP가 그 카드 *위에* 떠 있어서 PiP를 온전히 담는 크롭은 반드시
> 그 카드를 포함한다(리스트를 빼려고 좁게 자르면 카드가 어정쩡하게 잘려 더 나빠지는 걸 확인함).
> 다음에 다시 찍을 일이 있으면 PiP를 타이머 카드 위쪽에 겹치게 두면 양쪽 다 만족한다.

### 재생성 방법

프로모션 타일과 동일하되 `--window-size=1280,800`:

```bash
"C:/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --no-first-run --hide-scrollbars \
  --force-device-scale-factor=1 --user-data-dir="<SP>/cr-profile" \
  --allow-file-access-from-files \
  --virtual-time-budget=6000 --window-size=1280,800 \
  --screenshot="<SP>/slide02-en.png" \
  "<이 폴더의 절대경로>/screenshot-02-block.source.html"
```

- `--allow-file-access-from-files`가 필요하다 — 소스 HTML이 `block-en.png`/`../../icons/icon128.png`를
  상대경로 `<img>`로 참조하기 때문(프로모션 타일은 아이콘을 base64로 임베드해서 이 플래그가 없었다).
- `--screenshot` 출력은 OneDrive 밖(`<SP>`)에 쓰고 나서 복사할 것 — §1의 "액세스 거부(0x5)" 주의와 동일.
- 한글 캡션은 Sora에 글리프가 없어 시스템 굵은 한글 폰트로 폴백되는 게 정상이다.

> 대안: 캡션 없이 raw 캡처를 640×400 또는 1280×800으로 리사이즈만 해서 그대로 제출해도 CWS 요건은 충족된다(최소 1장). 합성은 완성도용 선택 사항.
