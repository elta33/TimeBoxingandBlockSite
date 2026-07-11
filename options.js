// options.js
// ※ 로드 순서: storage.js → render-day.js → options.js

let stagingCustomDomains = [];
let dailyScheduleEnabled = true;
let weekViewClockInterval = null;
let _editingBoxIndex = null; // 수정 중인 박스 인덱스 (null이면 새 박스 추가 모드)

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
    badge.textContent = '🔒 PIN 활성화됨 — 삭제·초기화·비활성화 잠김';
    if (setup)  setup.style.display  = 'none';
    if (change) change.style.display = 'block';
  } else {
    badge.className = 'pin-status-badge pin-inactive';
    badge.textContent = 'PIN 미설정 — 잠금 비활성화';
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
      if (errorEl) errorEl.textContent = 'PIN이 올바르지 않습니다.';
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

// ── 도메인 정규화 ──
function cleanDomain(d) {
  return d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').trim();
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
    span.textContent = item; span.title = item; span.className = 'domain-text';
    li.appendChild(span);
    const delBtn = _makeTrashButton(T('delete'), () => deleteItem(storageKey, index));
    li.appendChild(delBtn);
    ul.appendChild(li);
  });
}

// ── 공통: 커스텀 도메인 아이템 UI 팩토리 ──
function createCustomDomainItemUI(domain, mode, idPrefix, elType, onDelete) {
  const item = document.createElement(elType);
  item.className = 'custom-domain-item';

  const domSpan = document.createElement('span');
  domSpan.textContent = domain; domSpan.title = domain; domSpan.className = 'domain-text';
  item.appendChild(domSpan);

  const controls = document.createElement('div');
  controls.className = 'custom-domain-controls';

  const modeBadge = document.createElement('span');
  modeBadge.className = 'mode-badge mode-badge-allow';
  modeBadge.textContent = T('allow');
  controls.appendChild(modeBadge);

  const delBtn = _makeTrashButton(T('delete'), (e) => { e.stopPropagation(); onDelete(); });
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
    card.className = 'tbox box-block';
    card.dataset.boxIndex = boxIndex;
    card.style.top    = `${minsToPx(topMins)}px`;
    card.style.height = `${Math.max(minsToPx(heightMins) - 3, 20)}px`;

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
      const first = box.customDomains[0].domain;
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
      if (_pinEnabled) {
        _openPinModal(T('delete'), () => deleteBox(boxIndex));
      } else {
        deleteBox(boxIndex);
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
      deleteBox(boxIndex);
      panel.style.display = 'none';
      panel.dataset.openIndex = '';
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

  const wAddDomainPopup = document.createElement('div');
  wAddDomainPopup.style.cssText = [
    'display:none;position:absolute;z-index:200;',
    'top:calc(100% + 6px);left:0;',
    'background:#fff;border:1px solid #ddd;border-radius:8px;',
    'box-shadow:0 4px 16px rgba(0,0,0,0.13);',
    'padding:10px 12px;min-width:260px;'
  ].join('');

  const wPopupInput = document.createElement('input');
  wPopupInput.type = 'text';
  wPopupInput.placeholder = T('placeholderGithub');
  wPopupInput.style.cssText = 'flex:1;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.88rem;font-family:inherit;outline:none;min-width:0;';

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
    chrome.storage.local.get([boxKey], function(result) {
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
      chrome.storage.local.set({ [boxKey]: boxes }, () => {
        wAddDomainPopup.style.display = 'none';
        if (_wPopupOutsideHandler) document.removeEventListener('mousedown', _wPopupOutsideHandler);
        refreshPanel(boxes);
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
    empty.textContent = T('donutNoCustom');
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

  function enterPopupBoxEditMode(box, realIndex) {
    _popupEditingBoxIndex = realIndex;

    if (popupBoxName)   popupBoxName.value = box.name;
    if (popupStartTime) popupStartTime.value = box.startTime;
    if (popupEndTime)   popupEndTime.value = box.endTime;

    popupStagingDomains = (box.customDomains || []).map(cd => ({ ...cd }));
    renderPopupStagingList();

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
    chrome.storage.local.get([boxKey], function(result) {
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

      if (_popupEditingBoxIndex !== null) {
        boxes[_popupEditingBoxIndex] = { name, startTime, endTime, mode: 'block', days: [internalDow], customDomains: [...popupStagingDomains] };
      } else {
        boxes.push({ name, startTime, endTime, mode: 'block', days: [internalDow], customDomains: [...popupStagingDomains] });
      }
      chrome.storage.local.set({ [boxKey]: boxes }, () => {
        currentBoxes = boxes;
        if (warnEl) warnEl.style.display = 'none';
        exitPopupBoxEditMode();
        refreshDonut();
        // 메인 주간 뷰도 갱신
        renderBoxes(boxes);
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
function renderWeekView(boxes, wrap, scrollToMins) {
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
    requestAnimationFrame(() => { scrollBody.scrollTop = Math.max(0, minsToPx(scrollToMins) - 40); });
  } else if (wrap._weekScrollTop !== undefined) {
    requestAnimationFrame(() => { scrollBody.scrollTop = wrap._weekScrollTop; });
  } else {
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    requestAnimationFrame(() => { scrollBody.scrollTop = Math.max(0, minsToPx(nowMins) - 260); });
  }
}

// ── 뷰 디스패처 ──
function renderBoxes(boxes, scrollToMins) {
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

  if (currentView === 'day') renderDayView(boxes, wrap);
  else renderWeekView(boxes, wrap, scrollToMins);
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
  chrome.storage.local.get([boxKey], function(result) {
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

    if (_editingBoxIndex !== null) {
      boxes[_editingBoxIndex] = { name, startTime, endTime, mode: 'block', days: currentView === 'week' ? days : [], customDomains: [...stagingCustomDomains] };
    } else {
      const daysToSave = currentView === 'week' ? days : [null];
      daysToSave.forEach(day => {
        boxes.push({ name, startTime, endTime, mode: 'block', days: day !== null ? [day] : [], customDomains: [...stagingCustomDomains] });
      });
    }
    chrome.storage.local.set({ [boxKey]: boxes }, () => {
      exitBoxEditMode();
      const topMins = timeToMins(startTime);
      const key = getBoxKey();
      chrome.storage.local.get(['generalList', 'permanentList', key], result => {
        renderList('generalList',   result.generalList   || [], 'generalList',   'generalWarn');
        renderList('permanentList', result.permanentList || [], 'permanentList', 'permanentWarn');
        renderBoxes(result[key] || [], topMins);
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
  const KEYS = ['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled', 'weekStartMonday', 'pomodoroList', 'pomodoroSettings', 'pomodoroPresets', 'pomodoroCycleOverrides'];
  chrome.storage.local.get(KEYS, data => {
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
    const ALLOWED = new Set(['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled', 'weekStartMonday', 'pomodoroList', 'pomodoroSettings', 'pomodoroPresets', 'pomodoroCycleOverrides']);
    const safe = Object.fromEntries(Object.entries(data).filter(([k]) => ALLOWED.has(k)));
    if (Object.keys(safe).length === 0) { alert(T('noDataToRestore')); return; }
    chrome.storage.local.set(safe, () => {
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

// ── 통계 탭 ──

let _statsPeriod = 'today';

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

function _statsLogPomoSession(durationMins) {
  const dateStr = _statsTodayStr();
  chrome.storage.local.get(['focusEvents', 'focusStreak'], data => {
    let events = data.focusEvents || [];
    let day = events.find(e => e.date === dateStr);
    if (!day) { day = { date: dateStr, blocks: [], pomoSessions: [] }; events.push(day); }
    day.pomoSessions.push({ ts: Math.floor(Date.now() / 1000), durationMins });
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    events = events.filter(e => e.date >= cutoff.toISOString().slice(0, 10));
    const streak = _statsUpdateStreak(data.focusStreak || null, dateStr);
    chrome.storage.local.set({ focusEvents: events, focusStreak: streak });
  });
}

function _statsFormatMins(mins) {
  if (!mins) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h > 0 && m > 0) return T('timeHM', [String(h), String(m)]);
  if (h > 0) return T('timeH', [String(h)]);
  return T('timeM', [String(m)]);
}

function _renderBlockBarChart(allEvents, period) {
  const chartEl = document.getElementById('stat-bar-chart');
  if (!chartEl) return;
  chartEl.innerHTML = '';
  chartEl.style.position = 'relative';
  chartEl.style.overflow  = 'visible';

  const days  = period === '30d' ? 30 : 7;
  const today = new Date();
  const bars  = [];
  let maxFocusMins = 1;

  for (let i = days - 1; i >= 0; i--) {
    const d       = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr   = d.toISOString().slice(0, 10);
    const log       = allEvents.find(e => e.date === dateStr);
    const focusMins = log ? (log.focusMins || 0) : 0;
    const blocks    = log ? (log.blocks || []) : [];
    bars.push({ d, dateStr, isToday: i === 0, focusMins, blocks });
    if (focusMins > maxFocusMins) maxFocusMins = focusMins;
  }

  // 공유 팝오버
  const popover = document.createElement('div');
  popover.className = 'stats-bar-popover';
  chartEl.appendChild(popover);

  const dayKeys = ['daySun','dayMon','dayTue','dayWed','dayThu','dayFri','daySat'];
  const inner = document.createElement('div');
  inner.className = 'stats-bar-chart-inner';
  inner.style.gap = days <= 7 ? '20px' : '5px';

  bars.forEach(({ d, isToday, focusMins, blocks }) => {
    const col = document.createElement('div');
    col.className = 'stats-bar-col';

    const wrap = document.createElement('div');
    wrap.className = 'stats-bar-wrap';

    const bar = document.createElement('div');
    bar.className = 'stats-bar' + (isToday ? ' today' : '');
    const pct = Math.round((focusMins / maxFocusMins) * 100);
    const targetH = focusMins > 0 ? Math.max(pct, 4) : 0;
    bar.style.height = '0%';
    bar.style.width = days <= 7 ? '50px' : '100%';
    bar.dataset.targetHeight = targetH;

    // 30일 뷰는 막대 폭이 좁아 상시 라벨끼리 겹치므로, 이미 같은 정보를
    // 더 자세히 보여주는 호버 팝오버(stats-bar-popover)에 맡기고 여기선 생략한다.
    if (focusMins > 0 && days <= 7) {
      const tip = document.createElement('span');
      tip.className = 'stats-bar-tooltip';
      tip.textContent = _statsFormatMins(focusMins);
      bar.appendChild(tip);
    }
    wrap.appendChild(bar);

    const lbl = document.createElement('div');
    lbl.className = 'stats-bar-day' + (isToday ? ' today' : '');
    lbl.textContent = days <= 7
      ? (isToday ? T('statsToday') : T(dayKeys[d.getDay()]))
      : (d.getMonth() + 1) + '/' + d.getDate();

    col.append(wrap, lbl);

    // 호버 팝오버
    col.addEventListener('mouseenter', () => {
      bar.classList.add('hovered');

      popover.innerHTML = '';

      const dateRow = document.createElement('div');
      dateRow.className = 'stats-bar-popover-date';
      dateRow.textContent =
        (d.getMonth() + 1) + '/' + d.getDate() +
        ' (' + T(dayKeys[d.getDay()]) + ') · ' + _statsFormatMins(focusMins);
      popover.appendChild(dateRow);

      // 상위 차단 도메인 (최대 3개)
      const domainCounts = {};
      blocks.forEach(b => { domainCounts[b.domain] = (domainCounts[b.domain] || 0) + 1; });
      const top3 = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

      const domainLabel = document.createElement('div');
      domainLabel.className = 'stats-bar-popover-section';
      domainLabel.textContent = T('statsTopDomains');
      popover.appendChild(domainLabel);

      if (top3.length) {
        top3.forEach(([domain, count]) => {
          const row = document.createElement('div');
          row.className = 'stats-bar-popover-row';
          const dn = document.createElement('span');
          dn.className = 'stats-bar-popover-domain';
          dn.textContent = domain;
          const cnt = document.createElement('span');
          cnt.className = 'stats-bar-popover-count';
          cnt.textContent = count + T('statsBlockUnit');
          row.append(dn, cnt);
          popover.appendChild(row);
        });
      } else {
        const empty = document.createElement('div');
        empty.className = 'stats-bar-popover-empty';
        empty.textContent = T('statsNoData');
        popover.appendChild(empty);
      }

      // 위치: 바 상단 중앙
      popover.style.display = 'block';
      const barRect   = bar.getBoundingClientRect();
      const chartRect = chartEl.getBoundingClientRect();
      const colRect   = col.getBoundingClientRect();
      popover.style.left = (colRect.left + colRect.width / 2 - chartRect.left) + 'px';
      popover.style.top  = (barRect.top - chartRect.top) + 'px';
      popover.style.animation = 'none';
      popover.offsetWidth;
      popover.style.animation = 'popoverFadeIn 0.2s cubic-bezier(0.34,1.4,0.64,1) both';
    });

    col.addEventListener('mouseleave', () => {
      bar.classList.remove('hovered');
      popover.style.display = 'none';
    });

    inner.appendChild(col);
  });

  chartEl.appendChild(inner);

  // 아래에서 위로 솟아오르는 진입 애니메이션
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const total = inner.querySelectorAll('.stats-bar').length;
      inner.querySelectorAll('.stats-bar').forEach((bar, i) => {
        bar.style.transitionDelay = Math.round(i * 200 / Math.max(1, total - 1)) + 'ms';
        bar.style.height = bar.dataset.targetHeight + '%';
      });
    });
  });
}

function _renderTopDomains(filteredEvents) {
  const listEl = document.getElementById('stat-top-domains');
  if (!listEl) return;
  listEl.innerHTML = '';

  const counts = {};
  filteredEvents.forEach(log => {
    (log.blocks || []).forEach(b => {
      counts[b.domain] = (counts[b.domain] || 0) + 1;
    });
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const SLOTS = 5; // 도메인 개수(0~5)와 무관하게 항상 5행 높이를 예약 —
                    // 옆 집중 통계 섹터와 stretch로 세로가 맞물려 있어, 여기가
                    // 출렁이면 막대 그래프 높이까지 따라 출렁이기 때문.

  function placeholderRow() {
    const li = document.createElement('li');
    li.className = 'stats-domain-rank-item stats-domain-placeholder';
    li.innerHTML = '<span class="stats-rank-num">&nbsp;</span>'
      + '<div class="stats-rank-info"><span class="stats-rank-domain">&nbsp;</span>'
      + '<div class="stats-rank-bar-bg"><div class="stats-rank-bar-fill" style="width:0"></div></div></div>'
      + '<span class="stats-rank-count">&nbsp;</span>';
    return li;
  }

  if (!sorted.length) {
    const li = document.createElement('li');
    li.className = 'stats-domain-rank-item stats-domain-empty';
    li.textContent = T('statsNoData');
    listEl.appendChild(li);
    for (let i = 1; i < SLOTS; i++) listEl.appendChild(placeholderRow());
    return;
  }

  const maxCount = sorted[0][1];
  sorted.forEach(([domain, count], i) => {
    const li = document.createElement('li');
    li.className = 'stats-domain-rank-item';

    const rank = document.createElement('span');
    rank.className = 'stats-rank-num' + (i < 2 ? ' top' : '');
    rank.textContent = i + 1;

    const info = document.createElement('div');
    info.className = 'stats-rank-info';

    const name = document.createElement('span');
    name.className = 'stats-rank-domain';
    name.textContent = domain;

    const barBg = document.createElement('div');
    barBg.className = 'stats-rank-bar-bg';
    const barFill = document.createElement('div');
    barFill.className = 'stats-rank-bar-fill' + (i < 2 ? ' top' : '');
    barFill.style.width = '0%';
    barFill.dataset.targetWidth = Math.round((count / maxCount) * 100);
    barBg.appendChild(barFill);

    info.append(name, barBg);

    const countEl = document.createElement('span');
    countEl.className = 'stats-rank-count';
    countEl.textContent = count + T('statsBlockUnit');

    li.append(rank, info, countEl);
    listEl.appendChild(li);
  });

  for (let i = sorted.length; i < SLOTS; i++) listEl.appendChild(placeholderRow());

  // 왼쪽에서 오른쪽으로 늘어나는 진입 애니메이션
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      listEl.querySelectorAll('.stats-rank-bar-fill').forEach((fill, i) => {
        fill.style.transitionDelay = (i * 60) + 'ms';
        fill.style.width = fill.dataset.targetWidth + '%';
      });
    });
  });
}

function _renderPomoStats(allEvents, period) {
  const el = document.getElementById('stat-pomo-content');
  if (!el) return;
  el.innerHTML = '';

  const todayStr = _statsTodayStr();
  const todayLog = allEvents.find(e => e.date === todayStr);
  const todayCyc  = todayLog ? (todayLog.pomoSessions || []).length : 0;
  const todayMins = todayLog ? (todayLog.pomoSessions || []).reduce((s, p) => s + p.durationMins, 0) : 0;

  function calcPeriod(days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const filtered = allEvents.filter(e => e.date >= cutoff.toISOString().slice(0, 10));
    return {
      cyc:  filtered.reduce((s, e) => s + (e.pomoSessions || []).length, 0),
      mins: filtered.reduce((s, e) => s + (e.pomoSessions || []).reduce((s2, p) => s2 + p.durationMins, 0), 0),
    };
  }

  const p7  = calcPeriod(7);
  const p30 = calcPeriod(30);

  function makeCard(label, cycles, mins, isActive) {
    const card = document.createElement('div');
    card.className = 'stats-pomo-card';
    if (isActive) card.dataset.active = '1';

    const lbl = document.createElement('div');
    lbl.className = 'stats-pomo-card-label';
    lbl.textContent = label;

    const val = document.createElement('div');
    val.className = 'stats-pomo-card-value';
    const timeStr = mins > 0 ? _statsFormatMins(mins) : '—';
    val.textContent = `${cycles}${T('statsPomoUnit')} | ${timeStr}`;

    card.append(lbl, val);
    return card;
  }

  const grid = document.createElement('div');
  grid.className = 'stats-pomo-grid';

  grid.appendChild(makeCard(T('statsToday'),     todayCyc, todayMins, period === 'today'));
  grid.appendChild(makeCard(T('statsPomoWeek'),  p7.cyc,  p7.mins,   period === '7d'));
  grid.appendChild(makeCard(T('statsPomoMonth'), p30.cyc, p30.mins,  period === '30d'));

  el.appendChild(grid);

  // 부드럽게 하이라이트가 밝아지는 진입 애니메이션
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      grid.querySelectorAll('.stats-pomo-card[data-active]').forEach(card => {
        card.classList.add('active');
      });
    });
  });
}

function _renderHeatmap(allEvents, period) {
  const wrapEl = document.getElementById('stat-heatmap-wrap');
  const el = document.getElementById('stat-heatmap');
  if (!el || !wrapEl) return;
  el.innerHTML = '';

  const days = period === '30d' ? 30 : period === '7d' ? 7 : 1;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const hourSums = new Array(24).fill(0);
  allEvents.filter(e => e.date >= cutoffStr).forEach(dayLog => {
    (dayLog.blocks || []).forEach(b => {
      const h = new Date(b.ts * 1000).getHours();
      if (h >= 0 && h < 24) hourSums[h]++;
    });
  });

  const isToday = period === 'today';
  const maxVal = Math.max(1, ...hourSums);

  const NS = 'http://www.w3.org/2000/svg';
  const W = 220, H = 70, pT = 8, pB = 4, pL = 4, pR = 4;
  const cW = W - pL - pR, cH = H - pT - pB;
  const baseY = pT + cH;

  function mk(tag, attrs, st) {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (st) e.setAttribute('style', st);
    return e;
  }

  [6, 12, 18].forEach(h => {
    const x = pL + ((h + 0.5) / 24) * cW;
    el.appendChild(mk('line', { x1: x, y1: pT, x2: x, y2: baseY, 'stroke-dasharray': '2,2' }, 'stroke:#efefef;stroke-width:0.5'));
  });
  el.appendChild(mk('line', { x1: pL, y1: baseY, x2: W - pR, y2: baseY }, 'stroke:#efefef;stroke-width:0.5'));

  // 공유 팝오버 (재렌더 시 재사용)
  let popover = wrapEl.querySelector('.stats-heatmap-popover');
  if (!popover) {
    popover = document.createElement('div');
    popover.className = 'stats-heatmap-popover';
    wrapEl.appendChild(popover);
  }
  popover.style.display = 'none';

  const peakH = hourSums.indexOf(maxVal);
  const slotW = cW / 24;
  const barW = slotW * 0.6;
  const minH = 3;

  for (let h = 0; h < 24; h++) {
    const v = hourSums[h];
    const cx = pL + (h + 0.5) * slotW;
    const barH = v > 0 ? Math.max(minH, (v / maxVal) * cH) : minH * 0.4;
    const y = baseY - barH;
    const isPeak = v > 0 && h === peakH;
    const barFill = isPeak ? 'var(--heatmap-bar-peak)' : 'var(--heatmap-bar)';

    const rect = mk('rect', {
      x: (cx - barW / 2).toFixed(1),
      width: barW.toFixed(1),
      rx: (barW / 2).toFixed(1)
    }, `fill:${barFill};height:0;y:${baseY.toFixed(1)};transition:height 0.6s cubic-bezier(0.22,1,0.36,1),y 0.6s cubic-bezier(0.22,1,0.36,1)`);
    rect.dataset.targetH = barH.toFixed(1);
    rect.dataset.targetY = y.toFixed(1);
    el.appendChild(rect);

    const hit = mk('rect', { x: (cx - slotW / 2).toFixed(1), y: pT, width: slotW.toFixed(1), height: cH }, 'fill:transparent;cursor:pointer');
    el.appendChild(hit);

    const display = isToday ? String(v) : (v / days).toFixed(1);

    hit.addEventListener('mouseenter', () => {
      rect.style.filter = 'brightness(1.2)';
      popover.textContent = `${h}:00 — ${display}${T('statsBlockUnit')}`;
      popover.style.display = 'block';

      const barRect  = rect.getBoundingClientRect();
      const wrapRect = wrapEl.getBoundingClientRect();
      popover.style.left = (barRect.left + barRect.width / 2 - wrapRect.left) + 'px';
      popover.style.top  = (barRect.top - wrapRect.top) + 'px';
      popover.style.animation = 'none';
      popover.offsetWidth;
      popover.style.animation = 'popoverFadeIn 0.2s cubic-bezier(0.34,1.4,0.64,1) both';
    });

    hit.addEventListener('mouseleave', () => {
      rect.style.filter = '';
      popover.style.display = 'none';
    });
  }

  // 아래에서 위로 솟아오르는 진입 애니메이션
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.querySelectorAll('rect[data-target-h]').forEach((r, i) => {
        r.style.transitionDelay = (i * 12) + 'ms';
        r.style.height = r.dataset.targetH;
        r.style.y = r.dataset.targetY;
      });
    });
  });

  const periodEl = document.getElementById('stat-heatmap-period');
  if (periodEl) periodEl.textContent = T('statsPeriod' + (period === 'today' ? 'Today' : period));
}

// 스트릭 달력 칸의 집중 강도 색 — solved.ac 스트릭 배지 참고, 연속
// 그라데이션이 아니라 이산 4단계(--scal-t1~t4, options.html에 라이트/다크
// 값 정의)로 매핑. 옅음→짙음으로 가다가 최상위(t4)만 채도 높은 튀는 색으로
// 반전시켜 "확 높은 집중"을 한눈에 강조한다. var()라 테마 전환 시 라이브 반영.
function _scalIntensityColor(intensity) {
  if (intensity >= 0.88) return 'var(--scal-t4)';
  if (intensity >= 0.65) return 'var(--scal-t3)';
  if (intensity >= 0.45) return 'var(--scal-t2)';
  return 'var(--scal-t1)';
}

function _renderStreakCalendar(allEvents, streak) {
  const container = document.getElementById('streakCalSector');
  if (!container) return;

  // 스트릭 달력이 포모도로 통계와 한 줄을 7:3 비율로 나눠 쓴다 — 그 폭(~880px)에
  // 맞춰 주 수를 잡는다. 실제 렌더 폭이 예상과 달라 넘치더라도
  // .scal-calendar-col의 overflow-x:auto가 받아준다.
  const WEEKS = 36;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // 이번 주 월요일 기준으로 13주 전 월요일 계산 (UTC 기준)
  const dow = today.getUTCDay();
  const daysToMon = dow === 0 ? 6 : dow - 1;
  const startTs = new Date(today);
  startTs.setUTCDate(startTs.getUTCDate() - daysToMon - (WEEKS - 1) * 7);
  startTs.setUTCHours(0, 0, 0, 0);

  // 날짜 문자열 배열 생성 (91개, 월요일부터)
  const dateStrs = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(startTs);
    d.setUTCDate(d.getUTCDate() + i);
    dateStrs.push(d.toISOString().slice(0, 10));
  }

  // 활동 맵: date → focusMins
  const activityMap = {};
  let maxMins = 1;
  allEvents.forEach(e => {
    const mins = e.focusMins || 0;
    const hasAny = mins > 0 || (e.blocks || []).length > 0 || (e.pomoSessions || []).length > 0;
    if (hasAny) {
      activityMap[e.date] = mins;
      if (mins > maxMins) maxMins = mins;
    }
  });

  // 스트릭 날짜 집합
  const streakDates = new Set();
  if (streak.current > 0 && streak.lastDate) {
    const parts = streak.lastDate.split('-').map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    for (let i = 0; i < streak.current; i++) {
      streakDates.add(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() - 1);
    }
  }

  // 내용 재구성
  container.innerHTML = '';

  // 상단 — 삭제된 히어로 카드가 보여주던 "현재 스트릭" 수치를 크게 표시.
  // 섹터 타이틀(예: "📅 스트릭 달력")은 위아래 여백만 늘려서 뺐다 — 아래
  // "🔥 연속 집중 스트릭" eyebrow 라벨이 사실상 같은 역할을 한다.
  // solved.ac 스트릭 달력처럼 큰 숫자 → 전체 폭 그리드 순서로 세로 배치.
  const top = document.createElement('div');
  top.className = 'scal-top';
  const eyebrowEl = document.createElement('div');
  eyebrowEl.className = 'stat-eyebrow';
  eyebrowEl.textContent = '🔥 연속 집중 스트릭';
  const valueEl = document.createElement('div');
  valueEl.className = 'stat-value';
  const valueNum = document.createElement('span');
  valueNum.textContent = String(streak.current);
  const valueUnit = document.createElement('span');
  valueUnit.className = 'stat-unit';
  valueUnit.textContent = '일째';
  valueEl.append(valueNum, valueUnit);
  top.append(eyebrowEl, valueEl);
  container.appendChild(top);

  // 달력 컬럼(섹터 전체 폭 사용)
  const calCol = document.createElement('div');
  calCol.className = 'scal-calendar-col';

  const PITCH = 23; // 칸 20px + gap 3px (CSS .scal-cell/.scal-days/.scal-grid와 짝 맞출 것)

  // 월 레이블
  const monthsEl = document.createElement('div');
  monthsEl.className = 'scal-months';
  monthsEl.style.width = (WEEKS * PITCH - 3) + 'px';
  let lastMonth = -1;
  for (let w = 0; w < WEEKS; w++) {
    const m = parseInt(dateStrs[w * 7].split('-')[1]) - 1;
    if (m !== lastMonth) {
      lastMonth = m;
      const lbl = document.createElement('span');
      lbl.textContent = (m + 1) + '월';
      lbl.style.left = (w * PITCH) + 'px';
      monthsEl.appendChild(lbl);
    }
  }

  // 그리드 레이아웃
  const wrap = document.createElement('div');
  wrap.className = 'scal-wrap';

  const daysEl = document.createElement('div');
  daysEl.className = 'scal-days';
  ['월', '', '수', '', '금', '', '일'].forEach(lbl => {
    const s = document.createElement('span');
    s.textContent = lbl;
    daysEl.appendChild(s);
  });

  const rightEl = document.createElement('div');
  rightEl.className = 'scal-right';

  const grid = document.createElement('div');
  grid.className = 'scal-grid';

  // 칸 hover 팝오버 — 브라우저 기본 title 툴팁(지연 있고 스타일링 불가)을 대체.
  const cellPopover = document.createElement('div');
  cellPopover.className = 'scal-cell-popover';

  dateStrs.forEach(ds => {
    const isFuture = ds > todayStr;
    const isToday = ds === todayStr;
    const hasActivity = ds in activityMap;
    const mins = activityMap[ds] || 0;
    const isStreak = streakDates.has(ds);

    const cell = document.createElement('div');
    cell.className = 'scal-cell';

    if (isFuture) {
      cell.style.opacity = '0';
    } else if (hasActivity) {
      const intensity = mins > 0 ? Math.min(1, 0.3 + (mins / maxMins) * 0.7) : 0.4;
      cell.style.background = _scalIntensityColor(intensity);
    } else {
      cell.style.background = 'var(--scal-cell-empty)';
    }

    if (isToday) {
      cell.style.outline = '2px solid var(--blue)';
      cell.style.outlineOffset = '-1px';
      cell.style.borderRadius = '2px';
    }

    if (!isFuture) {
      const [, mm, dd] = ds.split('-');
      const minsText = mins > 0 ? ` · ${_statsFormatMins(mins)}` : '';
      const popText = `${parseInt(mm)}/${parseInt(dd)}${minsText}${isStreak ? ' 🔥' : ''}`;
      cell.addEventListener('mouseenter', () => {
        cellPopover.textContent = popText;
        cellPopover.style.display = 'block';
        const cellRect = cell.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        cellPopover.style.left = (cellRect.left + cellRect.width / 2 - containerRect.left) + 'px';
        cellPopover.style.top = (cellRect.top - containerRect.top) + 'px';
        cellPopover.style.animation = 'none';
        cellPopover.offsetWidth;
        cellPopover.style.animation = 'popoverFadeIn 0.2s cubic-bezier(0.34,1.4,0.64,1) both';
      });
      cell.addEventListener('mouseleave', () => { cellPopover.style.display = 'none'; });
    }

    grid.appendChild(cell);
  });

  rightEl.append(monthsEl, grid);
  wrap.append(daysEl, rightEl);

  // 범례("없음/집중" 색 표기) — 달력 우상단에, 그리드 오른쪽 끝에 맞춰 배치.
  // 색 자체는 스트릭 여부와 무관하게 전부 집중 시간 강도(노란 계열) 하나로 통일돼
  // 있으므로, "며칠 연속인지"는 위쪽 큰 수치와 각 칸의 hover 툴팁으로 확인한다.
  const legendRow = document.createElement('div');
  legendRow.className = 'scal-legend-row';
  const legend = document.createElement('div');
  legend.className = 'scal-legend';
  const mkCell = (bg) => { const s = document.createElement('span'); s.className = 'scal-leg-cell'; s.style.background = bg; return s; };
  const mkLbl  = (t)  => { const s = document.createElement('span'); s.className = 'scal-leg-lbl';  s.textContent = t; return s; };
  legend.append(
    mkLbl('없음'), mkCell('var(--scal-cell-empty)'),
    mkCell('var(--scal-t1)'), mkCell('var(--scal-t2)'), mkCell('var(--scal-t3)'), mkCell('var(--scal-t4)'),
    mkLbl('집중')
  );
  legendRow.appendChild(legend);

  calCol.append(legendRow, wrap);
  container.append(calCol, cellPopover);

  // 하단 — 최장 기록 텍스트만 남음(범례는 위로 이동).
  const bestEl = document.createElement('div');
  bestEl.className = 'scal-best';
  bestEl.textContent = streak.longest > 0
    ? T('statsStreakBest', [String(streak.longest)])
    : T('statsStreakNone');
  container.appendChild(bestEl);
}

function renderStats(period) {
  _statsPeriod = period || _statsPeriod;

  document.querySelectorAll('.stats-period-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === _statsPeriod);
  });

  const keys = ['focusEvents', 'focusStreak', 'pomodoroSettings'];
  chrome.storage.local.get(keys, data => {
    const allEvents = data.focusEvents || [];
    const streak    = data.focusStreak || { current: 0, longest: 0, lastDate: '' };
    const todayStr  = _statsTodayStr();

    // 집중 시간 카드 (기간별 합산)
    const focusVal   = document.getElementById('stat-focus-val');
    const focusTitle = document.getElementById('stat-focus-title');
    const focusSub   = document.getElementById('stat-focus-sub');
    if (focusVal) {
      let mins = 0;
      if (_statsPeriod === 'today') {
        const todayLog = allEvents.find(e => e.date === todayStr);
        mins = todayLog ? (todayLog.focusMins || 0) : 0;
      } else {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - (_statsPeriod === '7d' ? 7 : 30));
        const cutStr = cutoff.toISOString().slice(0, 10);
        mins = allEvents.filter(e => e.date >= cutStr)
                        .reduce((s, e) => s + (e.focusMins || 0), 0);
      }
      focusVal.textContent = mins > 0 ? _statsFormatMins(mins) : '—';
      const pSuffix = _statsPeriod === 'today' ? '' : _statsPeriod;
      if (focusTitle) focusTitle.textContent = T('statsFocusTime' + pSuffix);
      if (focusSub)   focusSub.textContent   = T('statsFocusSub'  + pSuffix);
    }

    // 차단 횟수 카드 (기간 필터)
    const blockVal   = document.getElementById('stat-block-val');
    const blockTitle = document.getElementById('stat-block-title');
    const blockSub   = document.getElementById('stat-block-sub');
    if (blockVal) {
      const filtered = _statsPeriod === 'today'
        ? allEvents.filter(e => e.date === todayStr)
        : (() => {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - (_statsPeriod === '7d' ? 7 : 30));
            return allEvents.filter(e => e.date >= cutoff.toISOString().slice(0, 10));
          })();
      const total = filtered.reduce((s, e) => s + (e.blocks || []).length, 0);
      blockVal.textContent = total;
      const pSuffix = _statsPeriod === 'today' ? '' : _statsPeriod;
      if (blockTitle) blockTitle.textContent = T('statsBlockCount' + pSuffix);
      if (blockSub)   blockSub.textContent   = T('statsBlockSub'   + pSuffix);
    }

    // 차트 제목
    const chartTitle = document.getElementById('stat-chart-title');
    if (chartTitle) {
      chartTitle.textContent = T(_statsPeriod === '30d' ? 'statsChartTitle30' : 'statsChartTitle7');
    }

    // 서브 렌더러들
    _renderBlockBarChart(allEvents, _statsPeriod);
    const topPeriod = document.getElementById('stat-top-domains-period');
    if (topPeriod) topPeriod.textContent = T('statsPeriod' + (_statsPeriod === 'today' ? 'Today' : _statsPeriod));

    _renderTopDomains(
      _statsPeriod === 'today'
        ? allEvents.filter(e => e.date === todayStr)
        : allEvents.filter(e => {
            const c = new Date();
            if (_statsPeriod === '7d') c.setDate(c.getDate() - 7);
            else c.setDate(c.getDate() - 30);
            return e.date >= c.toISOString().slice(0, 10);
          })
    );
    _renderPomoStats(allEvents, _statsPeriod);
    _renderHeatmap(allEvents, _statsPeriod);
    _renderStreakCalendar(allEvents, streak);
  });
}

// ── DOMContentLoaded 진입점 ──
document.addEventListener('DOMContentLoaded', () => {
  // 요일 팝업 닫기 버튼
  document.getElementById('dayPopupCloseBtn')?.addEventListener('click', closeDayPopup);

  // 메인 탭
  document.querySelectorAll('.main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
      // 다른 탭으로 이동 시 박스 수정 모드 종료
      if (_editingBoxIndex !== null) exitBoxEditMode();
      if (tab.dataset.tab === 'stats') renderStats(_statsPeriod);
    });
  });

  // 통계 기간 탭
  document.querySelectorAll('.stats-period-tab').forEach(btn => {
    btn.addEventListener('click', () => renderStats(btn.dataset.period));
  });

  // focusEvents 변경 시 통계 탭이 열려있으면 실시간 재렌더링
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.focusEvents) return;
    const statsPanel = document.getElementById('tab-stats');
    if (statsPanel && statsPanel.classList.contains('active')) {
      renderStats(_statsPeriod);
    }
  });

  // 주 시작 토글 복원
  const weekStartWrap = document.getElementById('weekStartToggleWrap');
  chrome.storage.local.get(['weekStartMonday'], result => {
    weekStartMonday = !!result.weekStartMonday;
    const radio = document.querySelector(`input[name="weekStart"][value="${weekStartMonday ? 'mon' : 'sun'}"]`);
    if (radio) radio.checked = true;
    syncDaySelector();
  });
  document.querySelectorAll('input[name="weekStart"]').forEach(radio => {
    radio.addEventListener('change', () => {
      weekStartMonday = radio.value === 'mon';
      chrome.storage.local.set({ weekStartMonday });
      syncDaySelector();
      if (currentView === 'week') loadSettings();
    });
  });

  // 하루 스케줄 활성화 토글
  chrome.storage.local.get(['dailyScheduleEnabled'], result => {
    dailyScheduleEnabled = result.dailyScheduleEnabled !== false;
    const toggle = document.getElementById('dailyScheduleDisableToggle');
    if (toggle) toggle.checked = !dailyScheduleEnabled;
    applyDailyScheduleVisual();
  });
  document.getElementById('dailyScheduleDisableToggle')?.addEventListener('change', e => {
    if (_pinEnabled) {
      const toggle = e.target;
      toggle.checked = !toggle.checked; // 원래 상태 즉시 복원
      _openPinModal('비활성화', () => {
        toggle.checked = !toggle.checked;
        dailyScheduleEnabled = !toggle.checked;
        chrome.storage.local.set({ dailyScheduleEnabled });
        applyDailyScheduleVisual();
      });
      return;
    }
    dailyScheduleEnabled = !e.target.checked;
    chrome.storage.local.set({ dailyScheduleEnabled });
    applyDailyScheduleVisual();
  });

  // 다크모드 토글
  const darkModeToggle = document.getElementById('darkModeToggle');
  chrome.storage.local.get(['darkModeEnabled'], result => {
    if (darkModeToggle) darkModeToggle.checked = !!result.darkModeEnabled;
  });
  darkModeToggle?.addEventListener('change', e => {
    chrome.storage.local.set({ darkModeEnabled: e.target.checked });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.darkModeEnabled && darkModeToggle) {
      darkModeToggle.checked = !!changes.darkModeEnabled.newValue;
    }
  });

  function updateWeekStartToggleVisibility() {
    if (weekStartWrap) weekStartWrap.style.display = currentView === 'week' ? 'flex' : 'none';
  }
  updateWeekStartToggleVisibility();
  updateDailyToggleVisibility();

  initViewTabs(() => {
    updateWeekStartToggleVisibility();
    updateDailyToggleVisibility();
    applyDailyScheduleVisual();
  });
  loadSettings();

  // 스케줄러 섹터(타임테이블) 안에서 박스 이외의 곳을 클릭하면 상세 패널 닫기 + 선택 해제
  // 범위를 문서 전체가 아닌 이 섹터로 좁힌 이유: 박스 수정 시 폼(다른 섹터)에 입력하는 클릭까지 선택 해제로 이어지면 안 됨
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('weekDetailPanel');
    if (!panel || panel.style.display !== 'block') return;
    const sector = document.getElementById('schedulerSector');
    if (!sector || !sector.contains(e.target)) return; // 스케줄러 섹터 밖 클릭은 무시
    if (e.target.closest('.tbox')) return; // 박스 자체 클릭은 박스의 클릭 핸들러가 처리
    if (panel.contains(e.target)) return;  // 패널 내부(주소 추가 등) 클릭은 무시
    panel.style.display = 'none';
    panel.dataset.openIndex = '';
    document.querySelectorAll('.tbox.selected').forEach(el => el.classList.remove('selected'));
  });

  // 입력 시 경고 숨김
  ['generalDomainInput', 'permanentDomainInput', 'customDomainInput', 'boxName']
    .forEach((id, idx) => {
      document.getElementById(id)?.addEventListener('input', () => hideWarn(['generalWarn','permanentWarn','customWarn','boxWarn'][idx]));
    });
  ['startTime', 'endTime'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('input',  () => hideWarn('boxWarn'));
    el?.addEventListener('change', () => hideWarn('boxWarn'));
  });

  document.getElementById('permanentDomainInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('addPermanentBtn').click(); });
  document.getElementById('generalDomainInput')?.addEventListener('keydown',   e => { if (e.key === 'Enter') document.getElementById('addGeneralBtn').click(); });
  document.getElementById('customDomainInput')?.addEventListener('keydown',    e => { if (e.key === 'Enter') document.getElementById('addCustomStagingBtn').click(); });

  // 내보내기 / 불러오기
  document.getElementById('exportBtn')?.addEventListener('click', exportSettings);
  document.getElementById('importBtn')?.addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) { importSettings(file); e.target.value = ''; }
  });

  // ── PIN 초기화 ──
  _loadPinStatus();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.lockPin) return;
    const lp = changes.lockPin.newValue;
    _pinEnabled = !!(lp?.enabled && lp?.hash);
    _updatePinUI();
    loadSettings(); // 박스 카드 버튼 상태 재렌더링
  });

  // PIN 모달 이벤트
  document.getElementById('pinModalCancelBtn')?.addEventListener('click', _closePinModal);
  document.getElementById('pinModalConfirmBtn')?.addEventListener('click', _attemptPinUnlock);
  document.getElementById('pinModalOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'pinModalOverlay') _closePinModal();
  });
  document.getElementById('pinModalInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter')  _attemptPinUnlock();
    if (e.key === 'Escape') _closePinModal();
  });

  // PIN 등록
  async function _doSetPin() {
    const newPin     = document.getElementById('pinNewInput')?.value || '';
    const confirmPin = document.getElementById('pinNewConfirmInput')?.value || '';
    const errorEl    = document.getElementById('pinSetError');
    const showErr = msg => { if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; } };
    if (!newPin)            { showErr('PIN을 입력하세요.'); return; }
    if (newPin.length < 4)  { showErr('PIN은 4자 이상이어야 합니다.'); return; }
    if (newPin !== confirmPin) { showErr('PIN이 일치하지 않습니다.'); return; }
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    const hash = await _hashPin(newPin, salt);
    chrome.storage.local.set({ lockPin: { hash, salt, enabled: true } }, () => {
      if (errorEl) errorEl.style.display = 'none';
      document.getElementById('pinNewInput').value = '';
      document.getElementById('pinNewConfirmInput').value = '';
    });
  }
  document.getElementById('pinSetBtn')?.addEventListener('click', _doSetPin);
  ['pinNewInput','pinNewConfirmInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') _doSetPin(); });
    document.getElementById(id)?.addEventListener('input', () => {
      const err = document.getElementById('pinSetError');
      if (err) err.style.display = 'none';
    });
  });

  // PIN 변경
  async function _doChangePin() {
    const currentPin = document.getElementById('pinCurrentInput')?.value    || '';
    const newPin     = document.getElementById('pinChangeNewInput')?.value   || '';
    const confirmPin = document.getElementById('pinChangeConfirmInput')?.value || '';
    const errorEl    = document.getElementById('pinChangeError');
    const showErr = msg => { if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; } };
    if (!currentPin || !newPin || !confirmPin) { showErr('모든 항목을 입력하세요.'); return; }
    if (newPin.length < 4)  { showErr('새 PIN은 4자 이상이어야 합니다.'); return; }
    if (newPin !== confirmPin) { showErr('새 PIN이 일치하지 않습니다.'); return; }
    chrome.storage.local.get(['lockPin'], async result => {
      const lp = result.lockPin;
      if (!lp?.hash || !lp?.salt) return;
      const hash = await _hashPin(currentPin, lp.salt);
      if (hash !== lp.hash) {
        showErr('현재 PIN이 올바르지 않습니다.');
        document.getElementById('pinCurrentInput').value = '';
        return;
      }
      const newSalt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
      const newHash = await _hashPin(newPin, newSalt);
      chrome.storage.local.set({ lockPin: { hash: newHash, salt: newSalt, enabled: true } }, () => {
        if (errorEl) errorEl.style.display = 'none';
        ['pinCurrentInput','pinChangeNewInput','pinChangeConfirmInput'].forEach(id => {
          const el = document.getElementById(id); if (el) el.value = '';
        });
      });
    });
  }
  document.getElementById('pinChangeBtn')?.addEventListener('click', _doChangePin);
  ['pinCurrentInput','pinChangeNewInput','pinChangeConfirmInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') _doChangePin(); });
    document.getElementById(id)?.addEventListener('input', () => {
      const err = document.getElementById('pinChangeError');
      if (err) err.style.display = 'none';
    });
  });

  // PIN 해제
  document.getElementById('pinRemoveBtn')?.addEventListener('click', () => {
    _openPinModal('PIN 해제', () => {
      chrome.storage.local.set({ lockPin: { hash: '', salt: '', enabled: false } });
    });
  });
});

