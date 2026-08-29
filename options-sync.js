// options-sync.js
// 기기간 설정 동기화 UI — 충돌 배너, 동기화된 설정 비교 모달, 수동 불러오기/합치기 버튼.
// 실제 판단·적용 로직은 전부 storage-api.js에 있고, 이 파일은 그걸 보여주고 확인받는 역할만 한다.
// options-core.js 다음에 로드하며 최상위 실행은 initSyncUi() 하나뿐(options-init.js가 호출).

// 비교 모달에 노출할 설정 항목과, 값을 사람이 읽는 한 줄로 줄이는 방법.
// storage-api.js의 SETTINGS_KEYS 중 사용자가 의미를 알아볼 수 있는 것만 고른다 —
// 내부 구조가 그대로 드러나는 키(pomodoroCycleOverrides 등)는 개수 요약으로 충분하다.
const SYNC_COMPARE_ROWS = [
  { key: 'generalList',           labelKey: 'syncItemGeneralList',    type: 'domains' },
  { key: 'permanentList',         labelKey: 'syncItemPermanentList',  type: 'domains' },
  { key: 'dailyBoxes',            labelKey: 'syncItemDailyBoxes',     type: 'boxes'   },
  { key: 'weeklyBoxes',           labelKey: 'syncItemWeeklyBoxes',    type: 'boxes'   },
  { key: 'todoItems',             labelKey: 'syncItemTodoItems',      type: 'count'   },
  { key: 'pomodoroList',          labelKey: 'syncItemPomodoroList',   type: 'domains' },
  { key: 'pomodoroSettings',      labelKey: 'syncItemPomodoroSettings', type: 'pomo'  },
  { key: 'pomodoroPresets',       labelKey: 'syncItemPomodoroPresets', type: 'count'  },
  { key: 'pomodoroCycleOverrides', labelKey: 'syncItemPomodoroCycles', type: 'count'  },
  { key: 'customQuotes',          labelKey: 'syncItemCustomQuotes',   type: 'count'   },
  { key: 'customLinks',           labelKey: 'syncItemCustomLinks',    type: 'count'   },
  { key: 'dailyScheduleEnabled',  labelKey: 'syncItemDailySchedule',  type: 'onoff', defaultOn: true },
  { key: 'weekStartMonday',       labelKey: 'syncItemWeekStart',      type: 'onoff' },
  { key: 'shortsBlockEnabled',    labelKey: 'syncItemShortsBlock',    type: 'onoff' },
  { key: 'instaBlockEnabled',     labelKey: 'syncItemInstaBlock',     type: 'onoff' },
  { key: 'instaShowFollowedPosts', labelKey: 'syncItemInstaFollowed', type: 'onoff' }
];

const SYNC_PREVIEW_ITEMS = 3;       // 비교 모달의 한 줄 요약에 이름을 직접 보여줄 개수
const SYNC_MERGE_PREVIEW_ITEMS = 8; // 합치기 확인 모달에서 항목을 그대로 나열할 개수

// 추가될 항목 한 줄. 도메인은 저장이 punycode라 사용자가 입력한 문자로 되돌려 보여준다.
function _syncItemText(row, item) {
  if (row.type === 'domains') return domainToDisplay(String(item));
  if (typeof item === 'string') return item;
  return JSON.stringify(item);
}

function _syncCountText(n) {
  return T('syncCountItems', [String(n)]);
}

// 값 하나를 한 줄 요약으로. 값이 아예 없으면 null을 돌려 "없음"으로 표시하게 한다.
function _syncSummarize(row, value) {
  if (row.type === 'onoff') {
    if (value === undefined) return row.defaultOn ? T('syncOn') : T('syncOff');
    return value ? T('syncOn') : T('syncOff');
  }
  if (value === undefined || value === null) return null;
  if (row.type === 'pomo') {
    const s = value || {};
    if (s.workMins === undefined) return null;
    return T('syncPomoSummary', [String(s.workMins), String(s.restMins), String(s.cycles)]);
  }
  const list = Array.isArray(value) ? value : [];
  if (!list.length) return _syncCountText(0);
  if (row.type === 'count') return _syncCountText(list.length);
  if (row.type === 'boxes') {
    const names = list.slice(0, SYNC_PREVIEW_ITEMS)
      .map(b => (b && b.name) ? b.name : T('syncUnnamedBox'))
      .join(', ');
    return list.length > SYNC_PREVIEW_ITEMS
      ? `${_syncCountText(list.length)} · ${names}…`
      : `${_syncCountText(list.length)} · ${names}`;
  }
  // domains — 저장은 punycode라 화면에는 사용자가 입력한 문자로 되돌려 보여준다
  const shown = list.slice(0, SYNC_PREVIEW_ITEMS).map(d => domainToDisplay(String(d))).join(', ');
  return list.length > SYNC_PREVIEW_ITEMS
    ? `${_syncCountText(list.length)} · ${shown}…`
    : `${_syncCountText(list.length)} · ${shown}`;
}

