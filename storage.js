// storage.js
// ── 전역 상태 ──
let currentView = 'day'; // 'day' | 'week'
let currentBoxes = [];

function getBoxKey() {
  return currentView === 'week' ? 'weeklyBoxes' : 'dailyBoxes';
}

// ── 전체 설정 로드 (렌더링 진입점) ──
function loadSettings() {
  const boxKey = getBoxKey();
  chrome.storage.local.get(['generalList', 'permanentList', boxKey], function(result) {
    renderList('generalList',   result.generalList   || [], 'generalList',   'generalWarn');
    renderList('permanentList', result.permanentList || [], 'permanentList', 'permanentWarn');
    renderBoxes(result[boxKey] || []);
  });
}

// ── 도메인 리스트 추가 ──
function addToList(inputId, storageKey, ulId, warnId) {
  const input = document.getElementById(inputId);
  const domain = cleanDomain(input.value.trim());
  if (!domain) return;
  chrome.storage.local.get([storageKey], function(result) {
    const list = result[storageKey] || [];
    const existingIndex = list.indexOf(domain);
    if (existingIndex !== -1) {
      const ul = document.getElementById(ulId);
      if (ul && ul.children[existingIndex]) triggerBounceAndWarn(ul.children[existingIndex], warnId, '같은 주소가 이미 있습니다.');
      return;
    }
    list.push(domain);
    chrome.storage.local.set({ [storageKey]: list }, () => {
      input.value = '';
      hideWarn(warnId);
      loadSettings();
    });
  });
}

// ── 도메인 리스트 항목 삭제 ──
function deleteItem(storageKey, index) {
  chrome.storage.local.get([storageKey], function(result) {
    const list = result[storageKey] || [];
    list.splice(index, 1);
    chrome.storage.local.set({ [storageKey]: list }, loadSettings);
  });
}

// ── 박스 삭제 ──
function deleteBox(index) {
  const boxKey = getBoxKey();
  chrome.storage.local.get([boxKey], function(result) {
    const boxes = result[boxKey] || [];
    boxes.splice(index, 1);
    chrome.storage.local.set({ [boxKey]: boxes }, loadSettings);
  });
}

// ── 커스텀 도메인 삭제 ──
function deleteCustomDomain(boxIndex, cdIndex, onDone) {
  const boxKey = getBoxKey();
  chrome.storage.local.get([boxKey], function(result) {
    result[boxKey][boxIndex].customDomains.splice(cdIndex, 1);
    chrome.storage.local.set({ [boxKey]: result[boxKey] }, () => {
      if (onDone) onDone(result[boxKey]); else loadSettings();
    });
  });
}

// ── 커스텀 도메인 모드 변경 ──
function updateCustomMode(boxIndex, cdIndex, newMode, onDone) {
  const boxKey = getBoxKey();
  chrome.storage.local.get([boxKey], function(result) {
    result[boxKey][boxIndex].customDomains[cdIndex].mode = newMode;
    chrome.storage.local.set({ [boxKey]: result[boxKey] }, () => {
      if (onDone) onDone(result[boxKey]); else loadSettings();
    });
  });
}

// ── 박스 커스텀 도메인 일괄 모드 변경 ──
function setBoxMasterMode(boxIndex, newMode, onDone) {
  const boxKey = getBoxKey();
  chrome.storage.local.get([boxKey], function(result) {
    result[boxKey][boxIndex].customDomains.forEach(cd => cd.mode = newMode);
    chrome.storage.local.set({ [boxKey]: result[boxKey] }, () => {
      if (onDone) onDone(result[boxKey]); else loadSettings();
    });
  });
}

// ── 리스트 전체 초기화 ──
function clearAll(storageKey, confirmMsg, inputIdsToClear) {
  if (!confirm(confirmMsg)) return;
  chrome.storage.local.set({ [storageKey]: [] }, () => {
    if (inputIdsToClear) inputIdsToClear.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    if (storageKey === 'dailyBoxes' || storageKey === 'weeklyBoxes') { stagingCustomDomains = []; renderStagingList(); }
    loadSettings();
  });
}
