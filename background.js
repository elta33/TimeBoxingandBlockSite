// background.js
importScripts('pomodoro-shared.js', 'storage-api.js');

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
    return new URL('https://' + host).hostname + tail;
  } catch (_) {
    return domain;
  }
}

async function updateBlockingRules() {
  const data = await TBBStorage.get(['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled', 'pomodoroState', 'pomodoroList']);
  const generalList = data.generalList || [];
  const permanentList = data.permanentList || [];
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

  if (activeBox) {
    // ※ 크롬 DNR 핵심 제약: allow 액션은 block 액션만 무력화하며, redirect 액션은 무력화하지 못함.
    //   따라서 "커스텀 allow → generalList redirect" 충돌은 우선순위로 해결 불가.
    //   해결책: 커스텀 allow 도메인은 generalList 규칙 자체를 올리지 않는 방식으로 우회.
    //   (finalAllowSet에 기록 → generalList 등록 시 필터링)

    // 커스텀 허용 도메인 처리 (계급 50): permanentList 제외 후 generalList 차단에서 면제
    if (activeBox.customDomains) {
      activeBox.customDomains.forEach(cd => {
        const clean = cleanDomain(cd.domain);
        if (!permanentList.some(p => cleanDomain(p) === clean)) {
          finalAllowSet.add(clean);
          addDnrRule(clean, 50, true);
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
  const pomodoroState = data.pomodoroState || { active: false };
  const pomodoroList  = data.pomodoroList  || [];
  if (pomodoroState.active && pomodoroState.phase === 'work') {
    pomodoroList.forEach(d => addDnrRule(cleanDomain(d), 30, false, 'pomodoro'));
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

// ── 통계 로깅 헬퍼 ──
function _statsTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function _statsUpdateStreak(streak, dateStr) {
  const s = streak || { current: 0, longest: 0, lastDate: '' };
  if (s.lastDate === dateStr) return s;
  const prev = new Date(dateStr);
  prev.setDate(prev.getDate() - 1);
  const yesterStr = prev.toISOString().slice(0, 10);
  const cur = (s.lastDate === yesterStr) ? s.current + 1 : 1;
  return { current: cur, longest: Math.max(s.longest, cur), lastDate: dateStr };
}

async function _statsLogPomoSession(durationMins) {
  const dateStr = _statsTodayStr();
  const data = await TBBStorage.get(['focusEvents', 'focusStreak']);
  let events = data.focusEvents || [];
  let day = events.find(e => e.date === dateStr);
  if (!day) { day = { date: dateStr, blocks: [], pomoSessions: [] }; events.push(day); }
  day.pomoSessions.push({ ts: Math.floor(Date.now() / 1000), durationMins });
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  events = events.filter(e => e.date >= cutoff.toISOString().slice(0, 10));
  const streak = _statsUpdateStreak(data.focusStreak || null, dateStr);
  await TBBStorage.set({ focusEvents: events, focusStreak: streak });
}

// 1분 알람마다 활성 타임박스 안에 있으면 오늘 focusMins +1
async function _statsLogBoxMinute() {
  const data = await TBBStorage.get([
    'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled', 'focusEvents', 'focusStreak'
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
  let events = data.focusEvents || [];
  let day = events.find(e => e.date === dateStr);
  if (!day) { day = { date: dateStr, blocks: [], pomoSessions: [], focusMins: 0 }; events.push(day); }
  day.focusMins = (day.focusMins || 0) + 1;

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  events = events.filter(e => e.date >= cutoff.toISOString().slice(0, 10));
  const streak = _statsUpdateStreak(data.focusStreak || null, dateStr);
  await TBBStorage.set({ focusEvents: events, focusStreak: streak });
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

// 데이터 변경 및 타이머 연동
chrome.storage.onChanged.addListener(updateBlockingRules);
chrome.alarms.create("timeboxTicker", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "timeboxTicker") {
    await _statsLogBoxMinute();
    await checkPomodoroPhase();
    updateBlockingRules();
  }
});
chrome.runtime.onStartup.addListener(updateBlockingRules);
chrome.runtime.onInstalled.addListener(async () => {
  await _migrateToSync();
  await _migrateToSyncV2();
  updateBlockingRules();
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

  const data = await TBBStorage.get(['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled', 'pomodoroState', 'pomodoroList']);
  const permanentList = data.permanentList || [];
  const permBlocked = permanentList.find(d => matches(d));
  if (permBlocked) return { blocked: true, reason: 'permanent', domain: cleanDomain(permBlocked) };

  const pomodoroState = data.pomodoroState || { active: false };
  const pomodoroList  = data.pomodoroList  || [];
  if (pomodoroState.active && pomodoroState.phase === 'work') {
    const pomoBlocked = pomodoroList.find(d => matches(d));
    if (pomoBlocked) return { blocked: true, reason: 'pomodoro', domain: cleanDomain(pomoBlocked) };
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
  if (!activeBox) return { blocked: false };

  const allowSet = new Set(
    (activeBox.customDomains || []).map(cd => cleanDomain(cd.domain))
  );

  const generalList = data.generalList || [];
  for (const d of generalList) {
    if (!allowSet.has(cleanDomain(d)) && matches(d)) return { blocked: true, reason: 'general', domain: cleanDomain(d) };
  }

  return { blocked: false };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'checkBlock') return false;
  shouldUrlBeBlocked(msg.url).then(sendResponse);
  return true; // 비동기 응답
});