function _syncRenderCompare(local, remote) {
  const body = document.getElementById('syncCompareBody');
  if (!body) return;
  body.textContent = '';

  let rendered = 0;
  SYNC_COMPARE_ROWS.forEach(row => {
    // 양쪽 다 값이 없는 항목은 보여줄 게 없다(토글은 기본값이 있으므로 항상 표시).
    if (row.type !== 'onoff' && local[row.key] === undefined && remote[row.key] === undefined) return;

    const localText = _syncSummarize(row, local[row.key]);
    const remoteText = _syncSummarize(row, remote[row.key]);
    const changed = JSON.stringify(local[row.key] ?? null) !== JSON.stringify(remote[row.key] ?? null);

    const wrap = document.createElement('div');
    wrap.className = 'sync-compare-row';

    const label = document.createElement('div');
    label.className = 'sync-compare-label';
    label.textContent = T(row.labelKey);
    wrap.appendChild(label);

    [localText, remoteText].forEach((text, idx) => {
      const cell = document.createElement('div');
      cell.className = 'sync-compare-val';
      // 달라지는 항목만 강조 — 전부 빨갛게 물들면 어디가 바뀌는지 안 보인다
      if (changed && idx === 1) cell.classList.add('sync-compare-changed');
      cell.textContent = text === null ? T('syncNone') : text;
      wrap.appendChild(cell);
    });

    body.appendChild(wrap);
    rendered++;
  });

  if (!rendered) {
    const empty = document.createElement('div');
    empty.className = 'sync-compare-empty';
    empty.textContent = T('syncCompareEmpty');
    body.appendChild(empty);
  }
}

