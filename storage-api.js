// storage-api.js
// chrome.storage.local / chrome.storage.sync 라우팅 레이어.
// 호출부는 chrome.storage.* 대신 TBBStorage.get/set만 쓰면 되고,
// 어떤 키가 sync로 가는지는 이 파일에서만 결정한다.

// 크로스 기기 동기화 대상 (작고, 기기 간 값이 같아야 의미 있는 키만).
// pomodoroState(활성 타이머) 등 기기별 상태, pipWindowId/pomodoroPipPos/todoTriggerPos 등
// 창 위치·ID, customBgImages(Base64 이미지) 등 대용량 데이터, darkModeEnabled/lockPin(사용자가
// 기기별로 다르게 쓰길 원함)은 의도적으로 제외 — sync 용량(item당 8KB)/쓰기 경합 문제 때문.
const TBB_SYNC_KEYS = new Set([
  'permanentList',
  'generalList',
  'dailyBoxes',
  'weeklyBoxes',
  'dailyScheduleEnabled',
  'weekStartMonday',
  'focusEvents',
  'focusStreak',
  'todoItems',
  'pomodoroSettings',
  'pomodoroPresets',
  'pomodoroCycleOverrides',
  'pomodoroList',
  'customQuotes',
  'customLinks'
]);

// chrome.storage.sync 의 QUOTA_BYTES_PER_ITEM(8192)보다 여유를 둔 안전선.
const TBB_SYNC_BYTE_LIMIT = 7500;
const TBB_FOCUS_EVENTS_TRIM_DAYS = 14;

function _tbbByteSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function _tbbSplitKeys(keys) {
  const sync = [];
  const local = [];
  keys.forEach(k => (TBB_SYNC_KEYS.has(k) ? sync : local).push(k));
  return { sync, local };
}

function _tbbTrimFocusEvents(events, days) {
  if (!Array.isArray(events)) return events;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return events.filter(e => e.date >= cutoffStr);
}

// sync 대상 값 중 용량 초과 위험이 있는 키를 사전에 줄여서 quota 에러를 예방.
function _tbbGuardSyncPayload(obj) {
  Object.keys(obj).forEach(k => {
    const size = _tbbByteSize(obj[k]);
    if (size <= TBB_SYNC_BYTE_LIMIT) return;
    if (k === 'focusEvents') {
      obj[k] = _tbbTrimFocusEvents(obj[k], TBB_FOCUS_EVENTS_TRIM_DAYS);
      console.warn(`[TBBStorage] focusEvents가 sync 용량 한도에 근접해 최근 ${TBB_FOCUS_EVENTS_TRIM_DAYS}일로 축소했습니다.`);
    } else {
      console.warn(`[TBBStorage] ${k} 크기(${size}B)가 sync 한도에 근접해 동기화가 실패할 수 있습니다.`);
    }
  });
  return obj;
}

async function _tbbGet(keys) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  const { sync, local } = _tbbSplitKeys(keyList);
  const [syncRes, localRes] = await Promise.all([
    sync.length ? chrome.storage.sync.get(sync) : Promise.resolve({}),
    local.length ? chrome.storage.local.get(local) : Promise.resolve({})
  ]);
  // sync 쓰기가 과거에 실패해 local에 폴백 저장된 값이 있으면 보완
  // (안 하면 _tbbSet의 폴백 쓰기가 있어도 get()이 sync만 봐서 그 값이 영원히 안 읽힘)
  const missingSync = sync.filter(k => syncRes[k] === undefined);
  const fallbackRes = missingSync.length ? await chrome.storage.local.get(missingSync) : {};
  return Object.assign({}, fallbackRes, syncRes, localRes);
}

async function _tbbSet(obj) {
  const { sync, local } = _tbbSplitKeys(Object.keys(obj));
  const tasks = [];
  if (local.length) {
    const localObj = {};
    local.forEach(k => { localObj[k] = obj[k]; });
    tasks.push(chrome.storage.local.set(localObj));
  }
  if (sync.length) {
    const syncObj = {};
    sync.forEach(k => { syncObj[k] = obj[k]; });
    _tbbGuardSyncPayload(syncObj);
    tasks.push(
      chrome.storage.sync.set(syncObj)
        .then(() => chrome.storage.local.remove(sync).catch(() => {})) // 과거 폴백 잔여분 정리
        .catch(err => {
          console.warn('[TBBStorage] sync 쓰기 실패, local에 백업 저장:', err);
          return chrome.storage.local.set(syncObj);
        })
    );
  }
  await Promise.all(tasks);
}

self.TBBStorage = {
  SYNC_KEYS: TBB_SYNC_KEYS,
  get(keys, callback) {
    const p = _tbbGet(keys);
    if (callback) { p.then(callback); return; }
    return p;
  },
  set(obj, callback) {
    const p = _tbbSet(obj);
    if (callback) { p.then(() => callback()); return; }
    return p;
  }
};
