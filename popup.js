// popup.js

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

function timeToMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function isBoxActiveNow(box) {
  const startM = timeToMins(box.startTime);
  const [eH, eM] = box.endTime.split(':').map(Number);
  let endM = eH * 60 + eM;
  let nowM = new Date().getHours() * 60 + new Date().getMinutes();
  if (endM <= startM) {
    endM += 24 * 60;
    if (nowM <= eH * 60 + eM) nowM += 24 * 60;
  }
  return nowM >= startM && nowM < endM;
}

function calcEndRemaining(box) {
  const startM = timeToMins(box.startTime);
  const [eH, eMin] = box.endTime.split(':').map(Number);
  let endM = eH * 60 + eMin;
  let nowM = new Date().getHours() * 60 + new Date().getMinutes();
  if (endM <= startM) {
    endM += 24 * 60;
    if (nowM <= eH * 60 + eMin) nowM += 24 * 60;
  }
  return Math.max(0, endM - nowM);
}

function calcStartRemaining(box) {
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  return Math.max(0, timeToMins(box.startTime) - nowM);
}

function fmtMins(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h > 0 && m > 0) return T('timeHM', [String(h), String(m)]);
  if (h > 0) return T('timeH', [String(h)]);
  return T('timeM', [String(m)]);
}

function matchesDomain(hostname, entry) {
  const clean = cleanDomain(entry);
  const sep = clean.search(/[/?#]/);
  if (sep !== -1) {
    const bHost = clean.slice(0, sep);
    return hostname === bHost || hostname.endsWith('.' + bHost);
  }
  return hostname === clean || hostname.endsWith('.' + clean);
}

function getDomainStatus(hostname, permanentList, generalList) {
  if (permanentList.some(d => matchesDomain(hostname, d))) return 'permanent';
  if (generalList.some(d => matchesDomain(hostname, d))) return 'general';
  return null;
}

function getDAY_LABELS() {
  return [T('dayMon'),T('dayTue'),T('dayWed'),T('dayThu'),T('dayFri'),T('daySat'),T('daySun')];
}

function buildTypeBadge(box) {
  const badge = document.createElement('span');
  badge.className = 'p-type-badge';
  if (box._type === 'daily') {
    badge.classList.add('p-badge-daily');
    badge.textContent = T('typeBadgeDaily');
  } else {
    badge.classList.add('p-badge-weekly');
    badge.textContent = (box.days || []).map(d => getDAY_LABELS()[d]).join('·');
  }
  return badge;
}

function buildActiveCard(box) {
  const card = document.createElement('div');
  card.className = 'p-box-card active';

  const top = document.createElement('div');
  top.className = 'p-box-card-top';

  const dot = document.createElement('div');
  dot.className = 'p-box-dot';

  const name = document.createElement('span');
  name.className = 'p-box-name';
  name.textContent = box.name;

  top.appendChild(dot);
  top.appendChild(name);
  top.appendChild(buildTypeBadge(box));
  card.appendChild(top);

  const time = document.createElement('div');
  time.className = 'p-box-time-active';
  time.textContent = `${box.startTime} – ${box.endTime}`;
  card.appendChild(time);

  const rem = calcEndRemaining(box);
  if (rem > 0) {
    const remEl = document.createElement('div');
    remEl.className = 'p-box-time-active';
    remEl.style.opacity = '0.55';
    remEl.textContent = T('afterEnd', [fmtMins(rem)]);
    card.appendChild(remEl);
  }

  return card;
}

function buildUpcomingRow(box) {
  const row = document.createElement('div');
  row.className = 'p-box-row';

  const left = document.createElement('div');
  left.className = 'p-box-row-left';

  const dot = document.createElement('div');
  dot.className = 'p-box-dot dim';

  const name = document.createElement('span');
  name.className = 'p-box-row-name';
  name.textContent = box.name;

  left.appendChild(dot);
  left.appendChild(name);
  left.appendChild(buildTypeBadge(box));
  row.appendChild(left);

  const timeWrap = document.createElement('div');
  timeWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;';

  const timeRange = document.createElement('span');
  timeRange.className = 'p-box-row-time';
  timeRange.textContent = `${box.startTime} – ${box.endTime}`;
  timeWrap.appendChild(timeRange);

  const rem = calcStartRemaining(box);
  if (rem > 0) {
    const remEl = document.createElement('span');
    remEl.className = 'p-box-row-time';
    remEl.style.opacity = '0.55';
    remEl.textContent = T('afterStart', [fmtMins(rem)]);
    timeWrap.appendChild(remEl);
  }

  row.appendChild(timeWrap);

  return row;
}

// ── DOM refs ──
const settingsBtn     = document.getElementById('settingsBtn');
const currentPageSect = document.getElementById('currentPageSection');
const currentDomainEl = document.getElementById('currentDomain');
const domainStatusEl  = document.getElementById('domainStatus');
const addBtnsEl       = document.getElementById('addBtns');
const addPermanentBtn = document.getElementById('addPermanentBtn');
const addGeneralBtn   = document.getElementById('addGeneralBtn');
const switchTrack     = document.getElementById('switchTrack');
const toggleLabel     = document.getElementById('toggleLabel');
const scheduleSection = document.getElementById('scheduleSection');
const currentBoxWrap  = document.getElementById('currentBoxWrap');
const upcomingLabel   = document.getElementById('upcomingLabel');
const upcomingBoxWrap = document.getElementById('upcomingBoxWrap');

let currentHostname = null;
let storageData = {};

settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

// ── 토글 시각 ──
function setToggleVisual(disabled) {
  switchTrack.classList.toggle('on', disabled);
  switchTrack.setAttribute('aria-checked', String(disabled));
  toggleLabel.classList.toggle('active', disabled);
  scheduleSection.classList.toggle('disabled', disabled);
}

function toggleSchedule() {
  const nowDisabled = !switchTrack.classList.contains('on');
  setToggleVisual(nowDisabled);
  const enabled = !nowDisabled;
  storageData.dailyScheduleEnabled = enabled;
  TBBStorage.set({ dailyScheduleEnabled: enabled });
}

switchTrack.addEventListener('click', toggleSchedule);
switchTrack.addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSchedule(); }
});