// ═══════════════════════════════════════════════
// 포모도로 타이머 탭
// ═══════════════════════════════════════════════

let _pomoInterval      = null;
let _pomoPreviewActive = false;
let _pomoPreviewTimer  = null;

function _fmtPomoTime(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

// 누르고 있으면 연속 입력되는 스테퍼 버튼 헬퍼 (정적/동적 요소 공용)
function _makeRepeatBtnEl(btn, action) {
  if (!btn) return;
  let timer = null;
  const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const schedule = (delay) => {
    timer = setTimeout(() => {
      action();
      schedule(Math.max(80, Math.floor(delay * 0.65)));
    }, delay);
  };
  btn.addEventListener('mousedown', e => { e.preventDefault(); action(); schedule(400); });
  btn.addEventListener('mouseup', stop);
  btn.addEventListener('mouseleave', stop);
}

function _resolveCycleTimes(cycleNum, settings, overrides) {
  const found = (overrides || []).find(o => o.cycle === cycleNum);
  return {
    workMins: found ? found.workMins : settings.workMins,
    restMins: found ? found.restMins : settings.restMins,
  };
}

function _findCycleOverride(cycleNum, overrides) {
  return (overrides || []).find(o => o.cycle === cycleNum) || null;
}

// baseSettings와 실제로 다른(우연히 값이 같지 않은) 예외만 골라낸다
function _cycleOverrideDiffs(baseSettings, overrides) {
  return (overrides || []).filter(o => o.workMins !== baseSettings.workMins || o.restMins !== baseSettings.restMins);
}

function _createAdjustIcon(cls) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (cls) svg.setAttribute('class', cls);
  [[4, 6, 20, 6], [4, 12, 20, 12], [4, 18, 20, 18]].forEach(([x1, y1, x2, y2]) => {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    svg.appendChild(line);
  });
  [[8, 6], [16, 12], [10, 18]].forEach(([cx, cy]) => {
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', 2);
    svg.appendChild(c);
  });
  return svg;
}

