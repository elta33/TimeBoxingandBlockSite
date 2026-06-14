// options.js
// ※ 로드 순서: storage.js → render-day.js → options.js

let stagingCustomDomains = [];

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
    const delBtn = document.createElement('button');
    delBtn.textContent = '삭제'; delBtn.className = 'btn-danger btn-sm';
    delBtn.onclick = () => deleteItem(storageKey, index);
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

  // 모드 배지 (읽기 전용)
  const modeBadge = document.createElement('span');
  modeBadge.className = 'mode-badge ' + (mode === 'allow' ? 'mode-badge-allow' : 'mode-badge-block');
  modeBadge.textContent = mode === 'allow' ? '허용' : '차단';
  controls.appendChild(modeBadge);

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-danger btn-sm'; delBtn.textContent = '삭제';
  delBtn.onclick = (e) => { e.stopPropagation(); onDelete(); };
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
      if (panel) panel.style.display = 'none';
      if (onViewChange) onViewChange();
      loadSettings();
    });
  });
}

// ── 주간 뷰 전용 상수 ──
const PX_PER_MIN = 80 / 60; // 1시간 = 80px
const TOTAL_HEIGHT = TOTAL_MINS * PX_PER_MIN;
function minsToPx(mins) { return mins * PX_PER_MIN; }

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

// ── 주간 뷰: 박스 카드 DOM 생성 ──
function buildBoxCard(box, boxIndex, isWeek) {
  const startM = timeToMins(box.startTime);
  let endM = timeToMins(box.endTime);
  if (endM <= startM) endM += TOTAL_MINS;
  const durationM = endM - startM;

  const card = document.createElement('div');
  card.className = `tbox box-block`;
  card.dataset.boxIndex = boxIndex;
  card.style.top    = `${minsToPx(startM)}px`;
  card.style.height = `${Math.max(minsToPx(durationM) - 3, 20)}px`;

  const nameEl = document.createElement('div');
  nameEl.className = 'tbox-name'; nameEl.textContent = box.name;
  card.appendChild(nameEl);

  if (!isWeek || durationM >= 45) {
    const timeEl = document.createElement('div');
    timeEl.className = 'tbox-time';
    timeEl.textContent = `${box.startTime}–${box.endTime}`;
    card.appendChild(timeEl);
  }

  // 커스텀 주소 요약 텍스트
  if (box.customDomains && box.customDomains.length > 0 && durationM >= 30) {
    const summaryEl = document.createElement('div');
    summaryEl.className = 'tbox-custom-summary';
    const first = box.customDomains[0].domain;
    const rest  = box.customDomains.length - 1;
    summaryEl.textContent = rest > 0 ? `${first} 외 ${rest}개` : first;
    card.appendChild(summaryEl);
  }

  const delBtn = document.createElement('button');
  delBtn.className = 'tbox-del'; delBtn.textContent = '삭제'; delBtn.title = '이 박스 삭제';
  delBtn.onclick = (e) => { e.stopPropagation(); deleteBox(boxIndex); };
  card.appendChild(delBtn);

  // 박스 클릭 → 하단 외부 패널 열기
  if (box.customDomains && box.customDomains.length > 0) {
    card.addEventListener('click', (e) => {
      if (e.target === delBtn) return;
      renderWeekDetailPanel(box, boxIndex);
    });
  }

  return card;
}