// ── 렌더링 ──
function renderAll() {
  const {
    permanentList = [],
    generalList   = [],
    dailyBoxes    = [],
    weeklyBoxes   = [],
    dailyScheduleEnabled
  } = storageData;
  const scheduleEnabled = dailyScheduleEnabled !== false;

  setToggleVisual(!scheduleEnabled);

  // 현재 페이지 상태
  if (currentHostname) {
    const status = getDomainStatus(currentHostname, permanentList, generalList);
    if (status === 'permanent') {
      domainStatusEl.textContent = T('popupPermanentBlocked');
      domainStatusEl.className = 'p-domain-badge p-badge-permanent';
      domainStatusEl.style.display = 'inline-block';
      addBtnsEl.style.display = 'none';
    } else if (status === 'general') {
      domainStatusEl.textContent = T('popupGeneralBlocked');
      domainStatusEl.className = 'p-domain-badge p-badge-general';
      domainStatusEl.style.display = 'inline-block';
      addBtnsEl.style.display = 'none';
    } else {
      domainStatusEl.style.display = 'none';
      addBtnsEl.style.display = 'flex';
    }
  }

  // 오늘의 박스 목록 (하루 + 해당 요일 주간)
  const todayDow = (new Date().getDay() + 6) % 7; // 0=월…6=일
  const todayBoxes = [
    ...dailyBoxes.map(b => ({ ...b, _type: 'daily' })),
    ...weeklyBoxes
      .filter(b => (b.days || []).includes(todayDow))
      .map(b => ({ ...b, _type: 'weekly' }))
  ].sort((a, b) => timeToMins(a.startTime) - timeToMins(b.startTime));

  const activeBox = todayBoxes.find(b => isBoxActiveNow(b)) || null;
  const nowMins   = new Date().getHours() * 60 + new Date().getMinutes();
  const upcoming  = todayBoxes
    .filter(b => !isBoxActiveNow(b) && timeToMins(b.startTime) > nowMins)
    .slice(0, 2);

  // 현재 박스
  currentBoxWrap.innerHTML = '';
  if (activeBox) {
    currentBoxWrap.appendChild(buildActiveCard(activeBox));
  } else {
    const empty = document.createElement('div');
    empty.className = 'p-empty';
    empty.textContent = T('popupNoActiveBox');
    currentBoxWrap.appendChild(empty);
  }

  // 다음 박스
  upcomingBoxWrap.innerHTML = '';
  if (upcoming.length > 0) {
    upcomingLabel.style.display = 'block';
    upcoming.forEach(b => upcomingBoxWrap.appendChild(buildUpcomingRow(b)));
  } else {
    upcomingLabel.style.display = 'none';
  }
}

// ── 도메인 추가 핸들러 ──
addPermanentBtn.addEventListener('click', () => {
  if (!currentHostname) return;
  const list = [...(storageData.permanentList || [])];
  if (list.some(d => matchesDomain(currentHostname, d))) return;
  list.push(currentHostname);
  storageData.permanentList = list;
  TBBStorage.set({ permanentList: list }, renderAll);
});

addGeneralBtn.addEventListener('click', () => {
  if (!currentHostname) return;
  const list = [...(storageData.generalList || [])];
  if (list.some(d => matchesDomain(currentHostname, d))) return;
  list.push(currentHostname);
  storageData.generalList = list;
  TBBStorage.set({ generalList: list }, renderAll);
});

// ── 초기화 ──
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const url = tabs[0]?.url || '';
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
      currentHostname = urlObj.hostname.replace(/^www\./, '');
      currentDomainEl.textContent = currentHostname;
      currentPageSect.style.display = 'block';
    }
  } catch (_) {}

  TBBStorage.get(
    ['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled'],
    result => {
      storageData = result;
      renderAll();
    }
  );
});