function _updateAdvancedFeedback(settings, overrides) {
  const diffs   = _cycleOverrideDiffs(settings, overrides);
  const btn     = document.getElementById('pomoAdvancedBtn');
  const summary = document.getElementById('pomoAdvancedSummary');
  if (btn) {
    btn.textContent = diffs.length ? `${T('pomoAdvancedBtn')} · ${diffs.length}` : T('pomoAdvancedBtn');
    btn.classList.toggle('pomo-advanced-btn-active', diffs.length > 0);
  }
  if (summary) {
    if (diffs.length) {
      const cycles = diffs.map(d => d.cycle).sort((a, b) => a - b);
      summary.textContent = cycles.length <= 3
        ? `${cycles.join(', ')}${T('pomoAdvancedDiffLineSuffix')}`
        : `${cycles.length}${T('pomoAdvancedDiffCountSuffix')}`;
      summary.style.display = '';
    } else {
      summary.style.display = 'none';
    }
  }
}

function renderPomoList(list) {
  const ul = document.getElementById('pomoList');
  if (!ul) return;
  ul.innerHTML = '';
  list.forEach((domain, i) => {
    const li   = document.createElement('li');
    li.className = 'custom-domain-item';
    const span = document.createElement('span');
    span.textContent = domain; span.title = domain; span.className = 'domain-text';
    const del = _makeTrashButton(T('delete'), () => {
      chrome.storage.local.get(['pomodoroList'], r => {
        const arr = r.pomodoroList || [];
        arr.splice(i, 1);
        chrome.storage.local.set({ pomodoroList: arr }, loadPomoData);
      });
    });
    li.append(span, del);
    ul.appendChild(li);
  });
}

