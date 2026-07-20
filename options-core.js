// options-core.js
// PIN 잠금 + 도메인 리스트 유틸 + 타임박스 스케줄러(하루/주간 뷰, 박스 CRUD) + 내보내기/불러오기
// 로드 순서: storage.js → i18n.js → render-day.js → options-core.js → options-stats.js → options-init.js → pomodoro-shared.js → options-pomodoro.js

let stagingCustomDomains = [];
let dailyScheduleEnabled = true;
let weekViewClockInterval = null;
let _editingBoxIndex = null; // 수정 중인 박스 인덱스 (null이면 새 박스 추가 모드)

// ── 박스 색상 선택기 (메인 폼 + 팝업 폼 공용) ──
// 프리셋 스와치와 커스텀(<input type="color">) 스와치를 하나의 컨트롤러로 묶어
// get/set/reset만 노출한다. 팝업 폼은 열릴 때마다 이 함수를 다시 호출해 이전
// 리스너가 남아있지 않은 새 DOM 위에 다시 바인딩한다(다른 팝업 필드들과 동일 패턴).
// onChange는 사용자가 실제로 스와치를 클릭하거나 커스텀 색을 고를 때만 호출된다
// (set/reset으로 인한 프로그래매틱 변경은 제외) — 수정 모드에서 이 콜백으로
// 타임테이블/도넛의 해당 박스를 저장 전 미리보기로 즉시 갱신한다.
function setupBoxColorPicker(containerId, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  const swatches = Array.from(container.querySelectorAll('.box-color-swatch[data-color]'));
  const customBtn = container.querySelector('.box-color-custom');
  const customInput = container.querySelector('.box-color-custom-input');
  let current = BOX_COLOR_DEFAULT;

  function markSelected(el) {
    swatches.forEach(s => s.classList.remove('selected'));
    if (customBtn) customBtn.classList.remove('selected');
    if (el) el.classList.add('selected');
  }

  swatches.forEach(sw => {
    sw.addEventListener('click', () => {
      current = sw.dataset.color;
      markSelected(sw);
      if (onChange) onChange(current);
    });
  });

  if (customInput) {
    customInput.addEventListener('input', () => {
      current = customInput.value;
      if (customBtn) customBtn.style.background = current;
      markSelected(customBtn);
      if (onChange) onChange(current);
    });
  }

  markSelected(swatches[0]); // 기본값(첫 프리셋 = 토마토)으로 시작

  return {
    get: () => current,
    set(color) {
      current = color || BOX_COLOR_DEFAULT;
      const match = swatches.find(s => s.dataset.color === current);
      if (match) {
        if (customBtn) customBtn.style.background = '';
        markSelected(match);
      } else {
        if (customBtn) customBtn.style.background = current;
        if (customInput && /^#/.test(current)) customInput.value = current;
        markSelected(customBtn);
      }
    },
    reset() {
      current = BOX_COLOR_DEFAULT;
      if (customBtn) customBtn.style.background = '';
      markSelected(swatches[0]);
    },
  };
}

// 수정 중인 박스의 색이 바뀌면 저장 전이라도 실제 타임테이블/도넛에 바로 반영한다.
function _liveUpdateBoxColor(boxIndex, color, dayViewWrap) {
  if (boxIndex === null || boxIndex === undefined) return;
  document.querySelectorAll(`.tbox[data-box-index="${boxIndex}"]`).forEach(card => {
    card.style.background = color;
    card.style.setProperty('--box-glow', color);
    card.classList.toggle('tbox-dark-text', isLightBoxColor(color));
  });
  if (dayViewWrap && dayViewWrap._updateBoxColor) dayViewWrap._updateBoxColor(boxIndex, color);
}

const boxColorPickerCtl = setupBoxColorPicker('boxColorPicker', (color) => {
  _liveUpdateBoxColor(_editingBoxIndex, color, document.getElementById('timetableWrap'));
});

// ── PIN 잠금 ──
let _pinEnabled = false;
let _pendingPinAction = null;

async function _hashPin(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + pin));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _loadPinStatus() {
  chrome.storage.local.get(['lockPin'], result => {
    const lp = result.lockPin;
    _pinEnabled = !!(lp?.enabled && lp?.hash);
    _updatePinUI();
    loadSettings(); // PIN 상태 확정 후 박스 카드 재렌더
  });
}

function _updatePinUI() {
  const badge   = document.getElementById('pinStatusBadge');
  const setup   = document.getElementById('pinSetupSection');
  const change  = document.getElementById('pinChangeSection');
  if (!badge) return;
  if (_pinEnabled) {
    badge.className = 'pin-status-badge pin-active';
    badge.textContent = T('pinStatusActive');
    if (setup)  setup.style.display  = 'none';
    if (change) change.style.display = 'block';
  } else {
    badge.className = 'pin-status-badge pin-inactive';
    badge.textContent = T('pinStatusInactive');
    if (setup)  setup.style.display  = 'block';
    if (change) change.style.display = 'none';
  }
  _applyScheduleToggleLockVisual();
  _applyStaticButtonLockVisuals();
}

function _applyScheduleToggleLockVisual() {
  const icon = document.getElementById('schedLockIcon');
  if (icon) icon.style.display = _pinEnabled ? 'inline' : 'none';
}

function _applyStaticButtonLockVisuals() {
  const clearBoxesBtn = document.getElementById('clearBoxesBtn');
  if (clearBoxesBtn) {
    if (_pinEnabled) {
      clearBoxesBtn.classList.add('pin-locked');
      clearBoxesBtn.textContent = '🔒 ' + T('clearAll');
    } else {
      clearBoxesBtn.classList.remove('pin-locked');
      clearBoxesBtn.textContent = T('clearAll');
    }
  }
}

function _openPinModal(actionLabel, onSuccess) {
  const overlay   = document.getElementById('pinModalOverlay');
  const input     = document.getElementById('pinModalInput');
  const confirmBtn = document.getElementById('pinModalConfirmBtn');
  const errorEl   = document.getElementById('pinModalError');
  if (!overlay) return;
  _pendingPinAction = onSuccess;
  if (confirmBtn) confirmBtn.textContent = actionLabel;
  if (input)    { input.value = ''; input.classList.remove('pin-shake'); }
  if (errorEl)  errorEl.textContent = '';
  overlay.style.display = 'flex';
  setTimeout(() => input?.focus(), 60);
}

function _closePinModal() {
  const overlay = document.getElementById('pinModalOverlay');
  if (overlay) overlay.style.display = 'none';
  const input = document.getElementById('pinModalInput');
  if (input) input.value = '';
  const errorEl = document.getElementById('pinModalError');
  if (errorEl) errorEl.textContent = '';
  _pendingPinAction = null;
}

async function _attemptPinUnlock() {
  const input   = document.getElementById('pinModalInput');
  const errorEl = document.getElementById('pinModalError');
  const pin = input?.value || '';
  if (!pin) return;
  chrome.storage.local.get(['lockPin'], async result => {
    const lp = result.lockPin;
    if (!lp?.hash || !lp?.salt) return;
    const hash = await _hashPin(pin, lp.salt);
    if (hash === lp.hash) {
      const action = _pendingPinAction;
      _closePinModal();
      if (action) action();
    } else {
      if (errorEl) errorEl.textContent = T('pinErrWrong');
      if (input) {
        input.classList.remove('pin-shake');
        void input.offsetWidth;
        input.classList.add('pin-shake');
        input.value = '';
        setTimeout(() => { input.classList.remove('pin-shake'); input.focus(); }, 360);
      }
    }
  });
}

// ── 도메인 정규화 (유니코드 IDN 도메인은 punycode로 변환 — background.js cleanDomain과 동일 정책) ──
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

// ── 경고 표시 / 숨김 ──
function triggerBounceAndWarn(element, warnId, msg) {
  const warnEl = document.getElementById(warnId);
  if (warnEl) { warnEl.textContent = msg; warnEl.style.display = 'inline-block'; }
  if (element) {
    element.classList.remove('bounce');
    void element.offsetWidth;
    element.classList.add('bounce');
    setTimeout(() => element.classList.remove('bounce'), 600);
  }
}

function hideWarn(warnId) {
  const warnEl = document.getElementById(warnId);
  if (warnEl) warnEl.style.display = 'none';
}

// ── 공통 시간 계산 ──
const TOTAL_MINS = 24 * 60;
function timeToMins(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// ── 공통: 쓰레기통 삭제 아이콘 (도메인 리스트 / 포모도로 프리셋 / 타임박스
// 주간뷰 박스 삭제 버튼이 전부 이 아이콘을 공유) ──
const TRASH_ICON_SVG = '<svg viewBox="0 0 24 24" width="29" height="29" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
function _makeTrashButton(title, onClick, extraClass) {
  const btn = document.createElement('button');
  btn.className = 'icon-trash-btn' + (extraClass ? ' ' + extraClass : '');
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = TRASH_ICON_SVG;
  btn.onclick = onClick;
  return btn;
}

// ── 공통: 차단 관리 탭 도메인 리스트 렌더링 ──
function renderList(elementId, items, storageKey, warnId) {
  const ul = document.getElementById(elementId);
  ul.innerHTML = '';
  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'custom-domain-item';
    const span = document.createElement('span');
    const displayItem = domainToDisplay(item);
    span.textContent = displayItem; span.title = displayItem; span.className = 'domain-text';
    li.appendChild(span);
    const delBtn = _makeTrashButton(T('delete'), () => animateShrinkAndRemove(li, () => deleteItem(storageKey, index)));
    li.appendChild(delBtn);
    ul.appendChild(li);
  });
  _applyDomainFilter(elementId);
}

