// storage.js
// ── 전역 상태 ──
let currentView = 'day'; // 'day' | 'week'
let currentBoxes = [];

function getBoxKey() {
  return currentView === 'week' ? 'weeklyBoxes' : 'dailyBoxes';
}

// ── 박스 색상 (기본 프리셋 + 커스텀) ──
// box.color가 없는 기존 저장 데이터(마이그레이션 이전)는 BOX_COLOR_DEFAULT로 대체해 렌더링한다.
const BOX_COLOR_DEFAULT = 'var(--tomato)';
const BOX_COLOR_PRESETS = [
  BOX_COLOR_DEFAULT,
  '#ff8c00',
  'var(--amber)',
  'var(--green)',
  'var(--blue)',
  '#7c5cff',
  '#ff5c9e',
];

function resolveBoxColor(box) {
  return (box && box.color) || BOX_COLOR_DEFAULT;
}

// CSS 변수(var(--x))든 리터럴(#rrggbb)이든 상관없이 실제 렌더링되는 RGB를 얻어와
// 밝기(YIQ)를 계산한다 — 밝은 박스 색 위에 흰 텍스트/아이콘이 묻히는 걸 방지하기 위함.
function isLightBoxColor(colorValue) {
  if (!colorValue) return false;
  const probe = document.createElement('div');
  probe.style.color = colorValue;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const m = rgb.match(/\d+/g);
  if (!m) return false;
  const [r, g, b] = m.map(Number);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150;
}

// ── 전체 설정 로드 (렌더링 진입점) ──
function loadSettings(onDone) {
  const boxKey = getBoxKey();
  TBBStorage.get(['generalList', 'permanentList', boxKey], function(result) {
    renderList('generalList',   result.generalList   || [], 'generalList',   'generalWarn');
    renderList('permanentList', result.permanentList || [], 'permanentList', 'permanentWarn');
    renderBoxes(result[boxKey] || []);
    if (onDone) onDone();
  });
}

// ── 도메인 리스트 추가 ──
function addToList(inputId, storageKey, ulId, warnId) {
  const input = document.getElementById(inputId);
  const domain = cleanDomain(input.value.trim());
  if (!domain) return;
  TBBStorage.get([storageKey], function(result) {
    const list = result[storageKey] || [];
    const existingIndex = list.indexOf(domain);
    if (existingIndex !== -1) {
      const ul = document.getElementById(ulId);
      if (ul && ul.children[existingIndex]) scrollAndBounce(ul, ul.children[existingIndex], warnId, T('alreadySameAddress'));
      return;
    }
    list.push(domain);
    TBBStorage.set({ [storageKey]: list }, () => {
      input.value = '';
      hideWarn(warnId);
      loadSettings(() => animateNewListItem(document.getElementById(ulId)));
    });
  });
}

// ── 도메인 리스트 항목 삭제 ──
function deleteItem(storageKey, index) {
  TBBStorage.get([storageKey], function(result) {
    const list = result[storageKey] || [];
    list.splice(index, 1);
    TBBStorage.set({ [storageKey]: list }, loadSettings);
  });
}

// ── 박스 삭제 ──
function deleteBox(index) {
  const boxKey = getBoxKey();
  TBBStorage.get([boxKey], function(result) {
    const boxes = result[boxKey] || [];
    boxes.splice(index, 1);
    TBBStorage.set({ [boxKey]: boxes }, () => {
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
  TBBStorage.get([boxKey], function(result) {
    result[boxKey][boxIndex].customDomains.splice(cdIndex, 1);
    TBBStorage.set({ [boxKey]: result[boxKey] }, () => {
      if (onDone) onDone(result[boxKey]); else loadSettings();
    });
  });
}

// ── 리스트 전체 초기화 (모든 항목이 한 점으로 뭉치며 소멸한 뒤 실제로 지운다) ──
function clearAll(storageKey, confirmMsg, inputIdsToClear, options) {
  const skipConfirm = options?.skipConfirm || false;
  if (!skipConfirm && !confirm(confirmMsg)) return;

  const doClear = () => {
    TBBStorage.set({ [storageKey]: [] }, () => {
      if (inputIdsToClear) inputIdsToClear.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      if (storageKey === 'dailyBoxes' || storageKey === 'weeklyBoxes') {
        if (_editingBoxIndex !== null) exitBoxEditMode(); else { stagingCustomDomains = []; renderStagingList(); }
      }
      loadSettings();
    });
  };

  let targets = [];
  if (storageKey === 'generalList' || storageKey === 'permanentList') {
    targets = Array.from(document.querySelectorAll(`#${storageKey} .custom-domain-item`));
  } else if (storageKey === 'dailyBoxes' || storageKey === 'weeklyBoxes') {
    const wrap = document.getElementById('timetableWrap');
    if (wrap) targets = Array.from(wrap.querySelectorAll('.tbox, .donut-seg'));
  }

  if (targets.length > 0) animateConvergeAndVanish(targets, doClear);
  else doClear();
}
