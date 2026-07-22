// block.js

// ─────────────────────────────────────────────
// 기본값 (스토리지가 비어있을 때 최초 1회 시딩)
// ─────────────────────────────────────────────
const DEFAULT_IMAGES = [
  { name: 'Default_1.jpeg', builtin: 'images/Default_1.jpeg' },
  { name: 'Default_2.jpeg', builtin: 'images/Default_2.jpeg' },
  { name: 'Default_3.jpeg', builtin: 'images/Default_3.jpeg' },
  { name: 'Default_4.jpeg', builtin: 'images/Default_4.jpeg' },
  { name: 'Default_5.jpeg', builtin: 'images/Default_5.jpeg' },
];
function getDefaultQuotes() {
  return [
    T('defaultQuote1'),
    T('defaultQuote2'),
    T('defaultQuote3'),
    T('defaultQuote4'),
    T('defaultQuote5'),
  ];
}

// ─────────────────────────────────────────────
// 스토리지 키
// ─────────────────────────────────────────────
const STORE_IMGS   = 'customBgImages';  // Array<{name, builtin?, data?}>
const STORE_QUOTES = 'customQuotes';    // string[]
const STORE_LINKS  = 'customLinks';     // Array<{imgName, quote}>

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────
function pickRandom(arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function getImgSrc(img) {
  if (img.data)    return img.data;
  if (img.builtin) return chrome.runtime.getURL(img.builtin);
  return null;
}

// ─────────────────────────────────────────────
// 스토리지 로드 (최초 기본값 시딩 포함)
// ─────────────────────────────────────────────
function loadData() {
  return new Promise(resolve => {
    TBBStorage.get([STORE_IMGS, STORE_QUOTES, STORE_LINKS], data => {
      let imgs   = data[STORE_IMGS];
      let quotes = data[STORE_QUOTES];
      let links  = data[STORE_LINKS];
      const updates = {};

      if (!Array.isArray(imgs))   { imgs   = DEFAULT_IMAGES;        updates[STORE_IMGS]   = imgs;   }
      if (!Array.isArray(quotes)) { quotes = getDefaultQuotes();    updates[STORE_QUOTES] = quotes; }
      if (!Array.isArray(links))  { links  = [];              updates[STORE_LINKS]  = links;  }

      if (Object.keys(updates).length) TBBStorage.set(updates);
      resolve({ imgs, quotes, links });
    });
  });
}

// ─────────────────────────────────────────────
// 배경 + 문구 적용 (링크 연동)
// ─────────────────────────────────────────────
function applyBgAndQuote(imgs, quotes, links) {
  const img  = pickRandom(imgs);
  const link = img ? links.find(l => l.imgName === img.name) : null;

  let q;
  if (link) {
    // 링크된 이미지 → 반드시 대응 문구 사용
    q = link.quote;
  } else {
    // 링크되지 않은 이미지 → 링크에 묶인 문구는 후보에서 제외
    const linkedQuoteSet = new Set(links.map(l => l.quote));
    const freeQuotes     = quotes.filter(qt => !linkedQuoteSet.has(qt));
    q = pickRandom(freeQuotes); // 자유 문구가 없으면 null → 문구 숨김
  }

  if (img) {
    const src = getImgSrc(img);
    if (src) {
      const layer = document.getElementById('bg-layer');
      const el = new Image();
      el.onload = () => { layer.style.backgroundImage = `url("${src}")`; layer.classList.add('loaded'); };
      el.onerror = () => console.warn('bg image load failed:', img.name);
      el.src = src;
    }
  }

  const quoteEl = document.getElementById('quote');
  if (q) quoteEl.textContent = q;
  else   quoteEl.style.display = 'none';
}

// ─────────────────────────────────────────────
// 차단 사유 문구
// ─────────────────────────────────────────────
const _params = new URLSearchParams(window.location.search);
const _reason = _params.get('reason');

// ─────────────────────────────────────────────
// 통계: 차단 이벤트 로깅
// ─────────────────────────────────────────────
function _statsStreak(streak, dateStr) {
  const s = streak || { current: 0, longest: 0, lastDate: '' };
  if (s.lastDate === dateStr) return s;
  const prev = new Date(dateStr);
  prev.setDate(prev.getDate() - 1);
  const yesterStr = prev.toISOString().slice(0, 10);
  const cur = (s.lastDate === yesterStr) ? s.current + 1 : 1;
  return { current: cur, longest: Math.max(s.longest, cur), lastDate: dateStr };
}

(function logBlockEvent() {
  const domain = _params.get('domain');
  if (!domain) return;
  const dateStr = new Date().toISOString().slice(0, 10);
  const ts = Math.floor(Date.now() / 1000);
  TBBStorage.get(['focusEvents', 'focusStreak'], data => {
    let events = data.focusEvents || [];
    let day = events.find(e => e.date === dateStr);
    if (!day) { day = { date: dateStr, blocks: [], pomoSessions: [] }; events.push(day); }
    day.blocks.push({ domain, reason: _reason || 'general', ts });
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    events = events.filter(e => e.date >= cutoff.toISOString().slice(0, 10));
    const streak = _statsStreak(data.focusStreak || null, dateStr);
    TBBStorage.set({ focusEvents: events, focusStreak: streak });
  });
})();

function setSubtitleWithKeyword(el, preKey, keywordKey, postKey) {
  el.textContent = '';
  // pre/post는 로케일에 따라 의도적으로 빈 문자열일 수 있다(ko의 permanent/pomodoro는 접두사 없음).
  // T()는 메시지가 없을 때 키 이름으로 폴백하는데, chrome.i18n.getMessage가 "존재하지만 빈 값"과
  // "키 자체가 없음"을 구분 안 해줘서 T()를 쓰면 의도된 빈 문자열도 키 이름으로 잘못 대체된다.
  // 그래서 여기서는 폴백 없이 원본 값을 그대로 쓰고, 비어 있으면 아예 붙이지 않는다.
  const preText = chrome.i18n.getMessage(preKey);
  if (preText) el.appendChild(document.createTextNode(preText));
  const span = document.createElement('span');
  span.className = 'reason-keyword';
  span.textContent = T(keywordKey);
  el.appendChild(span);
  const postText = chrome.i18n.getMessage(postKey);
  if (postText) el.appendChild(document.createTextNode(postText));
}

(function applyReasonMessage() {
  const el = document.getElementById('subtitle');
  if (!el) return;
  const h1 = document.querySelector('h1');

  if (_reason === 'general' || _reason === 'custom') {
    if (h1) h1.textContent = T('blockTitleSchedule');
    setSubtitleWithKeyword(el, 'blockReasonGeneralPre', 'blockReasonGeneralKeyword', 'blockReasonGeneralPost');
  } else if (_reason === 'permanent') {
    setSubtitleWithKeyword(el, 'blockReasonPermanentPre', 'blockReasonPermanentKeyword', 'blockReasonPermanentPost');
  } else if (_reason === 'pomodoro') {
    if (h1) h1.textContent = T('blockTitlePomodoro');
    setSubtitleWithKeyword(el, 'blockReasonPomodoroPre', 'blockReasonPomodoroKeyword', 'blockReasonPomodoroPost');
  } else {
    setSubtitleWithKeyword(el, 'blockReasonGeneralPre', 'blockReasonGeneralKeyword', 'blockReasonGeneralPost');
  }
})();

document.getElementById('openSettings')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ─────────────────────────────────────────────
// 남은 차단 시간 표시
// ─────────────────────────────────────────────
(function applyRemainingTime() {
  if (_reason === 'permanent' || _reason === 'pomodoro') return;

  function timeToMins(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }
  function isActive(box) {
    const now = new Date();
    let nowM = now.getHours() * 60 + now.getMinutes();
    const startM = timeToMins(box.startTime);
    const [eH, eMin] = box.endTime.split(':').map(Number);
    let endM = eH * 60 + eMin;
    if (endM <= startM) {
      endM += 24 * 60;
      if (nowM <= eH * 60 + eMin) nowM += 24 * 60;
    }
    return nowM >= startM && nowM < endM;
  }
  function getRemainingMins(endStr) {
    const [eH, eM] = endStr.split(':').map(Number);
    const now = new Date();
    const nowM = now.getHours() * 60 + now.getMinutes();
    let endM = eH * 60 + eM;
    if (endM <= nowM) endM += 24 * 60;
    return endM - nowM;
  }
  function fmt(mins) {
    const h = Math.floor(mins / 60), m = mins % 60;
    const timeStr = h > 0 && m > 0 ? T('timeHM', [String(h), String(m)])
                  : h > 0           ? T('timeH',  [String(h)])
                  :                   T('timeM',  [String(m)]);
    return T('afterRelease', [timeStr]);
  }

  TBBStorage.get(['dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled'], data => {
    const dailyEnabled = data.dailyScheduleEnabled !== false;
    const dailyBoxes   = dailyEnabled ? (data.dailyBoxes || []).map(b => ({ ...b, days: [] })) : [];
    const weeklyBoxes  = data.weeklyBoxes || [];
    const todayDow     = (new Date().getDay() + 6) % 7;

    const activeBox = [...dailyBoxes, ...weeklyBoxes].find(box => {
      const days = box.days || [];
      if (days.length > 0 && !days.includes(todayDow)) return false;
      return isActive(box);
    });
    if (!activeBox) return;

    const remaining = getRemainingMins(activeBox.endTime);
    if (remaining <= 0) return;
    const el = document.getElementById('remaining-time');
    if (el) { el.textContent = fmt(remaining); el.style.display = 'block'; }
  });
})();

// ─────────────────────────────────────────────
// 팝업 상태
// ─────────────────────────────────────────────
let _imgs   = [];
let _quotes = [];
let _links  = [];

let _selectingMode = false;
let _selImg   = null;  // index into _imgs
let _selQuote = null;  // index into _quotes

// ─────────────────────────────────────────────
// 스토리지 저장
// ─────────────────────────────────────────────
// chrome.storage.local.set은 실패해도 예외를 던지지 않고 rejected Promise만 반환한다 —
// catch 없이 두면 저장이 조용히 실패해도(예: 용량 초과) 화면엔 반영된 것처럼 보이다가
// 새로고침 시 이전 상태로 되돌아간다. 이미지는 base64라 용량을 금방 채우므로 실패를
// 사용자에게 알려준다(manifest의 unlimitedStorage로 기본 10MB 상한 자체는 없앴지만,
// 디스크 부족 등 다른 이유의 실패에도 대비).
function saveImages() {
  chrome.storage.local.set({ [STORE_IMGS]: _imgs }).catch(err => {
    console.error('이미지 저장 실패:', err);
    alert(T('custImageSaveFailed'));
  });
}
function saveQuotes() { TBBStorage.set({ [STORE_QUOTES]: _quotes }); }
function saveLinks()  { TBBStorage.set({ [STORE_LINKS]:  _links  }); }

// ─────────────────────────────────────────────
// 렌더링: 링크 목록
// ─────────────────────────────────────────────
function renderLinkList() {
  const list = document.getElementById('linkList');
  list.innerHTML = '';

  if (!_links.length) {
    const empty = document.createElement('div');
    empty.className = 'cust-list-empty';
    empty.textContent = T('custNoLinks');
    list.appendChild(empty);
    return;
  }

  _links.forEach((link, i) => {
    const img = _imgs.find(im => im.name === link.imgName);
    const src = img ? getImgSrc(img) : null;

    const item = document.createElement('div');
    item.className = 'link-item';

    // 이미지 영역
    const imgPart = document.createElement('div');
    imgPart.className = 'link-img-part';

    const thumb = document.createElement('img');
    thumb.className = 'link-img-thumb';
    thumb.src = src || '';
    thumb.alt = link.imgName;
    if (!src) thumb.style.visibility = 'hidden';

    const imgName = document.createElement('span');
    imgName.className = 'link-img-name';
    imgName.title = link.imgName;
    imgName.textContent = link.imgName;
    if (!img) imgName.style.opacity = '0.4';

    imgPart.append(thumb, imgName);

    // 연결선
    const connector = document.createElement('div');
    connector.className = 'link-connector';

    // 인용구 영역
    const quotePart = document.createElement('div');
    quotePart.className = 'link-quote-part';
    quotePart.title = link.quote;
    quotePart.textContent = link.quote;

    // 링크 해제 버튼
    const unlinkBtn = document.createElement('button');
    unlinkBtn.className = 'link-unlink-btn';
    unlinkBtn.textContent = '×';
    unlinkBtn.title = T('custUnlinkTitle');
    unlinkBtn.addEventListener('click', e => { e.stopPropagation(); deleteLink(i); });

    item.append(imgPart, connector, quotePart, unlinkBtn);
    list.appendChild(item);
  });
}

// ─────────────────────────────────────────────
// 렌더링: 이미지 목록 (관리용 — 커스텀 팝업의 배경 이미지 칸)
// ─────────────────────────────────────────────
function renderImageList() {
  const list = document.getElementById('imageList');
  list.innerHTML = '';

  if (!_imgs.length) {
    const empty = document.createElement('div');
    empty.className = 'cust-list-empty';
    empty.textContent = T('custNoImages');
    list.appendChild(empty);
    return;
  }

  _imgs.forEach((img, i) => {
    const src = getImgSrc(img);

    const item = document.createElement('div');
    item.className = 'cust-item clickable';

    const thumb = document.createElement('img');
    thumb.className = 'cust-thumb';
    thumb.src = src || '';
    thumb.alt = img.name;

    const name = document.createElement('span');
    name.className = 'cust-item-name';
    name.title = img.name;
    name.textContent = img.name;

    const del = document.createElement('button');
    del.className = 'cust-del';
    del.textContent = '×';
    del.title = T('delete');
    del.addEventListener('click', e => { e.stopPropagation(); deleteImage(i); });

    item.append(thumb, name, del);
    item.addEventListener('click', () => { if (src) openImagePreview(src); });

    list.appendChild(item);
  });
}

// ─────────────────────────────────────────────
// 렌더링: 인용구 목록 (관리용 — 커스텀 팝업의 인용구 칸)
// ─────────────────────────────────────────────
function renderQuoteList() {
  const list = document.getElementById('quoteList');
  list.innerHTML = '';

  if (!_quotes.length) {
    const empty = document.createElement('div');
    empty.className = 'cust-list-empty';
    empty.textContent = T('custNoQuotes');
    list.appendChild(empty);
    return;
  }

  _quotes.forEach((q, i) => {
    const item = document.createElement('div');
    item.className = 'cust-item';

    const text = document.createElement('span');
    text.className = 'cust-item-name';
    text.title = q;
    text.textContent = q;

    const del = document.createElement('button');
    del.className = 'cust-del';
    del.textContent = '×';
    del.title = T('delete');
    del.addEventListener('click', e => { e.stopPropagation(); deleteQuote(i); });

    item.append(text, del);
    list.appendChild(item);
  });
}

// ─────────────────────────────────────────────
// 렌더링: 링크 선택 모달의 이미지/인용구 목록 (선택 전용 — 삭제·미리보기 없음)
// ─────────────────────────────────────────────
function renderLinkSelectImageList() {
  const list = document.getElementById('linkSelectImageList');
  list.innerHTML = '';

  if (!_imgs.length) {
    const empty = document.createElement('div');
    empty.className = 'cust-list-empty';
    empty.textContent = T('custNoImages');
    list.appendChild(empty);
    return;
  }

  const linkedImgNames = new Set(_links.map(l => l.imgName));

  _imgs.forEach((img, i) => {
    const src        = getImgSrc(img);
    const isLinked   = linkedImgNames.has(img.name);
    const isSelected = _selImg === i;

    const item = document.createElement('div');
    item.className = 'cust-item clickable'
      + (isSelected ? ' sel-selected' : '')
      + (isLinked ? ' sel-disabled' : '');

    const thumb = document.createElement('img');
    thumb.className = 'cust-thumb';
    thumb.src = src || '';
    thumb.alt = img.name;

    const name = document.createElement('span');
    name.className = 'cust-item-name';
    name.title = img.name;
    name.textContent = img.name;

    item.append(thumb, name);
    item.addEventListener('click', () => {
      if (isLinked) return;
      _selImg = (_selImg === i) ? null : i;
      updateSelStatus();
      renderLinkSelectImageList();
    });

    list.appendChild(item);
  });
}

function renderLinkSelectQuoteList() {
  const list = document.getElementById('linkSelectQuoteList');
  list.innerHTML = '';

  if (!_quotes.length) {
    const empty = document.createElement('div');
    empty.className = 'cust-list-empty';
    empty.textContent = T('custNoQuotes');
    list.appendChild(empty);
    return;
  }

  const linkedQuotes = new Set(_links.map(l => l.quote));

  _quotes.forEach((q, i) => {
    const isLinked   = linkedQuotes.has(q);
    const isSelected = _selQuote === i;

    const item = document.createElement('div');
    item.className = 'cust-item clickable'
      + (isSelected ? ' sel-selected' : '')
      + (isLinked ? ' sel-disabled' : '');

    const text = document.createElement('span');
    text.className = 'cust-item-name';
    text.title = q;
    text.textContent = q;

    item.appendChild(text);
    item.addEventListener('click', () => {
      if (isLinked) return;
      _selQuote = (_selQuote === i) ? null : i;
      updateSelStatus();
      renderLinkSelectQuoteList();
    });

    list.appendChild(item);
  });
}

// ─────────────────────────────────────────────
// CRUD: 이미지
// ─────────────────────────────────────────────
function deleteImage(i) {
  const name = _imgs[i]?.name;
  // 선택 인덱스 보정
  if (_selImg === i)                    _selImg = null;
  else if (_selImg !== null && _selImg > i) _selImg--;

  _imgs.splice(i, 1);

  if (name) {
    const hadLink = _links.some(l => l.imgName === name);
    _links = _links.filter(l => l.imgName !== name);
    if (hadLink) { saveLinks(); renderLinkList(); }
  }
  saveImages();
  if (_selectingMode) updateSelStatus();
  renderImageList();
}

// ─────────────────────────────────────────────
// CRUD: 인용구
// ─────────────────────────────────────────────
function deleteQuote(i) {
  const q = _quotes[i];
  if (_selQuote === i)                        _selQuote = null;
  else if (_selQuote !== null && _selQuote > i) _selQuote--;

  _quotes.splice(i, 1);

  if (q) {
    const hadLink = _links.some(l => l.quote === q);
    _links = _links.filter(l => l.quote !== q);
    if (hadLink) { saveLinks(); renderLinkList(); }
  }
  saveQuotes();
  if (_selectingMode) updateSelStatus();
  renderQuoteList();
}

// ─────────────────────────────────────────────
// CRUD: 링크
// ─────────────────────────────────────────────
function deleteLink(i) {
  _links.splice(i, 1);
  saveLinks();
  renderLinkList();
}

// ─────────────────────────────────────────────
// 이미지 미리보기
// ─────────────────────────────────────────────
function openImagePreview(src) {
  document.getElementById('img-preview-el').src = src;
  document.getElementById('img-preview-backdrop').classList.add('open');
}

document.getElementById('img-preview-backdrop').addEventListener('click', () => {
  document.getElementById('img-preview-backdrop').classList.remove('open');
});

// ─────────────────────────────────────────────
// 선택 모드
// ─────────────────────────────────────────────
function updateSelStatus() {
  const popup = document.getElementById('link-select-popup');
  popup.classList.toggle('img-selected',   _selImg   !== null);
  popup.classList.toggle('quote-selected', _selQuote !== null);

  const btn    = document.getElementById('selCompleteBtn');
  const status = document.getElementById('selStatus');
  btn.disabled = (_selImg === null || _selQuote === null);

  const imgLabel   = _selImg   !== null ? `"${_imgs[_selImg]?.name || '?'}"` : T('custSelNone');
  const quoteLabel = _selQuote !== null ? T('custSelSelected') : T('custSelNone');
  status.textContent = T('custSelStatus', [imgLabel, quoteLabel]);
}

// 링크 선택은 커스텀 팝업 위에 겹쳐 뜨는 별도 모달(#link-select-backdrop)에서 이뤄진다 —
// 기존엔 같은 팝업 안에서 이미지/인용구 목록을 흐리게 하는 방식이었으나, 그 선택 로직
// (강조/비활성화/선택 완료 판정)은 그대로 두고 렌더 대상만 모달 전용 목록으로 옮겼다.
function enterSelectionMode() {
  _selectingMode = true;
  _selImg   = null;
  _selQuote = null;
  updateSelStatus();
  renderLinkSelectImageList();
  renderLinkSelectQuoteList();
  document.getElementById('link-select-backdrop').classList.add('open');
}

function exitSelectionMode() {
  _selectingMode = false;
  _selImg   = null;
  _selQuote = null;
  document.getElementById('link-select-backdrop').classList.remove('open');
  document.getElementById('link-select-popup').classList.remove('img-selected', 'quote-selected');
}

document.getElementById('addLinkBtn').addEventListener('click', enterSelectionMode);
document.getElementById('link-select-close').addEventListener('click', exitSelectionMode);
document.getElementById('link-select-backdrop').addEventListener('click', e => {
  if (e.target === e.currentTarget) exitSelectionMode();
});

document.getElementById('selCompleteBtn').addEventListener('click', () => {
  if (_selImg === null || _selQuote === null) return;
  const img   = _imgs[_selImg];
  const quote = _quotes[_selQuote];
  // 중복 방지 (선택 불가 처리로 대부분 막히지만 안전망)
  if (_links.some(l => l.imgName === img.name || l.quote === quote)) return;
  _links.push({ imgName: img.name, quote });
  saveLinks();
  renderLinkList();
  exitSelectionMode();
});

// ─────────────────────────────────────────────
// 팝업 열기 / 닫기
// ─────────────────────────────────────────────
function openPopup() {
  renderLinkList();
  renderImageList();
  renderQuoteList();
  document.getElementById('customize-backdrop').classList.add('open');
}

function closePopup() {
  if (_selectingMode) exitSelectionMode();
  document.getElementById('customize-backdrop').classList.remove('open');
  document.getElementById('quoteInputArea').classList.remove('open');
  document.getElementById('quoteInput').value = '';
}

document.getElementById('customizeBtn').addEventListener('click', openPopup);
document.getElementById('customize-close').addEventListener('click', closePopup);
document.getElementById('customize-backdrop').addEventListener('click', e => {
  if (e.target === e.currentTarget) closePopup();
});

// ─────────────────────────────────────────────
// 이미지 파일 업로드
// ─────────────────────────────────────────────
document.getElementById('imageFileInput').addEventListener('change', e => {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  Promise.all(files.map(f => new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload  = ev => res({ name: f.name, data: ev.target.result });
    reader.onerror = rej;
    reader.readAsDataURL(f);
  }))).then(newImgs => {
    _imgs.push(...newImgs);
    saveImages();
    renderImageList();
    e.target.value = '';
  }).catch(err => console.error('이미지 읽기 실패:', err));
});

