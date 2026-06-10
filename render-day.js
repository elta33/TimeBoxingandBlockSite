// render-day.js
// ── 도넛(하루) 뷰 전용 수학 헬퍼 ──
function minsToAngle(mins) { return (mins / TOTAL_MINS) * 360 - 90; }
function polarToXY(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

let dayViewClockInterval = null;

function renderDayView(boxes, wrap) {
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
      hintEl.textContent = '박스 선택';
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
      mBlockBtn.onclick = () => setBoxMasterMode(boxIndex, 'block', refreshPanel);
      const mAllowBtn = document.createElement('button');
      mAllowBtn.className = 'btn-ghost btn-sm'; mAllowBtn.textContent = '모두 허용';
      mAllowBtn.onclick = () => setBoxMasterMode(boxIndex, 'allow', refreshPanel);
      masterRow.appendChild(mBlockBtn); masterRow.appendChild(mAllowBtn);
      detailArea.appendChild(masterRow);

      const list = document.createElement('ul');
      list.className = 'donut-domain-list';
      box.customDomains.forEach((cd, cdIndex) => {
        const li = createCustomDomainItemUI(
          cd.domain, cd.mode, `dv_b${boxIndex}_c${cdIndex}`, 'li',
          (newMode) => updateCustomMode(boxIndex, cdIndex, newMode, refreshPanel),
          () => deleteCustomDomain(boxIndex, cdIndex, refreshPanel)
        );
        list.appendChild(li);
      });
      detailArea.appendChild(list);
    } else {
      const empty = document.createElement('p');
      empty.className = 'detail-empty';
      empty.textContent = '커스텀 주소 없음';
      detailArea.appendChild(empty);
    }
  }

  // ── 세그먼트 선택 / 해제 ──
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
    renderCenter(selectedIndex !== null ? boxes[selectedIndex] : null);
    renderDetailArea(selectedIndex !== null ? boxes[selectedIndex] : null, selectedIndex);
  }

  // ── 겹침 경고 펄스 애니메이션 ──
  function pulseBox(idx) {
    const segs = segGroup.querySelectorAll('.donut-seg');
    const seg = segs[idx];
    if (!seg) return;

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
    hint.textContent = '등록된 타임박스가 없습니다.';
    wrap.appendChild(hint);
  }

  dayViewClockInterval = setInterval(renderClockHand, 60000);
}
