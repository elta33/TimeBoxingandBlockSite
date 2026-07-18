# CWS 스토어 에셋 현황 및 제작 가이드

Chrome Web Store 제출에 필요한 이미지 에셋의 상태와 제작 방법.

## 요구 사양 (CWS 기준)

| 에셋 | 사양 | 필수 | 상태 |
|------|------|------|------|
| 스토어 아이콘 | 128×128 PNG | 필수 | ✅ `icons/icon128.png` |
| 스크린샷 | 1280×800 **또는** 640×400 PNG/JPEG, 1~5장 | 최소 1장 필수 | ⬜ 사용자 캡처 필요 (아래) |
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

### 2-2. 1280×800 합성 (원하면 Claude가 대행)

raw 캡처를 주면, 프로모션 타일과 같은 톤(`#10141f` 배경 + tomato `#ff6347` 액센트, Sora/Manrope)으로 캡션을 얹은
1280×800 타일로 합성해 `screenshots/`에 만들 수 있다. 캡션 초안은
`store-listing/store-description.md`의 "스크린샷 캡션 제안" 참고.

> 대안: 캡션 없이 raw 캡처를 640×400 또는 1280×800으로 리사이즈만 해서 그대로 제출해도 CWS 요건은 충족된다(최소 1장). 합성은 완성도용 선택 사항.