// ── 공통: 도메인 리스트 검색 ──
// 리스트 <ul> id → 그 위에 놓인 검색 입력 id. 각 리스트의 render 함수가 다시 그릴 때마다
// 끝에서 _applyDomainFilter를 호출해, 추가/삭제 후 재렌더링돼도 검색어 필터가 유지되게 한다.
const DOMAIN_SEARCH_MAP = {
  permanentList: 'permanentSearchInput',
  generalList: 'generalSearchInput',
  stagingCustomList: 'stagingSearchInput',
  popup_stagingCustomList: 'popup_stagingSearchInput',
  pomoList: 'pomoSearchInput',
  advDomainList: 'advDomainSearchInput'
};

function _applyDomainFilter(listId) {
  const list = document.getElementById(listId);
  if (!list) return;
  const input = document.getElementById(DOMAIN_SEARCH_MAP[listId]);
  const q = (input?.value || '').trim().toLowerCase();
  Array.from(list.children).forEach(li => {
    const text = (li.querySelector('.domain-text')?.textContent || '').toLowerCase();
    li.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
}

function _initDomainSearchInputs() {
  Object.entries(DOMAIN_SEARCH_MAP).forEach(([listId, searchInputId]) => {
    document.getElementById(searchInputId)?.addEventListener('input', () => _applyDomainFilter(listId));
  });
}

// ── 공통: 도메인 추가 입력의 기본 도메인 드롭다운(인기 검색어 스타일) ──
// 상시/일반/포모도로 차단 "추가" 입력에 커서가 가면(포커스) 비어있을 때 기본 도메인을
// 보여주고, 클릭하면 그 도메인이 바로 등록된다. 입력 중이면(글자가 들어오면) 드롭다운을 치운다.
const DOMAIN_SUGGEST_DEFAULTS = ['youtube.com', 'youtube.com/shorts', 'instagram.com', 'x.com'];
const DOMAIN_SUGGEST_MAP = [
  { inputId: 'permanentDomainInput', addBtnId: 'addPermanentBtn', dropdownId: 'permanentDomainSuggest' },
  { inputId: 'generalDomainInput',   addBtnId: 'addGeneralBtn',   dropdownId: 'generalDomainSuggest' },
  { inputId: 'pomoDomainInput',      addBtnId: 'addPomoBtn',      dropdownId: 'pomoDomainSuggest' }
];

function _initDomainSuggestions() {
  DOMAIN_SUGGEST_MAP.forEach(({ inputId, addBtnId, dropdownId }) => {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;

    DOMAIN_SUGGEST_DEFAULTS.forEach(domain => {
      const item = document.createElement('div');
      item.className = 'domain-suggest-item';
      item.textContent = domain;
      // click이 아니라 mousedown + preventDefault: click을 쓰면 그 전에 input이 blur되어
      // 드롭다운이 먼저 닫혀버려 클릭이 씹힌다. mousedown에서 기본 동작(blur)을 막는다.
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = domain;
        dropdown.classList.remove('open');
        document.getElementById(addBtnId)?.click();
      });
      dropdown.appendChild(item);
    });

    input.addEventListener('focus', () => {
      if (!input.value.trim()) dropdown.classList.add('open');
    });
    input.addEventListener('input', () => dropdown.classList.remove('open'));
    input.addEventListener('blur', () => dropdown.classList.remove('open'));
  });
}

// ── 공통: 커스텀 도메인 아이템 UI 팩토리 ──
function createCustomDomainItemUI(domain, mode, idPrefix, elType, onDelete) {
  const item = document.createElement(elType);
  item.className = 'custom-domain-item';

  const domSpan = document.createElement('span');
  const displayDomain = domainToDisplay(domain);
  domSpan.textContent = displayDomain; domSpan.title = displayDomain; domSpan.className = 'domain-text';
  item.appendChild(domSpan);

  const controls = document.createElement('div');
  controls.className = 'custom-domain-controls';

  const modeBadge = document.createElement('span');
  modeBadge.className = 'mode-badge mode-badge-allow';
  modeBadge.textContent = T('allow');
  controls.appendChild(modeBadge);

  const delBtn = _makeTrashButton(T('delete'), (e) => { e.stopPropagation(); animateShrinkAndRemove(item, onDelete); });
  controls.appendChild(delBtn);

  item.appendChild(controls);
  return item;
}

// ── 뷰 탭 초기화 ──
function initViewTabs(onViewChange) {
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      const dayRow = document.getElementById('daySelectRow');
      if (dayRow) dayRow.style.display = currentView === 'week' ? 'block' : 'none';
      // 뷰 전환 시 주간 상세 패널 닫기
      const panel = document.getElementById('weekDetailPanel');
      if (panel) { panel.style.display = 'none'; panel.dataset.openIndex = ''; }
      document.querySelectorAll('.tbox.selected').forEach(el => el.classList.remove('selected'));
      // 뷰 전환 시 수정 모드 종료 (day/week 폼 필드 구성이 달라짐)
      if (_editingBoxIndex !== null) exitBoxEditMode();
      if (onViewChange) onViewChange();
      loadSettings();
    });
  });
}

// ── 주간 뷰 전용 상수 ──
const PX_PER_MIN = 100 / 60; // 1시간 = 80px
const TOTAL_HEIGHT = TOTAL_MINS * PX_PER_MIN;
function minsToPx(mins) { return mins * PX_PER_MIN; }

// ── 이즈인-아웃 스무스 스크롤 ──
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function smoothScrollTo(el, targetTop, duration = 650, onDone) {
  const startTop  = el.scrollTop;
  const distance  = targetTop - startTop;
  if (Math.abs(distance) < 1) { if (onDone) onDone(); return; }
  const startTime = performance.now();
  function step(now) {
    const t = Math.min(1, (now - startTime) / duration);
    el.scrollTop = startTop + distance * easeInOutCubic(t);
    if (t < 1) requestAnimationFrame(step);
    else if (onDone) onDone();
  }
  requestAnimationFrame(step);
}

// ── 도메인 리스트 중복 항목: 스크롤 포커싱 후 바운스 ──
function scrollAndBounce(ul, el, warnId, msg) {
  const warnEl = document.getElementById(warnId);
  if (warnEl) { warnEl.textContent = msg; warnEl.style.display = 'inline-block'; }
  if (!el) return;
  const playBounce = () => {
    if (el._bounceTimeout) clearTimeout(el._bounceTimeout);
    el.classList.remove('bounce');
    void el.offsetWidth;
    el.classList.add('bounce');
    el._bounceTimeout = setTimeout(() => {
      el.classList.remove('bounce');
      el._bounceTimeout = null;
    }, 600);
  };
  if (ul) {
    const elRect = el.getBoundingClientRect();
    const ulRect = ul.getBoundingClientRect();
    const elTopInScroll = ul.scrollTop + (elRect.top - ulRect.top);
    const target = Math.max(0, elTopInScroll - (ul.clientHeight - el.offsetHeight) / 2);
    smoothScrollTo(ul, target, 650, playBounce);
  } else {
    playBounce();
  }
}

// ── 도메인 리스트 추가: 스크롤 포커싱 후 중심 확장 애니메이션 ──
// 새 항목은 항상 리스트 맨 끝에 붙는다는 전제. 리스트가 스크롤 가능한 상태면 맨 밑까지
// 이즈인아웃으로 부드럽게 스크롤한 뒤, 끝나면 새 항목이 중심에서부터 확장되며 나타나는
// 연출을 재생한다. 스크롤할 필요가 없으면(다 보이는 경우) 확장 애니메이션만 바로 재생한다.
function animateNewListItem(ul) {
  if (!ul) return;
  const newEl = ul.lastElementChild;
  const playGrow = () => {
    if (!newEl) return;
    newEl.classList.remove('domain-item-grow');
    void newEl.offsetWidth;
    newEl.classList.add('domain-item-grow');
  };
  if (ul.scrollHeight - ul.clientHeight > 1) {
    smoothScrollTo(ul, ul.scrollHeight - ul.clientHeight, 420, playGrow);
  } else {
    playGrow();
  }
}

// ── 삭제: 축소되며 사라지는 애니메이션 ──
// 요소(들)에 축소+페이드 애니메이션을 재생한 뒤 onDone을 호출한다. 실제 storage 삭제는
// onDone 안에서 일어나므로, 화면에서 사라지는 연출이 끝난 뒤에야 데이터가 지워진다.
// 도메인 리스트 항목(li), 타임박스 카드(.tbox)는 기본 className(domain-item-remove, border-box
// 기준 자기 중심 축소)을 쓰고, 도넛 세그먼트(svg path/circle)는 fill-box 기준으로 정확히
// 자기 중심으로 축소하는 'donut-seg-shrink'를 넘겨서 쓴다.
function animateShrinkAndRemove(elements, onDone, duration = 200, className = 'domain-item-remove') {
  const els = (Array.isArray(elements) ? elements : [elements]).filter(Boolean);
  if (els.length === 0) { if (onDone) onDone(); return; }
  els.forEach(el => {
    el.classList.remove(className);
    void el.getBoundingClientRect();
    el.classList.add(className);
  });
  setTimeout(() => { if (onDone) onDone(); }, duration);
}