const POMO_PRESET_PAGE_SIZE = 4;
let _pomoPresetPage = 0;
let _pomoPresetsCache = [];
let _pomoPresetEditing = false;

function _applyPomoPreset(preset) {
  _savePomoSettings({ workMins: preset.workMins, restMins: preset.restMins, cycles: preset.cycles }, null);
  chrome.storage.local.set({ pomodoroCycleOverrides: (preset.cycleOverrides || []).map(o => ({ ...o })) });
}

function renderPomoPresets(presets) {
  _pomoPresetsCache = presets;
  const ul        = document.getElementById('pomoPresetList');
  const empty     = document.getElementById('pomoPresetEmpty');
  const prevBtn   = document.getElementById('pomoPresetPrevBtn');
  const nextBtn   = document.getElementById('pomoPresetNextBtn');
  const indicator = document.getElementById('pomoPresetPageIndicator');
  if (!ul) return;

  const totalPages = Math.max(1, Math.ceil(presets.length / POMO_PRESET_PAGE_SIZE));
  _pomoPresetPage = Math.min(Math.max(_pomoPresetPage, 0), totalPages - 1);

  const hasItems = presets.length > 0;
  empty.style.display = hasItems ? 'none' : '';
  if (indicator) { indicator.style.display = hasItems ? '' : 'none'; indicator.textContent = `${_pomoPresetPage + 1} / ${totalPages}`; }
  if (prevBtn) { prevBtn.style.visibility = hasItems ? 'visible' : 'hidden'; prevBtn.disabled = _pomoPresetPage <= 0; }
  if (nextBtn) { nextBtn.style.visibility = hasItems ? 'visible' : 'hidden'; nextBtn.disabled = _pomoPresetPage >= totalPages - 1; }

  ul.classList.toggle('editing', _pomoPresetEditing);
  ul.innerHTML = '';
  const start = _pomoPresetPage * POMO_PRESET_PAGE_SIZE;
  presets.slice(start, start + POMO_PRESET_PAGE_SIZE).forEach((preset, idx) => {
    const i  = start + idx;
    const li = document.createElement('li');
    li.className = 'pomo-preset-item';
    li.onclick = () => _applyPomoPreset(preset);

    const delX = _makeTrashButton(T('delete'), (e) => {
      e.stopPropagation();
      chrome.storage.local.get(['pomodoroPresets'], r => {
        const arr = r.pomodoroPresets || [];
        arr.splice(i, 1);
        chrome.storage.local.set({ pomodoroPresets: arr }, loadPomoData);
      });
    }, 'pomo-preset-del-x');

    const name = document.createElement('span');
    name.className = 'pomo-preset-name';
    name.textContent = preset.name;
    name.title = preset.name;

    const diffs = _cycleOverrideDiffs({ workMins: preset.workMins, restMins: preset.restMins }, preset.cycleOverrides);

    const metaRow = document.createElement('div');
    metaRow.className = 'pomo-preset-meta-row';
    const meta = document.createElement('span');
    meta.className = 'pomo-preset-meta';
    meta.textContent = `${preset.workMins}/${preset.restMins} · ${preset.cycles}${T('pomoTimes')}`;
    metaRow.appendChild(meta);
    if (diffs.length) metaRow.appendChild(_createAdjustIcon('pomo-preset-override-icon'));

    li.append(delX, name, metaRow);
    if (diffs.length) {
      const summary = document.createElement('span');
      summary.className = 'pomo-preset-override-summary';
      summary.textContent = `${diffs.length}${T('pomoAdvancedDiffCountSuffix')}`;
      li.appendChild(summary);
    }
    ul.appendChild(li);
  });
}

