// render-day.js
// ── 도넛(하루) 뷰 전용 수학 헬퍼 ──
function minsToAngle(mins) { return (mins / TOTAL_MINS) * 360 - 90; }
function polarToXY(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

let dayViewClockInterval = null;

function renderDayView(boxes, wrap, onEditBox) {
  if (dayViewClockInterval) { clearInterval(dayViewClockInterval); dayViewClockInterval = null; }

  const CX = 260, CY = 260, R_OUTER = 175, R_INNER = 108, R_LABEL = 196;
  const SVG_SIZE = 520;

  const container = document.createElement('div');
  container.className = 'donut-container';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${SVG_SIZE} ${SVG_SIZE}`);
  svg.setAttribute('width', SVG_SIZE); svg.setAttribute('height', SVG_SIZE);
  svg.style.display = 'block'; svg.style.margin = '0 auto';

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svg.appendChild(defs);

  const bgGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(bgGroup);

  // ── 빈 시간대 배경 호 ──
  function drawBgArcs() {
    bgGroup.innerHTML = '';
    const occupied = boxes.map(b => {
      const s = timeToMins(b.startTime);
      let e = timeToMins(b.endTime);
      if (e <= s) e += TOTAL_MINS;
      return { s, e };
    });
    const events = [];
    occupied.forEach(({ s, e }) => { events.push({ t: s, type: 1 }); events.push({ t: e, type: -1 }); });
    events.sort((a, b) => a.t - b.t || a.type - b.type);

    let depth = 0, prev = 0;
    const gaps = [];
    events.forEach(ev => {
      if (depth === 0 && ev.t > prev) gaps.push({ s: prev, e: ev.t });
      depth += ev.type;
      prev = ev.t;
    });
    if (depth === 0 && prev < TOTAL_MINS) gaps.push({ s: prev, e: TOTAL_MINS });

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

    gaps.forEach(({ s, e }) => {
      if (e - s < 1) return;
      if (e - s >= TOTAL_MINS) return; // 24시간 박스로 인해 gap이 없는 경우 스킵
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

  // ── 호 path 생성 ──
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

  // ── 눈금 및 시각 레이블 ──
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

  const segGroup   = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const centerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const clockGroup  = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(segGroup);
  svg.appendChild(centerGroup);
  svg.appendChild(clockGroup);

  const detailArea = document.createElement('div');
  detailArea.className = 'donut-detail-area';

  // ── 중앙 텍스트 렌더링 ──
  function renderCenter(box) {
    centerGroup.innerHTML = '';
    if (box) {
      const nameEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      nameEl.setAttribute('x', CX); nameEl.setAttribute('y', CY - 18);
      nameEl.setAttribute('text-anchor', 'middle'); nameEl.setAttribute('dominant-baseline', 'middle');
      nameEl.setAttribute('font-size', '15'); nameEl.setAttribute('font-weight', 'bold');
      nameEl.setAttribute('fill', '#ff6347');
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
      modeEl.setAttribute('fill', '#ff6347');
      modeEl.setAttribute('font-family', 'inherit');
      modeEl.textContent = T('donutBlockBox');
      centerGroup.appendChild(modeEl);
    } else {
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const dayEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      dayEl.setAttribute('x', CX); dayEl.setAttribute('y', CY - 12);
      dayEl.setAttribute('text-anchor', 'middle'); dayEl.setAttribute('dominant-baseline', 'middle');
      dayEl.setAttribute('font-size', '16'); dayEl.setAttribute('font-weight', 'bold');
      dayEl.setAttribute('fill', '#333'); dayEl.setAttribute('font-family', 'inherit');
      dayEl.textContent = `${mm}-${dd}`;
      centerGroup.appendChild(dayEl);

      const hintEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      hintEl.setAttribute('x', CX); hintEl.setAttribute('y', CY + 12);
      hintEl.setAttribute('text-anchor', 'middle'); hintEl.setAttribute('dominant-baseline', 'middle');
      hintEl.setAttribute('font-size', '12'); hintEl.setAttribute('fill', '#bbb');
      hintEl.setAttribute('font-family', 'inherit');
      hintEl.textContent = T('donutSelectHint');
      centerGroup.appendChild(hintEl);
    }
  }

  // ── 현재 시각 바늘 ──
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

    const hh = String(now.getHours()).padStart(2,'0');
    const mm = String(now.getMinutes()).padStart(2,'0');
    const label = T('donutNowTime', [`${hh}:${mm}`]);
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

  // ── 선택된 박스 하단 상세 패널 ──
  function renderDetailArea(box, boxIndex) {
    detailArea.innerHTML = '';
    if (!box) return;

    const refreshPanel = (updatedBoxes) => {
      currentBoxes = updatedBoxes;
      const updatedBox = updatedBoxes[boxIndex];
      if (updatedBox) renderDetailArea(updatedBox, boxIndex);
      else { selectedIndex = null; renderDetailArea(null, null); renderCenter(null); }
    };

    const header = document.createElement('div');
    header.className = 'donut-detail-header';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'donut-detail-title';
    titleSpan.textContent = box.name;
    header.appendChild(titleSpan);

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:8px;';

    // 팝업(요일 도넛 미리보기)은 onEditBox로 자체 폼(popup_*)에 이월, 메인 뷰는 기본적으로 메인 폼(enterBoxEditMode)에 이월
    const editBoxBtn = document.createElement('button');
    editBoxBtn.className = 'btn btn-sm' + (_pinEnabled ? ' pin-locked' : '');
    editBoxBtn.textContent = (_pinEnabled ? '🔒 ' : '') + T('donutEditBox');
    editBoxBtn.onclick = () => {
      const doEdit = () => (onEditBox || enterBoxEditMode)(box, boxIndex);
      if (_pinEnabled) {
        _openPinModal(T('donutEditBox'), doEdit);
      } else {
        doEdit();
      }
    };
    btnGroup.appendChild(editBoxBtn);

    const delBoxBtn = document.createElement('button');
    delBoxBtn.className = 'btn-danger btn-sm' + (_pinEnabled ? ' pin-locked' : '');
    delBoxBtn.textContent = (_pinEnabled ? '🔒 ' : '') + T('donutDeleteBox');
    delBoxBtn.onclick = () => {
      if (_pinEnabled) {
        _openPinModal(T('delete'), () => deleteBox(boxIndex));
      } else {
        deleteBox(boxIndex);
      }
    };
    btnGroup.appendChild(delBoxBtn);
    header.appendChild(btnGroup);
    detailArea.appendChild(header);

    // ── 주소 추가 팝업 (인라인 드롭다운) ──
    const addPopupWrap = document.createElement('div');
    addPopupWrap.style.cssText = 'position:relative;display:inline-block;';

    const addDomainPopup = document.createElement('div');
    addDomainPopup.style.cssText = [
      'display:none;position:absolute;z-index:200;',
      'top:calc(100% + 6px);left:0;',
      'background:#fff;border:1px solid #ddd;border-radius:8px;',
      'box-shadow:0 4px 16px rgba(0,0,0,0.13);',
      'padding:10px 12px;min-width:260px;'
    ].join('');

    const popupInput = document.createElement('input');
    popupInput.type = 'text';
    popupInput.placeholder = T('placeholderGithub');
    popupInput.style.cssText = 'flex:1;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.88rem;font-family:inherit;outline:none;min-width:0;';

    const popupConfirmBtn = document.createElement('button');
    popupConfirmBtn.className = 'btn btn-sm';
    popupConfirmBtn.textContent = T('add');
    popupConfirmBtn.style.cssText = 'margin-left:6px;padding:7px 12px;flex-shrink:0;';

    const popupRow = document.createElement('div');
    popupRow.style.cssText = 'display:flex;align-items:center;gap:0;';
    popupRow.appendChild(popupInput);
    popupRow.appendChild(popupConfirmBtn);

    const popupWarn = document.createElement('div');
    popupWarn.style.cssText = 'font-size:0.78rem;color:#ff6347;margin-top:5px;display:none;font-weight:600;';
    addDomainPopup.appendChild(popupRow);
    addDomainPopup.appendChild(popupWarn);
    addPopupWrap.appendChild(addDomainPopup);

    // 팝업 외부 클릭 시 닫기
    let _popupOutsideHandler = null;
    function openAddPopup() {
      addDomainPopup.style.display = 'block';
      popupInput.value = ''; popupWarn.style.display = 'none';
      setTimeout(() => popupInput.focus(), 50);
      _popupOutsideHandler = (ev) => {
        if (!addPopupWrap.contains(ev.target)) {
          addDomainPopup.style.display = 'none';
          document.removeEventListener('mousedown', _popupOutsideHandler);
        }
      };
      document.addEventListener('mousedown', _popupOutsideHandler);
    }

    const addDomainInPanelBtn = document.createElement('button');
    addDomainInPanelBtn.className = 'btn-ghost btn-sm';
    addDomainInPanelBtn.textContent = T('addAddress');
    addDomainInPanelBtn.onclick = (e) => { e.stopPropagation(); openAddPopup(); };
    addPopupWrap.insertBefore(addDomainInPanelBtn, addDomainPopup);

    function doAddDomain() {
      const raw = popupInput.value.trim();
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
          popupWarn.textContent = T('alreadyRegisteredAddress');
          popupWarn.style.display = 'block';
          return;
        }
        targetBox.customDomains.push({ domain, mode });
        chrome.storage.local.set({ [boxKey]: boxes }, () => {
          addDomainPopup.style.display = 'none';
          if (_popupOutsideHandler) document.removeEventListener('mousedown', _popupOutsideHandler);
          refreshPanel(boxes);
        });
      });
    }

    popupConfirmBtn.onclick = doAddDomain;
    popupInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAddDomain(); });

    if (box.customDomains && box.customDomains.length > 0) {
      const masterRow = document.createElement('div');
      masterRow.className = 'donut-master-row';
      masterRow.appendChild(addPopupWrap);
      detailArea.appendChild(masterRow);

      const list = document.createElement('ul');
      list.className = 'donut-domain-list';
      box.customDomains.forEach((cd, cdIndex) => {
        const li = createCustomDomainItemUI(
          cd.domain, cd.mode, `dv_b${boxIndex}_c${cdIndex}`, 'li',
          () => deleteCustomDomain(boxIndex, cdIndex, refreshPanel)
        );
        list.appendChild(li);
      });
      detailArea.appendChild(list);
    } else {
      const emptyMasterRow = document.createElement('div');
      emptyMasterRow.className = 'donut-master-row';
      emptyMasterRow.style.justifyContent = 'flex-start';
      emptyMasterRow.appendChild(addPopupWrap);
      detailArea.appendChild(emptyMasterRow);

      const empty = document.createElement('p');
      empty.className = 'detail-empty';
      empty.textContent = T('donutNoCustom');
      detailArea.appendChild(empty);
    }
  }

  // ── 세그먼트 선택 / 해제 ──
  function selectBox(idx) {
    selectedIndex = (selectedIndex === idx) ? null : idx;
    segGroup.querySelectorAll('.donut-seg').forEach((seg, i) => {
      const box = boxes[i];
      const isSelected = (i === selectedIndex);
      // circle(24시간 박스)와 path 분리 처리
      if (seg.tagName === 'circle') {
        seg.setAttribute('opacity', isSelected ? '1' : '0.85');
        seg.setAttribute('transform', '');
      } else {
        seg.setAttribute('stroke', isSelected ? '#fff' : 'none');
        seg.setAttribute('stroke-width', isSelected ? '3' : '0');
        const midMins = (timeToMins(box.startTime) + (timeToMins(box.endTime) <= timeToMins(box.startTime) ? timeToMins(box.endTime) + TOTAL_MINS : timeToMins(box.endTime))) / 2;
        const midAngle = minsToAngle(midMins);
        const offset = isSelected ? 10 : 0;
        const rad = (midAngle * Math.PI) / 180;
        seg.setAttribute('transform', isSelected ? `translate(${offset * Math.cos(rad)}, ${offset * Math.sin(rad)})` : '');
      }
    });
    const selBox = selectedIndex !== null ? boxes[selectedIndex] : null;
    renderCenter(selBox);
    // 필터링된(요일 팝업) 배열은 로컬 인덱스와 실제 storage 인덱스가 다를 수 있어 _idx로 보정
    const realIndex = selBox ? (selBox._idx !== undefined ? selBox._idx : selectedIndex) : null;
    renderDetailArea(selBox, realIndex);
  }

  // ── 겹침 경고 펄스 애니메이션 ──
  function pulseBox(idx) {
    const segs = segGroup.querySelectorAll('.donut-seg');
    const seg = segs[idx];
    if (!seg) return;

    // 24시간 박스(circle)는 opacity 폄이드로 대체
    if (seg.tagName === 'circle') {
      let count = 0;
      const TOTAL_PULSES = 2;
      function doPulseCircle() {
        if (count >= TOTAL_PULSES) { seg.setAttribute('opacity', '0.85'); return; }
        seg.setAttribute('opacity', '1');
        setTimeout(() => { seg.setAttribute('opacity', '0.85'); count++; setTimeout(doPulseCircle, 150); }, 150);
      }
      doPulseCircle();
      return;
    }

    const box = boxes[idx];
    const midMins = (timeToMins(box.startTime) + (timeToMins(box.endTime) <= timeToMins(box.startTime) ? timeToMins(box.endTime) + TOTAL_MINS : timeToMins(box.endTime))) / 2;
    const midAngle = minsToAngle(midMins);
    const rad = (midAngle * Math.PI) / 180;

    const wasSelected = (selectedIndex === idx);
    const baseTransform = wasSelected ? `translate(${10 * Math.cos(rad)}, ${10 * Math.sin(rad)})` : '';
    const pushOffset = wasSelected ? 22 : 12;
    const pushed = `translate(${pushOffset * Math.cos(rad)}, ${pushOffset * Math.sin(rad)})`;

    seg.style.transition = 'transform 0.15s ease';
    seg.setAttribute('stroke', '#fff');
    seg.setAttribute('stroke-width', '3');

    let count = 0;
    const TOTAL_PULSES = 2;

    function doPulse() {
      if (count >= TOTAL_PULSES) {
        seg.setAttribute('transform', baseTransform);
        seg.setAttribute('stroke', wasSelected ? '#fff' : 'none');
        seg.setAttribute('stroke-width', wasSelected ? '3' : '0');
        return;
      }
      seg.setAttribute('transform', pushed);
      setTimeout(() => {
        seg.setAttribute('transform', baseTransform);
        count++;
        setTimeout(doPulse, 150);
      }, 150);
    }
    doPulse();
  }

  wrap._pulseBox = pulseBox;

  // ── 도넛 세그먼트 path 생성 ──
  function makeSegPath(startMins, endMins, rOuter, rInner) {
    if ((endMins - startMins) >= TOTAL_MINS) return null;
    const a1 = minsToAngle(startMins), a2 = minsToAngle(endMins);
    const p1 = polarToXY(CX, CY, rOuter, a1), p2 = polarToXY(CX, CY, rOuter, a2);
    const p3 = polarToXY(CX, CY, rInner, a2), p4 = polarToXY(CX, CY, rInner, a1);
    const large = (endMins - startMins) > TOTAL_MINS / 2 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y} Z`;
  }

  // ── 세그먼트 생성 및 이벤트 바인딩 ──
  boxes.forEach((box, i) => {
    const startM = timeToMins(box.startTime);
    let endM = timeToMins(box.endTime);
    if (endM <= startM) endM += TOTAL_MINS;
    const color = '#ff6347';

    let seg;
    if (endM - startM >= TOTAL_MINS) {
      // 24시간 박스: 웹패스 대신 원형(circle)으로 렌더
      seg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      seg.setAttribute('cx', CX); seg.setAttribute('cy', CY);
      seg.setAttribute('r', (R_OUTER + R_INNER) / 2);
      seg.setAttribute('fill', 'none');
      seg.setAttribute('stroke', color);
      seg.setAttribute('stroke-width', R_OUTER - R_INNER);
      seg.setAttribute('opacity', '0.85');
    } else {
      const pathD = makeSegPath(startM, endM, R_OUTER, R_INNER);
      seg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      seg.setAttribute('d', pathD);
      seg.setAttribute('fill', color); seg.setAttribute('opacity', '0.85');
    }

    seg.setAttribute('stroke-linejoin', 'round');
    seg.style.cursor = 'pointer';
    seg.style.transition = 'transform 0.18s ease, opacity 0.15s';
    seg.classList.add('donut-seg');
    seg.addEventListener('mouseenter', () => { if (i !== selectedIndex) seg.setAttribute('opacity', '1'); });
    seg.addEventListener('mouseleave', () => { if (i !== selectedIndex) seg.setAttribute('opacity', '0.85'); });
    seg.addEventListener('click', () => selectBox(i));
    segGroup.appendChild(seg);
  });

  // ── 중앙 클릭 → 선택 해제 ──
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
    hint.textContent = T('donutNoBoxes');
    wrap.appendChild(hint);
  }

  dayViewClockInterval = setInterval(renderClockHand, 60000);
}