// ── 주간 뷰: 스케줄러 하단 커스텀 주소 패널 ──
function renderWeekDetailPanel(box, boxIndex) {
  const panel = document.getElementById('weekDetailPanel');
  if (!panel) return;

  // 같은 박스 재클릭 시 토글 닫기
  if (panel.style.display === 'block' && panel.dataset.openIndex === String(boxIndex)) {
    panel.style.display = 'none';
    panel.dataset.openIndex = '';
    return;
  }

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
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-ghost btn-sm'; closeBtn.textContent = '닫기';
  closeBtn.onclick = () => { panel.style.display = 'none'; panel.dataset.openIndex = ''; };
  header.appendChild(closeBtn);
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
  wPopupInput.placeholder = '예: github.com';
  wPopupInput.style.cssText = 'flex:1;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.88rem;font-family:inherit;outline:none;min-width:0;';

  const wPopupConfirmBtn = document.createElement('button');
  wPopupConfirmBtn.className = 'btn btn-sm';
  wPopupConfirmBtn.textContent = '추가';
  wPopupConfirmBtn.style.cssText = 'margin-left:6px;padding:7px 12px;flex-shrink:0;';

  const wPopupRow = document.createElement('div');
  wPopupRow.style.cssText = 'display:flex;align-items:center;gap:0;';
  wPopupRow.appendChild(wPopupInput);
  wPopupRow.appendChild(wPopupConfirmBtn);

  const wPopupWarn = document.createElement('div');
  wPopupWarn.style.cssText = 'font-size:0.78rem;color:#ff4d4d;margin-top:5px;display:none;font-weight:600;';
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
  wAddDomainInPanelBtn.textContent = '+ 주소 추가';
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
        wPopupWarn.textContent = '이미 등록된 주소입니다.';
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

  // 모두 차단 / 모두 허용
  const masterRow = document.createElement('div');
  masterRow.className = 'donut-master-row';
  masterRow.appendChild(wAddPopupWrap);
  panel.appendChild(masterRow);

  // 도메인 리스트
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

  panel.style.display = 'block';
}

// ── 요일 선택기 순서 동기화 ──
let weekStartMonday = false;

function syncDaySelector() {
  const selector = document.querySelector('.day-selector');
  if (!selector) return;
  const ORDER_MON = [0,1,2,3,4,5,6];
  const ORDER_SUN = [6,0,1,2,3,4,5];
  const order = weekStartMonday ? ORDER_MON : ORDER_SUN;
  const LABELS = ['월','화','수','목','금','토','일'];
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
  if (weekStartMonday) {
    return [
      { label: '월', dow: 1 }, { label: '화', dow: 2 }, { label: '수', dow: 3 },
      { label: '목', dow: 4 }, { label: '금', dow: 5 }, { label: '토', dow: 6 }, { label: '일', dow: 0 },
    ];
  } else {
    return [
      { label: '일', dow: 0 }, { label: '월', dow: 1 }, { label: '화', dow: 2 },
      { label: '수', dow: 3 }, { label: '목', dow: 4 }, { label: '금', dow: 5 }, { label: '토', dow: 6 },
    ];
  }
}

// ── 주간 뷰 렌더링 ──
function renderWeekView(boxes, wrap, scrollToMins) {
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
  cornerCell.style.cssText = 'width:52px;border-right:1px solid #e8e8e8;background:#fafafa;';
  headerRow.appendChild(cornerCell);
  weekOrder.forEach(({ label, dow }) => {
    const lbl = document.createElement('div');
    lbl.className   = 'week-day-label' + (dow === todayDow ? ' today' : '');
    lbl.textContent = label;
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
      .forEach(box => { col.appendChild(buildBoxCard(box, boxes.indexOf(box), true)); });

    // 오늘 열에만 현재 시간선 표시
    if (dow === todayDow) {
      const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
      const nowPx = minsToPx(nowMins);

      const timeLine = document.createElement('div');
      timeLine.className = 'week-now-line';
      timeLine.style.top = `${nowPx}px`;

      const dot = document.createElement('div');
      dot.className = 'week-now-dot';

      timeLine.appendChild(dot);
      col.appendChild(timeLine);
    }
  });

  bodyGrid.appendChild(labelCol);
  dayCols.forEach(col => bodyGrid.appendChild(col));
  scrollBody.appendChild(bodyGrid);
  outer.appendChild(scrollBody);
  wrap.appendChild(outer);

  wrap._weekScrollBody = scrollBody;
  scrollBody.addEventListener('scroll', () => { wrap._weekScrollTop = scrollBody.scrollTop; }, { passive: true });

  // ── 드래그 스크롤 ──
  let isDragging = false, startY = 0, startScrollTop = 0;
  scrollBody.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    isDragging = true; startY = e.clientY; startScrollTop = scrollBody.scrollTop;
    scrollBody.classList.add('grabbing'); e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    scrollBody.scrollTop = startScrollTop - (e.clientY - startY);
  });
  window.addEventListener('mouseup', () => {
    isDragging = false; scrollBody.classList.remove('grabbing');
  });

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
      if (ul && ul.children[existIdx]) triggerBounceAndWarn(ul.children[existIdx], 'customWarn', '같은 주소가 이미 있습니다.');
      return;
    }
    stagingCustomDomains.push({ domain, mode });
    document.getElementById('customDomainInput').value = '';
    hideWarn('customWarn');
    renderStagingList();
  }
};

