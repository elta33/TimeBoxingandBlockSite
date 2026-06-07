// options.js
let stagingCustomDomains = [];

// background.js와 동일한 정규화 함수 — 저장 전 항상 이 함수를 거쳐야 비교가 맞음
function cleanDomain(d) {
  return d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').trim();
}

// --- 애니메이션 및 경고 제어 헬퍼 함수 ---
function triggerBounceAndWarn(element, warnId, msg) {
  const warnEl = document.getElementById(warnId);
  if(warnEl) {
    warnEl.textContent = msg;
    warnEl.style.display = 'inline-block';
  }
  
  if(element) {
    element.classList.remove('bounce');
    void element.offsetWidth; // 리플로우 강제 발생 (애니메이션 재시작)
    element.classList.add('bounce');
    setTimeout(() => element.classList.remove('bounce'), 600);
  }
}

function hideWarn(warnId) {
  const warnEl = document.getElementById(warnId);
  if(warnEl) warnEl.style.display = 'none';
}

function loadSettings() {
  chrome.storage.local.get(['generalList', 'permanentList', 'timeBoxes'], function(result) {
    renderList('generalList', result.generalList || [], 'generalList', 'generalWarn');
    renderList('permanentList', result.permanentList || [], 'permanentList', 'permanentWarn');
    renderBoxes(result.timeBoxes || []);
  });
}

function renderList(elementId, items, storageKey, warnId) {
  const ul = document.getElementById(elementId);
  ul.innerHTML = '';
  ul.style.padding = '0';
  ul.style.margin = '10px 0';

  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'custom-domain-item'; 
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    li.style.width = '100%';
    li.style.boxSizing = 'border-box';
    li.style.listStyle = 'none'; 

    const span = document.createElement('span');
    span.textContent = item;
    span.title = item; 
    span.style.fontSize = '0.95rem';
    span.style.whiteSpace = 'nowrap';
    span.style.overflow = 'hidden';
    span.style.textOverflow = 'ellipsis';
    span.style.flexGrow = '1';
    span.style.minWidth = '0';
    span.style.marginRight = '10px';
    li.appendChild(span);
    
    const delBtn = document.createElement('button');
    delBtn.textContent = '삭제';
    delBtn.className = 'btn-danger btn-sm';
    delBtn.style.flexShrink = '0';
    delBtn.onclick = () => deleteItem(storageKey, index);
    
    li.appendChild(delBtn);
    ul.appendChild(li);
  });
}

// ── 시간표 뷰 전역 상태 ──
let currentView = 'day'; // 'day' | 'week'
let currentBoxes = [];

// ── 뷰 전환 탭 초기화 (DOMContentLoaded 이후 호출됨) ──
function initViewTabs() {
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      // 요일 선택 행: 일주일 뷰일 때만 표시
      const dayRow = document.getElementById('daySelectRow');
      if (dayRow) dayRow.style.display = currentView === 'week' ? 'block' : 'none';
      renderBoxes(currentBoxes);
    });
  });
}

// ── 시간(분) → px 변환 (2시간 = 80px) ──
const PX_PER_MIN = 80 / 120; // ≈ 0.667
const TOTAL_MINS = 24 * 60;
const TOTAL_HEIGHT = TOTAL_MINS * PX_PER_MIN;

function minsToPx(mins) { return mins * PX_PER_MIN; }
function timeToMins(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}
function fmtHour(h) {
  if (h === 0) return '오전 12';
  if (h < 12) return `오전 ${h}`;
  if (h === 12) return '오후 12';
  return `오후 ${h - 12}`;
}

// ── 시간 레이블 + 구분선 생성 (2시간 단위) ──
function buildTimeAxis(labelCol, bodyEl, slotCount) {
  labelCol.style.height = `${TOTAL_HEIGHT}px`;
  bodyEl.style.height = `${TOTAL_HEIGHT}px`;

  for (let slot = 0; slot <= slotCount; slot++) {
    const mins = slot * 120; // 2시간 간격
    const px = minsToPx(mins);
    const isMidnight = mins === 0 || mins === TOTAL_MINS;

    // 레이블
    const lbl = document.createElement('div');
    lbl.className = 'time-label on-hour' + (isMidnight ? ' midnight' : '');
    lbl.style.top = `${px}px`;
    // 첫 00:00은 위로 잘리지 않게, 나머지는 중앙 정렬
    lbl.style.transform = (slot === 0) ? 'translateY(2px)' : 'translateY(-50%)';
    const h = Math.floor(mins / 60) % 24;
    lbl.textContent = `${String(h).padStart(2,'0')}:00`;
    labelCol.appendChild(lbl);

    // 구분선
    if (slot < slotCount) {
      const line = document.createElement('div');
      line.className = 'hour-line on-hour';
      line.style.top = `${px}px`;
      bodyEl.appendChild(line);
    }
  }
}