// ═══════════════════════════════════════════════
// 고급 설정 (회차별 작업/휴식 시간 예외)
// ═══════════════════════════════════════════════

let _advDraftSettings  = { workMins: 25, restMins: 5, cycles: 2 };
let _advDraftOverrides = []; // [{ cycle, name, workMins, restMins }]

function _advCycleLabel(n) {
  return `${n}${T('pomoAdvancedCycleSuffix')}`;
}

function _renderAdvancedBaseText() {
  const el = document.getElementById('pomoAdvancedBaseText');
  if (!el) return;
  const s = _advDraftSettings;
  el.textContent = `${T('pomoAdvancedBaseLabel')}: ${s.workMins}${T('pomoMin')} / ${s.restMins}${T('pomoMin')} · ${s.cycles}${T('pomoTimes')}`;
}

function _renderCyclePicker() {
  const grid   = document.getElementById('pomoCyclePickerGrid');
  const addBtn = document.getElementById('pomoAdvancedAddBtn');
  if (!grid) return;
  const used = new Set(_advDraftOverrides.map(o => o.cycle));
  grid.innerHTML = '';
  let available = 0;
  for (let n = 1; n <= _advDraftSettings.cycles; n++) {
    if (used.has(n)) continue;
    available++;
    const btn = document.createElement('button');
    btn.className = 'pomo-cycle-picker-item';
    btn.textContent = _advCycleLabel(n);
    btn.onclick = () => {
      _advDraftOverrides.push({ cycle: n, name: '', workMins: _advDraftSettings.workMins, restMins: _advDraftSettings.restMins });
      document.getElementById('pomoCyclePicker')?.classList.remove('open');
      _renderAdvancedList();
      _renderCyclePicker();
    };
    grid.appendChild(btn);
  }
  if (available === 0) {
    const p = document.createElement('p');
    p.className = 'pomo-cycle-picker-empty';
    p.textContent = T('pomoAdvancedPickerEmpty');
    grid.appendChild(p);
  }
  if (addBtn) addBtn.disabled = available === 0;
}

function _advEffectiveName(item) {
  return (item.name || '').trim() || _advCycleLabel(item.cycle);
}