// ─────────────────────────────────────────────
// 모두 삭제 / 해제
// ─────────────────────────────────────────────
document.getElementById('clearAllImages').addEventListener('click', () => {
  if (!_imgs.length) return;
  if (confirm(T('custConfirmClearImages'))) {
    _imgs  = [];
    _links = [];
    saveImages(); saveLinks();
    renderImageList(); renderLinkList();
  }
});

document.getElementById('clearAllQuotes').addEventListener('click', () => {
  if (!_quotes.length) return;
  if (confirm(T('custConfirmClearQuotes'))) {
    _quotes = [];
    _links  = [];
    saveQuotes(); saveLinks();
    renderQuoteList(); renderLinkList();
  }
});

document.getElementById('clearAllLinks').addEventListener('click', () => {
  if (!_links.length) return;
  if (confirm(T('custConfirmClearLinks'))) {
    _links = [];
    saveLinks();
    renderLinkList();
  }
});

// ─────────────────────────────────────────────
// 문구 추가
// ─────────────────────────────────────────────
document.getElementById('addQuoteBtn').addEventListener('click', () => {
  const area = document.getElementById('quoteInputArea');
  area.classList.toggle('open');
  if (area.classList.contains('open')) document.getElementById('quoteInput').focus();
});

function confirmAddQuote() {
  const input = document.getElementById('quoteInput');
  const val   = input.value.trim();
  if (!val) return;
  _quotes.push(val);
  saveQuotes();
  renderQuoteList();
  input.value = '';
  document.getElementById('quoteInputArea').classList.remove('open');
}

document.getElementById('quoteConfirm').addEventListener('click', confirmAddQuote);
document.getElementById('quoteInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmAddQuote(); }
});

// ─────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────
loadData().then(({ imgs, quotes, links }) => {
  _imgs   = imgs;
  _quotes = quotes;
  _links  = links;
  applyBgAndQuote(imgs, quotes, links);
});
