// background.js
// 의존 파일 로드: 크롬은 service worker라 importScripts로 직접 읽고, 파이어폭스는 event page라
// importScripts 자체가 없어서 manifest.firefox.json의 background.scripts가 같은 순서로 로드한다.
// 두 목록의 순서는 항상 일치시켜야 한다(storage-api.js가 background.js보다 먼저).
if (typeof importScripts === 'function') {
  importScripts('browser-shim.js', 'pomodoro-shared.js', 'storage-api.js', 'pro.js');
}

const BLOCK_PAGE_PATH = "/block.html";

function getCurrentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function isTimeInBox(startStr, endStr) {
  const [sH, sM] = startStr.split(':').map(Number);
  const [eH, eM] = endStr.split(':').map(Number);
  
  const startMin = sH * 60 + sM;
  let endMin = eH * 60 + eM;
  let currentMin = getCurrentMinutes();

  if (endMin <= startMin) {
    endMin += 24 * 60;
    if (currentMin <= eH * 60 + eM) {
      currentMin += 24 * 60;
    }
  }
  return currentMin >= startMin && currentMin < endMin;
}

// 도메인 문자열에서 불필요한 http, www, 끝부분 슬래시 등을 완벽히 제거 + 유니코드(IDN) 도메인은 punycode로 정규화
// (DNR urlFilter는 ASCII만 허용 — 정규화 안 하면 updateDynamicRules 전체가 실패함)
function cleanDomain(d) {
  const domain = d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').trim();
  const sepIdx = domain.search(/[/?#]/);
  const host = sepIdx === -1 ? domain : domain.slice(0, sepIdx);
  const tail = sepIdx === -1 ? '' : domain.slice(sepIdx);
  try {
    return _canonicalVideoUrl(new URL('https://' + host).hostname, tail);
  } catch (_) {
    return domain;
  }
}

// 유튜브 영상 링크는 공유 버튼이 붙이는 si·t·list 같은 부가 파라미터나 youtu.be 단축 주소 때문에
// "그 주소로 시작하는 페이지" 비교가 어긋나기 쉽다(예외/화이트리스트에 넣어도 실제 방문 주소와 앞부분이
// 달라 허용이 안 됨). 영상을 가리키는 최소 형태(youtube.com/watch?v=ID, youtube.com/shorts/ID)로 맞춘다.
// 저장된 값이 아니라 읽을 때마다 적용되므로 예전에 저장된 링크도 그대로 고쳐진다.
// background.js / options-core.js / popup.js의 cleanDomain과 함께 세 곳 동일하게 유지할 것.
function _canonicalVideoUrl(host, tail) {
  const h = host.replace(/^(www\.|m\.)/, '');
  if (h === 'youtu.be' && tail) {
    const id = tail.slice(1).split(/[/?#]/)[0];
    if (id) return 'youtube.com/watch?v=' + id;
  }
  if (h === 'youtube.com' && tail) {
    try {
      const u = new URL('https://youtube.com' + tail);
      const v = u.searchParams.get('v');
      if (u.pathname === '/watch' && v) return 'youtube.com/watch?v=' + v;
      if (/^\/shorts\/[^/]+$/.test(u.pathname)) return 'youtube.com' + u.pathname;
    } catch (_) {}
  }
  return host + tail;
}

// 화이트리스트 항목을 호스트 단위와 경로 단위로 나눈다.
// - 호스트(예: github.com): 서브도메인 포함 사이트 전체 허용 → DNR excludedRequestDomains
// - 경로(예: youtube.com/watch?v=xxx): 그 주소로 시작하는 페이지만 허용 → 별도 allow 규칙
// ASCII가 아니면(정규화 실패) 버린다 — 비ASCII 하나가 updateDynamicRules 전체를 실패시키는 건
// addDnrRule과 같은 사정.
function splitWhitelist(list) {
  const hosts = new Set();
  const paths = new Set();
  (list || []).forEach(d => {
    const clean = cleanDomain(d);
    if (!clean || !/^[\x00-\x7F]*$/.test(clean)) return;
    if (clean.search(/[/?#]/) === -1) hosts.add(clean.toLowerCase());
    else paths.add(clean);
  });
  // youtu.be 공유 링크는 youtu.be에 먼저 요청한 뒤 서버가 youtube.com/watch?v=ID로 넘긴다.
  // 화이트리스트 방식은 "등록 안 된 사이트 전부 차단"이라 첫 단계인 youtu.be에서 막혀버리므로
  // (일반 차단에선 youtu.be가 차단 대상이 아니라 문제가 안 드러났음), 유튜브 항목에는 youtu.be 쪽
  // 입구도 같이 열어 준다. 영상 항목은 그 영상의 youtu.be 주소만, 사이트 항목은 youtu.be 전체.
  if (hosts.has('youtube.com')) hosts.add('youtu.be');
  [...paths].forEach(p => {
    const m = p.match(/^youtube\.com\/watch\?v=([^&#]+)$/);
    if (m) paths.add('youtu.be/' + m[1]);
  });
  return { hosts: [...hosts], paths: [...paths] };
}

async function updateBlockingRules() {
  const data = await TBBStorage.get(['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled', 'pomodoroState', 'pomodoroList', 'pomodoroActiveDomainOverride', 'shortsBlockEnabled', 'instaBlockEnabled', 'whitelistModeEnabled', 'whitelistList']);
  // 화이트리스트 모드가 켜지면 상시/일반 차단 목록은 일시 정지된다(옵션 페이지에서도 흐리게 접혀 보임).
  // 목록 데이터는 그대로 두고 규칙만 안 올리므로, 끄면 원래 차단이 그대로 돌아온다.
  const whitelistOn = !!data.whitelistModeEnabled;
  const generalList = whitelistOn ? [] : (data.generalList || []);
  const permanentList = whitelistOn ? [] : (data.permanentList || []);
  // dailyBoxes: 요일 무관 오늘만 / weeklyBoxes: 요일 필터 적용
  const dailyEnabled = data.dailyScheduleEnabled !== false;
  const dailyBoxes = dailyEnabled ? (data.dailyBoxes || []).map(b => ({ ...b, days: [] })) : []; // 강제로 매일 적용
  const weeklyBoxes = data.weeklyBoxes || [];
  const timeBoxes = [...dailyBoxes, ...weeklyBoxes];

  let ruleIdCounter = 1;
  const newRules = [];
  const finalAllowSet = new Set(); // 커스텀 allow 도메인 추적 (generalList 등록 시 필터링용)

  // reason: 'permanent' | 'general' | 'custom' — block.html에서 차단 사유 메시지 분기용
  function addDnrRule(domain, priority, isAllow, reason) {
    if (!domain) return;
    // DNR urlFilter는 ASCII만 허용 — 하나라도 어기면 updateDynamicRules 전체가 실패하므로 개별 스킵
    if (!/^[\x00-\x7F]*$/.test(domain)) {
      console.warn(`[TBB] "${domain}"에 유효하지 않은 문자가 남아있어 차단 규칙에서 제외합니다.`);
      return;
    }
    let redirectPath = BLOCK_PAGE_PATH;
    if (!isAllow) {
      redirectPath += `?domain=${encodeURIComponent(domain)}`;
      if (reason) redirectPath += `&reason=${reason}`;
    }
    newRules.push({
      id: ruleIdCounter++,
      priority: priority,
      action: isAllow ? { type: "allow" } : { type: "redirect", redirect: { extensionPath: redirectPath } },
      condition: {
        // || 기호를 붙여 서브도메인(www 등)까지 완벽 매칭하는 크롬 권장 문법
        urlFilter: "||" + domain,
        resourceTypes: ["main_frame"]
      }
    });
  }

  // 1순위: 상시 차단 리스트 (계급 100)
  permanentList.forEach(d => {
    addDnrRule(cleanDomain(d), 100, false, 'permanent');
  });

  const todayDow = (new Date().getDay() + 6) % 7; // 0=월…6=일
  const activeBox = timeBoxes.find(box => {
    // days 빈 배열 = 매일 적용 (하루 뷰용 박스)
    const days = box.days || [];
    if (days.length > 0 && !days.includes(todayDow)) return false;
    return isTimeInBox(box.startTime, box.endTime);
  });

  // 박스 예외(customDomains)는 "일반 차단"의 예외라서, 일반 차단이 일시 정지되는 화이트리스트
  // 모드에선 같이 쉰다(안 그러면 박스 시간마다 화이트리스트에 구멍이 뚫림).
  if (activeBox && !whitelistOn) {
    // 크롬 DNR은 우선순위가 높은 allow가 낮은 redirect를 이긴다(공식 문서 matching algorithm).
    // 경로 예외(예: youtube.com/watch?v=xxx)는 이 allow 규칙으로 youtube.com 일반 차단을 뚫는다.
    // 도메인이 정확히 같은 예외는 finalAllowSet으로 일반 차단 규칙 자체도 안 올린다(이중 안전장치).

    // 커스텀 허용 도메인 처리 (계급 15): 일반 차단(10)·쇼츠/인스타(5)만 이기고 포모도로(30)·
    // 상시(100)에는 진다 — 예외는 "박스 시간의 일반 차단" 예외일 뿐, 집중 타이머까지 풀면 안 됨.
    // (예전엔 50이라 포모도로를 이겼지만 SPA 판정(shouldUrlBeBlocked)은 포모도로가 이겨서,
    //  페이지가 열렸다가 content.js가 다시 차단 화면으로 보내는 식으로 어긋나 있었다.)
    if (activeBox.customDomains) {
      activeBox.customDomains.forEach(cd => {
        const clean = cleanDomain(cd.domain);
        if (!permanentList.some(p => cleanDomain(p) === clean)) {
          finalAllowSet.add(clean);
          addDnrRule(clean, 15, true);
        }
      });
    }

    generalList.forEach(d => {
      const clean = cleanDomain(d);
      if (!finalAllowSet.has(clean)) {
        addDnrRule(clean, 10, false, 'general');
      }
    });
  }

  // 포모도로 차단 (작업 페이즈 중에만 활성화, 계급 30)
  // 도메인 커스텀 프리셋의 허용(예외) 도메인은 pomodoroList엔 그대로 남겨두고(프리셋 없이 되돌아오면
  // 다시 차단되도록) 규칙 생성 시에만 건너뛴다 — allow 규칙(계급 30 초과)으로 만들면 그보다 낮은
  // 화이트리스트/일반 차단까지 같이 풀리므로, 규칙 자체를 안 만드는 방식으로 처리.
  const pomodoroState = data.pomodoroState || { active: false };
  const pomodoroList  = data.pomodoroList  || [];
  const pomoAllowSet  = new Set((data.pomodoroActiveDomainOverride?.allow || []).map(cleanDomain));
  if (pomodoroState.active && pomodoroState.phase === 'work') {
    pomodoroList.forEach(d => {
      const clean = cleanDomain(d);
      if (!pomoAllowSet.has(clean)) addDnrRule(clean, 30, false, 'pomodoro');
    });
  }

  // 화이트리스트 모드 (계급 20): 등록된 호스트(서브도메인 포함)를 뺀 모든 http(s) 페이지를 차단.
  // 호스트는 "전부 매칭 + excludedRequestDomains" 규칙 하나로 빼고, 경로 항목만 allow 규칙(계급 25)을
  // 따로 둔다 — 호스트까지 allow 규칙으로 만들면 쇼츠/인스타(5) 강력 차단도 같이 무력화된다.
  // 차단 화면 통계/문구용 domain 파라미터는 regexSubstitution으로 원래 호스트를 넘긴다.
  // 포모도로(30)는 둘 다보다 높아서, 화이트리스트에 있는 사이트라도 작업 시간엔 포모도로 차단이 이긴다.
  if (whitelistOn) {
    const { hosts: allowHosts, paths: allowPaths } = splitWhitelist(data.whitelistList);
    allowPaths.forEach(p => addDnrRule(p, 25, true));
    const condition = {
      regexFilter: "^https?://(?:www\\.)?([^/:?#]+)",
      resourceTypes: ["main_frame"]
    };
    if (allowHosts.length) condition.excludedRequestDomains = allowHosts;
    newRules.push({
      id: ruleIdCounter++,
      priority: 20,
      action: {
        type: "redirect",
        redirect: { regexSubstitution: chrome.runtime.getURL("block.html") + "?reason=whitelist&domain=\\1" }
      },
      condition
    });
  }

  // 유튜브 쇼츠 강력 차단 (계급 5): 상시 차단(100)·포모도로(30)·일반 차단(10)이 유튜브 전체를
  // 걸어뒀으면 그쪽 우선순위가 더 높아 그대로 이기고(block.html 표시), 그 외엔 쇼츠 주소만
  // block.html 없이 유튜브 홈으로 조용히 리다이렉트한다. SPA 내부 이동은 DNR이 못 잡으므로
  // shouldUrlBeBlocked()의 폴백 경로에서 같은 조건을 한 번 더 처리한다.
  if (data.shortsBlockEnabled) {
    newRules.push({
      id: ruleIdCounter++,
      priority: 5,
      action: { type: "redirect", redirect: { url: "https://www.youtube.com/" } },
      condition: {
        urlFilter: "||youtube.com/shorts",
        resourceTypes: ["main_frame"]
      }
    });
  }

  // 인스타그램 릴스/탐색/게시물 강력 차단 (계급 5, 쇼츠와 동일 최하위 폴백): 검색 아이콘도
  // 실제로는 /explore/로 이동하므로 탐색과 같은 경로 하나로 커버된다. /p는 DM 공유·프로필
  // 게시물 메뉴로 들어가는 릴스/게시물 상세 열람 우회로를 막기 위해 추가(부작용: 팔로우 중인
  // 계정의 일반 게시물 상세도 함께 막힘 — /p가 콘텐츠 종류를 구분 안 하는 공용 경로라 불가피).
  // 알림/만들기/Threads는 URL 이동이 없는 패널·모달이라 리다이렉트 대상이 없고 코스메틱
  // 숨김(updateInstaCosmetic)만 담당한다.
  // 경로 뒤에 "^"(DNR 구분자 와일드카드: 문자/숫자/_-.% 가 아닌 문자 또는 URL 끝)를 붙여
  // /people, /reelsguy 같은 다른 경로·사용자명 접두사 오매칭을 방지한다.
  if (data.instaBlockEnabled) {
    ["explore", "reels", "p"].forEach(path => {
      newRules.push({
        id: ruleIdCounter++,
        priority: 5,
        action: { type: "redirect", redirect: { url: "https://www.instagram.com/" } },
        condition: {
          urlFilter: `||instagram.com/${path}^`,
          resourceTypes: ["main_frame"]
        }
      });
    });
  }

  // 크롬 엔진 덮어쓰기
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  const oldRuleIds = oldRules.map(rule => rule.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRuleIds,
    addRules: newRules
  });
  
  console.log("우선순위 규칙 업데이트 성공! 생성된 규칙 수:", newRules.length);
}

// ── 유튜브 쇼츠 코스메틱 숨김 (strong-block-selectors.css/js) ──
// registerContentScripts는 매니페스트 정적 content_scripts와 동일하게 document_start 시점에
// 동기 주입되어(페이지 깜빡임 없음) 페이지 CSP도 우회한다 — insertCSS를 webNavigation 이벤트에
// 맞춰 매번 호출하는 방식보다 타이밍이 안전해서 이쪽을 택함.
// css는 속성/구조 기반 선택자만 가능해서, 검색 결과 필터 칩처럼 순수 텍스트로만 구분되는
// 요소는 js(strong-block-selectors.js)가 같은 등록 항목으로 함께 담당한다.
const SHORTS_CSS_SCRIPT_ID = 'tbb-strong-block-selectors';
const INSTA_CSS_SCRIPT_ID = 'tbb-strong-block-selectors-instagram';

async function updateShortsCosmetic() {
  const { shortsBlockEnabled } = await TBBStorage.get(['shortsBlockEnabled']);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SHORTS_CSS_SCRIPT_ID] });
  if (shortsBlockEnabled && registered.length === 0) {
    await chrome.scripting.registerContentScripts([{
      id: SHORTS_CSS_SCRIPT_ID,
      matches: ["*://*.youtube.com/*"],
      css: ["strong-block-selectors.css"],
      js: ["strong-block-selectors.js"],
      runAt: "document_start"
    }]);
  } else if (!shortsBlockEnabled && registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [SHORTS_CSS_SCRIPT_ID] });
  }
}

async function updateInstaCosmetic() {
  const { instaBlockEnabled } = await TBBStorage.get(['instaBlockEnabled']);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [INSTA_CSS_SCRIPT_ID] });

  if (!instaBlockEnabled) {
    if (registered.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [INSTA_CSS_SCRIPT_ID] });
    return;
  }

  // 예전에는 instaShowFollowedPosts(팔로우한 계정 게시물은 홈에 표시) 옵션에 따라
  // strong-block-insta-caughtup.css를 등록 목록에 넣고 빼면서 조건부로 적용했다. 그 옵션을
  // 제거하면서 규칙이 항상 적용되므로 파일은 strong-block-selectors.css로 합쳐졌고, 여기서도
  // 조건 분기 없이 고정 목록을 등록하면 된다.
  if (registered.length === 0) {
    await chrome.scripting.registerContentScripts([{
      id: INSTA_CSS_SCRIPT_ID,
      matches: ["*://*.instagram.com/*"],
      css: ["strong-block-selectors.css"],
      js: ["strong-block-selectors.js"],
      runAt: "document_start"
    }]);
  }
}

// 쇼츠/인스타 차단 토글이 바뀌는 순간, 이미 열려 있던 탭들은 content.js가 토글 변경 이전
// 상태로 실행 중이라 새로고침 전까지 리다이렉트/코스메틱 숨김이 적용(또는 해제)되지
// 않는다 — on/off 어느 쪽으로 바뀌든 열린 탭을 자동 새로고침.
function _reloadOpenYoutubeTabs() {
  chrome.tabs.query({ url: ["*://*.youtube.com/*"] }, tabs => {
    tabs.forEach(tab => { if (tab.id !== undefined) chrome.tabs.reload(tab.id); });
  });
}

function _reloadOpenInstagramTabs() {
  chrome.tabs.query({ url: ["*://*.instagram.com/*"] }, tabs => {
    tabs.forEach(tab => { if (tab.id !== undefined) chrome.tabs.reload(tab.id); });
  });
}

// ── 통계 로깅 헬퍼 ──
function _statsTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function _statsLogPomoSession(durationMins) {
  const dateStr = _statsTodayStr();
  // 이 기기 샤드에만 기록한다(보관 기간 정리는 updateFocusEvents가 처리)
  await TBBStorage.updateFocusEvents(events => {
    let day = events.find(e => e.date === dateStr);
    if (!day) { day = { date: dateStr, blocks: [], pomoSessions: [] }; events.push(day); }
    day.pomoSessions.push({ ts: Math.floor(Date.now() / 1000), durationMins });
    return events;
  });
  await TBBStorage.refreshStreak(); // 연속일은 기록에서 계산 — 저장값을 증가시키지 않는다
}

// 1분 알람마다 활성 타임박스 안에 있으면 오늘 focusMins +1
async function _statsLogBoxMinute() {
  const data = await TBBStorage.get([
    'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled'
  ]);
  const dailyEnabled = data.dailyScheduleEnabled !== false;
  const dailyBoxes   = dailyEnabled ? (data.dailyBoxes || []).map(b => ({ ...b, days: [] })) : [];
  const weeklyBoxes  = data.weeklyBoxes || [];
  const todayDow     = (new Date().getDay() + 6) % 7; // 0=월…6=일

  const inBox = [...dailyBoxes, ...weeklyBoxes].some(box => {
    const days = box.days || [];
    if (days.length > 0 && !days.includes(todayDow)) return false;
    return isTimeInBox(box.startTime, box.endTime);
  });
  if (!inBox) return;

  const dateStr = _statsTodayStr();
  // 이 기기가 실제로 집중한 분만 자기 샤드에 더한다. 다른 기기 값은 건드리지 않으므로
  // 예전처럼 두 기기가 서로의 기록을 지우는 일이 없다.
  await TBBStorage.updateFocusEvents(events => {
    let day = events.find(e => e.date === dateStr);
    if (!day) { day = { date: dateStr, blocks: [], pomoSessions: [], focusMins: 0 }; events.push(day); }
    day.focusMins = (day.focusMins || 0) + 1;
    return events;
  });
  await TBBStorage.refreshStreak();
}

// 포모도로 페이즈 자동 전환 (1분 알람 틱마다 체크)
async function checkPomodoroPhase() {
  const data      = await TBBStorage.get(['pomodoroState', 'pomodoroSettings', 'pomodoroCycleOverrides']);
  const state     = data.pomodoroState;
  const settings  = data.pomodoroSettings || { workMins: 25, restMins: 5, cycles: 2 };
  const overrides = data.pomodoroCycleOverrides || [];

  if (!state?.active || !state.endTime) return;
  const now = Date.now();
  if (now < state.endTime) return;
  // options-pomodoro.js / pomodoro-pip.js의 _pomoTick이 먼저 전환했을 경우 중복 전환 방지.
  // advancedAt이 10초 이내면 UI가 이미 처리한 것으로 간주하고 넘어감.
  if (state.advancedAt && now - state.advancedAt < 10000) return;

  const cycle       = state.cycle       || 1;
  const totalCycles = state.totalCycles || settings.cycles;
  let newState;

  if (state.phase === 'work') {
    const cur = _resolveCycleTimes(cycle, settings, overrides);
    newState = cycle >= totalCycles
      ? { active: false, phase: 'done', endTime: null, cycle, totalCycles }
      : { ...state,      phase: 'rest', endTime: now + cur.restMins * 60 * 1000 };
    await _statsLogPomoSession(cur.workMins);
  } else if (state.phase === 'rest') {
    const next = _resolveCycleTimes(cycle + 1, settings, overrides);
    newState = { ...state, phase: 'work', endTime: now + next.workMins * 60 * 1000, cycle: cycle + 1 };
  }

  if (newState) await chrome.storage.local.set({ pomodoroState: newState });
}

// ── local→sync 1회성 마이그레이션 ──
// 기존 사용자는 차단 설정/통계가 전부 local에만 있으므로, 크로스 기기 동기화 도입 시
// 한 번은 local 값을 sync로 옮겨줘야 다른 기기에서도 보인다.
const _SYNC_MIGRATION_FLAG = '_syncMigrationDone_v1';

// focusEvents는 기기마다 독립적으로 쌓여있을 수 있어 날짜 단위로 병합.
// blocks/pomoSessions는 ts 기준 dedupe, focusMins는 이중 집계를 피하려 max 채택(완벽한 병합은 아님).
// 여기서 만든 값은 구버전 단일 키('focusEvents')에 그대로 남는다 — 이후 기록은 기기별 샤드로
// 가고, 읽을 때 이 키까지 함께 합산되므로 샤드로 옮기지 않아야 이중 집계가 생기지 않는다.
// (storage-api.js의 focusEvents 샤딩 주석 참고)
function _mergeFocusEvents(localEvents, syncEvents) {
  const byDate = new Map();
  (syncEvents || []).forEach(e => byDate.set(e.date, {
    date: e.date,
    focusMins: e.focusMins || 0,
    blocks: [...(e.blocks || [])],
    pomoSessions: [...(e.pomoSessions || [])]
  }));
  (localEvents || []).forEach(e => {
    const existing = byDate.get(e.date);
    if (!existing) {
      byDate.set(e.date, {
        date: e.date,
        focusMins: e.focusMins || 0,
        blocks: [...(e.blocks || [])],
        pomoSessions: [...(e.pomoSessions || [])]
      });
      return;
    }
    existing.focusMins = Math.max(existing.focusMins, e.focusMins || 0);
    const blockKey = b => `${b.domain}|${b.ts}`;
    const existingBlockKeys = new Set(existing.blocks.map(blockKey));
    (e.blocks || []).forEach(b => { if (!existingBlockKeys.has(blockKey(b))) existing.blocks.push(b); });
    const sessionKey = s => `${s.ts}|${s.durationMins}`;
    const existingSessionKeys = new Set(existing.pomoSessions.map(sessionKey));
    (e.pomoSessions || []).forEach(s => { if (!existingSessionKeys.has(sessionKey(s))) existing.pomoSessions.push(s); });
  });
  return Array.from(byDate.values());
}

async function _migrateToSync() {
  const flag = await chrome.storage.local.get([_SYNC_MIGRATION_FLAG]);
  if (flag[_SYNC_MIGRATION_FLAG]) return;

  const listKeys = ['permanentList', 'generalList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled', 'weekStartMonday'];
  const [localData, syncData] = await Promise.all([
    chrome.storage.local.get([...listKeys, 'focusEvents', 'focusStreak']),
    chrome.storage.sync.get([...listKeys, 'focusEvents', 'focusStreak'])
  ]);

  const toSync = {};
  // 리스트/박스류: sync에 이미 값이 있으면(다른 기기가 먼저 마이그레이션) sync를 신뢰하고 local로 덮지 않음
  listKeys.forEach(k => {
    if (syncData[k] === undefined && localData[k] !== undefined) toSync[k] = localData[k];
  });
  if (localData.focusEvents || syncData.focusEvents) {
    toSync.focusEvents = _mergeFocusEvents(localData.focusEvents, syncData.focusEvents);
  }
  if (syncData.focusStreak === undefined && localData.focusStreak !== undefined) {
    toSync.focusStreak = localData.focusStreak;
  }

  if (Object.keys(toSync).length) await TBBStorage.set(toSync);
  await chrome.storage.local.set({ [_SYNC_MIGRATION_FLAG]: true });
}

// ── 2차 마이그레이션 (투두/포모도로 설정·프리셋/차단화면 문구·링크) ──
// v1과 별도 플래그로 분리 — v1이 이미 완료된 기존 사용자도 이 배치는 새로 받아야 함.
const _SYNC_MIGRATION_FLAG_V2 = '_syncMigrationDone_v2';

async function _migrateToSyncV2() {
  const flag = await chrome.storage.local.get([_SYNC_MIGRATION_FLAG_V2]);
  if (flag[_SYNC_MIGRATION_FLAG_V2]) return;

  const keys = ['todoItems', 'pomodoroSettings', 'pomodoroPresets', 'pomodoroCycleOverrides', 'pomodoroList', 'customQuotes', 'customLinks'];
  const [localData, syncData] = await Promise.all([
    chrome.storage.local.get(keys),
    chrome.storage.sync.get(keys)
  ]);

  const toSync = {};
  // sync에 이미 값이 있으면(다른 기기가 먼저 마이그레이션) sync를 신뢰하고 local로 덮지 않음
  keys.forEach(k => {
    if (syncData[k] === undefined && localData[k] !== undefined) toSync[k] = localData[k];
  });

  if (Object.keys(toSync).length) await TBBStorage.set(toSync);
  await chrome.storage.local.set({ [_SYNC_MIGRATION_FLAG_V2]: true });
}

// sync 쪽 변경은 "다른 계정/기기 데이터가 통째로 들어온 것"일 수 있어 데이터셋 합의 상태를
// 다시 확인해야 한다. 브라우저가 여러 키를 나눠 전달할 수 있으므로 잠깐 모아서 한 번만 본다
// (데이터셋 id가 설정 키보다 늦게 도착하면 멀쩡한 값을 충돌로 오인할 수 있기 때문).
let _syncLinkCheckTimer = null;
function _scheduleSyncLinkCheck() {
  if (_syncLinkCheckTimer) clearTimeout(_syncLinkCheckTimer);
  _syncLinkCheckTimer = setTimeout(() => {
    _syncLinkCheckTimer = null;
    TBBStorage.ensureSyncLink().then(updateBlockingRules).catch(() => {});
  }, 1500);
}

// 데이터 변경 및 타이머 연동
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') _scheduleSyncLinkCheck();
  updateBlockingRules();
  updateShortsCosmetic();
  updateInstaCosmetic();
  // on↔off 어느 방향이든 토글이 바뀌면 새로고침 (켤 때: 숨김/리다이렉트 즉시 적용,
  // 끌 때: 옛 content.js가 붙잡고 있던 상태 없이 깨끗하게 원복)
  if (changes.shortsBlockEnabled) {
    _reloadOpenYoutubeTabs();
  }
  if (changes.instaBlockEnabled) {
    _reloadOpenInstagramTabs();
  }
});
chrome.alarms.create("timeboxTicker", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "timeboxTicker") {
    await _statsLogBoxMinute();
    await checkPomodoroPhase();
    updateBlockingRules();
  }
});
chrome.runtime.onStartup.addListener(() => {
  TBBPro.ensureGrandfather();
  TBBStorage.gcLegacyFocusEvents(); // 보관 기간이 지난 구버전 통계 단일 키 정리
  TBBStorage.ensureSyncLink();
  updateBlockingRules();
  updateShortsCosmetic();
  updateInstaCosmetic();
});
chrome.runtime.onInstalled.addListener(async (details) => {
  await TBBPro.ensureGrandfather(); // 출시 무료 기간 사용자를 영구 무료로 각인(설치/업데이트 양쪽)
  await _migrateToSync();
  await _migrateToSyncV2();
  await TBBStorage.gcLegacyFocusEvents();
  await TBBStorage.ensureSyncLink();
  // 제거된 기능의 잔여 키 정리: instaShowFollowedPosts(팔로우한 계정 게시물 표시)는 기능째로
  // 삭제됐지만, 쓰던 사용자의 sync 저장소에는 값이 남아 있다. 읽는 코드가 없으니 동작에
  // 영향은 없고 동기화 비교 목록에도 안 나오지만, 계정에 죽은 키가 남는 걸 피하려고 한 번
  // 지운다. 없는 키를 remove해도 onChanged는 안 뜨므로 두 번째 업데이트부터는 no-op이다.
  await chrome.storage.sync.remove('instaShowFollowedPosts').catch(() => {});
  updateBlockingRules();
  updateShortsCosmetic();
  updateInstaCosmetic();

  if (details.reason === 'install') {
    // 신규 설치: 옵션 페이지를 자동으로 열어 온보딩 체크리스트(options-init.js)를 바로 보여준다.
    chrome.runtime.openOptionsPage();
    // 리뷰 요청 배너(popup.js)는 설치 직후엔 뜨지 않도록 최초 노출 시점을 14일 뒤로 미뤄둔다.
    // 이 값이 없는 기존(업데이트) 사용자는 popup.js에서 "미설정 = 바로 노출 대상"으로 처리된다.
    chrome.storage.local.set({ reviewPromptNextAt: Date.now() + 14 * 24 * 60 * 60 * 1000 });
  }

  // update 분기를 두지 않는다. 온보딩 체크리스트는 별도 완료 플래그 없이 실제 storage
  // 상태로 매번 판정하므로(options-init.js), 업데이트 후에도 이미 끝낸 항목은 취소선이
  // 그대로 유지되고 새로 추가된 항목만 미완료로 보인다. 여기서 onboardingDismissed를
  // 대신 세팅하면 "닫지 않은" 사용자의 체크리스트까지 통째로 숨겨져 새 항목을 못 본다.
  // 닫은 사용자는 onboardingDismissed=true가 이미 있으니 그대로 숨겨진다.
});