function _buildAdvItemRow(labelText, item, key, min, max) {
  const row = document.createElement('div');
  row.className = 'pomo-advanced-item-fields';

  const label = document.createElement('span');
  label.className = 'pomo-advanced-item-label';
  label.textContent = labelText;

  const numWrap = document.createElement('div');
  numWrap.className = 'pomo-num-input';
  const decrBtn = document.createElement('button');
  decrBtn.type = 'button'; decrBtn.className = 'pomo-num-btn'; decrBtn.textContent = '−';
  const valInput = document.createElement('input');
  valInput.type = 'number'; valInput.className = 'pomo-num-val'; valInput.value = item[key];
  const incrBtn = document.createElement('button');
  incrBtn.type = 'button'; incrBtn.className = 'pomo-num-btn'; incrBtn.textContent = '+';
  numWrap.append(decrBtn, valInput, incrBtn);

  const unit = document.createElement('span');
  unit.className = 'pomo-advanced-item-unit';
  unit.textContent = T('pomoMin');

  const commit = v => {
    v = Math.max(min, Math.min(max, v));
    item[key] = v;
    valInput.value = v;
  };
  _makeRepeatBtnEl(decrBtn, () => { if (item[key] > min) commit(item[key] - 1); });
  _makeRepeatBtnEl(incrBtn, () => { if (item[key] < max) commit(item[key] + 1); });
  valInput.addEventListener('input', () => {
    const v = parseInt(valInput.value);
    if (!isNaN(v) && v > max) valInput.value = max;
  });
  valInput.addEventListener('change', () => {
    let v = parseInt(valInput.value);
    if (isNaN(v)) v = item[key];
    commit(v);
  });

  row.append(label, numWrap, unit);
  return row;
}

function _renderAdvancedList() {
  const ul    = document.getElementById('pomoAdvancedList');
  const empty = document.getElementById('pomoAdvancedEmpty');
  if (!ul) return;
  ul.innerHTML = '';
  _advDraftOverrides.sort((a, b) => a.cycle - b.cycle);
  empty.style.display = _advDraftOverrides.length ? 'none' : '';

  _advDraftOverrides.forEach(item => {
    const li = document.createElement('li');
    li.className = 'pomo-advanced-item';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'pomo-advanced-name-input';
    nameInput.maxLength = 30;
    nameInput.value = item.name || '';
    nameInput.placeholder = `${T('pomoAdvancedNameLabel')}/${T('pomoAdvancedBaseLabel')}: ${_advCycleLabel(item.cycle)}`;

    const cycleTag = document.createElement('span');
    cycleTag.className = 'pomo-advanced-item-cycletag';
    cycleTag.textContent = _advCycleLabel(item.cycle);
    cycleTag.style.display = (item.name || '').trim() ? '' : 'none';

    nameInput.addEventListener('input', () => {
      item.name = nameInput.value;
      cycleTag.style.display = (item.name || '').trim() ? '' : 'none';
    });

    const workFields = _buildAdvItemRow(T('pomoAdvancedWorkLabel'), item, 'workMins', 1, 60);
    const restFields = _buildAdvItemRow(T('pomoAdvancedRestLabel'), item, 'restMins', 1, 60);

    const delBtn = document.createElement('button');
    delBtn.className = 'pomo-advanced-item-del';
    delBtn.textContent = '×';
    delBtn.title = T('delete');
    delBtn.onclick = () => {
      _advDraftOverrides = _advDraftOverrides.filter(o => o !== item);
      _renderAdvancedList();
      _renderCyclePicker();
    };

    li.append(nameInput, cycleTag, workFields, restFields, delBtn);
    ul.appendChild(li);
  });
}

const ADV_BASE_INPUT_IDS = { workMins: 'advWorkVal', restMins: 'advRestVal', cycles: 'advCyclesVal' };

function _advSetBase(key, newVal) {
  const oldVal = _advDraftSettings[key];
  _advDraftSettings[key] = newVal;
  const el = document.getElementById(ADV_BASE_INPUT_IDS[key]);
  if (el) el.value = newVal;
  if (key === 'workMins' || key === 'restMins') {
    _advDraftOverrides.forEach(o => { if (o[key] === oldVal) o[key] = newVal; });
  }
  if (key === 'cycles') {
    _advDraftOverrides = _advDraftOverrides.filter(o => o.cycle <= newVal);
  }
  _renderAdvancedBaseText();
  _renderAdvancedList();
  _renderCyclePicker();
}

function _openAdvancedModal() {
  chrome.storage.local.get(['pomodoroSettings', 'pomodoroCycleOverrides'], data => {
    const settings = data.pomodoroSettings || { workMins: 25, restMins: 5, cycles: 2 };
    _advDraftSettings  = { workMins: settings.workMins, restMins: settings.restMins, cycles: settings.cycles };
    _advDraftOverrides = (data.pomodoroCycleOverrides || []).map(o => ({
      ...o,
      name: o.name === _advCycleLabel(o.cycle) ? '' : o.name,
    }));

    const wEl = document.getElementById('advWorkVal');
    const rEl = document.getElementById('advRestVal');
    const cEl = document.getElementById('advCyclesVal');
    if (wEl) wEl.value = _advDraftSettings.workMins;
    if (rEl) rEl.value = _advDraftSettings.restMins;
    if (cEl) cEl.value = _advDraftSettings.cycles;

    _renderAdvancedBaseText();
    _renderAdvancedList();
    _renderCyclePicker();

    const overlay = document.getElementById('pomoAdvancedOverlay');
    if (overlay) overlay.style.display = 'flex';
  });
}

function _closeAdvancedModal() {
  const overlay = document.getElementById('pomoAdvancedOverlay');
  if (overlay) overlay.style.display = 'none';
  document.getElementById('pomoCyclePicker')?.classList.remove('open');
  document.getElementById('pomoAdvSavePopover')?.classList.remove('open');
}

function updatePomoDisplay(state, settings, overrides) {
  if (_pomoPreviewActive) return;
  const display    = document.getElementById('pomoDisplay');
  const phaseEl    = document.getElementById('pomoPhaseLabel');
  const timeEl     = document.getElementById('pomoTimeLabel');
  const cycleEl    = document.getElementById('pomoCycleLabel');
  const startBtn   = document.getElementById('pomoStartBtn');
  const customBadge = document.getElementById('pomoCustomBadge');
  if (!display) return;

  const phase       = state?.phase || 'idle';
  const totalCycles = state?.totalCycles || settings.cycles;
  const cycle       = state?.cycle       || 1;
  const isActive    = !!state?.active;
  const effectiveCycle = phase === 'idle' ? 1 : cycle;
  const ov = _findCycleOverride(effectiveCycle, overrides);

  display.className = 'pomo-display' + (phase !== 'idle' ? ' phase-' + phase : '');

  const phaseNames = { work: T('pomoWork'), rest: T('pomoRest'), done: T('pomoDone'), idle: T('pomoIdle') };
  let phaseText = phaseNames[phase] || T('pomoIdle');
  if ((phase === 'work' || phase === 'rest') && ov) {
    phaseText = `${_advEffectiveName(ov)} · ${phaseText}`;
  }
  if (phaseEl) phaseEl.textContent = phaseText;

  if (timeEl) {
    if (isActive && state.endTime) {
      const rem = Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000));
      timeEl.textContent = _fmtPomoTime(rem);
    } else if (!isActive && state?.pausedRemaining != null) {
      timeEl.textContent = _fmtPomoTime(state.pausedRemaining);
    } else if (phase === 'done') {
      timeEl.textContent = '00:00';
    } else {
      const cur = _resolveCycleTimes(1, settings, overrides);
      timeEl.textContent = _fmtPomoTime(cur.workMins * 60);
    }
  }

  if (cycleEl) {
    cycleEl.textContent = phase === 'idle'
      ? `1 / ${settings.cycles}`
      : `${cycle} / ${totalCycles}`;
  }

  if (customBadge) {
    const differs = ov && (ov.workMins !== settings.workMins || ov.restMins !== settings.restMins);
    customBadge.style.display = (phase !== 'done' && differs) ? '' : 'none';
  }

  if (startBtn) {
    startBtn.disabled = phase === 'done';
    if (isActive)                              startBtn.textContent = T('pomoPause');
    else if (phase === 'work' || phase === 'rest') startBtn.textContent = T('pomoResume');
    else                                       startBtn.textContent = T('pomoStart');
  }

  const isDone   = phase === 'done';
  const resetBtn = document.getElementById('pomoResetBtn');
  const doneBtn  = document.getElementById('pomoDoneBtn');
  if (startBtn) startBtn.style.display = isDone ? 'none' : '';
  if (resetBtn) resetBtn.style.display = isDone ? 'none' : '';
  if (doneBtn)  doneBtn.style.display  = isDone ? '' : 'none';

  const settingsBtns = ['workDecrBtn','workIncrBtn','restDecrBtn','restIncrBtn','cyclesDecrBtn','cyclesIncrBtn','pomoWorkVal','pomoRestVal','pomoCyclesVal','pomoSavePresetBtn','pomoAdvancedBtn','pomoPresetEditBtn'];
  settingsBtns.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = isActive; });
  document.getElementById('pomoPresetList')?.classList.toggle('pomo-preset-list-disabled', isActive);
}

function _previewPomoDisplay(previewPhase, secs, cycles) {
  const display = document.getElementById('pomoDisplay');
  if (display) display.className = 'pomo-display phase-' + previewPhase;
  const phaseEl = document.getElementById('pomoPhaseLabel');
  if (phaseEl) phaseEl.textContent = previewPhase === 'work' ? T('pomoWork') : T('pomoRest');
  const timeEl = document.getElementById('pomoTimeLabel');
  if (timeEl) timeEl.textContent = _fmtPomoTime(secs);
  const cycleEl = document.getElementById('pomoCycleLabel');
  if (cycleEl) cycleEl.textContent = `1 / ${cycles}`;
}

function _advancePomoPhase(state, settings, overrides) {
  const now         = Date.now();
  const cycle       = state.cycle       || 1;
  const totalCycles = state.totalCycles || settings.cycles;
  let newState;

  if (state.phase === 'work') {
    const cur = _resolveCycleTimes(cycle, settings, overrides);
    newState = cycle >= totalCycles
      ? { active: false, phase: 'done', endTime: null, cycle, totalCycles, advancedAt: now }
      : { ...state, phase: 'rest', endTime: now + cur.restMins * 60 * 1000, advancedAt: now };
    _statsLogPomoSession(cur.workMins);
  } else if (state.phase === 'rest') {
    const next = _resolveCycleTimes(cycle + 1, settings, overrides);
    newState = { ...state, phase: 'work', endTime: now + next.workMins * 60 * 1000, cycle: cycle + 1, advancedAt: now };
  }

  if (newState) chrome.storage.local.set({ pomodoroState: newState });
}

function _pomoTick() {
  chrome.storage.local.get(['pomodoroState', 'pomodoroSettings', 'pomodoroCycleOverrides'], data => {
    const state     = data.pomodoroState    || { active: false, phase: 'idle' };
    const settings  = data.pomodoroSettings || { workMins: 25, restMins: 5, cycles: 2 };
    const overrides = data.pomodoroCycleOverrides || [];
    if (state.active && state.endTime && Date.now() >= state.endTime) {
      _advancePomoPhase(state, settings, overrides);
    } else {
      updatePomoDisplay(state, settings, overrides);
    }
    // endTime 기준 초 경계에 정렬해 다음 tick 예약 — setInterval 드리프트 방지
    let delay = 1000;
    if (state.active && state.endTime) {
      const rem = state.endTime - Date.now();
      if (rem > 0) delay = (rem % 1000) || 1000;
    }
    _pomoInterval = setTimeout(_pomoTick, delay);
  });
}