// ── 전체 초기화: 모든 항목이 한 점(평균 중심)으로 뭉치며 소멸하는 애니메이션 ──
function animateConvergeAndVanish(elements, onDone, duration = 380) {
  const els = (elements || []).filter(Boolean);
  if (els.length === 0) { if (onDone) onDone(); return; }
  const rects = els.map(el => el.getBoundingClientRect());
  const cx = rects.reduce((s, r) => s + r.left + r.width / 2, 0) / rects.length;
  const cy = rects.reduce((s, r) => s + r.top + r.height / 2, 0) / rects.length;
  els.forEach((el, i) => {
    const r = rects[i];
    const dx = cx - (r.left + r.width / 2);
    const dy = cy - (r.top + r.height / 2);
    el.classList.add('clear-converge');
    void el.offsetWidth;
    el.style.transform = `translate(${dx}px, ${dy}px) scale(0)`;
    el.style.opacity = '0';
  });
  setTimeout(() => { if (onDone) onDone(); }, duration);
}

// ── 박스 추가(일주일 뷰): 자기 위치 중앙에서부터 확장되는 애니메이션 ──
// 도메인 리스트와 같은 domain-item-grow를 재사용 — .tbox는 일반 HTML 요소라
// transform-origin의 기준 박스(border-box)가 자기 자신이라 그대로 중심 확장으로 동작한다.
function animateGrowElements(elements, className = 'domain-item-grow') {
  const els = (Array.isArray(elements) ? elements : [elements]).filter(Boolean);
  els.forEach(el => {
    el.classList.remove(className);
    void el.getBoundingClientRect();
    el.classList.add(className);
  });
}

// ── 요일 배열이 순서 무관하게 같은 집합인지 비교 (일주일 뷰 박스 편집 시 리사이즈
// 애니메이션을 적용해도 되는 케이스인지 판단하는 데 사용 — 요일이 바뀌면 렌더되는
// 컬럼(조각) 수 자체가 달라지므로 모핑 대신 즉시 최종 모습으로 넘어간다) ──
function _sameDaySet(a, b) {
  const sa = [...(a || [])].sort().join(',');
  const sb = [...(b || [])].sort().join(',');
  return sa === sb;
}

// ── 박스 편집(일주일 뷰): 시간이 바뀐 만큼 카드 높이/위치가 부드럽게 늘어나거나 줄어드는 애니메이션 ──
// 이미 최종 위치/높이로 그려진 카드를 잠깐 이전 모양으로 되돌린 뒤 새 모양까지 트랜지션한다.
// 자정을 넘기거나(2조각) 24시간 박스인 경우는 조각 구조가 달라질 수 있어 모핑하지 않는다.
function animateWeekResize(wrapEl, boxIndex, oldStartTime, oldEndTime, newStartTime, newEndTime, duration = 300) {
  const els = [...(wrapEl?.querySelectorAll(`.tbox[data-box-index="${boxIndex}"]`) || [])];
  if (els.length === 0) return;
  const os = timeToMins(oldStartTime), oe = timeToMins(oldEndTime);
  const ns = timeToMins(newStartTime), ne = timeToMins(newEndTime);
  if (oe <= os || ne <= ns) return; // 자정 넘김/24시간 박스는 스킵
  const oldTop = minsToPx(os), oldHeight = Math.max(minsToPx(oe - os) - 3, 20);
  const newTop = minsToPx(ns), newHeight = Math.max(minsToPx(ne - ns) - 3, 20);
  if (oldTop === newTop && oldHeight === newHeight) return;
  els.forEach(el => {
    el.style.transition = 'none';
    el.style.top = `${oldTop}px`;
    el.style.height = `${oldHeight}px`;
    void el.getBoundingClientRect();
    el.style.transition = `top ${duration}ms ease-in-out, height ${duration}ms ease-in-out`;
    el.style.top = `${newTop}px`;
    el.style.height = `${newHeight}px`;
    el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
  });
}

// ── 스크롤 컨테이너 안의 특정 요소를 화면 중앙으로 이즈인아웃 스크롤 포커싱 ──
function scrollElementToCenter(scrollContainer, el, duration = 500) {
  if (!scrollContainer || !el) return;
  const elRect = el.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  const elTopInScroll = scrollContainer.scrollTop + (elRect.top - containerRect.top);
  const target = Math.max(0, elTopInScroll - (scrollContainer.clientHeight - el.offsetHeight) / 2);
  smoothScrollTo(scrollContainer, target, duration);
}

// ── 겹침 강조: 링 형태로 번지는 플래시 연출 ──
function flashElements(els, className = 'focus-flash', duration = 1400) {
  els.forEach(el => {
    if (el._flashTimeout) clearTimeout(el._flashTimeout);
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    el._flashTimeout = setTimeout(() => {
      el.classList.remove(className);
      el._flashTimeout = null;
    }, duration);
  });
}

// ── 주간 뷰: 시간축 레이블 + 구분선 생성 ──
function buildTimeAxis(labelCol, bodyEl, slotCount) {
  labelCol.style.height = `${TOTAL_HEIGHT}px`;
  bodyEl.style.height   = `${TOTAL_HEIGHT}px`;

  for (let slot = 0; slot <= slotCount; slot++) {
    const mins = slot * 60;
    const px   = minsToPx(mins);
    const isMidnight = mins === 0 || mins === TOTAL_MINS;

    const lbl = document.createElement('div');
    lbl.className   = 'time-label on-hour' + (isMidnight ? ' midnight' : '');
    lbl.style.top   = `${px}px`;
    lbl.style.transform = slot === 0 ? 'translateY(2px)' : 'translateY(-50%)';
    lbl.textContent = `${String(Math.floor(mins / 60) % 24).padStart(2,'0')}:00`;
    labelCol.appendChild(lbl);

    if (slot < slotCount) {
      const line = document.createElement('div');
      line.className = 'hour-line on-hour';
      line.style.top = `${px}px`;
      bodyEl.appendChild(line);
    }
  }
}