function removeStagingDomain(index) { stagingCustomDomains.splice(index, 1); hideWarn('customWarn'); renderStagingList(); }

// ── 박스 추가 폼 ──
document.getElementById('addBoxBtn').addEventListener('click', () => {
  const name      = document.getElementById('boxName').value.trim();
  const startTime = getFormattedTime('startTime');
  const endTime   = getFormattedTime('endTime');
  const days      = currentView === 'week' ? getSelectedDays() : [];

  if (!name || !startTime || !endTime) return alert('박스 이름과 시간을 입력해주세요!');
  if (currentView === 'week' && days.length === 0) return alert('요일을 하나 이상 선택해주세요!');

  let newStartMin = timeToMins(startTime);
  let newEndMin   = timeToMins(endTime);
  if (newEndMin <= newStartMin) newEndMin += 24 * 60;

  const boxKey = getBoxKey();
  chrome.storage.local.get([boxKey], function(result) {
    const boxes = result[boxKey] || [];

    const overlapIndices = [];
    for (let i = 0; i < boxes.length; i++) {
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

        allOverlapDays.forEach(d => {
          const cb = document.querySelector(`.day-selector input[value="${d}"]`);
          if (cb) {
            const lbl = cb.nextElementSibling;
            if (lbl) {
              lbl.classList.remove('bounce');
              void lbl.offsetWidth;
              lbl.classList.add('bounce');
              setTimeout(() => lbl.classList.remove('bounce'), 600);
            }
          }
        });

        const scrollBody = wrap._weekScrollBody;
        if (scrollBody) {
          const firstStartMins = timeToMins(boxes[overlapIndices[0]].startTime);
          scrollBody.scrollTop = Math.max(0, minsToPx(firstStartMins) - 40);
        }

        overlapIndices.forEach(i => {
          wrap.querySelectorAll(`.tbox[data-box-index="${i}"]`).forEach(card => {
            card.classList.remove('bounce');
            void card.offsetWidth;
            card.classList.add('bounce');
            setTimeout(() => card.classList.remove('bounce'), 600);
          });
        });

        triggerBounceAndWarn(null, 'boxWarn', '시간이 겹치는 박스가 있습니다.');

      } else if (currentView === 'day' && wrap && wrap._pulseBox) {
        overlapIndices.forEach(i => wrap._pulseBox(i));
        triggerBounceAndWarn(null, 'boxWarn', '시간이 겹치는 박스가 있습니다.');
      } else {
        triggerBounceAndWarn(null, 'boxWarn', '시간이 겹치는 박스가 있습니다.');
      }

      document.getElementById('startTime').focus();
      return;
    }

    const daysToSave = currentView === 'week' ? days : [null];
    daysToSave.forEach(day => {
      boxes.push({ name, startTime, endTime, mode: 'block', days: day !== null ? [day] : [], customDomains: [...stagingCustomDomains] });
    });
    chrome.storage.local.set({ [boxKey]: boxes }, () => {
      document.getElementById('boxName').value = '';
      document.getElementById('customDomainInput').value = '';
      hideWarn('boxWarn');
      clearCustomTimeInputs();
      clearDaySelection();
      stagingCustomDomains = [];
      renderStagingList();
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
document.getElementById('clearGeneralBtn').onclick   = () => clearAll('generalList',   '일반 차단 목록을 모두 지우시겠습니까?',    ['generalDomainInput']);
document.getElementById('clearPermanentBtn').onclick = () => clearAll('permanentList', '상시 차단 목록을 모두 지우시겠습니까?', ['permanentDomainInput']);
document.getElementById('clearBoxesBtn').onclick = () => {
  clearAll(getBoxKey(), '타임박스 스케쥴을 모두 지우시겠습니까?', ['boxName', 'customDomainInput']);
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

// ── DOMContentLoaded 진입점 ──
document.addEventListener('DOMContentLoaded', () => {
  // 메인 탭
  document.querySelectorAll('.main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
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

  function updateWeekStartToggleVisibility() {
    if (weekStartWrap) weekStartWrap.style.display = currentView === 'week' ? 'flex' : 'none';
  }
  updateWeekStartToggleVisibility();

  initViewTabs(updateWeekStartToggleVisibility);
  loadSettings();

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
});