function _syncCloseCompare() {
  const overlay = document.getElementById('syncCompareOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function _syncOpenCompare() {
  const [local, remote] = await Promise.all([
    TBBStorage.getLocalSettings(),
    TBBStorage.getRemoteSettings()
  ]);
  // 미러가 비어 있으면(이 기기가 아직 아무것도 저장한 적 없음) 현재 읽히는 값으로 대신 채운다.
  const localView = Object.keys(local).length ? local : await TBBStorage.get(TBBStorage.SETTINGS_KEYS);
  _syncRenderCompare(localView, remote);
  const overlay = document.getElementById('syncCompareOverlay');
  if (overlay) overlay.style.display = 'flex';
}

function _syncCloseMergeConfirm() {
  const overlay = document.getElementById('syncMergeConfirmOverlay');
  if (overlay) overlay.style.display = 'none';
}

// 합치기는 실행한 뒤 결과를 알리는 대신, 실행 전에 "무엇이 몇 개 늘어나는지"를 보여주고
// 확인을 받는다 — 되돌릴 수 없는 동작이라 사후 통보보다 사전 확인이 맞다.
async function _syncAskMerge() {
  const summary = await TBBStorage.previewMergeLists();
  const groups = SYNC_COMPARE_ROWS
    .filter(row => summary[row.key] && summary[row.key].added > 0)
    .map(row => ({ row: row, add: summary[row.key].added, items: summary[row.key].items || [] }));

  const body = document.getElementById('syncMergeConfirmBody');
  if (body) {
    body.textContent = '';
    const intro = document.createElement('p');
    intro.className = 'sync-confirm-intro';
    intro.textContent = groups.length ? T('syncMergeConfirmIntro') : T('syncMergeNothing');
    body.appendChild(intro);

    groups.forEach(group => {
      const box = document.createElement('div');
      box.className = 'sync-confirm-group';

      const head = document.createElement('div');
      head.className = 'sync-confirm-group-head';
      const name = document.createElement('span');
      name.className = 'sync-confirm-item-name';
      name.textContent = T(group.row.labelKey);
      const add = document.createElement('span');
      add.className = 'sync-confirm-item-add';
      add.textContent = '+' + group.add;
      head.appendChild(name);
      head.appendChild(add);
      box.appendChild(head);

      const list = document.createElement('div');
      list.className = 'sync-confirm-items';
      group.items.slice(0, SYNC_MERGE_PREVIEW_ITEMS).forEach(item => {
        const line = document.createElement('div');
        line.className = 'sync-confirm-entry';
        line.textContent = _syncItemText(group.row, item);
        list.appendChild(line);
      });
      // 아주 긴 목록을 통째로 쏟아내면 확인 모달이 스크롤 덩어리가 된다 — 나머지는 개수로만.
      if (group.items.length > SYNC_MERGE_PREVIEW_ITEMS) {
        const more = document.createElement('div');
        more.className = 'sync-confirm-more';
        more.textContent = T('syncMergeMore', [String(group.items.length - SYNC_MERGE_PREVIEW_ITEMS)]);
        list.appendChild(more);
      }
      box.appendChild(list);
      body.appendChild(box);
    });
  }

  // 비교 모달에서 눌렀을 수도 있어 겹치지 않게 먼저 닫는다
  _syncCloseCompare();
  const overlay = document.getElementById('syncMergeConfirmOverlay');
  if (overlay) overlay.style.display = 'flex';
}

async function _syncApplyRemote() {
  await TBBStorage.adoptRemoteSettings();
  _syncCloseCompare();
  alert(T('syncApplyDone'));
  location.reload(); // 목록·타임박스·투두가 한꺼번에 바뀌므로 화면 전체를 다시 그린다
}

async function _syncMergeLists() {
  await TBBStorage.mergeSettingsLists();
  _syncCloseMergeConfirm();
  location.reload(); // 목록이 한꺼번에 바뀌므로 화면 전체를 다시 그린다
}

// 상태는 세 가지다:
//   충돌 없음        → 배너·보류 안내 둘 다 숨김
//   충돌, 안 무침     → 배너
//   충돌, 무시함      → 보류 안내만 (조용하지만 숨기지는 않는다 — 설정이 안 올라가는 상태라
//                      아무 표시도 없으면 나중에 "왜 다른 기기에 반영이 안 되지?"가 된다)
async function _syncRenderConflictBanner() {
  const banner = document.getElementById('syncConflictBanner');
  const note = document.getElementById('syncHoldNote');
  const link = await TBBStorage.getSyncLink();
  const holding = !!link.holding;
  const dismissed = !!link.dismissed;
  if (banner) banner.style.display = (holding && !dismissed) ? 'block' : 'none';
  if (note) note.style.display = (holding && dismissed) ? 'flex' : 'none';
}

function initSyncUi() {
  const on = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
  };

  // 버튼 설명은 호버 팝오버로만 띄운다(CSS의 .sync-tip-host가 data-tip을 읽어 그린다).
  // 마크업에 직접 못 박지 않고 여기서 채우는 건 로케일을 타야 하기 때문.
  const tip = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.dataset.tip = T(key);
  };
  tip('syncPullBtn', 'syncPullTip');
  tip('syncMergeBtn', 'syncMergeTip');

  on('syncPullBtn', _syncOpenCompare);
  on('syncConflictReviewBtn', _syncOpenCompare);
  on('syncConflictIgnoreBtn', async () => {
    await TBBStorage.dismissConflict();
    _syncRenderConflictBanner();
  });
  on('syncHoldShowBtn', async () => {
    await TBBStorage.restoreConflictNotice();
    _syncRenderConflictBanner();
  });
  on('syncCompareCloseBtn', _syncCloseCompare);
  on('syncCompareCancelBtn', _syncCloseCompare);
  on('syncCompareApplyBtn', _syncApplyRemote);
  on('syncCompareMergeBtn', _syncAskMerge);
  on('syncMergeBtn', _syncAskMerge);
  on('syncMergeConfirmOkBtn', _syncMergeLists);
  on('syncMergeConfirmCancelBtn', _syncCloseMergeConfirm);
  on('syncMergeConfirmCloseBtn', _syncCloseMergeConfirm);
  on('syncConflictKeepBtn', async () => {
    if (!confirm(T('syncKeepLocalConfirm'))) return;
    await TBBStorage.keepLocalSettings();
    alert(T('syncKeepLocalDone'));
    location.reload();
  });

  // 배경 클릭 / Esc로 닫기 — 두 모달 모두 동일하게 처리
  const overlays = [
    ['syncCompareOverlay', _syncCloseCompare],
    ['syncMergeConfirmOverlay', _syncCloseMergeConfirm]
  ].map(([id, close]) => ({ el: document.getElementById(id), close })).filter(o => o.el);

  overlays.forEach(o => {
    o.el.addEventListener('click', e => { if (e.target === o.el) o.close(); });
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    overlays.forEach(o => { if (o.el.style.display !== 'none') o.close(); });
  });

  _syncRenderConflictBanner();
  // 백그라운드가 충돌을 감지하면 _syncLink(local)가 바뀌므로 배너를 다시 그린다
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes._syncLink) _syncRenderConflictBanner();
  });
}