// ── 주간 뷰: 박스 카드 DOM 생성 (자정 넘기는 박스는 2개로 분할) ──
function buildBoxCard(box, boxIndex, isWeek) {
  const startM = timeToMins(box.startTime);
  const rawEndM = timeToMins(box.endTime);
  const wraps = (rawEndM <= startM && !(rawEndM === 0 && startM === 0));
  // 24시간 박스 (startM === rawEndM)
  const isFullDay = (rawEndM === startM);

  function makeCard(topMins, heightMins, isWrapTop) {
    const card = document.createElement('div');
    card.className = 'tbox';
    card.dataset.boxIndex = boxIndex;
    card.style.top    = `${minsToPx(topMins)}px`;
    card.style.height = `${Math.max(minsToPx(heightMins) - 3, 20)}px`;
    const boxColor = resolveBoxColor(box);
    card.style.background = boxColor;
    card.style.setProperty('--box-glow', boxColor);
    if (isLightBoxColor(boxColor)) card.classList.add('tbox-dark-text');

    const nameEl = document.createElement('div');
    nameEl.className = 'tbox-name';
    nameEl.textContent = isWrapTop ? `↩ ${box.name}` : box.name;
    card.appendChild(nameEl);

    if (!isWeek || heightMins >= 45) {
      const timeEl = document.createElement('div');
      timeEl.className = 'tbox-time';
      timeEl.textContent = `${box.startTime}–${box.endTime}`;
      card.appendChild(timeEl);
    }

    if (box.customDomains && box.customDomains.length > 0 && heightMins >= 30) {
      const summaryEl = document.createElement('div');
      summaryEl.className = 'tbox-custom-summary';
      const first = domainToDisplay(box.customDomains[0].domain);
      const rest  = box.customDomains.length - 1;
      if (rest > 0) {
        summaryEl.textContent = first;
        const restEl = document.createElement('div');
        restEl.className = 'tbox-custom-summary';
        restEl.textContent = T('moreExceptions', [String(rest)]);
        card.appendChild(summaryEl);
        card.appendChild(restEl);
      } else {
        summaryEl.textContent = T('exceptionLabel', [first]);
        card.appendChild(summaryEl);
      }
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'tbox-del' + (_pinEnabled ? ' tbox-del-locked' : '');
    if (_pinEnabled) {
      delBtn.textContent = '🔒';
    } else {
      delBtn.innerHTML = TRASH_ICON_SVG;
    }
    delBtn.title = T('deleteBoxTitle');
    delBtn.onclick = (e) => {
      e.stopPropagation();
      const doDelete = () => {
        const els = document.querySelectorAll(`.tbox[data-box-index="${boxIndex}"]`);
        animateShrinkAndRemove([...els], () => deleteBox(boxIndex));
      };
      if (_pinEnabled) {
        _openPinModal(T('delete'), doDelete);
      } else {
        doDelete();
      }
    };
    card.appendChild(delBtn);

    card.addEventListener('click', (e) => {
      if (e.target === delBtn) return;
      const panel = document.getElementById('weekDetailPanel');
      const wasOpenForThis = panel && panel.style.display === 'block' && panel.dataset.openIndex === String(boxIndex);
      document.querySelectorAll('.tbox.selected').forEach(el => el.classList.remove('selected'));
      if (wasOpenForThis) {
        panel.style.display = 'none';
        panel.dataset.openIndex = '';
        return;
      }
      document.querySelectorAll(`.tbox[data-box-index="${boxIndex}"]`).forEach(el => el.classList.add('selected'));
      renderWeekDetailPanel(box, boxIndex);
      // 선택한 박스가 스크롤 영역 중앙에 오도록 이즈인아웃 포커싱
      const scrollBody = card.closest('.week-scroll-body');
      if (scrollBody) scrollElementToCenter(scrollBody, card);
    });
    return card;
  }

  if (isFullDay) {
    // 24시간 박스: 컴럼 전체
    return [makeCard(0, TOTAL_MINS, false)];
  } else if (wraps) {
    // 자정 넘기는 박스: 두 조각
    const bottomH = TOTAL_MINS - startM;  // startM ~ 24:00
    const topH    = rawEndM;              // 00:00 ~ endTime
    return [makeCard(startM, bottomH, false), makeCard(0, topH, true)];
  } else {
    return [makeCard(startM, rawEndM - startM, false)];
  }
}

// ── 주간 뷰: 스케줄러 하단 커스텀 주소 패널 ──
function renderWeekDetailPanel(box, boxIndex) {
  const panel = document.getElementById('weekDetailPanel');
  if (!panel) return;

  panel.innerHTML = '';
  panel.dataset.openIndex = String(boxIndex);

  const refreshPanel = (updatedBoxes) => {
    currentBoxes = updatedBoxes;
    const updatedBox = updatedBoxes[boxIndex];
    if (updatedBox) renderWeekDetailPanel(updatedBox, boxIndex);
    else { panel.style.display = 'none'; panel.dataset.openIndex = ''; }
  };

  // 헤더
  const header = document.createElement('div');
  header.className = 'donut-detail-header';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'donut-detail-title';
  titleSpan.textContent = box.name;
  header.appendChild(titleSpan);

  const btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'display:flex;gap:8px;';

  const editBoxBtn = document.createElement('button');
  editBoxBtn.className = 'btn btn-sm' + (_pinEnabled ? ' pin-locked' : '');
  editBoxBtn.textContent = (_pinEnabled ? '🔒 ' : '') + T('donutEditBox');
  editBoxBtn.onclick = () => {
    if (_pinEnabled) {
      _openPinModal(T('donutEditBox'), () => enterBoxEditMode(box, boxIndex));
    } else {
      enterBoxEditMode(box, boxIndex);
    }
  };
  btnGroup.appendChild(editBoxBtn);

  const delBoxBtn = document.createElement('button');
  delBoxBtn.className = 'btn-danger btn-sm' + (_pinEnabled ? ' pin-locked' : '');
  delBoxBtn.textContent = (_pinEnabled ? '🔒 ' : '') + T('donutDeleteBox');
  delBoxBtn.onclick = () => {
    const doDelete = () => {
      const els = document.querySelectorAll(`.tbox[data-box-index="${boxIndex}"]`);
      animateShrinkAndRemove([...els], () => {
        deleteBox(boxIndex);
        panel.style.display = 'none';
        panel.dataset.openIndex = '';
      });
    };
    if (_pinEnabled) {
      _openPinModal(T('delete'), doDelete);
    } else {
      doDelete();
    }
  };
  btnGroup.appendChild(delBoxBtn);
  header.appendChild(btnGroup);
  panel.appendChild(header);

  // ── 주소 추가 팝업 (인라인 드롭다운) ──
  const wAddPopupWrap = document.createElement('div');
  wAddPopupWrap.style.cssText = 'position:relative;display:inline-block;';

  // position:fixed — #weekDetailPanel은 overflow:hidden(빈 상태 하단 모서리를
  // 둥글게 잘라내는 용도)이라, 팝업을 그 안에서 position:absolute로 띄우면
  // 패널 아래로 튀어나온 부분이 잘려 보인다. 뷰포트 기준으로 좌표를 직접
  // 계산해 띄우면(openWAddPopup 참고) 조상의 overflow와 무관하게 온전히 보인다.
  const wAddDomainPopup = document.createElement('div');
  wAddDomainPopup.style.cssText = [
    'display:none;position:fixed;z-index:200;',
    'background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:8px;',
    'box-shadow:0 4px 16px rgba(0,0,0,0.13);',
    'padding:10px 12px;min-width:260px;'
  ].join('');

  const wPopupInput = document.createElement('input');
  wPopupInput.type = 'text';
  wPopupInput.placeholder = T('placeholderGithub');
  wPopupInput.style.cssText = 'flex:1;padding:7px 10px;border:1px solid var(--panel-border);border-radius:6px;font-size:0.88rem;font-family:inherit;outline:none;min-width:0;';

  const wPopupConfirmBtn = document.createElement('button');
  wPopupConfirmBtn.className = 'btn btn-sm';
  wPopupConfirmBtn.textContent = T('add');
  wPopupConfirmBtn.style.cssText = 'margin-left:6px;padding:7px 12px;flex-shrink:0;';

  const wPopupRow = document.createElement('div');
  wPopupRow.style.cssText = 'display:flex;align-items:center;gap:0;';
  wPopupRow.appendChild(wPopupInput);
  wPopupRow.appendChild(wPopupConfirmBtn);

  const wPopupWarn = document.createElement('div');
  wPopupWarn.style.cssText = 'font-size:0.78rem;color:var(--tomato);margin-top:5px;display:none;font-weight:600;';
  wAddDomainPopup.appendChild(wPopupRow);
  wAddDomainPopup.appendChild(wPopupWarn);
  wAddPopupWrap.appendChild(wAddDomainPopup);

  let _wPopupOutsideHandler = null;
  function openWAddPopup() {
    const btnRect = wAddDomainInPanelBtn.getBoundingClientRect();
    wAddDomainPopup.style.top = (btnRect.bottom + 6) + 'px';
    wAddDomainPopup.style.left = btnRect.left + 'px';
    wAddDomainPopup.style.display = 'block';
    wPopupInput.value = ''; wPopupWarn.style.display = 'none';
    setTimeout(() => wPopupInput.focus(), 50);
    _wPopupOutsideHandler = (ev) => {
      if (!wAddPopupWrap.contains(ev.target)) {
        wAddDomainPopup.style.display = 'none';
        document.removeEventListener('mousedown', _wPopupOutsideHandler);
      }
    };
    document.addEventListener('mousedown', _wPopupOutsideHandler);
  }

  const wAddDomainInPanelBtn = document.createElement('button');
  wAddDomainInPanelBtn.className = 'btn-ghost btn-sm';
  wAddDomainInPanelBtn.textContent = T('addAddress');
  wAddDomainInPanelBtn.onclick = (e) => { e.stopPropagation(); openWAddPopup(); };
  wAddPopupWrap.insertBefore(wAddDomainInPanelBtn, wAddDomainPopup);

  function doWAddDomain() {
    const raw = wPopupInput.value.trim();
    const domain = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').trim();
    if (!domain) return;
    const mode = 'allow';
    const boxKey = getBoxKey();
    TBBStorage.get([boxKey], function(result) {
      const boxes = result[boxKey] || [];
      const targetBox = boxes[boxIndex];
      if (!targetBox) return;
      if (!targetBox.customDomains) targetBox.customDomains = [];
      if (targetBox.customDomains.some(cd => cd.domain === domain)) {
        wPopupWarn.textContent = T('alreadyRegisteredAddress');
        wPopupWarn.style.display = 'block';
        return;
      }
      targetBox.customDomains.push({ domain, mode });
      TBBStorage.set({ [boxKey]: boxes }, () => {
        wAddDomainPopup.style.display = 'none';
        if (_wPopupOutsideHandler) document.removeEventListener('mousedown', _wPopupOutsideHandler);
        refreshPanel(boxes);
        animateNewListItem(panel.querySelector('.donut-domain-list'));
      });
    });
  }

  wPopupConfirmBtn.onclick = doWAddDomain;
  wPopupInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doWAddDomain(); });

  if (box.customDomains && box.customDomains.length > 0) {
    const masterRow = document.createElement('div');
    masterRow.className = 'donut-master-row';
    masterRow.appendChild(wAddPopupWrap);
    panel.appendChild(masterRow);

    const list = document.createElement('ul');
    list.className = 'donut-domain-list';
    box.customDomains.forEach((cd, cdIndex) => {
      const li = createCustomDomainItemUI(
        cd.domain, cd.mode, `wd_b${boxIndex}_c${cdIndex}`, 'li',
        () => deleteCustomDomain(boxIndex, cdIndex, refreshPanel)
      );
      list.appendChild(li);
    });
    panel.appendChild(list);
  } else {
    const emptyMasterRow = document.createElement('div');
    emptyMasterRow.className = 'donut-master-row';
    emptyMasterRow.style.justifyContent = 'flex-start';
    emptyMasterRow.appendChild(wAddPopupWrap);
    panel.appendChild(emptyMasterRow);

    const empty = document.createElement('p');
    empty.className = 'detail-empty';
    empty.textContent = T('weekNoCustom');
    panel.appendChild(empty);
  }

  panel.style.display = 'block';
}

