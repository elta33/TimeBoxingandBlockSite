// popup.js

function cleanDomain(d) {
  const domain = d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').trim();
  const sepIdx = domain.search(/[/?#]/);
  const host = sepIdx === -1 ? domain : domain.slice(0, sepIdx);
  const tail = sepIdx === -1 ? '' : domain.slice(sepIdx);
  try {
    return _canonicalVideoUrl(new URL('https://' + host).hostname, tail);
  } catch (_) {
    return domain;
  }
}

// 유튜브 영상 링크는 공유 버튼이 붙이는 si·t·list 같은 부가 파라미터나 youtu.be 단축 주소 때문에
// "그 주소로 시작하는 페이지" 비교가 어긋나기 쉽다(예외/화이트리스트에 넣어도 실제 방문 주소와 앞부분이
// 달라 허용이 안 됨). 영상을 가리키는 최소 형태(youtube.com/watch?v=ID, youtube.com/shorts/ID)로 맞춘다.
// 저장된 값이 아니라 읽을 때마다 적용되므로 예전에 저장된 링크도 그대로 고쳐진다.
// background.js / options-core.js / popup.js의 cleanDomain과 함께 세 곳 동일하게 유지할 것.
function _canonicalVideoUrl(host, tail) {
  const h = host.replace(/^(www\.|m\.)/, '');
  if (h === 'youtu.be' && tail) {
    const id = tail.slice(1).split(/[/?#]/)[0];
    if (id) return 'youtube.com/watch?v=' + id;
  }
  if (h === 'youtube.com' && tail) {
    try {
      const u = new URL('https://youtube.com' + tail);
      const v = u.searchParams.get('v');
      if (u.pathname === '/watch' && v) return 'youtube.com/watch?v=' + v;
      if (/^\/shorts\/[^/]+$/.test(u.pathname)) return 'youtube.com' + u.pathname;
    } catch (_) {}
  }
  return host + tail;
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

// 화이트리스트의 경로 항목(youtube.com/watch?v=…)은 사이트 전체가 아니라 그 주소로 시작하는
// 페이지만 허용하므로(background.js shouldUrlBeBlocked의 matches와 같은 규칙) 경로까지 비교한다.
function matchesWhitelistEntry(hostname, urlTail, entry) {
  const clean = cleanDomain(entry);
  const sep = clean.search(/[/?#]/);
  if (sep === -1) return matchesDomain(hostname, clean);
  if (!matchesDomain(hostname, clean.slice(0, sep))) return false;
  const tail = clean.slice(sep);
  return urlTail.startsWith(tail) &&
    (urlTail.length === tail.length || '/?&=#'.includes(urlTail[tail.length]));
}

// 화이트리스트 모드에선 상시/일반 목록이 일시 정지되므로(background.js) 그 상태를 먼저 본다.
function getDomainStatus(hostname, permanentList, generalList, whitelistOn, whitelistList) {
  if (whitelistOn) return whitelistList.some(d => matchesWhitelistEntry(hostname, currentUrlTail, d)) ? 'whitelist' : null;
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
const settingsBtn      = document.getElementById('settingsBtn');
const emptyStateSect   = document.getElementById('emptyStateSection');
const emptyStateOpenBtn = document.getElementById('emptyStateOpenBtn');
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
const pomoSection     = document.getElementById('pomoSection');
const pomoStatusText  = document.getElementById('pomoStatusText');
const pomoPipBtn      = document.getElementById('pomoPipBtn');
const shortsBlockSwitch = document.getElementById('shortsBlockSwitch');
const instaBlockSwitch  = document.getElementById('instaBlockSwitch');
const reviewPromptSect     = document.getElementById('reviewPromptSection');
const reviewPromptWriteBtn = document.getElementById('reviewPromptWriteBtn');
const reviewPromptLaterBtn = document.getElementById('reviewPromptLaterBtn');

let currentHostname = null;
let currentUrlTail = ''; // 현재 탭 주소의 경로+쿼리+해시 (화이트리스트 경로 항목 비교용)
let storageData = {};
let _pomoTickInterval = null;

settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
emptyStateOpenBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

// ── 리뷰 요청 배너 ──
// 이미 리뷰를 쓰러 간 사용자에게는 다시 보여주지 않고, "나중에"를 누르면 이 간격만큼
// 뒤로 미룬다. 설치 직후에는 아직 안 뜨도록 background.js의 onInstalled에서 최초
// 노출 시각을 며칠 뒤로 미리 잡아둔다.
const REVIEW_PROMPT_INTERVAL_MS = 15 * 24 * 60 * 60 * 1000; // 15일 간격

function _maybeShowReviewPrompt() {
  if (!reviewPromptSect) return;
  // 이 플랫폼의 스토어 리뷰 주소가 아직 없으면(예: AMO 등록 전 파이어폭스 빌드) 배너를
  // 아예 띄우지 않는다 — 눌러도 아무 일 없는 배너를 보여주는 것보다 안 보이는 게 낫다.
  if (!tbbReviewUrl()) return;
  chrome.storage.local.get(['reviewPromptReviewed', 'reviewPromptNextAt'], result => {
    if (result.reviewPromptReviewed) return;
    if (result.reviewPromptNextAt && Date.now() < result.reviewPromptNextAt) return;
    reviewPromptSect.style.display = 'block';
  });
}

reviewPromptWriteBtn?.addEventListener('click', () => {
  // 스토어 주소는 review-url.js 하나에서만 관리한다(크롬=CWS / 파이어폭스=AMO 런타임 분기).
  // 탭을 못 열었으면 "리뷰 완료"로 기록하지 않는다 — 그래야 다음 주기에 배너가 다시 떠서
  // 안내 기회를 잃지 않는다.
  if (!tbbOpenReviewPage()) return;
  chrome.storage.local.set({ reviewPromptReviewed: true });
  reviewPromptSect.style.display = 'none';
});

reviewPromptLaterBtn?.addEventListener('click', () => {
  chrome.storage.local.set({ reviewPromptNextAt: Date.now() + REVIEW_PROMPT_INTERVAL_MS });
  reviewPromptSect.style.display = 'none';
});

// ── 토글 시각 ──
function setToggleVisual(disabled) {
  switchTrack.classList.toggle('on', disabled);
  switchTrack.setAttribute('aria-checked', String(disabled));
  toggleLabel.classList.toggle('active', disabled);
  scheduleSection.classList.toggle('disabled', disabled);
}

function applyScheduleToggle(nowDisabled) {
  setToggleVisual(nowDisabled);
  const enabled = !nowDisabled;
  storageData.dailyScheduleEnabled = enabled;
  TBBStorage.set({ dailyScheduleEnabled: enabled });
}

function toggleSchedule() {
  const nowDisabled = !switchTrack.classList.contains('on');
  // 옵션 페이지의 같은 토글과 동일하게, PIN이 있으면 켜고 끄는 양쪽 다 잠금 해제를 거친다.
  chrome.storage.local.get(['lockPin'], ({ lockPin }) => {
    if (lockPin?.enabled && lockPin?.hash) {
      _openPinModal(T(nowDisabled ? 'pinActionDisable' : 'pinModalConfirm'), () => applyScheduleToggle(nowDisabled));
    } else {
      applyScheduleToggle(nowDisabled);
    }
  });
}

chrome.storage.local.get(['lockPin'], ({ lockPin }) => {
  document.getElementById('scheduleLockIcon').style.display = (lockPin?.enabled && lockPin?.hash) ? 'inline' : 'none';
});

switchTrack.addEventListener('click', toggleSchedule);
switchTrack.addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSchedule(); }
});

// ── 강력 차단 토글(쇼츠/인스타) ──
function setupStrongBlockSwitch(track, storageKey) {
  function setVisual(on) {
    track.classList.toggle('on', on);
    track.setAttribute('aria-checked', String(on));
  }
  function toggle() {
    const on = !track.classList.contains('on');
    setVisual(on);
    TBBStorage.set({ [storageKey]: on });
  }
  TBBStorage.get([storageKey], result => setVisual(!!result[storageKey]));
  track.addEventListener('click', toggle);
  track.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  });
}
setupStrongBlockSwitch(shortsBlockSwitch, 'shortsBlockEnabled');
setupStrongBlockSwitch(instaBlockSwitch, 'instaBlockEnabled');

// ── 렌더링 ──
function renderAll() {
  const {
    permanentList = [],
    generalList   = [],
    dailyBoxes    = [],
    weeklyBoxes   = [],
    whitelistList = [],
    whitelistModeEnabled = false,
    dailyScheduleEnabled
  } = storageData;
  const scheduleEnabled = dailyScheduleEnabled !== false;

  // 빈 상태 안내: 차단 리스트·스케줄이 전부 비어있는 최초 사용자에게만 노출
  const isEmptyState = permanentList.length === 0 && generalList.length === 0
    && dailyBoxes.length === 0 && weeklyBoxes.length === 0 && !whitelistModeEnabled;
  emptyStateSect.style.display = isEmptyState ? 'flex' : 'none';

  setToggleVisual(!scheduleEnabled);

  // 현재 페이지 상태
  if (currentHostname) {
    const status = getDomainStatus(currentHostname, permanentList, generalList, whitelistModeEnabled, whitelistList);
    if (status === 'whitelist') {
      domainStatusEl.textContent = T('popupWhitelistAllowed');
      domainStatusEl.className = 'p-domain-badge p-badge-whitelist';
      domainStatusEl.style.display = 'inline-block';
      addBtnsEl.style.display = 'none';
    } else if (status === 'permanent') {
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

  renderPomo();
}

// ── 포모도로 상태 한 줄 ──
function fmtPomoRemaining(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function renderPomo() {
  clearInterval(_pomoTickInterval);
  const state = storageData.pomodoroState || { active: false, phase: 'idle' };
  if (!state.active || !state.endTime) {
    pomoSection.style.display = 'none';
    return;
  }
  pomoSection.style.display = 'block';
  const icon = state.phase === 'rest' ? '☕' : '🍅';
  const updateText = () => {
    const rem = Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000));
    pomoStatusText.textContent = `${icon} ${T('popupPomoRemaining', [fmtPomoRemaining(rem)])}`;
  };
  updateText();
  _pomoTickInterval = setInterval(updateText, 1000);
}

// ── 포모도로 PiP 빠른 경로 ──
function createPomoPipWindow() {
  const pipUrl = chrome.runtime.getURL('pomodoro-pip.html');
  TBBStorage.get(['pomodoroPipPos'], ({ pomodoroPipPos }) => {
    const opts = { url: pipUrl, type: 'popup', width: 280, height: 340 };
    if (pomodoroPipPos) { opts.left = pomodoroPipPos.left; opts.top = pomodoroPipPos.top; }
    chrome.windows.create(opts, win => {
      TBBStorage.set({ pipWindowId: win.id });
    });
  });
}

// 팝업(액션 팝업)은 실제 브라우저 윈도우가 아닌 특수한 서피스라 documentPictureInPicture
// API가 정상적으로 창을 만들지 못하고(promise가 resolve/reject 없이 멈춤) 옵션 페이지와
// 달리 "html 생략하고 곧장 PiP 승격"은 재현이 안 된다. 그래서 기본 상단 탭 고정 여부와
// 무관하게 항상 일반 PiP 창(html)만 연다 — 상단 고정이 필요하면 그 창 안의 토글을 쓰면 된다.
pomoPipBtn.addEventListener('click', () => {
  TBBStorage.get(['pipWindowId'], ({ pipWindowId }) => {
    if (pipWindowId) {
      chrome.windows.get(pipWindowId, win => {
        if (chrome.runtime.lastError || !win) {
          createPomoPipWindow();
        } else {
          chrome.windows.update(pipWindowId, { focused: true });
        }
      });
    } else {
      createPomoPipWindow();
    }
  });
});

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
_maybeShowReviewPrompt();
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const url = tabs[0]?.url || '';
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
      currentHostname = urlObj.hostname.replace(/^www\./, '');
      currentUrlTail = urlObj.pathname + urlObj.search + urlObj.hash;
      currentDomainEl.textContent = domainToDisplay(currentHostname);
      currentPageSect.style.display = 'block';
    }
  } catch (_) {}

  TBBStorage.get(
    ['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled', 'pomodoroState', 'whitelistModeEnabled', 'whitelistList'],
    result => {
      storageData = result;
      renderAll();
    }
  );
});
