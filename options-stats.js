// options-stats.js
// 통계 탭 렌더링 (바 차트 / 상위 차단 도메인 / 포모도로 통계 / 히트맵 / 스트릭 달력)
// options-core.js 다음에 로드. 이 파일은 함수 정의만 있고 최상위 실행 코드는 없음 — options-init.js가 renderStats()를 호출해 부트스트랩한다.
// ── 통계 탭 ──

let _statsPeriod = 'today';

// 차단 횟수 단위: 한국어는 "회", 영어는 단위 없이 숫자만(빈 문자열).
// T()는 빈 메시지를 키 이름으로 폴백하므로, 여기서는 폴백 없이 getMessage를 직접 쓴다.
function _blockUnit() {
  return chrome.i18n.getMessage('statsBlockUnit');
}

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
  TBBStorage.get(['focusEvents', 'focusStreak'], data => {
    let events = data.focusEvents || [];
    let day = events.find(e => e.date === dateStr);
    if (!day) { day = { date: dateStr, blocks: [], pomoSessions: [] }; events.push(day); }
    day.pomoSessions.push({ ts: Math.floor(Date.now() / 1000), durationMins });
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    events = events.filter(e => e.date >= cutoff.toISOString().slice(0, 10));
    const streak = _statsUpdateStreak(data.focusStreak || null, dateStr);
    TBBStorage.set({ focusEvents: events, focusStreak: streak });
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
          dn.textContent = domainToDisplay(domain);
          const cnt = document.createElement('span');
          cnt.className = 'stats-bar-popover-count';
          cnt.textContent = count + _blockUnit();
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
    name.textContent = domainToDisplay(domain);

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
    countEl.textContent = count + _blockUnit();

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
      popover.textContent = `${h}:00 — ${display}${_blockUnit()}`;
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
  TBBStorage.get(keys, data => {
    const allEvents = data.focusEvents || [];
    const streak    = data.focusStreak || { current: 0, longest: 0, lastDate: '' };
    const todayStr  = _statsTodayStr();

    // 집중 시간 카드 (기간별 합산)
    const focusVal    = document.getElementById('stat-focus-val');
    const focusFixed  = document.getElementById('stat-focus-fixed');
    const focusPeriod = document.getElementById('stat-focus-period');
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
      if (focusFixed)  focusFixed.textContent  = T('statsFocusSub');
      if (focusPeriod) focusPeriod.textContent = T('statsFocusTime' + pSuffix);
    }

    // 차단 횟수 카드 (기간 필터)
    const blockVal    = document.getElementById('stat-block-val');
    const blockFixed  = document.getElementById('stat-block-fixed');
    const blockPeriod = document.getElementById('stat-block-period');
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
      const blockUnitEl = document.getElementById('stat-block-unit');
      if (blockUnitEl) blockUnitEl.textContent = _blockUnit();
      const pSuffix = _statsPeriod === 'today' ? '' : _statsPeriod;
      if (blockFixed)  blockFixed.textContent  = T('statsBlockSub');
      if (blockPeriod) blockPeriod.textContent = T('statsBlockCount' + pSuffix);
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
