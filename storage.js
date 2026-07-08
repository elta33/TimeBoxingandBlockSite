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
      if (ul && ul.children[existingIndex]) scrollAndBounce(ul, ul.children[existingIndex], warnId, T('alreadySameAddress'));
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
    chrome.storage.local.set({ [boxKey]: boxes }, () => {
      // 수정 중인 박스가 삭제됐거나, 그보다 앞 인덱스가 삭제돼 인덱스가 밀렸으면 수정 모드 종료
      if (_editingBoxIndex !== null && index <= _editingBoxIndex) exitBoxEditMode();
      // 요일 도넛 팝업이 열려있는 상태에서 그 안의 삭제 버튼으로 지웠다면, 팝업도 즉시 재렌더링
      currentBoxes = boxes;
      const popupOverlay = document.getElementById('dayPopupOverlay');
      const popupWrap    = document.getElementById('dayPopupWrap');
      if (popupOverlay && !popupOverlay.classList.contains('hidden') && popupWrap && popupWrap._refreshDonut) {
        popupWrap._refreshDonut();
      }
      loadSettings();
    });
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

// ── 리스트 전체 초기화 ──
function clearAll(storageKey, confirmMsg, inputIdsToClear, options) {
  const skipConfirm = options?.skipConfirm || false;
  if (!skipConfirm && !confirm(confirmMsg)) return;
  chrome.storage.local.set({ [storageKey]: [] }, () => {
    if (inputIdsToClear) inputIdsToClear.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    if (storageKey === 'dailyBoxes' || storageKey === 'weeklyBoxes') {
      if (_editingBoxIndex !== null) exitBoxEditMode(); else { stagingCustomDomains = []; renderStagingList(); }
    }
    loadSettings();
  });
}