// ── 박스 카드 하나 생성 ──
function buildBoxCard(box, boxIndex, isWeek) {
  const startM = timeToMins(box.startTime);
  let endM = timeToMins(box.endTime);
  if (endM <= startM) endM += TOTAL_MINS; // 자정 넘김
  const durationM = endM - startM;

  const card = document.createElement('div');
  card.className = `tbox ${box.mode === 'block' ? 'box-block' : 'box-allow'}`;
  card.style.top = `${minsToPx(startM)}px`;
  card.style.height = `${Math.max(minsToPx(durationM) - 3, 20)}px`;

  const nameEl = document.createElement('div');
  nameEl.className = 'tbox-name';
  nameEl.textContent = box.name;
  card.appendChild(nameEl);

  if (!isWeek || durationM >= 45) {
    const timeEl = document.createElement('div');
    timeEl.className = 'tbox-time';
    timeEl.textContent = `${box.startTime}–${box.endTime}`;
    card.appendChild(timeEl);
  }

  // 삭제 버튼
  const delBtn = document.createElement('button');
  delBtn.className = 'tbox-del';
  delBtn.textContent = '삭제';
  delBtn.title = '이 박스 삭제';
  delBtn.onclick = (e) => { e.stopPropagation(); deleteBox(boxIndex); };
  card.appendChild(delBtn);

  // 상세 패널 (클릭 토글)
  if (box.customDomains && box.customDomains.length > 0) {
    const detail = buildDetailPanel(box, boxIndex, startM);
    card.appendChild(detail);
    card.addEventListener('click', (e) => {
      if (e.target === delBtn) return;
      const isOpen = detail.classList.contains('open');
      // 다른 패널 모두 닫기
      document.querySelectorAll('.tbox-detail.open').forEach(d => d.classList.remove('open'));
      if (!isOpen) detail.classList.add('open');
    });
  }

  return card;
}

// ── 커스텀 도메인 상세 패널 ──
function buildDetailPanel(box, boxIndex, startM) {
  const panel = document.createElement('div');
  panel.className = 'tbox-detail';
  // 박스가 하단에 가까우면 위로 열림
  const openUp = startM > TOTAL_MINS - 180;
  if (openUp) {
    panel.style.bottom = '0';
  } else {
    panel.style.top = '0';
  }

  const titleRow = document.createElement('div');
  titleRow.className = 'tbox-detail-title';
  titleRow.innerHTML = `<span>커스텀 주소 (${box.customDomains.length})</span>`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tbox-detail-close';
  closeBtn.textContent = '✕';
  closeBtn.onclick = (e) => { e.stopPropagation(); panel.classList.remove('open'); };
  titleRow.appendChild(closeBtn);
  panel.appendChild(titleRow);

  // 일괄 변경 버튼
  const masterRow = document.createElement('div');
  masterRow.style.cssText = 'display:flex;gap:5px;margin-bottom:8px;';
  const mBlockBtn = document.createElement('button');
  mBlockBtn.textContent = '모두 차단';
  mBlockBtn.className = 'btn-ghost btn-sm';
  mBlockBtn.onclick = (e) => { e.stopPropagation(); setBoxMasterMode(boxIndex, 'block'); };
  const mAllowBtn = document.createElement('button');
  mAllowBtn.textContent = '모두 허용';
  mAllowBtn.className = 'btn-ghost btn-sm';
  mAllowBtn.onclick = (e) => { e.stopPropagation(); setBoxMasterMode(boxIndex, 'allow'); };
  masterRow.appendChild(mBlockBtn);
  masterRow.appendChild(mAllowBtn);
  panel.appendChild(masterRow);

  // 커스텀 도메인 목록
  box.customDomains.forEach((cd, cdIndex) => {
    const item = document.createElement('div');
    item.className = 'custom-domain-item';
    item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%;box-sizing:border-box;';

    const domSpan = document.createElement('span');
    domSpan.textContent = `↳ ${cd.domain}`;
    domSpan.title = cd.domain;
    domSpan.style.cssText = 'font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-grow:1;min-width:0;margin-right:8px;';
    item.appendChild(domSpan);

    const controls = document.createElement('div');
    controls.className = 'custom-domain-controls';
    controls.style.cssText = 'display:flex;align-items:center;flex-shrink:0;';

    const toggleDiv = document.createElement('div');
    toggleDiv.className = 'mini-toggle';

    const rBlock = document.createElement('input');
    rBlock.type = 'radio'; rBlock.id = `dp_b${boxIndex}_c${cdIndex}_blk`; rBlock.name = `dp_b${boxIndex}_c${cdIndex}`; rBlock.checked = cd.mode === 'block';
    rBlock.onchange = () => updateCustomMode(boxIndex, cdIndex, 'block');
    const lBlock = document.createElement('label'); lBlock.htmlFor = rBlock.id; lBlock.textContent = '차단';

    const rAllow = document.createElement('input');
    rAllow.type = 'radio'; rAllow.id = `dp_b${boxIndex}_c${cdIndex}_alw`; rAllow.name = `dp_b${boxIndex}_c${cdIndex}`; rAllow.checked = cd.mode === 'allow';
    rAllow.onchange = () => updateCustomMode(boxIndex, cdIndex, 'allow');
    const lAllow = document.createElement('label'); lAllow.htmlFor = rAllow.id; lAllow.textContent = '허용';

    toggleDiv.append(rBlock, lBlock, rAllow, lAllow);
    controls.appendChild(toggleDiv);

    const delCdBtn = document.createElement('button');
    delCdBtn.className = 'btn-danger btn-sm';
    delCdBtn.textContent = '삭제';
    delCdBtn.onclick = (e) => { e.stopPropagation(); deleteCustomDomain(boxIndex, cdIndex); };
    controls.appendChild(delCdBtn);

    item.appendChild(controls);
    panel.appendChild(item);
  });

  return panel;
}