function loadPomoData() {
  chrome.storage.local.get(['pomodoroSettings', 'pomodoroList', 'pomodoroState', 'pomodoroPresets', 'pomodoroCycleOverrides'], data => {
    const settings  = data.pomodoroSettings || { workMins: 25, restMins: 5, cycles: 2 };
    const list      = data.pomodoroList     || [];
    const state     = data.pomodoroState    || { active: false, phase: 'idle' };
    const presets   = data.pomodoroPresets  || [];
    const overrides = data.pomodoroCycleOverrides || [];

    const wEl = document.getElementById('pomoWorkVal');
    const rEl = document.getElementById('pomoRestVal');
    const cEl = document.getElementById('pomoCyclesVal');
    if (wEl) wEl.value = settings.workMins;
    if (rEl) rEl.value = settings.restMins;
    if (cEl) cEl.value = settings.cycles;

    renderPomoList(list);
    renderPomoPresets(presets);
    updatePomoDisplay(state, settings, overrides);
    _updateAdvancedFeedback(settings, overrides);
  });
}

function _getPomoSettingsFromUI() {
  return {
    workMins: parseInt(document.getElementById('pomoWorkVal')?.value) || 25,
    restMins: parseInt(document.getElementById('pomoRestVal')?.value) || 5,
    cycles:   parseInt(document.getElementById('pomoCyclesVal')?.value) || 2,
  };
}

function _savePomoSettings(s, previewPhase) {
  chrome.storage.local.set({ pomodoroSettings: s });
  const wEl = document.getElementById('pomoWorkVal');
  const rEl = document.getElementById('pomoRestVal');
  const cEl = document.getElementById('pomoCyclesVal');
  if (wEl) wEl.value = s.workMins;
  if (rEl) rEl.value = s.restMins;
  if (cEl) cEl.value = s.cycles;

  if (previewPhase) {
    // onChanged → loadPomoData → updatePomoDisplay 연쇄가 preview를 덮어쓰지 못하도록 플래그 설정
    _pomoPreviewActive = true;
    clearTimeout(_pomoPreviewTimer);
    _pomoPreviewTimer = setTimeout(() => {
      _pomoPreviewActive = false;
      chrome.storage.local.get(['pomodoroState', 'pomodoroSettings', 'pomodoroCycleOverrides'], d => {
        updatePomoDisplay(d.pomodoroState || { active: false, phase: 'idle' }, d.pomodoroSettings || s, d.pomodoroCycleOverrides || []);
      });
    }, 1500);
    const secs = previewPhase === 'work' ? s.workMins * 60 : s.restMins * 60;
    _previewPomoDisplay(previewPhase, secs, s.cycles);
  } else {
    chrome.storage.local.get(['pomodoroState', 'pomodoroCycleOverrides'], d => {
      const state = d.pomodoroState || { active: false, phase: 'idle' };
      if (!state.active) updatePomoDisplay(state, s, d.pomodoroCycleOverrides || []);
    });
  }
}

function _importFromList(storageKey) {
  chrome.storage.local.get([storageKey, 'pomodoroList'], data => {
    const source  = data[storageKey]  || [];
    const current = data.pomodoroList || [];
    const curSet  = new Set(current);
    const toAdd   = source.filter(d => !curSet.has(d));
    if (!toAdd.length) { alert(T('noNewItems')); return; }
    chrome.storage.local.set({ pomodoroList: [...current, ...toAdd] }, loadPomoData);
  });
  document.getElementById('pomoImportMenu')?.classList.remove('open');
}

