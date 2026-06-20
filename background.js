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
  const data = await chrome.storage.local.get(['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled']);
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

    // 커스텀 도메인 처리 (계급 50)
    if (activeBox.customDomains) {
      activeBox.customDomains.forEach(cd => {
        const clean = cleanDomain(cd.domain);
        const isPermanent = permanentList.some(p => cleanDomain(p) === clean);

        if (cd.mode === 'block') {
          // 차단 박스, 허용 박스 모두: 커스텀 block은 무조건 차단 규칙 등록
          // (단, permanentList는 계급 100으로 이미 커버되므로 중복 등록이지만 무해함)
          addDnrRule(clean, 50, false, 'custom');
        } else if (cd.mode === 'allow') {
          if (!isPermanent) {
            // finalAllowSet에 기록해두어 generalList 등록 시 제외시킴
            finalAllowSet.add(clean);
            // 허용 박스에서는 allow 규칙 자체가 의미 없지만(generalList가 안 올라오므로),
            // 차단 박스에서 혹시 generalList에 없는 도메인을 명시적으로 허용하려는 의도를 위해 등록 유지
            addDnrRule(clean, 50, true);
          }
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

  // 크롬 엔진 덮어쓰기
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  const oldRuleIds = oldRules.map(rule => rule.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRuleIds,
    addRules: newRules
  });
  
  console.log("우선순위 규칙 업데이트 성공! 생성된 규칙 수:", newRules.length);
}

// 데이터 변경 및 타이머 연동
chrome.storage.onChanged.addListener(updateBlockingRules);
chrome.alarms.create("timeboxTicker", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "timeboxTicker") updateBlockingRules(); });
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

  const data = await chrome.storage.local.get(['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled']);
  const permanentList = data.permanentList || [];
  if (permanentList.some(d => matches(d))) return { blocked: true, reason: 'permanent' };

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

  const allowSet = new Set();
  if (activeBox.customDomains) {
    for (const cd of activeBox.customDomains) {
      if (cd.mode === 'allow') allowSet.add(cleanDomain(cd.domain));
      else if (cd.mode === 'block' && matches(cd.domain)) return { blocked: true, reason: 'custom' };
    }
  }

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