// ── 시간(분) → 원형 각도 변환 헬퍼 ──
function minsToAngle(mins) {
  return (mins / TOTAL_MINS) * 360 - 90; // 00:00이 12시(위) 기준
}
function polarToXY(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function fmtTimeLabel(mins) {
  const h = Math.floor(mins / 60) % 24;
  return `${String(h).padStart(2, '0')}:00`;
}

// ── 하루 뷰: 원형 차트 렌더링 ──
let dayViewClockInterval = null; // 현재 시각 업데이트 인터벌

function renderDayView(boxes, wrap) {
  if (dayViewClockInterval) { clearInterval(dayViewClockInterval); dayViewClockInterval = null; }

  const CX = 260, CY = 260, R_OUTER = 175, R_INNER = 108, R_LABEL = 196;
  const SVG_SIZE = 520;

  const container = document.createElement('div');
  container.className = 'donut-container';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${SVG_SIZE} ${SVG_SIZE}`);
  svg.setAttribute('width', SVG_SIZE);
  svg.setAttribute('height', SVG_SIZE);
  svg.style.display = 'block';
  svg.style.margin = '0 auto';

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svg.appendChild(defs);

  // ── 배경: 박스가 없는 빈 시간대만 회색 호로 채움 ──
  // 박스가 있는 시간대는 배경 없음 → 밀면 흰 배경만 드러남
  const bgGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(bgGroup);

  function drawBgArcs() {
    bgGroup.innerHTML = '';
    // 박스가 점유하는 시간 구간 수집
    const occupied = boxes.map(b => {
      const s = timeToMins(b.startTime);
      let e = timeToMins(b.endTime);
      if (e <= s) e += TOTAL_MINS;
      return { s, e };
    });
    // 0~TOTAL_MINS 중 빈 구간 계산
    const events = [];
    occupied.forEach(({ s, e }) => { events.push({ t: s, type: 1 }); events.push({ t: e, type: -1 }); });
    events.sort((a, b) => a.t - b.t || a.type - b.type);

    // 빈 구간 = 겹치는 박스가 없는 구간
    let depth = 0, prev = 0;
    const gaps = [];
    events.forEach(ev => {
      if (depth === 0 && ev.t > prev) gaps.push({ s: prev, e: ev.t });
      depth += ev.type;
      prev = ev.t;
    });
    if (depth === 0 && prev < TOTAL_MINS) gaps.push({ s: prev, e: TOTAL_MINS });

    // 박스가 없으면 전체 원
    if (boxes.length === 0) {
      const fullBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      fullBg.setAttribute('cx', CX); fullBg.setAttribute('cy', CY);
      fullBg.setAttribute('r', (R_OUTER + R_INNER) / 2);
      fullBg.setAttribute('fill', 'none');
      fullBg.setAttribute('stroke', '#f0f0f0');
      fullBg.setAttribute('stroke-width', R_OUTER - R_INNER);
      bgGroup.appendChild(fullBg);
      return;
    }

    // 빈 구간마다 호(arc) path 그리기
    gaps.forEach(({ s, e }) => {
      if (e - s < 1) return;
      const pathD = makeArcPath(s, e);
      if (!pathD) return;
      const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      arc.setAttribute('d', pathD);
      arc.setAttribute('fill', 'none');
      arc.setAttribute('stroke', '#f0f0f0');
      arc.setAttribute('stroke-width', R_OUTER - R_INNER);
      bgGroup.appendChild(arc);
    });
  }

  // 호 path 생성: stroke 방식 (중간 반지름 기준 arc)
  function makeArcPath(startMins, endMins) {
    if (endMins - startMins >= TOTAL_MINS) return null;
    const r = (R_OUTER + R_INNER) / 2;
    const a1 = minsToAngle(startMins), a2 = minsToAngle(endMins);
    const p1 = polarToXY(CX, CY, r, a1);
    const p2 = polarToXY(CX, CY, r, a2);
    const large = (endMins - startMins) > TOTAL_MINS / 2 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y}`;
  }

  drawBgArcs();

  // ── 눈금선: 바깥 끝에만 살짝 ──
  for (let h = 0; h < 24; h++) {
    const angle = minsToAngle(h * 60);
    const isMajor = h % 2 === 0;
    const tickStart = polarToXY(CX, CY, R_OUTER + 1, angle);
    const tickEnd   = polarToXY(CX, CY, R_OUTER + (isMajor ? 9 : 5), angle);
    const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tick.setAttribute('x1', tickStart.x); tick.setAttribute('y1', tickStart.y);
    tick.setAttribute('x2', tickEnd.x);   tick.setAttribute('y2', tickEnd.y);
    tick.setAttribute('stroke', isMajor ? '#bbb' : '#ddd');
    tick.setAttribute('stroke-width', isMajor ? 1.5 : 1);
    svg.appendChild(tick);

    if (isMajor) {
      const lp = polarToXY(CX, CY, R_LABEL + 16, angle);
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', lp.x); txt.setAttribute('y', lp.y);
      txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('dominant-baseline', 'middle');
      txt.setAttribute('font-size', '11'); txt.setAttribute('fill', '#aaa');
      txt.setAttribute('font-family', 'inherit');
      txt.textContent = `${String(h).padStart(2,'0')}`;
      svg.appendChild(txt);
    }
  }

  let selectedIndex = null;

  // segGroup — 배경이 호 방식이라 clip 불필요
  const segGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(segGroup);

  const centerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(centerGroup);

  const clockGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(clockGroup);

  const detailArea = document.createElement('div');
  detailArea.className = 'donut-detail-area';

  function renderCenter(box) {
    centerGroup.innerHTML = '';
    if (box) {
      const nameEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      nameEl.setAttribute('x', CX); nameEl.setAttribute('y', CY - 18);
      nameEl.setAttribute('text-anchor', 'middle'); nameEl.setAttribute('dominant-baseline', 'middle');
      nameEl.setAttribute('font-size', '15'); nameEl.setAttribute('font-weight', 'bold');
      nameEl.setAttribute('fill', box.mode === 'block' ? '#ff4d4f' : '#52c41a');
      nameEl.setAttribute('font-family', 'inherit');
      nameEl.textContent = box.name.length > 10 ? box.name.slice(0, 10) + '…' : box.name;
      centerGroup.appendChild(nameEl);

      const timeEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      timeEl.setAttribute('x', CX); timeEl.setAttribute('y', CY + 8);
      timeEl.setAttribute('text-anchor', 'middle'); timeEl.setAttribute('dominant-baseline', 'middle');
      timeEl.setAttribute('font-size', '13'); timeEl.setAttribute('fill', '#555');
      timeEl.setAttribute('font-family', 'inherit');
      timeEl.textContent = `${box.startTime} – ${box.endTime}`;
      centerGroup.appendChild(timeEl);

      const modeEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      modeEl.setAttribute('x', CX); modeEl.setAttribute('y', CY + 30);
      modeEl.setAttribute('text-anchor', 'middle'); modeEl.setAttribute('dominant-baseline', 'middle');
      modeEl.setAttribute('font-size', '11');
      modeEl.setAttribute('fill', box.mode === 'block' ? '#ff4d4f' : '#52c41a');
      modeEl.setAttribute('font-family', 'inherit');
      modeEl.textContent = box.mode === 'block' ? '차단 박스' : '허용 박스';
      centerGroup.appendChild(modeEl);
    } else {
      const DAYS_KO = ['일','월','화','수','목','금','토'];
      const todayStr = DAYS_KO[new Date().getDay()] + '요일';
      const dayEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      dayEl.setAttribute('x', CX); dayEl.setAttribute('y', CY - 12);
      dayEl.setAttribute('text-anchor', 'middle'); dayEl.setAttribute('dominant-baseline', 'middle');
      dayEl.setAttribute('font-size', '16'); dayEl.setAttribute('font-weight', 'bold');
      dayEl.setAttribute('fill', '#333'); dayEl.setAttribute('font-family', 'inherit');
      dayEl.textContent = todayStr;
      centerGroup.appendChild(dayEl);

      const hintEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      hintEl.setAttribute('x', CX); hintEl.setAttribute('y', CY + 12);
      hintEl.setAttribute('text-anchor', 'middle'); hintEl.setAttribute('dominant-baseline', 'middle');
      hintEl.setAttribute('font-size', '12'); hintEl.setAttribute('fill', '#bbb');
      hintEl.setAttribute('font-family', 'inherit');
      hintEl.textContent = '박스 선택';
      centerGroup.appendChild(hintEl);
    }
  }

  function renderClockHand() {
    clockGroup.innerHTML = '';
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const angle = minsToAngle(nowMins);
    const innerPt = polarToXY(CX, CY, R_INNER - 2, angle);
    const outerPt = polarToXY(CX, CY, R_OUTER + 2, angle);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', innerPt.x); line.setAttribute('y1', innerPt.y);
    line.setAttribute('x2', outerPt.x); line.setAttribute('y2', outerPt.y);
    line.setAttribute('stroke', '#faad14');
    line.setAttribute('stroke-width', '2.5');
    line.setAttribute('stroke-linecap', 'round');
    clockGroup.appendChild(line);

    // 뱃지: R_OUTER + 42 — SVG_SIZE=480이라 여유 충분
    const hh = String(now.getHours()).padStart(2,'0');
    const mm = String(now.getMinutes()).padStart(2,'0');
    const label = `현재 시각: ${hh}:${mm}`;
    const lp = polarToXY(CX, CY, R_OUTER + 42, angle);
    const textW = label.length * 7.2 + 14;
    const textH = 22;

    const badgeRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    badgeRect.setAttribute('x', lp.x - textW / 2); badgeRect.setAttribute('y', lp.y - textH / 2);
    badgeRect.setAttribute('width', textW); badgeRect.setAttribute('height', textH);
    badgeRect.setAttribute('rx', 5); badgeRect.setAttribute('fill', '#faad14');
    clockGroup.appendChild(badgeRect);

    const badgeTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    badgeTxt.setAttribute('x', lp.x); badgeTxt.setAttribute('y', lp.y + 1);
    badgeTxt.setAttribute('text-anchor', 'middle'); badgeTxt.setAttribute('dominant-baseline', 'middle');
    badgeTxt.setAttribute('font-size', '11'); badgeTxt.setAttribute('font-weight', 'bold');
    badgeTxt.setAttribute('fill', '#fff'); badgeTxt.setAttribute('font-family', 'inherit');
    badgeTxt.textContent = label;
    clockGroup.appendChild(badgeTxt);
  }

  function renderDetailArea(box, boxIndex) {
    detailArea.innerHTML = '';
    if (!box) return;

    const header = document.createElement('div');
    header.className = 'donut-detail-header';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'donut-detail-title';
    titleSpan.textContent = box.name;
    header.appendChild(titleSpan);
    const delBoxBtn = document.createElement('button');
    delBoxBtn.className = 'btn-danger btn-sm';
    delBoxBtn.textContent = '박스 삭제';
    delBoxBtn.onclick = () => deleteBox(boxIndex);
    header.appendChild(delBoxBtn);
    detailArea.appendChild(header);

    if (box.customDomains && box.customDomains.length > 0) {
      const masterRow = document.createElement('div');
      masterRow.className = 'donut-master-row';
      const mBlockBtn = document.createElement('button');
      mBlockBtn.className = 'btn-ghost btn-sm'; mBlockBtn.textContent = '모두 차단';
      mBlockBtn.onclick = () => setBoxMasterMode(boxIndex, 'block');
      const mAllowBtn = document.createElement('button');
      mAllowBtn.className = 'btn-ghost btn-sm'; mAllowBtn.textContent = '모두 허용';
      mAllowBtn.onclick = () => setBoxMasterMode(boxIndex, 'allow');
      masterRow.appendChild(mBlockBtn); masterRow.appendChild(mAllowBtn);
      detailArea.appendChild(masterRow);

      const list = document.createElement('ul');
      list.className = 'donut-domain-list';
      box.customDomains.forEach((cd, cdIndex) => {
        const li = document.createElement('li');
        li.className = 'custom-domain-item';
        const domSpan = document.createElement('span');
        domSpan.textContent = cd.domain; domSpan.title = cd.domain;
        li.appendChild(domSpan);
        const controls = document.createElement('div');
        controls.className = 'custom-domain-controls';
        const toggleDiv = document.createElement('div');
        toggleDiv.className = 'mini-toggle';
        const rBlock = document.createElement('input');
        rBlock.type = 'radio'; rBlock.id = `dv_b${boxIndex}_c${cdIndex}_blk`;
        rBlock.name = `dv_b${boxIndex}_c${cdIndex}`; rBlock.checked = cd.mode === 'block';
        rBlock.onchange = () => updateCustomMode(boxIndex, cdIndex, 'block');
        const lBlock = document.createElement('label'); lBlock.htmlFor = rBlock.id; lBlock.textContent = '차단';
        const rAllow = document.createElement('input');
        rAllow.type = 'radio'; rAllow.id = `dv_b${boxIndex}_c${cdIndex}_alw`;
        rAllow.name = `dv_b${boxIndex}_c${cdIndex}`; rAllow.checked = cd.mode === 'allow';
        rAllow.onchange = () => updateCustomMode(boxIndex, cdIndex, 'allow');
        const lAllow = document.createElement('label'); lAllow.htmlFor = rAllow.id; lAllow.textContent = '허용';
        toggleDiv.append(rBlock, lBlock, rAllow, lAllow);
        controls.appendChild(toggleDiv);
        const delCdBtn = document.createElement('button');
        delCdBtn.className = 'btn-danger btn-sm'; delCdBtn.textContent = '삭제';
        delCdBtn.onclick = () => deleteCustomDomain(boxIndex, cdIndex);
        controls.appendChild(delCdBtn);
        li.appendChild(controls);
        list.appendChild(li);
      });
      detailArea.appendChild(list);
    } else {
      const empty = document.createElement('p');
      empty.style.cssText = 'font-size:0.82rem;color:#bbb;margin:8px 0 0;';
      empty.textContent = '커스텀 주소 없음';
      detailArea.appendChild(empty);
    }
  }

  function selectBox(idx) {
    selectedIndex = (selectedIndex === idx) ? null : idx;
    segGroup.querySelectorAll('.donut-seg').forEach((seg, i) => {
      const box = boxes[i];
      const isSelected = (i === selectedIndex);
      seg.setAttribute('stroke', isSelected ? '#fff' : 'none');
      seg.setAttribute('stroke-width', isSelected ? '3' : '0');
      const midMins = (timeToMins(box.startTime) + (timeToMins(box.endTime) <= timeToMins(box.startTime) ? timeToMins(box.endTime) + TOTAL_MINS : timeToMins(box.endTime))) / 2;
      const midAngle = minsToAngle(midMins);
      const offset = isSelected ? 10 : 0;
      const rad = (midAngle * Math.PI) / 180;
      seg.setAttribute('transform', isSelected ? `translate(${offset * Math.cos(rad)}, ${offset * Math.sin(rad)})` : '');
    });
    // 선택된 박스 시간대의 배경 호도 같이 밀기
    bgGroup.querySelectorAll('.bg-arc-seg').forEach((arc, i) => {
      // bgArc는 세그먼트와 1:1 대응
    });
    renderCenter(selectedIndex !== null ? boxes[selectedIndex] : null);
    renderDetailArea(selectedIndex !== null ? boxes[selectedIndex] : null, selectedIndex);
  }

  function makeSegPath(startMins, endMins, rOuter, rInner) {
    if ((endMins - startMins) >= TOTAL_MINS) return null;
    const a1 = minsToAngle(startMins), a2 = minsToAngle(endMins);
    const p1 = polarToXY(CX, CY, rOuter, a1), p2 = polarToXY(CX, CY, rOuter, a2);
    const p3 = polarToXY(CX, CY, rInner, a2), p4 = polarToXY(CX, CY, rInner, a1);
    const large = (endMins - startMins) > TOTAL_MINS / 2 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y} Z`;
  }

  boxes.forEach((box, i) => {
    const startM = timeToMins(box.startTime);
    let endM = timeToMins(box.endTime);
    if (endM <= startM) endM += TOTAL_MINS;
    const color = box.mode === 'block' ? '#ff4d4f' : '#52c41a';
    const pathD = makeSegPath(startM, endM, R_OUTER, R_INNER);
    const seg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    seg.setAttribute('d', pathD);
    seg.setAttribute('fill', color); seg.setAttribute('opacity', '0.85');
    seg.setAttribute('stroke', 'none'); seg.setAttribute('stroke-width', '0');
    seg.style.cursor = 'pointer';
    seg.style.transition = 'transform 0.18s ease, opacity 0.15s';
    seg.classList.add('donut-seg');
    seg.addEventListener('mouseenter', () => { if (i !== selectedIndex) seg.setAttribute('opacity', '1'); });
    seg.addEventListener('mouseleave', () => { if (i !== selectedIndex) seg.setAttribute('opacity', '0.85'); });
    seg.addEventListener('click', () => selectBox(i));
    segGroup.appendChild(seg);
  });

  const centerClickZone = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  centerClickZone.setAttribute('cx', CX); centerClickZone.setAttribute('cy', CY);
  centerClickZone.setAttribute('r', R_INNER - 4);
  centerClickZone.setAttribute('fill', 'transparent');
  centerClickZone.style.cursor = 'default';
  centerClickZone.addEventListener('click', () => selectBox(null));
  svg.appendChild(centerClickZone);

  renderCenter(null);
  renderClockHand();
  container.appendChild(svg);
  container.appendChild(detailArea);
  wrap.appendChild(container);

  if (boxes.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = '등록된 타임박스가 없습니다.';
    wrap.appendChild(hint);
  }

  dayViewClockInterval = setInterval(renderClockHand, 60000);
}

// ── 일주일 뷰 렌더링 ──
function renderWeekView(boxes, wrap) {
  const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
  const todayDow = (new Date().getDay() + 6) % 7; // 0=월…6=일

  const outer = document.createElement('div');
  outer.className = 'timetable-outer';

  // 요일 헤더 (sticky)
  const headerRow = document.createElement('div');
  headerRow.className = 'week-header-row';
  // 시간 레이블 열 공간 확보
  const cornerCell = document.createElement('div');
  cornerCell.style.cssText = 'width:52px;border-right:1px solid #e8e8e8;background:#fafafa;';
  headerRow.appendChild(cornerCell);
  DAYS.forEach((d, i) => {
    const lbl = document.createElement('div');
    lbl.className = 'week-day-label' + (i === todayDow ? ' today' : '');
    lbl.textContent = d;
    headerRow.appendChild(lbl);
  });
  // headerRow grid columns: 52px + 7 equal cols
  headerRow.style.gridTemplateColumns = `52px repeat(7, 1fr)`;
  outer.appendChild(headerRow);

  // 본문 그리드 (시간 레이블 열 + 7요일 열)
  const bodyGrid = document.createElement('div');
  bodyGrid.className = 'timetable-grid';
  bodyGrid.style.gridTemplateColumns = `52px repeat(7, 1fr)`;

  const labelCol = document.createElement('div');
  labelCol.className = 'time-label-col';

  // 7개 요일 컬럼
  const dayCols = DAYS.map(() => {
    const col = document.createElement('div');
    col.className = 'week-day-col';
    return col;
  });

  const SLOTS = 12; // 2시간 × 12 = 24시간
  const dummyBody = document.createElement('div');
  dummyBody.className = 'timetable-body';
  buildTimeAxis(labelCol, dummyBody, SLOTS);

  dayCols.forEach((col) => {
    col.style.height = `${TOTAL_HEIGHT}px`;
    col.style.position = 'relative';
    for (let slot = 0; slot < SLOTS; slot++) {
      const line = document.createElement('div');
      line.className = 'hour-line on-hour';
      line.style.top = `${minsToPx(slot * 120)}px`;
      col.appendChild(line);
    }
  });

  // 요일별 박스 필터링: days 빈 배열(구형 데이터 or 하루용) = 모든 요일에 표시
  dayCols.forEach((col, dayIdx) => {
    const dayBoxes = boxes.filter(box => {
      const d = box.days || [];
      return d.length === 0 || d.includes(dayIdx);
    });
    dayBoxes.forEach((box) => {
      const origIdx = boxes.indexOf(box);
      col.appendChild(buildBoxCard(box, origIdx, true));
    });
  });

  bodyGrid.appendChild(labelCol);
  dayCols.forEach(col => bodyGrid.appendChild(col));
  outer.appendChild(bodyGrid);
  wrap.appendChild(outer);
}

// ── 메인 renderBoxes (loadSettings에서 호출됨) ──
function renderBoxes(boxes) {
  currentBoxes = boxes;
  const wrap = document.getElementById('timetableWrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  // 일주일 뷰로 전환 시 하루 뷰 인터벌 정리
  if (currentView !== 'day' && dayViewClockInterval) {
    clearInterval(dayViewClockInterval);
    dayViewClockInterval = null;
  }

  if (currentView === 'day') {
    renderDayView(boxes, wrap);
  } else {
    renderWeekView(boxes, wrap);
  }

  // 바깥 클릭 시 상세 패널 닫기 (일주일 뷰용)
  wrap.addEventListener('click', (e) => {
    if (!e.target.closest('.tbox')) {
      document.querySelectorAll('.tbox-detail.open').forEach(d => d.classList.remove('open'));
    }
  });
}

// --- 임시 대기열(Staging) ---
function renderStagingList() {
  const ul = document.getElementById('stagingCustomList');
  ul.innerHTML = '';
  stagingCustomDomains.forEach((cd, index) => {
    const li = document.createElement('li');
    li.className = 'custom-domain-item';
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    li.style.width = '100%';
    li.style.boxSizing = 'border-box';

    const span = document.createElement('span');
    span.textContent = cd.domain;
    span.title = cd.domain;
    span.style.whiteSpace = 'nowrap';
    span.style.overflow = 'hidden';
    span.style.textOverflow = 'ellipsis';
    span.style.flexGrow = '1';
    span.style.minWidth = '0';
    span.style.marginRight = '10px';
    li.appendChild(span);

    const controls = document.createElement('div');
    controls.className = 'custom-domain-controls';
    controls.style.display = 'flex';
    controls.style.alignItems = 'center';
    controls.style.flexShrink = '0';

    const toggleDiv = document.createElement('div');
    toggleDiv.className = 'mini-toggle';

    const rBlock = document.createElement('input');
    rBlock.type = 'radio'; rBlock.id = `stg_c${index}_blk`; rBlock.name = `stg_c${index}`; rBlock.checked = cd.mode === 'block';
    rBlock.onchange = () => { stagingCustomDomains[index].mode = 'block'; renderStagingList(); };
    const lBlock = document.createElement('label'); lBlock.htmlFor = rBlock.id; lBlock.textContent = '차단';

    const rAllow = document.createElement('input');
    rAllow.type = 'radio'; rAllow.id = `stg_c${index}_alw`; rAllow.name = `stg_c${index}`; rAllow.checked = cd.mode === 'allow';
    rAllow.onchange = () => { stagingCustomDomains[index].mode = 'allow'; renderStagingList(); };
    const lAllow = document.createElement('label'); lAllow.htmlFor = rAllow.id; lAllow.textContent = '허용';

    toggleDiv.append(rBlock, lBlock, rAllow, lAllow);
    controls.appendChild(toggleDiv);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger btn-sm';
    delBtn.textContent = '삭제';
    delBtn.onclick = () => removeStagingDomain(index);
    controls.appendChild(delBtn);

    li.appendChild(controls);
    ul.appendChild(li);
  });
}

// --- 중복 검사 로직 적용 구역 ---
document.getElementById('addCustomStagingBtn').onclick = () => {
  const domain = cleanDomain(document.getElementById('customDomainInput').value.trim());
  // 박스 모드의 반댓값이 기본: 차단 박스 → 허용, 허용 박스 → 차단
  const boxMode = document.querySelector('input[name="boxMode"]:checked')?.value || 'block';
  const mode = boxMode === 'block' ? 'allow' : 'block';
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

document.getElementById('masterStgBlockBtn').onclick = () => { stagingCustomDomains.forEach(cd => cd.mode = 'block'); renderStagingList(); };
document.getElementById('masterStgAllowBtn').onclick = () => { stagingCustomDomains.forEach(cd => cd.mode = 'allow'); renderStagingList(); };
function removeStagingDomain(index) { stagingCustomDomains.splice(index, 1); hideWarn('customWarn'); renderStagingList(); }

// 시간 충돌 계산용 분 변환기
function getMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

document.getElementById('addBoxBtn').addEventListener('click', () => {
  const name = document.getElementById('boxName').value.trim();
  const startTime = getFormattedTime('startTime');
  const endTime = getFormattedTime('endTime');
  const modeElement = document.querySelector('input[name="boxMode"]:checked');
  const mode = modeElement ? modeElement.value : 'block';
  const days = currentView === 'week' ? getSelectedDays() : []; // 하루 뷰면 요일 무관(빈 배열 = 매일)

  if (!name || !startTime || !endTime) return alert('박스 이름과 시간을 입력해주세요!');
  if (currentView === 'week' && days.length === 0) return alert('요일을 하나 이상 선택해주세요!');

  let newStartMin = getMinutes(startTime);
  let newEndMin = getMinutes(endTime);
  if (newEndMin <= newStartMin) newEndMin += 24 * 60;

  chrome.storage.local.get(['timeBoxes'], function(result) {
    const boxes = result.timeBoxes || [];

    // 겹침 검사: 요일이 겹치는 박스끼리만 시간 충돌 체크
    let overlapIndex = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      // 요일 겹침 확인 — 둘 다 빈 배열(매일)이거나 교집합 있으면 겹침
      const bDays = b.days || [];
      const daysOverlap = days.length === 0 || bDays.length === 0
        || days.some(d => bDays.includes(d));
      if (!daysOverlap) continue;

      let existStart = getMinutes(b.startTime);
      let existEnd = getMinutes(b.endTime);
      if (existEnd <= existStart) existEnd += 24 * 60;
      if (Math.max(newStartMin, existStart) < Math.min(newEndMin, existEnd)) {
        overlapIndex = i; break;
      }
    }

    if (overlapIndex !== -1) {
      const wrap = document.getElementById('timetableWrap');
      const cards = wrap ? wrap.querySelectorAll('.tbox') : [];
      if (cards[overlapIndex]) triggerBounceAndWarn(cards[overlapIndex], 'boxWarn', '시간이 겹치는 박스가 있습니다.');
      return;
    }

    const newBox = { name, startTime, endTime, mode, days, customDomains: [...stagingCustomDomains] };
    boxes.push(newBox);
    chrome.storage.local.set({ timeBoxes: boxes }, () => {
      document.getElementById('boxName').value = '';
      document.getElementById('customDomainInput').value = '';
      hideWarn('boxWarn');
      clearCustomTimeInputs();
      clearDaySelection();
      stagingCustomDomains = [];
      renderStagingList();
      loadSettings();
    });
  });
});

document.getElementById('addGeneralBtn').onclick = () => addToList('generalDomainInput', 'generalList', 'generalList', 'generalWarn');
document.getElementById('addPermanentBtn').onclick = () => addToList('permanentDomainInput', 'permanentList', 'permanentList', 'permanentWarn');

function addToList(inputId, storageKey, ulId, warnId) {
  const input = document.getElementById(inputId);
  const domain = cleanDomain(input.value.trim());
  if (!domain) return;
  chrome.storage.local.get([storageKey], function(result) {
    const list = result[storageKey] || [];
    
    const existingIndex = list.indexOf(domain);
    if (existingIndex !== -1) {
      const ul = document.getElementById(ulId);
      if(ul && ul.children[existingIndex]) triggerBounceAndWarn(ul.children[existingIndex], warnId, '같은 주소가 이미 있습니다.');
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

function deleteItem(storageKey, index) { chrome.storage.local.get([storageKey], function(result) { const list = result[storageKey] || []; list.splice(index, 1); chrome.storage.local.set({ [storageKey]: list }, loadSettings); }); }
function deleteBox(index) { chrome.storage.local.get(['timeBoxes'], function(result) { const boxes = result.timeBoxes || []; boxes.splice(index, 1); chrome.storage.local.set({ timeBoxes: boxes }, loadSettings); }); }
function deleteCustomDomain(boxIndex, cdIndex) { chrome.storage.local.get(['timeBoxes'], function(result) { result.timeBoxes[boxIndex].customDomains.splice(cdIndex, 1); chrome.storage.local.set({ timeBoxes: result.timeBoxes }, loadSettings); }); }
function updateCustomMode(boxIndex, cdIndex, newMode) { chrome.storage.local.get(['timeBoxes'], function(result) { result.timeBoxes[boxIndex].customDomains[cdIndex].mode = newMode; chrome.storage.local.set({ timeBoxes: result.timeBoxes }, loadSettings); }); }
function setBoxMasterMode(boxIndex, newMode) { chrome.storage.local.get(['timeBoxes'], function(result) { result.timeBoxes[boxIndex].customDomains.forEach(cd => cd.mode = newMode); chrome.storage.local.set({ timeBoxes: result.timeBoxes }, loadSettings); }); }

function clearAll(storageKey, confirmMsg, inputIdsToClear) {
  if(!confirm(confirmMsg)) return;
  chrome.storage.local.set({ [storageKey]: [] }, () => {
    if(inputIdsToClear) inputIdsToClear.forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
    if(storageKey === 'timeBoxes') { stagingCustomDomains = []; renderStagingList(); }
    loadSettings();
  });
}

document.getElementById('clearGeneralBtn').onclick = () => clearAll('generalList', '일반 차단 목록을 모두 지우시겠습니까?', ['generalDomainInput']);
document.getElementById('clearPermanentBtn').onclick = () => clearAll('permanentList', '상시 차단 목록을 모두 지우시겠습니까?', ['permanentDomainInput']);
document.getElementById('clearBoxesBtn').onclick = () => { clearAll('timeBoxes', '타임박스 스케쥴을 모두 지우시겠습니까?', ['boxName', 'customDomainInput']); clearCustomTimeInputs(); clearDaySelection(); };

function getFormattedTime(inputId) {
  const val = document.getElementById(inputId).value; // "HH:MM"
  return val || null;
}

function clearCustomTimeInputs() {
  const s = document.getElementById('startTime');
  const e = document.getElementById('endTime');
  if (s) s.value = '';
  if (e) e.value = '';
}

function getSelectedDays() {
  return Array.from(document.querySelectorAll('input[name="days"]:checked'))
    .map(cb => parseInt(cb.value));
}

function clearDaySelection() {
  document.querySelectorAll('input[name="days"]').forEach(cb => cb.checked = false);
}

document.addEventListener('DOMContentLoaded', () => {
  // ── 상단 메인 탭 전환 ──
  document.querySelectorAll('.main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  initViewTabs();
  loadSettings();

  // 사용자가 다시 입력 칸을 터치하면 경고창 숨김
  const ids = ['generalDomainInput', 'permanentDomainInput', 'customDomainInput', 'boxName'];
  const warns = ['generalWarn', 'permanentWarn', 'customWarn', 'boxWarn'];
  ids.forEach((id, idx) => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', () => hideWarn(warns[idx]));
  });
});