// ── 요일 도넛 팝업 ──
let _dayPopupClockInterval = null;

function openDayPopup(dow, dayLabel, allBoxes) {
  const overlay = document.getElementById('dayPopupOverlay');
  const wrap    = document.getElementById('dayPopupWrap');
  const title   = document.getElementById('dayPopupTitle');
  if (!overlay || !wrap) return;

  const internalDow = dow === 0 ? 6 : dow - 1;
  const DAY_FULL_KEYS = { 0: 'daySundayFull', 1: 'dayMondayFull', 2: 'dayTuesdayFull', 3: 'dayWednesdayFull', 4: 'dayThursdayFull', 5: 'dayFridayFull', 6: 'daySaturdayFull' };
  title.textContent = T('dayScheduleTitle', [T(DAY_FULL_KEYS[dow])]);

  if (_dayPopupClockInterval) { clearInterval(_dayPopupClockInterval); _dayPopupClockInterval = null; }

  // ── 도넛 렌더링 ──
  // 필터링 후에도 실제 storage(weeklyBoxes) 상의 인덱스를 잃지 않도록 _idx로 원본 위치를 함께 보관
  function getFilteredBoxes() {
    return currentBoxes
      .map((box, idx) => ({ ...box, _idx: idx }))
      .filter(box => {
        const d = box.days || [];
        return d.length === 0 || d.includes(internalDow);
      });
  }

  // ── 팝업 전용 박스 수정 모드 (하루 뷰 도넛과 동일한 기능을 팝업 자체 폼으로 이월) ──
  let _popupEditingBoxIndex = null;
  let popupColorPickerCtl = null;

  function enterPopupBoxEditMode(box, realIndex) {
    _popupEditingBoxIndex = realIndex;

    if (popupBoxName)   popupBoxName.value = box.name;
    if (popupStartTime) popupStartTime.value = box.startTime;
    if (popupEndTime)   popupEndTime.value = box.endTime;

    popupStagingDomains = (box.customDomains || []).map(cd => ({ ...cd }));
    renderPopupStagingList();
    if (popupColorPickerCtl) popupColorPickerCtl.set(box.color);

    const titleEl = document.getElementById('popupBoxFormTitle');
    if (titleEl) titleEl.textContent = T('donutEditBox');
    if (newPopupAddBoxBtn) newPopupAddBoxBtn.textContent = T('boxUpdate');
    const cancelBtn = document.getElementById('popup_cancelEditBoxBtn');
    if (cancelBtn) cancelBtn.style.display = 'block';

    const warnEl = document.getElementById('popup_boxWarn');
    if (warnEl) warnEl.style.display = 'none';
  }

  function exitPopupBoxEditMode() {
    _popupEditingBoxIndex = null;

    const titleEl = document.getElementById('popupBoxFormTitle');
    if (titleEl) titleEl.textContent = T('newBox');
    if (newPopupAddBoxBtn) newPopupAddBoxBtn.textContent = T('boxCreate');
    const cancelBtn = document.getElementById('popup_cancelEditBoxBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';

    if (popupBoxName)   popupBoxName.value = '';
    if (popupStartTime) popupStartTime.value = '';
    if (popupEndTime)   popupEndTime.value = '';
    popupStagingDomains = [];
    renderPopupStagingList();
    if (popupColorPickerCtl) popupColorPickerCtl.reset();
    const warnEl = document.getElementById('popup_boxWarn');
    if (warnEl) warnEl.style.display = 'none';
  }

  function refreshDonut() {
    wrap.innerHTML = '';
    renderDayView(getFilteredBoxes(), wrap, enterPopupBoxEditMode);
  }
  wrap._refreshDonut = refreshDonut; // storage.js의 deleteBox 등에서 팝업이 열려있을 때 재렌더링하기 위한 훅
  refreshDonut();

  // ── 팝업 전용 스테이징 ──
  let popupStagingDomains = [];

  function renderPopupStagingList() {
    const ul = document.getElementById('popup_stagingCustomList');
    if (!ul) return;
    ul.innerHTML = '';
    popupStagingDomains.forEach((cd, index) => {
      const li = createCustomDomainItemUI(
        cd.domain, cd.mode, `popup_stg_c${index}`, 'li',
        () => { popupStagingDomains.splice(index, 1); renderPopupStagingList(); }
      );
      ul.appendChild(li);
    });
    _applyDomainFilter('popup_stagingCustomList');
  }

  // 스테이징 입력 초기화
  const _oldPopupCustomInput = document.getElementById('popup_customDomainInput');
  if (_oldPopupCustomInput) _oldPopupCustomInput.parentNode.replaceChild(_oldPopupCustomInput.cloneNode(true), _oldPopupCustomInput);
  const popupCustomInput = document.getElementById('popup_customDomainInput');
  const popupBoxName    = document.getElementById('popup_boxName');
  const popupStartTime  = document.getElementById('popup_startTime');
  const popupEndTime    = document.getElementById('popup_endTime');
  if (popupCustomInput) popupCustomInput.value = '';
  if (popupBoxName)    popupBoxName.value = '';
  if (popupStartTime)  popupStartTime.value = '';
  if (popupEndTime)    popupEndTime.value = '';
  popupStagingDomains = [];
  renderPopupStagingList();
  // 색상 선택기도 팝업이 열릴 때마다 DOM을 새로 복제해(이전 리스너 제거) 다시 바인딩
  const _oldPopupColorPicker = document.getElementById('popup_boxColorPicker');
  if (_oldPopupColorPicker) {
    _oldPopupColorPicker.parentNode.replaceChild(_oldPopupColorPicker.cloneNode(true), _oldPopupColorPicker);
  }
  popupColorPickerCtl = setupBoxColorPicker('popup_boxColorPicker', (color) => {
    _liveUpdateBoxColor(_popupEditingBoxIndex, color, wrap);
  });
  // 이전에 팝업을 수정 모드로 둔 채 닫았을 수 있으므로 매번 새 박스 추가 모드로 초기화
  const _popupTitleEl = document.getElementById('popupBoxFormTitle');
  if (_popupTitleEl) _popupTitleEl.textContent = T('newBox');
  const _popupCancelBtn = document.getElementById('popup_cancelEditBoxBtn');
  if (_popupCancelBtn) _popupCancelBtn.style.display = 'none';

  // 입력 시 경고 숨김 (메인 폼과 동일 로직)
  [popupBoxName, popupStartTime, popupEndTime].forEach(el => {
    if (!el) return;
    el.addEventListener('input',  () => { const w = document.getElementById('popup_boxWarn'); if (w) w.style.display = 'none'; });
    el.addEventListener('change', () => { const w = document.getElementById('popup_boxWarn'); if (w) w.style.display = 'none'; });
  });
  if (popupCustomInput) {
    popupCustomInput.addEventListener('input', () => { const w = document.getElementById('popup_customWarn'); if (w) w.style.display = 'none'; });
  }

  // 스테이징 주소 추가
  const popupAddCustomBtn = document.getElementById('popup_addCustomStagingBtn');
  const newPopupAddCustomBtn = popupAddCustomBtn.cloneNode(true);
  popupAddCustomBtn.parentNode.replaceChild(newPopupAddCustomBtn, popupAddCustomBtn);
  if (popupCustomInput) {
    popupCustomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') newPopupAddCustomBtn.click(); });
  }

  newPopupAddCustomBtn.onclick = () => {
    const domain = cleanDomain((document.getElementById('popup_customDomainInput')?.value || '').trim());
    if (!domain) return;
    const existIdx = popupStagingDomains.findIndex(cd => cd.domain === domain);
    if (existIdx !== -1) {
      const ul = document.getElementById('popup_stagingCustomList');
      if (ul && ul.children[existIdx]) scrollAndBounce(ul, ul.children[existIdx], 'popup_customWarn', T('alreadySameAddress'));
      return;
    }
    popupStagingDomains.push({ domain, mode: 'allow' });
    document.getElementById('popup_customDomainInput').value = '';
    const warnEl = document.getElementById('popup_customWarn');
    if (warnEl) warnEl.style.display = 'none';
    renderPopupStagingList();
    animateNewListItem(document.getElementById('popup_stagingCustomList'));
  };

  // 박스 생성
  const popupAddBoxBtn = document.getElementById('popup_addBoxBtn');
  const newPopupAddBoxBtn = popupAddBoxBtn.cloneNode(true);
  newPopupAddBoxBtn.textContent = T('boxCreate'); // 이전 세션에서 수정 모드로 남아있던 텍스트 방지
  popupAddBoxBtn.parentNode.replaceChild(newPopupAddBoxBtn, popupAddBoxBtn);

  const popupCancelEditBtn = document.getElementById('popup_cancelEditBoxBtn');
  if (popupCancelEditBtn) {
    const newPopupCancelEditBtn = popupCancelEditBtn.cloneNode(true);
    popupCancelEditBtn.parentNode.replaceChild(newPopupCancelEditBtn, popupCancelEditBtn);
    newPopupCancelEditBtn.addEventListener('click', exitPopupBoxEditMode);
  }

  newPopupAddBoxBtn.addEventListener('click', () => {
    const name      = (document.getElementById('popup_boxName')?.value || '').trim();
    const startTime = document.getElementById('popup_startTime')?.value || null;
    const endTime   = document.getElementById('popup_endTime')?.value   || null;
    const warnEl    = document.getElementById('popup_boxWarn');

    if (!name || !startTime || !endTime) { alert(T('boxNameRequired')); return; }

    let newStartMin = timeToMins(startTime);
    let newEndMin   = timeToMins(endTime);
    if (newEndMin <= newStartMin) newEndMin += 24 * 60;

    const boxKey = 'weeklyBoxes';
    TBBStorage.get([boxKey], function(result) {
      const boxes = result[boxKey] || [];

      // 겨침 검사 (해당 요일만, 수정 중인 자기 자신은 제외)
      const overlapIndices = [];
      for (let i = 0; i < boxes.length; i++) {
        if (i === _popupEditingBoxIndex) continue;
        const b = boxes[i];
        const bDays = b.days || [];
        if (bDays.length > 0 && !bDays.includes(internalDow)) continue;
        let existStart = timeToMins(b.startTime);
        let existEnd   = timeToMins(b.endTime);
        if (existEnd <= existStart) existEnd += 24 * 60;
        let isOverlap = Math.max(newStartMin, existStart) < Math.min(newEndMin, existEnd);
        if (!isOverlap && newEndMin > 24 * 60) {
          const ss = existStart + 24 * 60, se = existEnd + 24 * 60;
          isOverlap = Math.max(newStartMin, ss) < Math.min(newEndMin, se);
        }
        if (isOverlap) overlapIndices.push(i);
      }

      if (overlapIndices.length > 0) {
        if (warnEl) { warnEl.textContent = T('timeOverlapWarn2'); warnEl.style.display = 'inline-block'; }
        const filtered = getFilteredBoxes();
        overlapIndices.forEach(i => {
          const filteredIdx = filtered.findIndex(b => b._idx === i);
          if (filteredIdx !== -1 && wrap._pulseBox) wrap._pulseBox(filteredIdx);
        });
        return;
      }

      const color = popupColorPickerCtl ? popupColorPickerCtl.get() : BOX_COLOR_DEFAULT;
      const wasEditing = _popupEditingBoxIndex !== null;
      const oldBox = wasEditing ? { ...boxes[_popupEditingBoxIndex] } : null;
      let savedBoxIndex;
      if (wasEditing) {
        boxes[_popupEditingBoxIndex] = { name, startTime, endTime, mode: 'block', days: [internalDow], customDomains: [...popupStagingDomains], color };
        savedBoxIndex = _popupEditingBoxIndex;
      } else {
        boxes.push({ name, startTime, endTime, mode: 'block', days: [internalDow], customDomains: [...popupStagingDomains], color });
        savedBoxIndex = boxes.length - 1;
      }
      TBBStorage.set({ [boxKey]: boxes }, () => {
        currentBoxes = boxes;
        if (warnEl) warnEl.style.display = 'none';
        exitPopupBoxEditMode();
        refreshDonut();
        // 메인 주간 뷰도 갱신
        renderBoxes(boxes);
        if (wasEditing && oldBox) {
          animateDonutResize(wrap, savedBoxIndex, oldBox.startTime, oldBox.endTime, startTime, endTime);
        } else {
          animateDonutGrow(wrap, savedBoxIndex);
        }
      });
    });
  });

  overlay.classList.remove('hidden');
  overlay.onclick = (e) => { if (e.target === overlay) closeDayPopup(); };
}

function closeDayPopup() {
  const overlay = document.getElementById('dayPopupOverlay');
  if (overlay) overlay.classList.add('hidden');
  // 팝업 도넛의 clock interval 정리
  if (dayViewClockInterval) { clearInterval(dayViewClockInterval); dayViewClockInterval = null; }
  // 팝업 안에서 주소 추가/삭제 등으로 바뀐 내용을 뒤의 주간 그리드에도 반영
  renderBoxes(currentBoxes);
}

// ── 요일 선택기 순서 동기화 ──
let weekStartMonday = false;

function syncDaySelector() {
  const selector = document.querySelector('.day-selector');
  if (!selector) return;
  const ORDER_MON = [0,1,2,3,4,5,6];
  const ORDER_SUN = [6,0,1,2,3,4,5];
  const order = weekStartMonday ? ORDER_MON : ORDER_SUN;
  const LABELS = [T('dayMon'),T('dayTue'),T('dayWed'),T('dayThu'),T('dayFri'),T('daySat'),T('daySun')];
  const checked = new Set(
    Array.from(selector.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value)
  );
  selector.innerHTML = '';
  order.forEach(v => {
    const id = `day${v}`;
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = id; cb.name = 'days'; cb.value = String(v);
    if (checked.has(String(v))) cb.checked = true;
    const lbl = document.createElement('label');
    lbl.htmlFor = id; lbl.textContent = LABELS[v];
    selector.appendChild(cb);
    selector.appendChild(lbl);
  });
}

function getWeekOrder() {
  const mo = T('dayMon'), tu = T('dayTue'), we = T('dayWed'), th = T('dayThu'),
        fr = T('dayFri'), sa = T('daySat'), su = T('daySun');
  const moF = T('dayMondayFull'), tuF = T('dayTuesdayFull'), weF = T('dayWednesdayFull'),
        thF = T('dayThursdayFull'), frF = T('dayFridayFull'), saF = T('daySaturdayFull'), suF = T('daySundayFull');
  if (weekStartMonday) {
    return [
      { label: mo, fullLabel: moF, dow: 1 }, { label: tu, fullLabel: tuF, dow: 2 }, { label: we, fullLabel: weF, dow: 3 },
      { label: th, fullLabel: thF, dow: 4 }, { label: fr, fullLabel: frF, dow: 5 }, { label: sa, fullLabel: saF, dow: 6 }, { label: su, fullLabel: suF, dow: 0 },
    ];
  } else {
    return [
      { label: su, fullLabel: suF, dow: 0 }, { label: mo, fullLabel: moF, dow: 1 }, { label: tu, fullLabel: tuF, dow: 2 },
      { label: we, fullLabel: weF, dow: 3 }, { label: th, fullLabel: thF, dow: 4 }, { label: fr, fullLabel: frF, dow: 5 }, { label: sa, fullLabel: saF, dow: 6 },
    ];
  }
}

// ── 주간 뷰 렌더링 ──
function renderWeekView(boxes, wrap, scrollToMins, onSettled) {
  if (weekViewClockInterval) { clearInterval(weekViewClockInterval); weekViewClockInterval = null; }
  const weekOrder = getWeekOrder();
  const todayDow  = new Date().getDay();

  const outer = document.createElement('div');
  outer.className = 'timetable-outer scrollable';

  const scrollBody = document.createElement('div');
  scrollBody.className = 'week-scroll-body';

  const headerRow = document.createElement('div');
  headerRow.className = 'week-header-row';
  headerRow.style.gridTemplateColumns = '52px repeat(7, 1fr)';
  const cornerCell = document.createElement('div');
  cornerCell.className = 'week-corner-cell';
  cornerCell.style.width = '52px';
  headerRow.appendChild(cornerCell);
  weekOrder.forEach(({ label, fullLabel, dow }) => {
    const internalDow = dow === 0 ? 6 : dow - 1;
    const hasSchedule = boxes.some(box => {
      const d = box.days || [];
      return d.length === 0 || d.includes(internalDow);
    });
    const lbl = document.createElement('div');
    lbl.className   = 'week-day-label' + (dow === todayDow ? ' today' : '') + (hasSchedule ? ' has-schedule' : '');
    lbl.textContent = label;
    lbl.title = T('dayScheduleTooltip', [fullLabel]);
    lbl.addEventListener('click', () => openDayPopup(dow, fullLabel, boxes));
    headerRow.appendChild(lbl);
  });
  scrollBody.appendChild(headerRow);

  const bodyGrid = document.createElement('div');
  bodyGrid.className = 'timetable-grid';
  bodyGrid.style.gridTemplateColumns = '52px repeat(7, 1fr)';

  const labelCol = document.createElement('div');
  labelCol.className = 'time-label-col';

  const dayCols = weekOrder.map(({ dow }) => {
    const col = document.createElement('div');
    col.className    = 'week-day-col';
    col.style.height = `${TOTAL_HEIGHT}px`;
    col.style.position = 'relative';
    col._dow = dow;
    return col;
  });

  buildTimeAxis(labelCol, document.createElement('div'), 24);

  dayCols.forEach(col => {
    for (let slot = 0; slot < 24; slot++) {
      const line = document.createElement('div');
      line.className = 'hour-line on-hour';
      line.style.top = `${minsToPx(slot * 60)}px`;
      col.appendChild(line);
    }
  });

  dayCols.forEach(col => {
    const dow = col._dow;
    const internalDow = dow === 0 ? 6 : dow - 1;
    boxes
      .filter(box => { const d = box.days || []; return d.length === 0 || d.includes(internalDow); })
      .forEach(box => {
        buildBoxCard(box, boxes.indexOf(box), true).forEach(card => col.appendChild(card));
      });

    // 오늘 열에만 현재 시간선 표시
    if (dow === todayDow) {
      const timeLine = document.createElement('div');
      timeLine.className = 'week-now-line';

      const dot = document.createElement('div');
      dot.className = 'week-now-dot';
      timeLine.appendChild(dot);
      col.appendChild(timeLine);

      function updateWeekNowLine() {
        const m = new Date().getHours() * 60 + new Date().getMinutes();
        timeLine.style.top = `${minsToPx(m)}px`;
      }
      updateWeekNowLine();
      weekViewClockInterval = setInterval(updateWeekNowLine, 60000);
    }
  });

  bodyGrid.appendChild(labelCol);
  dayCols.forEach(col => bodyGrid.appendChild(col));
  scrollBody.appendChild(bodyGrid);
  outer.appendChild(scrollBody);
  wrap.appendChild(outer);

  wrap._weekScrollBody = scrollBody;
  scrollBody.addEventListener('scroll', () => { wrap._weekScrollTop = scrollBody.scrollTop; }, { passive: true });

  if (scrollToMins !== undefined) {
    // 박스 추가/수정 직후 해당 시간대로 이동 — 이즈인아웃으로 부드럽게 스크롤한 뒤,
    // 끝나면 onSettled(추가/수정 강조 애니메이션 트리거)를 호출한다.
    // 리렌더로 새로 만들어진 스크롤 컨테이너는 항상 scrollTop 0에서 시작하므로, 애니메이션을
    // 시작하기 직전에 직전 스크롤 위치로 먼저 맞춰둔다. 이 스냅을 안 하면 0으로 순간 이동했다가
    // 다시 내려오는 것처럼 보이는 깜빡임이 생긴다(직전 위치가 목표보다 아래일 때 특히 두드러짐).
    requestAnimationFrame(() => {
      if (wrap._weekScrollTop !== undefined) scrollBody.scrollTop = wrap._weekScrollTop;
      smoothScrollTo(scrollBody, Math.max(0, minsToPx(scrollToMins) - 40), 550, onSettled);
    });
  } else if (wrap._weekScrollTop !== undefined) {
    requestAnimationFrame(() => { scrollBody.scrollTop = wrap._weekScrollTop; if (onSettled) onSettled(); });
  } else {
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    requestAnimationFrame(() => { scrollBody.scrollTop = Math.max(0, minsToPx(nowMins) - 260); if (onSettled) onSettled(); });
  }
}

// ── 뷰 디스패처 ──
function renderBoxes(boxes, scrollToMins, onSettled) {
  currentBoxes = boxes;
  const wrap = document.getElementById('timetableWrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (currentView !== 'day' && dayViewClockInterval) {
    clearInterval(dayViewClockInterval); dayViewClockInterval = null;
  }
  if (currentView !== 'week' && weekViewClockInterval) {
    clearInterval(weekViewClockInterval); weekViewClockInterval = null;
  }

  if (currentView === 'day') { renderDayView(boxes, wrap); if (onSettled) onSettled(); }
  else renderWeekView(boxes, wrap, scrollToMins, onSettled);
}

// ── 스테이징 커스텀 도메인 목록 렌더링 ──
function renderStagingList() {
  const ul = document.getElementById('stagingCustomList');
  ul.innerHTML = '';
  stagingCustomDomains.forEach((cd, index) => {
    const li = createCustomDomainItemUI(
      cd.domain, cd.mode, `stg_c${index}`, 'li',
      () => removeStagingDomain(index)
    );
    ul.appendChild(li);
  });
  _applyDomainFilter('stagingCustomList');
}

// ── 스테이징 이벤트 핸들러 ──
document.getElementById('addCustomStagingBtn').onclick = () => {
  const domain = cleanDomain(document.getElementById('customDomainInput').value.trim());
  const mode = 'allow';
  if (domain) {
    const existIdx = stagingCustomDomains.findIndex(cd => cd.domain === domain);
    if (existIdx !== -1) {
      const ul = document.getElementById('stagingCustomList');
      if (ul && ul.children[existIdx]) scrollAndBounce(ul, ul.children[existIdx], 'customWarn', T('alreadySameAddress'));
      return;
    }
    stagingCustomDomains.push({ domain, mode });
    document.getElementById('customDomainInput').value = '';
    hideWarn('customWarn');
    renderStagingList();
    animateNewListItem(document.getElementById('stagingCustomList'));
  }
};

function removeStagingDomain(index) { stagingCustomDomains.splice(index, 1); hideWarn('customWarn'); renderStagingList(); }

// ── 박스 수정 모드 진입/종료 ──
function enterBoxEditMode(box, boxIndex) {
  _editingBoxIndex = boxIndex;

  document.getElementById('boxName').value  = box.name;
  document.getElementById('startTime').value = box.startTime;
  document.getElementById('endTime').value   = box.endTime;

  if (currentView === 'week') {
    clearDaySelection();
    (box.days || []).forEach(d => {
      const cb = document.querySelector(`input[name="days"][value="${d}"]`);
      if (cb) cb.checked = true;
    });
  }

  stagingCustomDomains = (box.customDomains || []).map(cd => ({ ...cd }));
  renderStagingList();
  if (boxColorPickerCtl) boxColorPickerCtl.set(box.color);

  const titleEl = document.getElementById('boxFormTitle');
  if (titleEl) titleEl.textContent = T('donutEditBox');
  const addBtn = document.getElementById('addBoxBtn');
  if (addBtn) addBtn.textContent = T('boxUpdate');
  const cancelBtn = document.getElementById('cancelEditBoxBtn');
  if (cancelBtn) cancelBtn.style.display = 'block';

  hideWarn('boxWarn');
  document.getElementById('boxName').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function exitBoxEditMode() {
  _editingBoxIndex = null;

  const titleEl = document.getElementById('boxFormTitle');
  if (titleEl) titleEl.textContent = T('newBox');
  const addBtn = document.getElementById('addBoxBtn');
  if (addBtn) addBtn.textContent = T('boxCreate');
  const cancelBtn = document.getElementById('cancelEditBoxBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';

  document.getElementById('boxName').value = '';
  document.getElementById('customDomainInput').value = '';
  clearCustomTimeInputs();
  clearDaySelection();
  stagingCustomDomains = [];
  renderStagingList();
  if (boxColorPickerCtl) boxColorPickerCtl.reset();
  hideWarn('boxWarn');
}

document.getElementById('cancelEditBoxBtn').addEventListener('click', exitBoxEditMode);

// ── 박스 추가 폼 ──
document.getElementById('addBoxBtn').addEventListener('click', () => {
  const name      = document.getElementById('boxName').value.trim();
  const startTime = getFormattedTime('startTime');
  const endTime   = getFormattedTime('endTime');
  const days      = currentView === 'week' ? getSelectedDays() : [];

  if (!name || !startTime || !endTime) return alert(T('boxNameRequired'));
  if (currentView === 'week' && days.length === 0) return alert(T('daysRequired'));

  let newStartMin = timeToMins(startTime);
  let newEndMin   = timeToMins(endTime);
  if (newEndMin <= newStartMin) newEndMin += 24 * 60;

  const boxKey = getBoxKey();
  TBBStorage.get([boxKey], function(result) {
    const boxes = result[boxKey] || [];

    const overlapIndices = [];
    for (let i = 0; i < boxes.length; i++) {
      if (i === _editingBoxIndex) continue; // 수정 중인 박스 자기 자신은 겹침 연산에서 제외
      const b = boxes[i];
      const bDays = b.days || [];
      const daysOverlap = days.length === 0 || bDays.length === 0 || days.some(d => bDays.includes(d));
      if (!daysOverlap) continue;

      let existStart = timeToMins(b.startTime);
      let existEnd   = timeToMins(b.endTime);
      if (existEnd <= existStart) existEnd += 24 * 60;

      let isOverlap = Math.max(newStartMin, existStart) < Math.min(newEndMin, existEnd);
      if (!isOverlap && newEndMin > 24 * 60) {
        const shiftedStart = existStart + 24 * 60;
        const shiftedEnd   = existEnd   + 24 * 60;
        isOverlap = Math.max(newStartMin, shiftedStart) < Math.min(newEndMin, shiftedEnd);
      }
      if (isOverlap) overlapIndices.push(i);
    }

    if (overlapIndices.length > 0) {
      const wrap = document.getElementById('timetableWrap');

      if (currentView === 'week' && wrap) {
        const allOverlapDays = new Set();
        overlapIndices.forEach(i => {
          (boxes[i].days || []).filter(d => days.includes(d)).forEach(d => allOverlapDays.add(d));
        });

        const dayLabelEls = [];
        allOverlapDays.forEach(d => {
          const cb = document.querySelector(`.day-selector input[value="${d}"]`);
          const lbl = cb && cb.nextElementSibling;
          if (lbl) dayLabelEls.push(lbl);
        });
        const playFocusFlash = () => {
          flashElements(dayLabelEls, 'focus-flash-dark');
          overlapIndices.forEach(i => {
            flashElements([...wrap.querySelectorAll(`.tbox[data-box-index="${i}"]`)]);
          });
        };

        const scrollBody = wrap._weekScrollBody;
        if (scrollBody) {
          const firstStartMins = timeToMins(boxes[overlapIndices[0]].startTime);
          smoothScrollTo(scrollBody, Math.max(0, minsToPx(firstStartMins) - 40), 650, playFocusFlash);
        } else {
          playFocusFlash();
        }

        triggerBounceAndWarn(null, 'boxWarn', T('timeOverlapWarn2'));

      } else if (currentView === 'day' && wrap && wrap._pulseBox) {
        overlapIndices.forEach(i => wrap._pulseBox(i));
        triggerBounceAndWarn(null, 'boxWarn', T('timeOverlapWarn2'));
      } else {
        triggerBounceAndWarn(null, 'boxWarn', T('timeOverlapWarn2'));
      }

      document.getElementById('startTime').focus();
      return;
    }

    const color = boxColorPickerCtl ? boxColorPickerCtl.get() : BOX_COLOR_DEFAULT;
    const wasEditing = _editingBoxIndex !== null;
    const oldBox = wasEditing ? { ...boxes[_editingBoxIndex] } : null;
    let savedBoxIndex;
    let newBoxIndices = []; // 일주일 뷰에서 여러 요일에 동시 추가한 경우, 생성된 모든 실제 인덱스
    if (wasEditing) {
      boxes[_editingBoxIndex] = { name, startTime, endTime, mode: 'block', days: currentView === 'week' ? days : [], customDomains: [...stagingCustomDomains], color };
      savedBoxIndex = _editingBoxIndex;
    } else {
      const daysToSave = currentView === 'week' ? days : [null];
      daysToSave.forEach(day => {
        boxes.push({ name, startTime, endTime, mode: 'block', days: day !== null ? [day] : [], customDomains: [...stagingCustomDomains], color });
        newBoxIndices.push(boxes.length - 1);
      });
      savedBoxIndex = boxes.length - 1;
    }
    TBBStorage.set({ [boxKey]: boxes }, () => {
      exitBoxEditMode();
      const topMins = timeToMins(startTime);
      const key = getBoxKey();
      TBBStorage.get(['generalList', 'permanentList', key], result => {
        renderList('generalList',   result.generalList   || [], 'generalList',   'generalWarn');
        renderList('permanentList', result.permanentList || [], 'permanentList', 'permanentWarn');
        // 렌더(카드는 이미 최종 모습으로 그려짐) 직후 반환되면, 스크롤이 시작되기 전인 지금
        // 편집(리사이즈) 애니메이션은 곧바로 건다 — 편집 대상 박스는 이미 화면 어딘가에
        // 보이고 있었을 것이므로 스크롤과 동시에 진행돼야 "다 그려진 박스가 스크롤 후에
        // 다시 이전 길이→새 길이로 바뀌는" 이중 변화가 없다.
        // 반면 새로 추가된 박스는 스크롤을 해야 보일 만큼 화면 밖에 있는 경우가 대부분이라,
        // 여기서 바로 확장 애니메이션(0.26s)을 틀면 스크롤(0.55s)이 끝나기 전에 화면 밖에서
        // 다 재생돼버려 "생성 애니메이션이 아예 사라진" 것처럼 보인다. 그래서 새 박스는
        // 일단 scale(0)으로 숨겨만 두고, 아래 onSettled(스크롤이 끝나 실제로 보이는 시점)에서
        // 확장 애니메이션을 재생한다. 하루 뷰(도넛)는 스크롤이 없어 원래도 문제없다.
        renderBoxes(result[key] || [], topMins, () => {
          if (wasEditing) return;
          const boxWrap = document.getElementById('timetableWrap');
          if (currentView === 'day') {
            animateDonutGrow(boxWrap, savedBoxIndex);
          } else if (currentView === 'week') {
            newBoxIndices.forEach(idx => {
              const els = [...boxWrap.querySelectorAll(`.tbox[data-box-index="${idx}"]`)];
              els.forEach(el => { el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; });
              animateGrowElements(els);
            });
          }
        });

        if (currentView === 'week') {
          const boxWrap = document.getElementById('timetableWrap');
          if (wasEditing && oldBox) {
            if (_sameDaySet(oldBox.days, days)) {
              animateWeekResize(boxWrap, savedBoxIndex, oldBox.startTime, oldBox.endTime, startTime, endTime);
            }
          } else {
            newBoxIndices.forEach(idx => {
              boxWrap.querySelectorAll(`.tbox[data-box-index="${idx}"]`).forEach(el => {
                el.style.transition = 'none';
                el.style.transform  = 'scale(0)';
                el.style.opacity    = '0';
              });
            });
          }
        } else if (currentView === 'day' && wasEditing && oldBox) {
          animateDonutResize(document.getElementById('timetableWrap'), savedBoxIndex, oldBox.startTime, oldBox.endTime, startTime, endTime);
        }
      });
    });
  });
});

// ── 차단 관리 탭 이벤트 핸들러 ──
document.getElementById('addGeneralBtn').onclick   = () => addToList('generalDomainInput',   'generalList',   'generalList',   'generalWarn');
document.getElementById('addPermanentBtn').onclick = () => addToList('permanentDomainInput', 'permanentList', 'permanentList', 'permanentWarn');
document.getElementById('clearGeneralBtn').onclick   = () => clearAll('generalList',   T('clearGeneralConfirm'),   ['generalDomainInput']);
document.getElementById('clearPermanentBtn').onclick = () => clearAll('permanentList', T('clearPermanentConfirm'), ['permanentDomainInput']);
document.getElementById('clearBoxesBtn').onclick = () => {
  if (_pinEnabled) {
    _openPinModal(T('clearAll'), () => {
      clearAll(getBoxKey(), T('clearBoxesConfirm'), ['boxName', 'customDomainInput'], { skipConfirm: true });
      clearCustomTimeInputs(); clearDaySelection();
    });
    return;
  }
  clearAll(getBoxKey(), T('clearBoxesConfirm'), ['boxName', 'customDomainInput']);
  clearCustomTimeInputs(); clearDaySelection();
};

// ── 폼 유틸 ──
function getFormattedTime(inputId) { return document.getElementById(inputId).value || null; }
function clearCustomTimeInputs() {
  const s = document.getElementById('startTime'); if (s) s.value = '';
  const e = document.getElementById('endTime');   if (e) e.value = '';
}
function getSelectedDays() {
  return Array.from(document.querySelectorAll('input[name="days"]:checked')).map(cb => parseInt(cb.value));
}
function clearDaySelection() {
  document.querySelectorAll('input[name="days"]').forEach(cb => cb.checked = false);
}

function exportSettings() {
  const KEYS = ['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled', 'weekStartMonday', 'shortsBlockEnabled', 'instaBlockEnabled', 'instaShowFollowedPosts', 'pomodoroList', 'pomodoroSettings', 'pomodoroPresets', 'pomodoroCycleOverrides', 'focusEvents', 'focusStreak', 'todoItems', 'customQuotes', 'customLinks'];
  // 배경 이미지(customBgImages)는 Base64라 용량이 커서 사용자가 명시적으로 선택했을 때만 포함.
  const includeImages = document.getElementById('exportIncludeImages')?.checked;
  if (includeImages) KEYS.push('customBgImages');
  TBBStorage.get(KEYS, data => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focus-timeboxer-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function importSettings(file) {
  const reader = new FileReader();
  reader.onload = e => {
    let data;
    try { data = JSON.parse(e.target.result); }
    catch { alert(T('invalidJson')); return; }
    const ALLOWED = new Set(['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled', 'weekStartMonday', 'shortsBlockEnabled', 'instaBlockEnabled', 'instaShowFollowedPosts', 'pomodoroList', 'pomodoroSettings', 'pomodoroPresets', 'pomodoroCycleOverrides', 'focusEvents', 'focusStreak', 'todoItems', 'customQuotes', 'customLinks', 'customBgImages']);
    const safe = Object.fromEntries(Object.entries(data).filter(([k]) => ALLOWED.has(k)));
    if (Object.keys(safe).length === 0) { alert(T('noDataToRestore')); return; }
    TBBStorage.set(safe, () => {
      alert(T('importSuccess'));
      loadSettings();
    });
  };
  reader.readAsText(file);
}

function applyDailyScheduleVisual() {
  const wrap = document.getElementById('timetableWrap');
  if (!wrap) return;
  wrap.classList.toggle('daily-disabled', !dailyScheduleEnabled);
}

function updateDailyToggleVisibility() {
  const row = document.getElementById('dailyScheduleToggleRow');
  if (row) row.style.display = currentView === 'day' ? 'flex' : 'none';
}