// PiP 창이 닫히면 저장된 ID 제거
chrome.windows.onRemoved.addListener(windowId => {
  chrome.storage.local.get(['pipWindowId'], ({ pipWindowId }) => {
    if (pipWindowId === windowId) chrome.storage.local.remove('pipWindowId');
  });
});

// ── content.js SPA 차단 판별 요청 처리 ──
// DNR이 잡지 못한 SPA 내비게이션(pushState/replaceState)에 대해
// content.js가 현재 URL을 보내면 차단 여부를 계산해 돌려준다.
async function shouldUrlBeBlocked(url) {
  let urlObj;
  try { urlObj = new URL(url); } catch { return { blocked: false }; }
  if (urlObj.protocol === 'chrome-extension:') return { blocked: false };

  const hostname = urlObj.hostname.replace(/^www\./, '');

  function matches(entry) {
    const clean = cleanDomain(entry);
    const sepIdx = clean.search(/[/?#]/);
    if (sepIdx !== -1) {
      // 경로 또는 쿼리 파라미터 포함 (예: youtube.com/shorts, youtube.com/watch?v=xxx)
      const bHost = clean.slice(0, sepIdx);
      const bTail = clean.slice(sepIdx); // "/shorts" 또는 "/watch?v=xxx"
      if (!(hostname === bHost || hostname.endsWith('.' + bHost))) return false;
      const urlTail = urlObj.pathname + urlObj.search + urlObj.hash;
      // 접두사 일치 + 경계 확인 (youtube.com/watch?v=abc 가 ?v=abcXXX 에 오매칭되지 않도록)
      return urlTail.startsWith(bTail) &&
        (urlTail.length === bTail.length || '/?&=#'.includes(urlTail[bTail.length]));
    }
    return hostname === clean || hostname.endsWith('.' + clean);
  }

  const data = await TBBStorage.get(['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled', 'pomodoroState', 'pomodoroList', 'pomodoroActiveDomainOverride', 'shortsBlockEnabled', 'instaBlockEnabled', 'whitelistModeEnabled', 'whitelistList']);
  // 체크 순서는 DNR 우선순위와 같게 유지: permanent(100) → pomodoro(30) → whitelist(20) → general(10) → shorts/insta(5).
  // 화이트리스트 모드에선 updateBlockingRules와 똑같이 상시/일반 차단을 건너뛴다.
  const whitelistOn = !!data.whitelistModeEnabled;
  const permanentList = whitelistOn ? [] : (data.permanentList || []);
  const permBlocked = permanentList.find(d => matches(d));
  if (permBlocked) return { blocked: true, reason: 'permanent', domain: cleanDomain(permBlocked) };

  const pomodoroState = data.pomodoroState || { active: false };
  const pomodoroList  = data.pomodoroList  || [];
  const pomoAllowSet  = new Set((data.pomodoroActiveDomainOverride?.allow || []).map(cleanDomain));
  if (pomodoroState.active && pomodoroState.phase === 'work') {
    const pomoBlocked = pomodoroList.find(d => !pomoAllowSet.has(cleanDomain(d)) && matches(d));
    if (pomoBlocked) return { blocked: true, reason: 'pomodoro', domain: cleanDomain(pomoBlocked) };
  }

  // DNR에서 allow 규칙(박스 예외 15, 화이트리스트 경로 25)에 걸린 주소는 그보다 낮은 일반 차단(10)과
  // 쇼츠/인스타(5)도 통과한다 — 아래 체크들이 같은 결론을 내도록 표시해 둔다.
  let allowRuleHit = false;

  if (whitelistOn && (urlObj.protocol === 'http:' || urlObj.protocol === 'https:')) {
    const { hosts, paths } = splitWhitelist(data.whitelistList);
    const pathHit = paths.some(p => matches(p));
    const hostHit = hosts.some(h => hostname === h || hostname.endsWith('.' + h));
    if (!pathHit && !hostHit) return { blocked: true, reason: 'whitelist', domain: hostname };
    if (pathHit) allowRuleHit = true;
  }

  const dailyEnabled = data.dailyScheduleEnabled !== false;
  const dailyBoxes = dailyEnabled ? (data.dailyBoxes || []).map(b => ({ ...b, days: [] })) : [];
  const weeklyBoxes = data.weeklyBoxes || [];
  const todayDow = (new Date().getDay() + 6) % 7;
  const activeBox = [...dailyBoxes, ...weeklyBoxes].find(box => {
    const days = box.days || [];
    if (days.length > 0 && !days.includes(todayDow)) return false;
    return isTimeInBox(box.startTime, box.endTime);
  });
  if (activeBox && !whitelistOn) {
    // 예외는 도메인 일치만이 아니라 "이 주소가 예외 항목에 매칭되는가"로 본다 — 예전엔 정확히 같은
    // 도메인만 비교해서, youtube.com/watch?v=xxx 예외를 넣어도 content.js의 로드 시 판정이
    // youtube.com 일반 차단으로 다시 막아버렸다(DNR은 통과시켰는데 차단 화면이 뜨던 버그).
    const exceptionHit = (activeBox.customDomains || []).some(cd => matches(cd.domain));
    if (exceptionHit) allowRuleHit = true;

    const generalList = exceptionHit ? [] : (data.generalList || []);
    for (const d of generalList) {
      if (matches(d)) return { blocked: true, reason: 'general', domain: cleanDomain(d) };
    }
  }

  // 유튜브 쇼츠 강력 차단 (permanent/pomodoro/general 다음 순위 폴백):
  // SPA 내부 이동(홈 피드에서 쇼츠 썸네일 클릭 등)은 DNR이 못 잡으므로 여기서 한 번 더 처리.
  // reason: 'shorts'는 block.html이 아니라 content.js가 유튜브 홈으로 직접 리다이렉트한다.
  if (allowRuleHit) return { blocked: false };

  if (data.shortsBlockEnabled && (hostname === 'youtube.com' || hostname.endsWith('.youtube.com'))) {
    if (urlObj.pathname === '/shorts' || urlObj.pathname.startsWith('/shorts/')) {
      return { blocked: true, reason: 'shorts' };
    }
  }

  // 인스타그램 릴스/탐색/게시물 강력 차단 (permanent/pomodoro/general 다음 순위 폴백): 사이드바
  // 탐색·릴스·검색 아이콘 클릭이나 홈 피드 게시물 클릭으로 SPA 내부 이동하는 경우 DNR이 못
  // 잡으므로 여기서 한 번 더 처리. reason: 'insta'도 shorts와 동일하게 block.html 없이
  // 인스타그램 홈으로 직접 리다이렉트한다.
  if (data.instaBlockEnabled && (hostname === 'instagram.com' || hostname.endsWith('.instagram.com'))) {
    // startsWith만 쓰면 /reelsguy 같은 사용자명 프로필까지 오매칭되므로, 경로가 정확히
    // 일치하거나 그 뒤에 '/'가 와야만(하위 경로) 차단 대상으로 인정한다.
    const pathUnderInsta = base => urlObj.pathname === base || urlObj.pathname.startsWith(base + '/');
    if (['/explore', '/reels', '/p'].some(pathUnderInsta)) {
      return { blocked: true, reason: 'insta' };
    }
  }

  return { blocked: false };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'checkBlock') return false;
  shouldUrlBeBlocked(msg.url).then(sendResponse);
  return true; // 비동기 응답
});
