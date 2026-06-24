// background.js
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

// 도메인 문자열에서 불필요한 http, www, 끝부분 슬래시 등을 완벽히 제거
function cleanDomain(d) {
  return d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').trim();
}

async function updateBlockingRules() {
  const data = await chrome.storage.local.get(['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled', 'pomodoroState', 'pomodoroList']);
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
    const redirectPath = reason ? `${BLOCK_PAGE_PATH}?reason=${reason}` : BLOCK_PAGE_PATH;
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

// 포모도로 페이즈 자동 전환 (1분 알람 틱마다 체크)
async function checkPomodoroPhase() {
  const data     = await chrome.storage.local.get(['pomodoroState', 'pomodoroSettings']);
  const state    = data.pomodoroState;
  const settings = data.pomodoroSettings || { workMins: 25, restMins: 5, cycles: 2 };

  if (!state?.active || !state.endTime) return;
  const now = Date.now();
  if (now < state.endTime) return;
  // options.js / pomodoro-pip.js의 _pomoTick이 먼저 전환했을 경우 중복 전환 방지.
  // advancedAt이 10초 이내면 UI가 이미 처리한 것으로 간주하고 넘어감.
  if (state.advancedAt && now - state.advancedAt < 10000) return;

  const cycle       = state.cycle       || 1;
  const totalCycles = state.totalCycles || settings.cycles;
  let newState;

  if (state.phase === 'work') {
    newState = cycle >= totalCycles
      ? { active: false, phase: 'done', endTime: null, cycle, totalCycles }
      : { ...state,      phase: 'rest', endTime: now + settings.restMins * 60 * 1000 };
  } else if (state.phase === 'rest') {
    newState = { ...state, phase: 'work', endTime: now + settings.workMins * 60 * 1000, cycle: cycle + 1 };
  }

  if (newState) await chrome.storage.local.set({ pomodoroState: newState });
}

// 데이터 변경 및 타이머 연동
chrome.storage.onChanged.addListener(updateBlockingRules);
chrome.alarms.create("timeboxTicker", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "timeboxTicker") {
    await checkPomodoroPhase();
    updateBlockingRules();
  }
});
chrome.runtime.onStartup.addListener(updateBlockingRules);
chrome.runtime.onInstalled.addListener(updateBlockingRules);

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

  const data = await chrome.storage.local.get(['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled', 'pomodoroState', 'pomodoroList']);
  const permanentList = data.permanentList || [];
  if (permanentList.some(d => matches(d))) return { blocked: true, reason: 'permanent' };

  const pomodoroState = data.pomodoroState || { active: false };
  const pomodoroList  = data.pomodoroList  || [];
  if (pomodoroState.active && pomodoroState.phase === 'work') {
    if (pomodoroList.some(d => matches(d))) return { blocked: true, reason: 'pomodoro' };
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
    if (!allowSet.has(cleanDomain(d)) && matches(d)) return { blocked: true, reason: 'general' };
  }

  return { blocked: false };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'checkBlock') return false;
  shouldUrlBeBlocked(msg.url).then(sendResponse);
  return true; // 비동기 응답
});