document.addEventListener('DOMContentLoaded', () => {

  // ── 반복 입력 헬퍼 (누르고 있으면 연속 입력) ──
  function _makeRepeatBtn(id, action) {
    _makeRepeatBtnEl(document.getElementById(id), action);
  }

  // ── 설정 +/- 버튼 ──
  [
    { decr: 'workDecrBtn',   incr: 'workIncrBtn',   key: 'workMins', min: 1, max: 60, preview: 'work' },
    { decr: 'restDecrBtn',   incr: 'restIncrBtn',   key: 'restMins', min: 1, max: 60, preview: 'rest' },
    { decr: 'cyclesDecrBtn', incr: 'cyclesIncrBtn', key: 'cycles',   min: 1, max: 10, preview: null   },
  ].forEach(({ decr, incr, key, min, max, preview }) => {
    _makeRepeatBtn(decr, () => {
      const s = _getPomoSettingsFromUI(); if (s[key] <= min) return;
      s[key]--; _savePomoSettings(s, preview);
    });
    _makeRepeatBtn(incr, () => {
      const s = _getPomoSettingsFromUI(); if (s[key] >= max) return;
      s[key]++; _savePomoSettings(s, preview);
    });
  });

  // ── 숫자 직접 입력 처리 ──
  [
    { id: 'pomoWorkVal',   key: 'workMins', min: 1, max: 60, fallback: 25, preview: 'work' },
    { id: 'pomoRestVal',   key: 'restMins', min: 1, max: 60, fallback: 5,  preview: 'rest' },
    { id: 'pomoCyclesVal', key: 'cycles',   min: 1, max: 10, fallback: 2,  preview: null   },
  ].forEach(({ id, key, min, max, fallback, preview }) => {
    const el = document.getElementById(id);
    if (!el) return;
    // 입력 중 최대값 초과 시 즉시 클램핑 (저장은 change에서만)
    el.addEventListener('input', () => {
      const v = parseInt(el.value);
      if (!isNaN(v) && v > max) el.value = max;
    });
    el.addEventListener('change', () => {
      let val = parseInt(el.value);
      if (isNaN(val)) val = fallback;
      val = Math.max(min, Math.min(max, val));
      el.value = val;
      const s = _getPomoSettingsFromUI();
      s[key] = val;
      _savePomoSettings(s, preview);
    });
  });

  // ── 시작 / 일시정지 / 재개 ──
  document.getElementById('pomoStartBtn')?.addEventListener('click', () => {
    chrome.storage.local.get(['pomodoroState', 'pomodoroSettings', 'pomodoroCycleOverrides'], data => {
      const state     = data.pomodoroState    || { active: false, phase: 'idle' };
      const settings  = data.pomodoroSettings || _getPomoSettingsFromUI();
      const overrides = data.pomodoroCycleOverrides || [];

      if (state.active) {
        const rem = Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000));
        chrome.storage.local.set({ pomodoroState: { ...state, active: false, endTime: null, pausedRemaining: rem } });
      } else if (state.phase === 'idle' || state.phase === 'done') {
        const s = _getPomoSettingsFromUI();
        const cur = _resolveCycleTimes(1, s, overrides);
        chrome.storage.local.set({
          pomodoroSettings: s,
          pomodoroState: { active: true, phase: 'work', endTime: Date.now() + cur.workMins * 60 * 1000, cycle: 1, totalCycles: s.cycles },
        });
      } else {
        const cur = _resolveCycleTimes(state.cycle || 1, settings, overrides);
        const rem = state.pausedRemaining ?? (state.phase === 'work' ? cur.workMins * 60 : cur.restMins * 60);
        chrome.storage.local.set({ pomodoroState: { ...state, active: true, endTime: Date.now() + rem * 1000, pausedRemaining: null } });
      }
    });
  });

  // ── 중지 / 완료 확인 ──
  function _resetPomoState() {
    chrome.storage.local.get(['pomodoroSettings'], d => {
      const s = d.pomodoroSettings || { workMins: 25, restMins: 5, cycles: 2 };
      chrome.storage.local.set({ pomodoroState: { active: false, phase: 'idle', endTime: null, cycle: 1, totalCycles: s.cycles } });
    });
  }
  document.getElementById('pomoResetBtn')?.addEventListener('click', _resetPomoState);
  document.getElementById('pomoDoneBtn')?.addEventListener('click', _resetPomoState);

  // ── 기본 상단 탭 고정 체크박스 ──
  // pomodoroDefaultAlwaysOnTop은 이 체크박스만 쓰고 바꾸는 영구 설정이다. popup 안 토글은
  // 그때그때의 세션(지금 열린 창을 pin할지)만 다루고, 이 기본값에는 관여하지 않는다 —
  // 그래야 "기본 켜짐" 상태에서 popup 쪽 토글을 껐다 닫아도 다음 PiP 클릭은 여전히 곧장 PiP로 간다.
  const defaultAotCheckbox = document.getElementById('pomoDefaultAlwaysOnTop');
  const aotCheckboxSupported = 'documentPictureInPicture' in window;
  if (defaultAotCheckbox) {
    defaultAotCheckbox.disabled = !aotCheckboxSupported;
    chrome.storage.local.get(['pomodoroDefaultAlwaysOnTop'], ({ pomodoroDefaultAlwaysOnTop }) => {
      defaultAotCheckbox.checked = aotCheckboxSupported && !!pomodoroDefaultAlwaysOnTop;
    });
    defaultAotCheckbox.addEventListener('change', () => {
      chrome.storage.local.set({ pomodoroDefaultAlwaysOnTop: defaultAotCheckbox.checked });
    });
  }

  // ── PiP 버튼 ──
  // pomodoroDefaultAlwaysOnTop이 켜져 있으면 html 팝업을 띄우지 않고 바로 실제 PiP로 진입한다.
  document.getElementById('pomoPipBtn')?.addEventListener('click', () => {
    const aotSupported = 'documentPictureInPicture' in window;
    chrome.storage.local.get(['pomodoroDefaultAlwaysOnTop'], ({ pomodoroDefaultAlwaysOnTop }) => {
      if (aotSupported && pomodoroDefaultAlwaysOnTop) {
        _createDirectPipWindow();
        return;
      }
      chrome.storage.local.get(['pipWindowId'], ({ pipWindowId }) => {
        if (pipWindowId) {
          chrome.windows.get(pipWindowId, win => {
            if (chrome.runtime.lastError || !win) {
              _createPipWindow();
            } else {
              chrome.windows.update(pipWindowId, { focused: true });
            }
          });
        } else {
          _createPipWindow();
        }
      });
    });
  });

  function _createPipWindow() {
    const pipUrl = chrome.runtime.getURL('pomodoro-pip.html');
    chrome.storage.local.get(['pomodoroPipPos'], ({ pomodoroPipPos }) => {
      const opts = { url: pipUrl, type: 'popup', width: 280, height: 340 };
      if (pomodoroPipPos) { opts.left = pomodoroPipPos.left; opts.top = pomodoroPipPos.top; }
      chrome.windows.create(opts, win => {
        chrome.storage.local.set({ pipWindowId: win.id });
      });
    });
  }

  // ── 옵션 페이지를 opener로 바로 실제 PiP(always-on-top) 창을 여는 경로 ──
  // 옵션 페이지 클릭에는 진짜 user activation이 있으므로 requestWindow()는 여기서 바로 호출한다.
  // 콘텐츠는 숨겨진 iframe으로 pomodoro-pip.html을 정상적으로 로드시킨 뒤,
  // 그 안에서 이미 살아 움직이는 DOM/로직을 pipWindow로 옮겨 재사용한다
  // (pip 문서에 <script>를 직접 주입하는 방식은 동작하지 않아 폐기했다).
  async function _createDirectPipWindow() {
    if (documentPictureInPicture.window) {
      documentPictureInPicture.window.focus();
      return;
    }
    let pipWindow;
    try {
      pipWindow = await documentPictureInPicture.requestWindow({ width: 280, height: 340 });
    } catch (e) {
      _createPipWindow();
      return;
    }

    // Document PiP 창은 moveTo()로 스폰 위치를 지정할 수 없어(크롬이 자체 배치) 위치 지정은 포기했다.

    // iframe은 pip 세션이 끝날 때(pomodoro-pip.js가 window.frameElement.remove()를 호출) 스스로 정리된다.
    // 여기서 바로 제거하면 그 안에서 동작 중인 realm이 통째로 사라질 수 있다.
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = chrome.runtime.getURL('pomodoro-pip.html');
    iframe.addEventListener('load', () => {
      iframe.contentWindow._adoptRealPipWindow(pipWindow, null);
    }, { once: true });
    document.body.appendChild(iframe);
  }

  // ── 프리셋 저장 팝오버 ──
  const presetSaveBtn  = document.getElementById('pomoSavePresetBtn');
  const presetPopover  = document.getElementById('pomoPresetPopover');
  const presetNameInput = document.getElementById('pomoPresetNameInput');

  presetSaveBtn?.addEventListener('click', e => {
    e.stopPropagation();
    presetPopover?.classList.toggle('open');
    if (presetPopover?.classList.contains('open')) presetNameInput?.focus();
  });

  function _confirmSavePreset() {
    const name = (presetNameInput?.value || '').trim();
    if (!name) { presetNameInput?.focus(); return; }
    const s = _getPomoSettingsFromUI();
    chrome.storage.local.get(['pomodoroPresets', 'pomodoroCycleOverrides'], d => {
      const arr = d.pomodoroPresets || [];
      arr.push({ name, workMins: s.workMins, restMins: s.restMins, cycles: s.cycles, cycleOverrides: (d.pomodoroCycleOverrides || []).map(o => ({ ...o })) });
      chrome.storage.local.set({ pomodoroPresets: arr }, () => {
        if (presetNameInput) presetNameInput.value = '';
        presetPopover?.classList.remove('open');
        _pomoPresetPage = Math.ceil(arr.length / POMO_PRESET_PAGE_SIZE) - 1;
        loadPomoData();
      });
    });
  }
  document.getElementById('pomoPresetConfirmBtn')?.addEventListener('click', _confirmSavePreset);
  presetNameInput?.addEventListener('keydown', e => { if (e.key === 'Enter') _confirmSavePreset(); });
  document.addEventListener('click', e => {
    if (!presetPopover?.classList.contains('open')) return;
    if (!presetPopover.contains(e.target) && e.target !== presetSaveBtn) {
      presetPopover.classList.remove('open');
    }
  });

  // ── 프리셋 편집 모드 ──
  const presetEditBtn = document.getElementById('pomoPresetEditBtn');
  presetEditBtn?.addEventListener('click', () => {
    _pomoPresetEditing = !_pomoPresetEditing;
    presetEditBtn.classList.toggle('active', _pomoPresetEditing);
    renderPomoPresets(_pomoPresetsCache);
  });
  // 편집 모드 중 다른 곳을 클릭하면 편집 모드만 종료하고, 그 클릭이 노린 원래 동작(버튼 클릭 등)은
  // 수행되지 않아야 하므로 캡처 단계에서 전파를 막는다. X 삭제 버튼과 편집 버튼 자신은 예외.
  document.addEventListener('click', e => {
    if (!_pomoPresetEditing) return;
    if (presetEditBtn && presetEditBtn.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.pomo-preset-del-x')) return;
    _pomoPresetEditing = false;
    presetEditBtn?.classList.remove('active');
    renderPomoPresets(_pomoPresetsCache);
    e.stopPropagation();
    e.preventDefault();
  }, true);

  document.getElementById('pomoPresetPrevBtn')?.addEventListener('click', () => {
    _pomoPresetPage--;
    renderPomoPresets(_pomoPresetsCache);
  });
  document.getElementById('pomoPresetNextBtn')?.addEventListener('click', () => {
    _pomoPresetPage++;
    renderPomoPresets(_pomoPresetsCache);
  });

  // ── 고급 설정(회차별 시간) 모달 ──
  document.getElementById('pomoAdvancedBtn')?.addEventListener('click', _openAdvancedModal);
  document.getElementById('pomoAdvancedCloseBtn')?.addEventListener('click', _closeAdvancedModal);
  document.getElementById('pomoAdvancedOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'pomoAdvancedOverlay') _closeAdvancedModal();
  });

  [
    { decr: 'advWorkDecrBtn',   incr: 'advWorkIncrBtn',   key: 'workMins', min: 1, max: 60 },
    { decr: 'advRestDecrBtn',   incr: 'advRestIncrBtn',   key: 'restMins', min: 1, max: 60 },
    { decr: 'advCyclesDecrBtn', incr: 'advCyclesIncrBtn', key: 'cycles',   min: 1, max: 10 },
  ].forEach(({ decr, incr, key, min, max }) => {
    _makeRepeatBtn(decr, () => { if (_advDraftSettings[key] > min) _advSetBase(key, _advDraftSettings[key] - 1); });
    _makeRepeatBtn(incr, () => { if (_advDraftSettings[key] < max) _advSetBase(key, _advDraftSettings[key] + 1); });
  });

  [
    { id: 'advWorkVal',   key: 'workMins', min: 1, max: 60, fallback: 25 },
    { id: 'advRestVal',   key: 'restMins', min: 1, max: 60, fallback: 5  },
    { id: 'advCyclesVal', key: 'cycles',   min: 1, max: 10, fallback: 2  },
  ].forEach(({ id, key, min, max, fallback }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseInt(el.value);
      if (!isNaN(v) && v > max) el.value = max;
    });
    el.addEventListener('change', () => {
      let v = parseInt(el.value);
      if (isNaN(v)) v = fallback;
      v = Math.max(min, Math.min(max, v));
      el.value = v;
      _advSetBase(key, v);
    });
  });

  document.getElementById('pomoAdvancedAddBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('pomoCyclePicker')?.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    const picker = document.getElementById('pomoCyclePicker');
    const addBtn = document.getElementById('pomoAdvancedAddBtn');
    if (!picker?.classList.contains('open')) return;
    if (!picker.contains(e.target) && e.target !== addBtn) picker.classList.remove('open');
  });

  document.getElementById('pomoAdvancedClearBtn')?.addEventListener('click', () => {
    if (!_advDraftOverrides.length) return;
    if (!confirm(T('pomoAdvancedClearConfirm'))) return;
    _advDraftOverrides = [];
    _renderAdvancedList();
    _renderCyclePicker();
  });

  document.getElementById('pomoAdvancedApplyBtn')?.addEventListener('click', () => {
    _savePomoSettings({ ..._advDraftSettings }, null);
    chrome.storage.local.set({ pomodoroCycleOverrides: _advDraftOverrides.map(o => ({ ...o, name: _advEffectiveName(o) })) });
    _closeAdvancedModal();
  });

  const advSaveBtn       = document.getElementById('pomoAdvancedSaveBtn');
  const advSavePopover    = document.getElementById('pomoAdvSavePopover');
  const advSaveNameInput  = document.getElementById('pomoAdvSaveNameInput');
  advSaveBtn?.addEventListener('click', e => {
    e.stopPropagation();
    advSavePopover?.classList.toggle('open');
    if (advSavePopover?.classList.contains('open')) advSaveNameInput?.focus();
  });
  function _confirmAdvancedSavePreset() {
    const name = (advSaveNameInput?.value || '').trim();
    if (!name) { advSaveNameInput?.focus(); return; }
    chrome.storage.local.get(['pomodoroPresets'], d => {
      const arr = d.pomodoroPresets || [];
      arr.push({
        name,
        workMins: _advDraftSettings.workMins,
        restMins: _advDraftSettings.restMins,
        cycles: _advDraftSettings.cycles,
        cycleOverrides: _advDraftOverrides.map(o => ({ ...o, name: _advEffectiveName(o) })),
      });
      chrome.storage.local.set({ pomodoroPresets: arr }, () => {
        if (advSaveNameInput) advSaveNameInput.value = '';
        advSavePopover?.classList.remove('open');
        _pomoPresetPage = Math.ceil(arr.length / POMO_PRESET_PAGE_SIZE) - 1;
        _closeAdvancedModal();
        loadPomoData();
      });
    });
  }
  document.getElementById('pomoAdvSaveConfirmBtn')?.addEventListener('click', _confirmAdvancedSavePreset);
  advSaveNameInput?.addEventListener('keydown', e => { if (e.key === 'Enter') _confirmAdvancedSavePreset(); });
  document.addEventListener('click', e => {
    if (!advSavePopover?.classList.contains('open')) return;
    if (!advSavePopover.contains(e.target) && e.target !== advSaveBtn) advSavePopover.classList.remove('open');
  });

  // ── 도메인 추가 ──
  function doAddPomoDomain() {
    const input  = document.getElementById('pomoDomainInput');
    const domain = cleanDomain((input?.value || '').trim());
    if (!domain) return;
    chrome.storage.local.get(['pomodoroList'], d => {
      const arr = d.pomodoroList || [];
      const idx = arr.indexOf(domain);
      if (idx !== -1) {
        const ul = document.getElementById('pomoList');
        if (ul?.children[idx]) scrollAndBounce(ul, ul.children[idx], 'pomoWarn', T('alreadySameAddress'));
        return;
      }
      arr.push(domain);
      chrome.storage.local.set({ pomodoroList: arr }, () => {
        if (input) input.value = '';
        hideWarn('pomoWarn');
        loadPomoData();
      });
    });
  }
  document.getElementById('addPomoBtn')?.addEventListener('click', doAddPomoDomain);
  document.getElementById('pomoDomainInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') doAddPomoDomain(); });
  document.getElementById('pomoDomainInput')?.addEventListener('input', () => hideWarn('pomoWarn'));

  // ── 전체 초기화 ──
  document.getElementById('clearPomoListBtn')?.addEventListener('click', () => {
    if (!confirm(T('clearPomoConfirm'))) return;
    chrome.storage.local.set({ pomodoroList: [] }, loadPomoData);
  });

  // ── 불러오기 드롭다운 ──
  const importBtn  = document.getElementById('pomoImportBtn');
  const importMenu = document.getElementById('pomoImportMenu');
  importBtn?.addEventListener('click', e => {
    e.stopPropagation();
    importMenu?.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!document.getElementById('pomoImportWrap')?.contains(e.target)) {
      importMenu?.classList.remove('open');
    }
  });
  document.getElementById('importFromPermanent')?.addEventListener('click', () => _importFromList('permanentList'));
  document.getElementById('importFromGeneral')?.addEventListener('click',   () => _importFromList('generalList'));

  // ── 스토리지 변경 시 UI 동기화 ──
  chrome.storage.onChanged.addListener(changes => {
    if (changes.pomodoroState || changes.pomodoroSettings || changes.pomodoroList || changes.pomodoroPresets || changes.pomodoroCycleOverrides) {
      loadPomoData();
    }
  });

  // ── 초기 로드 + 틱 시작 ──
  loadPomoData();
  _pomoTick();
});