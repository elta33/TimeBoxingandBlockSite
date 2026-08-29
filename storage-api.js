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
  'shortsBlockEnabled',
  'instaBlockEnabled',
  'instaShowFollowedPosts',
  'focusEvents',
  'focusStreak',
  'todoItems',
  'pomodoroSettings',
  'pomodoroPresets',
  'pomodoroCycleOverrides',
  'pomodoroList',
  'customQuotes',
  'customLinks',
  'proEntitlement'
]);

// chrome.storage.sync 의 QUOTA_BYTES_PER_ITEM(8192)보다 여유를 둔 안전선.
const TBB_SYNC_BYTE_LIMIT = 7500;
const TBB_FOCUS_EVENTS_TRIM_DAYS = 14;

// sync 성공/실패·용량 축소 이력을 기기 로컬에만 남겨 설정 탭에 노출한다.
// (동기화 여부를 사용자가 눈으로 확인할 방법이 console.warn뿐이라 "다른 기기에 왜 안 옮겨지지?"에
// 답할 수 없었던 문제 — 이 키 자체는 절대 sync로 보내지 않는다: 기기마다 사정이 다르다)
const TBB_SYNC_STATUS_KEY = '_syncStatus';

// ── 표시 전용: punycode(xn--) 호스트를 사람이 읽는 유니코드로 되돌림 ──
// 도메인 저장·매칭(cleanDomain, background.js/options-core.js)은 항상 punycode를 쓴다 — 실제
// 내비게이션 시 브라우저가 넘겨주는 hostname이 punycode라 그것과 비교해야 하기 때문. 여기서는
// 리스트/통계처럼 화면에 보여줄 때만 되돌려서 사용자가 입력한 원래 문자(한글 등)로 보이게
// 한다. 저장 형식·매칭 로직은 전혀 건드리지 않는다. RFC 3492 Bootstring 디코드의 최소 구현
// (도메인 라벨 하나를 디코드하는 부분만 필요해 인코드 방향은 없음).
function _punycodeLabelToUnicode(input) {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700, initialBias = 72, initialN = 128;
  let n = initialN, i = 0, bias = initialBias;
  const output = [];
  let basic = input.lastIndexOf('-');
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j++) {
    if (input.charCodeAt(j) >= 0x80) throw new Error('invalid punycode input');
    output.push(input[j]);
  }
  let index = basic > 0 ? basic + 1 : 0;
  const inputLength = input.length;
  function adapt(delta, numPoints, firstTime) {
    delta = firstTime ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    return Math.floor(k + (base - tMin + 1) * delta / (delta + skew));
  }
  function decodeDigit(cp) {
    if (cp - 0x30 < 0x0a) return cp - 0x16;
    if (cp - 0x41 < 0x1a) return cp - 0x41;
    if (cp - 0x61 < 0x1a) return cp - 0x61;
    return base;
  }
  while (index < inputLength) {
    const oldi = i;
    for (let w = 1, k = base; ; k += base) {
      if (index >= inputLength) throw new Error('invalid punycode input');
      const digit = decodeDigit(input.charCodeAt(index++));
      if (digit >= base) throw new Error('invalid punycode input');
      if (digit > Math.floor((0x7FFFFFFF - i) / w)) throw new Error('punycode overflow');
      i += digit * w;
      const t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
      if (digit < t) break;
      if (w > Math.floor(0x7FFFFFFF / (base - t))) throw new Error('punycode overflow');
      w *= (base - t);
    }
    const out = output.length + 1;
    bias = adapt(i - oldi, out, oldi === 0);
    if (Math.floor(i / out) > 0x7FFFFFFF - n) throw new Error('punycode overflow');
    n += Math.floor(i / out);
    i %= out;
    output.splice(i, 0, String.fromCodePoint(n));
    i++;
  }
  return output.join('');
}

// ── 표시 전용 보정: 낱자만 있는 한글(자음/모음만, 완성된 음절이 아닌 경우) ──
// "ㅋㅋ.com"처럼 완성된 음절이 아닌 낱자로만 된 도메인은, 브라우저가 punycode로 바꾸는 과정
// (IDNA/UTS46 정규화)에서 우리가 흔히 쓰는 호환용 자모(U+3131~U+3163, 예: 'ㅋ')가 조합용
// 자모(U+1100~U+11FF, 예: 'ᄏ')로 자동 매핑된 뒤 인코딩된다 — 이건 브라우저 자체의 IDNA 처리
// 규칙이라 cleanDomain() 단계에서부터 이미 그렇게 저장되고, 디코드도 그 값을 정확히 복원할
// 뿐이다. 문제는 조합용 자모가 원래 모음과 결합해 화면에 그려지도록 설계된 글자라, 혼자
// 놓이면 폰트와 무관하게 위아래로 눌린 모양으로 보인다(박스 이름 등 사용자가 직접 친 호환용
// 자모는 이 문제가 없다). 완성된 음절(예: '한')은 애초에 단일 코드포인트라 이 매핑을 타지
// 않으므로 안전하게, 조합용 자모만 골라 호환용 자모로 되돌려서 원래 타이핑했을 때와 같은
// 모양으로 보이게 한다 — 저장된 값이나 매칭 로직은 전혀 건드리지 않는 순수 표시 보정.
const _JAMO_CHOSEONG_TO_COMPAT = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const _JAMO_JONGSEONG_TO_COMPAT = ['ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
function _jamoToCompat(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 0x1100 && cp <= 0x1112) return _JAMO_CHOSEONG_TO_COMPAT[cp - 0x1100];
  if (cp >= 0x1161 && cp <= 0x1175) return String.fromCodePoint(cp - 0x1161 + 0x314F);
  if (cp >= 0x11A8 && cp <= 0x11C2) return _JAMO_JONGSEONG_TO_COMPAT[cp - 0x11A8];
  if (cp === 0x111A) return 'ㅀ'; // UTS46이 'ㅀ'을 이 코드포인트 하나로 매핑(자체 종성 코드포인트가 아님)
  if (cp === 0x1121) return 'ㅄ'; // 위와 동일한 이유로 'ㅄ'만 예외 매핑
  return ch;
}
function _remapConjoiningJamo(str) {
  return [...str].map(_jamoToCompat).join('');
}

// 호스트(또는 host+경로) 문자열 전체를 받아 "xn--"로 시작하는 라벨만 유니코드로 되돌린다.
// 디코드에 실패하면(형식이 이상하면) 원래 라벨을 그대로 둔다 — 화면 표시가 깨지는 것보다 안전.
function domainToDisplay(host) {
  if (!host) return host;
  return host.split('.').map(label => {
    if (!/^xn--/i.test(label)) return label;
    try {
      return _remapConjoiningJamo(_punycodeLabelToUnicode(label.slice(4).toLowerCase()));
    } catch (_) {
      return label;
    }
  }).join('.');
}

async function _tbbRecordSyncStatus(patch) {
  const cur = await chrome.storage.local.get([TBB_SYNC_STATUS_KEY]);
  await chrome.storage.local.set({
    [TBB_SYNC_STATUS_KEY]: { ...(cur[TBB_SYNC_STATUS_KEY] || {}), ...patch }
  });
}

function _tbbByteSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

// focusEvents 샤드 키(focusEvents_<deviceId>)는 개수가 기기마다 달라 목록에 미리 못 박으므로
// 접두사로 판별한다.
function _tbbIsSyncKey(key) {
  return TBB_SYNC_KEYS.has(key) || key.startsWith(TBB_FOCUS_SHARD_PREFIX);
}

function _tbbSplitKeys(keys) {
  const sync = [];
  const local = [];
  keys.forEach(k => (_tbbIsSyncKey(k) ? sync : local).push(k));
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
    if (k === TBB_FOCUS_LEGACY_KEY || k.startsWith(TBB_FOCUS_SHARD_PREFIX)) {
      obj[k] = _tbbTrimFocusEvents(obj[k], TBB_FOCUS_EVENTS_TRIM_DAYS);
      console.warn(`[TBBStorage] focusEvents가 sync 용량 한도에 근접해 최근 ${TBB_FOCUS_EVENTS_TRIM_DAYS}일로 축소했습니다.`);
      _tbbRecordSyncStatus({ trimmedFocusEventsAt: Date.now() });
    } else {
      console.warn(`[TBBStorage] ${k} 크기(${size}B)가 sync 한도에 근접해 동기화가 실패할 수 있습니다.`);
    }
  });
  return obj;
}

async function _tbbGet(keys) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  // 'focusEvents'는 더 이상 이 기기가 쓰는 실제 키가 아니라, 모든 기기 샤드 + 구버전 단일 키를
  // 합산해 만들어내는 읽기 전용 가상 키다. 호출부는 예전과 똑같이 쓰면 된다.
  const wantsFocus = keyList.includes(TBB_FOCUS_LEGACY_KEY);
  const plainKeys = wantsFocus ? keyList.filter(k => k !== TBB_FOCUS_LEGACY_KEY) : keyList;
  const { sync, local } = _tbbSplitKeys(plainKeys);
  const [syncRes, localRes, focusEvents] = await Promise.all([
    sync.length ? chrome.storage.sync.get(sync) : Promise.resolve({}),
    local.length ? chrome.storage.local.get(local) : Promise.resolve({}),
    wantsFocus ? _tbbReadFocusEvents() : Promise.resolve(null)
  ]);
  // sync 쓰기가 과거에 실패해 local에 폴백 저장된 값이 있으면 보완
  // (안 하면 _tbbSet의 폴백 쓰기가 있어도 get()이 sync만 봐서 그 값이 영원히 안 읽힘)
  const missingSync = sync.filter(k => syncRes[k] === undefined);
  const fallbackRes = missingSync.length ? await chrome.storage.local.get(missingSync) : {};
  const out = Object.assign({}, fallbackRes, syncRes, localRes);
  if (wantsFocus) out[TBB_FOCUS_LEGACY_KEY] = focusEvents;

  // hold 중(다른 계정/기기 데이터가 들어와 사용자 선택을 기다리는 중)에는 설정을 원격이 아니라
  // 이 기기 미러에서 읽는다. 미러에 없는 키는 이 기기가 한 번도 쓴 적 없다는 뜻이라 원격 값을
  // 그대로 둔다 — 지킬 로컬 값이 애초에 없다.
  const settingsWanted = plainKeys.filter(k => TBB_SETTINGS_KEY_SET.has(k));
  if (settingsWanted.length && (await _tbbReadLink()).holding) {
    const mirror = await _tbbReadMirror();
    settingsWanted.forEach(k => { if (mirror[k] !== undefined) out[k] = mirror[k]; });
  }
  return out;
}

async function _tbbSet(obj) {
  const allKeys = Object.keys(obj);
  // 설정 키는 항상 이 기기 미러에도 남긴다 — 원격이 통째로 갈아끼워져도 되돌릴 수 있게.
  const settingsKeys = allKeys.filter(k => TBB_SETTINGS_KEY_SET.has(k));
  const holding = settingsKeys.length ? (await _tbbReadLink()).holding : false;
  if (settingsKeys.length) {
    const patch = {};
    settingsKeys.forEach(k => { patch[k] = obj[k]; });
    await _tbbPatchMirror(patch);
  }
  // hold 중에는 설정을 원격으로 올리지 않는다 — 사용자가 아직 고르지 않은 원격 값을 덮으면 안 된다.
  // (통계 샤드 등 설정이 아닌 키는 그대로 동기화된다)
  const { sync, local } = _tbbSplitKeys(holding ? allKeys.filter(k => !TBB_SETTINGS_KEY_SET.has(k)) : allKeys);
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
        .then(() => {
          chrome.storage.local.remove(sync).catch(() => {}); // 과거 폴백 잔여분 정리
          _tbbRecordSyncStatus({ lastSuccessAt: Date.now(), lastErrorAt: null });
        })
        .catch(err => {
          console.warn('[TBBStorage] sync 쓰기 실패, local에 백업 저장:', err);
          _tbbRecordSyncStatus({ lastErrorAt: Date.now(), lastErrorMessage: String((err && err.message) || err) });
          return chrome.storage.local.set(syncObj);
        })
    );
  }
  await Promise.all(tasks);
}

// ── focusEvents 기기별 샤딩 ──
// 통계는 기기마다 독립적으로 쌓이는데, 예전에는 모든 기기가 'focusEvents' 단일 sync 키에
// "배열 전체"를 통째로 덮어썼다. chrome.storage.sync는 키 단위 last-write-wins라, 두 기기가
// 비슷한 시각에 기록하면 나중에 쓴 쪽이 상대 기기의 기록을 조용히 지웠다(1분 알람마다
// 발생 가능). 그래서 기기마다 자기 샤드 키(focusEvents_<deviceId>)에만 쓰고, 읽을 때
// 모든 샤드를 날짜 단위로 합산한다 — 쓰기 경합이 구조적으로 생길 수 없게 만드는 방식.
//
// 구버전 단일 키('focusEvents')는 삭제하지 않고 "읽기 전용 샤드 하나"로 계속 합산한다.
// 샤드로 복사해 넣지 않기 때문에 이중 집계가 원천적으로 없고, 아직 업데이트되지 않은 다른
// 기기가 그 키에 쓰는 값도 그대로 보인다. 보관 기간(30일)이 지나 이 키가 더 이상 아무것도
// 기여하지 않게 되면 _tbbGcLegacyFocusEvents()가 지운다.
const TBB_FOCUS_SHARD_PREFIX = 'focusEvents_';
const TBB_FOCUS_LEGACY_KEY = 'focusEvents';
const TBB_FOCUS_RETAIN_DAYS = 30;
const TBB_DEVICE_ID_KEY = '_deviceId';

function _tbbFocusCutoff() {
  const d = new Date();
  d.setDate(d.getDate() - TBB_FOCUS_RETAIN_DAYS);
  return d.toISOString().slice(0, 10);
}

// 기기 식별자는 절대 sync로 보내지 않는다 — 보내면 모든 기기가 같은 id를 갖게 돼 샤딩이 무의미해진다.
// 여러 컨텍스트(백그라운드/옵션/차단화면)가 동시에 처음 접근하면 id가 중복 생성될 수 있지만,
// 그래도 생기는 건 "읽을 때 어차피 합산되는 고아 샤드" 하나뿐이라 데이터 손실은 없다.
let _tbbDeviceIdCache = null;
async function _tbbDeviceId() {
  if (_tbbDeviceIdCache) return _tbbDeviceIdCache;
  const got = await chrome.storage.local.get([TBB_DEVICE_ID_KEY]);
  let id = got[TBB_DEVICE_ID_KEY];
  if (!id) {
    id = (self.crypto?.randomUUID?.() || String(Date.now()) + String(Math.random()).slice(2))
      .replace(/-/g, '').slice(0, 8);
    await chrome.storage.local.set({ [TBB_DEVICE_ID_KEY]: id });
  }
  _tbbDeviceIdCache = id;
  return id;
}

async function _tbbOwnShardKey() {
  return TBB_FOCUS_SHARD_PREFIX + (await _tbbDeviceId());
}

// 내 샤드는 local 복사본이 남아 있으면 그쪽이 최신이다 — _tbbSet은 sync 쓰기가 성공하면
// local 복사본을 지우므로, 남아 있다는 건 직전 sync 쓰기가 실패해 폴백됐다는 뜻이다.
// (일반 _tbbGet은 sync를 우선하는데, 통계는 누적값이라 그 규칙을 그대로 쓰면 폴백 이후
//  매번 옛 sync 값 위에 덧쓰게 되어 그 사이 기록이 계속 유실된다)
function _tbbPickOwnShard(syncVal, localVal) {
  const v = localVal !== undefined ? localVal : syncVal;
  return Array.isArray(v) ? v : [];
}

// 여러 샤드를 날짜 단위로 합친다. focusMins는 기기별로 겹치지 않는 값이라 합산,
// blocks/pomoSessions는 혹시 모를 중복(예전 백업 복원 등)에 대비해 ts 기준 dedupe 후 이어붙인다.
function _tbbMergeFocusEventLists(lists) {
  const byDate = new Map();
  const seenBlocks = new Map();
  const seenSessions = new Map();
  lists.forEach(list => {
    if (!Array.isArray(list)) return;
    list.forEach(e => {
      if (!e || !e.date) return;
      let day = byDate.get(e.date);
      if (!day) {
        day = { date: e.date, focusMins: 0, blocks: [], pomoSessions: [] };
        byDate.set(e.date, day);
        seenBlocks.set(e.date, new Set());
        seenSessions.set(e.date, new Set());
      }
      day.focusMins += e.focusMins || 0;
      const bSeen = seenBlocks.get(e.date);
      (e.blocks || []).forEach(b => {
        const k = `${b.domain}|${b.ts}`;
        if (bSeen.has(k)) return;
        bSeen.add(k);
        day.blocks.push(b);
      });
      const sSeen = seenSessions.get(e.date);
      (e.pomoSessions || []).forEach(s => {
        const k = `${s.ts}|${s.durationMins}`;
        if (sSeen.has(k)) return;
        sSeen.add(k);
        day.pomoSessions.push(s);
      });
    });
  });
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function _tbbReadFocusEvents() {
  const ownKey = await _tbbOwnShardKey();
  const [syncAll, localPart] = await Promise.all([
    chrome.storage.sync.get(null).catch(() => ({})),
    chrome.storage.local.get([ownKey, TBB_FOCUS_LEGACY_KEY])
  ]);
  const lists = [];
  Object.keys(syncAll).forEach(k => {
    if (k.startsWith(TBB_FOCUS_SHARD_PREFIX) && k !== ownKey) lists.push(syncAll[k]);
  });
  // 내 샤드만 local 폴백본을 우선한다. 다른 기기의 폴백 샤드는 그 기기가 sync에 올리기
  // 전까지 여기서 볼 방법이 없다.
  const own = _tbbPickOwnShard(syncAll[ownKey], localPart[ownKey]);
  if (own.length) lists.push(own);
  const legacy = syncAll[TBB_FOCUS_LEGACY_KEY] !== undefined
    ? syncAll[TBB_FOCUS_LEGACY_KEY]
    : localPart[TBB_FOCUS_LEGACY_KEY];
  if (legacy) lists.push(legacy);
  const cutoff = _tbbFocusCutoff();
  return _tbbMergeFocusEventLists(lists).filter(e => e.date >= cutoff);
}

// 통계 기록 진입점. mutator는 "이 기기 샤드"만 받는다 — 합산된 전체 배열을 받아 되쓰면
// 다른 기기 기록이 내 샤드로 복사돼 이중 집계가 되므로, 기록은 반드시 이 함수로만 한다.
async function _tbbUpdateFocusEvents(mutator) {
  const ownKey = await _tbbOwnShardKey();
  const [syncRes, localRes] = await Promise.all([
    chrome.storage.sync.get([ownKey]).catch(() => ({})),
    chrome.storage.local.get([ownKey])
  ]);
  const events = _tbbPickOwnShard(syncRes[ownKey], localRes[ownKey]);
  const next = mutator(events) || events;
  const cutoff = _tbbFocusCutoff();
  await _tbbSet({ [ownKey]: next.filter(e => e && e.date >= cutoff) });
}

// 가져오기(불러오기) 전용 완전 대체. 내보내기 파일은 이미 "모든 기기 합산본"이라,
// 샤드를 남겨두고 덮으면 같은 기록이 두 번 잡힌다. 그래서 모든 샤드와 구버전 키를 지우고
// 이 기기 샤드 하나로 재구성한다(사용자가 명시적으로 실행하는 파괴적 동작).
async function _tbbReplaceFocusEvents(events) {
  const ownKey = await _tbbOwnShardKey();
  const syncAll = await chrome.storage.sync.get(null).catch(() => ({}));
  const drop = Array.from(new Set([
    ...Object.keys(syncAll).filter(k => k.startsWith(TBB_FOCUS_SHARD_PREFIX)),
    ownKey,
    TBB_FOCUS_LEGACY_KEY
  ]));
  await Promise.all([
    chrome.storage.sync.remove(drop).catch(() => {}),
    chrome.storage.local.remove(drop).catch(() => {})
  ]);
  const cutoff = _tbbFocusCutoff();
  const list = (Array.isArray(events) ? events : []).filter(e => e && e.date >= cutoff);
  await _tbbSet({ [ownKey]: list });
}

// 구버전 단일 키가 보관 기간을 다 넘겨 더 이상 합산에 기여하지 않으면 정리한다.
// 아직 업데이트 안 된 기기가 계속 쓰고 있으면 최신 날짜가 남아 있어 지워지지 않는다.
async function _tbbGcLegacyFocusEvents() {
  const [s, l] = await Promise.all([
    chrome.storage.sync.get([TBB_FOCUS_LEGACY_KEY]).catch(() => ({})),
    chrome.storage.local.get([TBB_FOCUS_LEGACY_KEY])
  ]);
  const legacy = s[TBB_FOCUS_LEGACY_KEY] !== undefined
    ? s[TBB_FOCUS_LEGACY_KEY]
    : l[TBB_FOCUS_LEGACY_KEY];
  if (legacy === undefined) return;
  const cutoff = _tbbFocusCutoff();
  if (Array.isArray(legacy) && legacy.some(e => e && e.date >= cutoff)) return;
  await Promise.all([
    chrome.storage.sync.remove([TBB_FOCUS_LEGACY_KEY]).catch(() => {}),
    chrome.storage.local.remove([TBB_FOCUS_LEGACY_KEY]).catch(() => {})
  ]);
}

// storage.onChanged 구독자용 — 이제 통계 변경은 샤드 키 이름으로 오기 때문에
// changes.focusEvents만 보면 아무 변경도 감지하지 못한다.
function _tbbIsFocusEventsChange(changes) {
  return Object.keys(changes || {}).some(
    k => k === TBB_FOCUS_LEGACY_KEY || k.startsWith(TBB_FOCUS_SHARD_PREFIX)
  );
}

// ── 스트릭: 저장값이 아니라 통계에서 계산되는 파생값 ──
// 예전에는 focusStreak({current, longest, lastDate})를 기기마다 읽고-증가시켜-되썼다.
// sync는 키 단위 last-write-wins라, 값이 뒤처진 기기가 나중에 쓰면 lastDate가 과거로
// 되돌아가고 그 뒤 연속 계산이 통째로 어긋났다. 이제 연속일은 (충돌이 없는) focusEvents
// 합산본에서 매번 계산하고, 저장은 이벤트만으로 알 수 없는 두 가지만 남긴다:
//   longest   — 보관 기간(30일) 밖으로 밀려난 과거 최고 기록
//   startDate — 진행 중인 연속의 시작일(30일을 넘긴 연속을 잘리지 않게 하는 앵커)
// 둘 다 "커지기만 하거나 / 이벤트가 못 이기는 경우에만 쓰이는" 값이라 경합에 안전하다.
const TBB_STREAK_KEY = 'focusStreak';
// longest는 local 사본을 바닥값으로 함께 둔다 — 아직 업데이트 안 된 구버전 기기가 자기
// 기준 낮은 longest로 sync를 덮어써도 이 기기의 최고 기록이 깎이지 않게 하기 위함.
const TBB_STREAK_FLOOR_KEY = '_streakLongestFloor';

function _tbbShiftDate(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function _tbbDaysBetween(fromStr, toStr) {
  return Math.round((Date.parse(toStr + 'T00:00:00Z') - Date.parse(fromStr + 'T00:00:00Z')) / 86400000);
}

function _tbbDayHasActivity(e) {
  return !!e && ((e.focusMins || 0) > 0 || (e.blocks || []).length > 0 || (e.pomoSessions || []).length > 0);
}

// 구버전 앵커({current, lastDate})에서도 시작일을 복원한다 — 안 하면 업데이트 직후
// 30일을 넘긴 연속 기록이 창 크기만큼으로 잘려 보인다.
function _tbbAnchorStartDate(anchor) {
  if (!anchor) return '';
  if (anchor.startDate) return anchor.startDate;
  const cur = Number(anchor.current) || 0;
  if (anchor.lastDate && cur > 0) return _tbbShiftDate(anchor.lastDate, -(cur - 1));
  return '';
}

function _tbbDeriveStreak(events, anchor, floorLongest) {
  const pastBest = Math.max(Number(anchor && anchor.longest) || 0, Number(floorLongest) || 0);
  const dates = (Array.isArray(events) ? events : [])
    .filter(_tbbDayHasActivity)
    .map(e => e.date)
    .sort();
  if (!dates.length) return { current: 0, longest: pastBest, lastDate: '', startDate: '' };

  const active = new Set(dates);
  const last = dates[dates.length - 1];
  const todayStr = new Date().toISOString().slice(0, 10);
  // 오늘 아직 기록이 없어도 어제까지 이어졌으면 연속은 살아있다(하루가 안 끝났으므로).
  const alive = last === todayStr || last === _tbbShiftDate(todayStr, -1);

  let runStart = last;
  while (active.has(_tbbShiftDate(runStart, -1))) runStart = _tbbShiftDate(runStart, -1);

  // 연속이 보관 창 바깥까지 이어질 수도 있는 경우에만 앵커를 신뢰한다. 앵커는 실제보다
  // 이를 수 없고(이벤트는 합쳐질 뿐 사라지지 않아 연속이 과대평가되지 않는다) 늦을 수만
  // 있으므로, 앵커가 더 이른 날짜일 때만 채택하면 부풀려질 위험이 없다.
  const anchorStart = _tbbAnchorStartDate(anchor);
  const truncated = _tbbShiftDate(runStart, -1) < _tbbFocusCutoff();
  if (truncated && anchorStart && anchorStart < runStart) runStart = anchorStart;

  const current = alive ? _tbbDaysBetween(runStart, last) + 1 : 0;

  // 보관된 기록 안의 최장 연속도 함께 본다. 앵커에는 "그때 진행 중이던 연속"만 남기 때문에,
  // 백업 복원처럼 앵커를 거치지 않고 들어온 과거 기록의 최고치가 누락되는 걸 막는다.
  let bestInWindow = 0, run = 0, prevDate = '';
  dates.forEach(d => {
    run = (prevDate && _tbbShiftDate(prevDate, 1) === d) ? run + 1 : 1;
    prevDate = d;
    if (run > bestInWindow) bestInWindow = run;
  });

  return {
    current,
    longest: Math.max(pastBest, current, bestInWindow),
    lastDate: last,
    startDate: alive ? runStart : ''
  };
}

async function _tbbReadStreakAnchor() {
  const [syncRes, localRes] = await Promise.all([
    chrome.storage.sync.get([TBB_STREAK_KEY]).catch(() => ({})),
    chrome.storage.local.get([TBB_STREAK_KEY, TBB_STREAK_FLOOR_KEY])
  ]);
  // 내 샤드와 같은 이유로 local 사본이 남아 있으면 그쪽이 최신이다(직전 sync 쓰기 실패).
  const anchor = localRes[TBB_STREAK_KEY] !== undefined ? localRes[TBB_STREAK_KEY] : syncRes[TBB_STREAK_KEY];
  return { anchor: anchor || null, floor: localRes[TBB_STREAK_FLOOR_KEY] };
}

// 렌더링용. 이미 focusEvents를 읽어둔 호출부는 그 배열을 넘겨 중복 조회를 피한다.
async function _tbbGetStreak(events) {
  const list = events || await _tbbReadFocusEvents();
  const { anchor, floor } = await _tbbReadStreakAnchor();
  return _tbbDeriveStreak(list, anchor, floor);
}

// 기록 직후 호출해 앵커를 갱신한다. current/lastDate도 같이 써두는 건 아직 업데이트되지
// 않은 구버전 기기가 그 필드를 읽기 때문 — 없으면 그쪽에서 NaN이 된다.
async function _tbbRefreshStreak() {
  const events = await _tbbReadFocusEvents();
  const { anchor, floor } = await _tbbReadStreakAnchor();
  const s = _tbbDeriveStreak(events, anchor, floor);
  // 이 함수는 1분 알람마다 불린다. 값이 그대로면 sync 쓰기 쿼터를 헛되이 태우지 않는다.
  const prev = anchor || {};
  if (prev.current === s.current && prev.longest === s.longest &&
      prev.lastDate === s.lastDate && prev.startDate === s.startDate && floor === s.longest) {
    return s;
  }
  await Promise.all([
    _tbbSet({ [TBB_STREAK_KEY]: { current: s.current, longest: s.longest, lastDate: s.lastDate, startDate: s.startDate } }),
    chrome.storage.local.set({ [TBB_STREAK_FLOOR_KEY]: s.longest })
  ]);
  return s;
}

// ── 설정 덮어쓰기 보호(기기 연결 상태) ──
// chrome.storage.sync는 계정 하나당 공유 저장소 "한 벌"이다. 그래서 이미 쓰던 기기가 다른
// 계정으로 로그인하면 브라우저가 그 한 벌을 통째로 갈아끼우고, 이 기기가 쌓아둔 차단 목록·
// 타임박스가 확인 절차 없이 사라진 것처럼 보인다(통계는 기기별 샤드라 이 문제가 없다).
//
// 그래서 두 가지를 둔다:
//   1) 데이터셋 id — sync에 저장하는 임의의 식별자. "지금 보고 있는 이 sync 데이터가 어느
//      묶음인지"를 가리킨다. 평소 편집으로는 바뀌지 않고, 계정/프로필이 갈릴 때만 달라진다.
//   2) 미러 — 이 기기가 마지막으로 알고 있던 설정의 local 사본. 원격이 갈아끼워져도 이
//      값이 남아 있어야 "이 기기 설정 유지"로 되돌릴 수 있다.
// 합의된 데이터셋과 다른 묶음이 들어오면 hold 상태가 되어, 사용자가 고르기 전까지 읽기는
// 미러(=이 기기 설정)에서 나가고 설정 쓰기도 sync로 올라가지 않는다.
const TBB_SETTINGS_KEYS = [
  'permanentList', 'generalList', 'dailyBoxes', 'weeklyBoxes',
  'dailyScheduleEnabled', 'weekStartMonday',
  'shortsBlockEnabled', 'instaBlockEnabled', 'instaShowFollowedPosts',
  'todoItems', 'pomodoroSettings', 'pomodoroPresets', 'pomodoroCycleOverrides',
  'pomodoroList', 'customQuotes', 'customLinks'
];
// 합집합으로 합쳐도 의미가 깨지지 않는 키만. 타임박스(dailyBoxes/weeklyBoxes)는 시간표라
// 합치면 시간대가 겹쳐 엉망이 되고, 토글류는 합집합 자체가 성립하지 않아 제외한다.
//
// customLinks({imgName, quote} 배열)도 제외한다. 이건 "배경 이미지 ↔ 인용구" 연결인데
// 정작 배경 이미지(customBgImages)는 용량 때문에 동기화 대상이 아니라, 다른 기기의 연결을
// 가져오면 이 기기에 없는 이미지를 가리키는 항목이 쌓인다. 그것만이면 무해하지만
// block.js가 "링크에 묶인 인용구"를 자유 인용구 후보에서 빼기 때문에(applyBgAndQuote),
// 영영 뽑히지 않을 이미지에 묶인 인용구가 차단 화면에서 조용히 사라진다.
const TBB_MERGEABLE_KEYS = ['generalList', 'permanentList', 'customQuotes'];
const TBB_SETTINGS_KEY_SET = new Set(TBB_SETTINGS_KEYS);

const TBB_DATASET_KEY = '_syncDatasetId'; // sync
const TBB_MIRROR_KEY = '_settingsMirror'; // local
const TBB_LINK_KEY = '_syncLink';         // local

function _tbbNewDatasetId() {
  const raw = (self.crypto && self.crypto.randomUUID)
    ? self.crypto.randomUUID()
    : String(Date.now()) + String(Math.random()).slice(2);
  return raw.replace(/-/g, '').slice(0, 12);
}

// hold 여부는 거의 모든 읽기에서 필요해 매번 storage를 때리지 않도록 메모리에 캐시하고,
// local 변경 이벤트로 무효화한다(같은 컨텍스트의 쓰기에도 이벤트가 오므로 항상 최신).
let _tbbLinkCache = null;
let _tbbMirrorCache = null;
if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[TBB_LINK_KEY]) _tbbLinkCache = changes[TBB_LINK_KEY].newValue || null;
    if (changes[TBB_MIRROR_KEY]) _tbbMirrorCache = changes[TBB_MIRROR_KEY].newValue || null;
  });
}

// dismissed: 충돌 배너만 끈 상태. hold 자체는 유지되므로 이 기기 설정이 계속 쓰이고
// 설정은 원격으로 올라가지 않는다 — "알림만 그만" 이지 "원격 수용"이 아니다.
const TBB_LINK_DEFAULT = { agreedDatasetId: '', holding: false, remoteDatasetId: '', detectedAt: 0, dismissed: false };

async function _tbbReadLink() {
  if (_tbbLinkCache) return _tbbLinkCache;
  const r = await chrome.storage.local.get([TBB_LINK_KEY]);
  _tbbLinkCache = r[TBB_LINK_KEY] || Object.assign({}, TBB_LINK_DEFAULT);
  return _tbbLinkCache;
}

async function _tbbWriteLink(link) {
  _tbbLinkCache = link;
  await chrome.storage.local.set({ [TBB_LINK_KEY]: link });
}

async function _tbbReadMirror() {
  if (_tbbMirrorCache) return _tbbMirrorCache;
  const r = await chrome.storage.local.get([TBB_MIRROR_KEY]);
  _tbbMirrorCache = r[TBB_MIRROR_KEY] || {};
  return _tbbMirrorCache;
}

async function _tbbWriteMirror(mirror) {
  _tbbMirrorCache = mirror;
  await chrome.storage.local.set({ [TBB_MIRROR_KEY]: mirror });
}

async function _tbbPatchMirror(patch) {
  const mirror = Object.assign({}, await _tbbReadMirror());
  Object.keys(patch).forEach(k => { mirror[k] = patch[k]; });
  await _tbbWriteMirror(mirror);
}

async function _tbbReadRemoteSettings() {
  return await chrome.storage.sync.get(TBB_SETTINGS_KEYS).catch(() => ({}));
}

function _tbbValueOf(obj, k) {
  const v = obj ? obj[k] : undefined;
  return JSON.stringify(v === undefined ? null : v);
}

function _tbbSettingsDiffer(a, b) {
  return TBB_SETTINGS_KEYS.some(k => _tbbValueOf(a, k) !== _tbbValueOf(b, k));
}

function _tbbDefinedSettingsKeys(obj) {
  return TBB_SETTINGS_KEYS.filter(k => obj && obj[k] !== undefined);
}

// 데이터셋 합의 상태를 점검한다. 백그라운드가 시작 시점과 sync 변경 시점에 호출한다.
async function _tbbEnsureSyncLink() {
  const link = await _tbbReadLink();
  if (link.holding) return link; // 이미 사용자 선택 대기 중 — 다시 판단하지 않는다

  const [meta, remote, mirror] = await Promise.all([
    chrome.storage.sync.get([TBB_DATASET_KEY]).catch(() => ({})),
    _tbbReadRemoteSettings(),
    _tbbReadMirror()
  ]);
  const remoteId = meta[TBB_DATASET_KEY] || '';
  const remoteHas = _tbbDefinedSettingsKeys(remote).length > 0;

  // 평소 상태: 원격이 곧 내 데이터셋. 미러를 최신으로 맞춰둔다(나중에 되돌릴 스냅샷).
  if (link.agreedDatasetId && remoteId && remoteId === link.agreedDatasetId) {
    if (remoteHas && _tbbSettingsDiffer(remote, mirror)) await _tbbPatchMirror(remote);
    return link;
  }

  // 합의한 적이 있는데 다른 묶음이 들어왔고 내용까지 다르다 → 사용자가 고를 때까지 hold.
  // 내용이 같으면(같은 데이터에 id만 새로 붙은 경우 등) 굳이 귀찮게 하지 않는다.
  if (link.agreedDatasetId && remoteHas && _tbbSettingsDiffer(remote, mirror)) {
    const next = Object.assign({}, link, {
      holding: true, remoteDatasetId: remoteId, detectedAt: Date.now()
    });
    await _tbbWriteLink(next);
    return next;
  }

  // 신규 설치이거나, 원격이 비었거나, 내용이 이미 같은 경우 → 조용히 합의한다.
  const id = remoteId || link.agreedDatasetId || _tbbNewDatasetId();
  if (!remoteId) await chrome.storage.sync.set({ [TBB_DATASET_KEY]: id }).catch(() => {});
  if (remoteHas) {
    await _tbbPatchMirror(remote); // 원격이 진실 — 잃을 로컬 값이 없다
  } else {
    const keys = _tbbDefinedSettingsKeys(mirror);
    if (keys.length) {
      const push = {};
      keys.forEach(k => { push[k] = mirror[k]; });
      await _tbbSet(push); // 빈 계정으로 옮겨온 경우: 내 설정을 그대로 올려준다
    }
  }
  const next = { agreedDatasetId: id, holding: false, remoteDatasetId: '', detectedAt: 0, dismissed: false };
  await _tbbWriteLink(next);
  return next;
}

// ── 충돌 해소 / 수동 조작 ──

// 배너만 끈다. hold는 그대로라 이 기기 설정이 계속 쓰이고 설정은 원격으로 올라가지 않는다.
// "원격을 받아들인다"가 아니라 "알림을 그만 본다"는 뜻이며, 나중에 불러오기/유지/합치기 중
// 하나를 고르면 그 함수들이 hold와 함께 이 표시도 자동으로 푼다.
async function _tbbDismissConflict() {
  const link = await _tbbReadLink();
  await _tbbWriteLink(Object.assign({}, link, { dismissed: true }));
}

async function _tbbRestoreConflictNotice() {
  const link = await _tbbReadLink();
  await _tbbWriteLink(Object.assign({}, link, { dismissed: false }));
}

// 동기화된(원격) 설정을 이 기기에 적용한다. 이 기기 값은 사라지므로 호출부에서 반드시
// 확인을 받아야 한다.
async function _tbbAdoptRemoteSettings() {
  const [meta, remote] = await Promise.all([
    chrome.storage.sync.get([TBB_DATASET_KEY]).catch(() => ({})),
    _tbbReadRemoteSettings()
  ]);
  await _tbbPatchMirror(remote);
  await _tbbWriteLink({
    agreedDatasetId: meta[TBB_DATASET_KEY] || _tbbNewDatasetId(),
    holding: false, remoteDatasetId: '', detectedAt: 0, dismissed: false
  });
  // hold가 풀리면 읽기가 다시 sync로 나가므로 별도 복사가 필요 없다.
}

// 이 기기 설정을 정답으로 삼아 원격에 올린다(원격 값은 이 기기 값으로 대체된다).
async function _tbbKeepLocalSettings() {
  const [meta, mirror] = await Promise.all([
    chrome.storage.sync.get([TBB_DATASET_KEY]).catch(() => ({})),
    _tbbReadMirror()
  ]);
  const id = meta[TBB_DATASET_KEY] || _tbbNewDatasetId();
  // 먼저 hold를 풀어야 _tbbSet이 sync로 나간다
  await _tbbWriteLink({ agreedDatasetId: id, holding: false, remoteDatasetId: '', detectedAt: 0, dismissed: false });
  if (!meta[TBB_DATASET_KEY]) await chrome.storage.sync.set({ [TBB_DATASET_KEY]: id }).catch(() => {});
  const keys = _tbbDefinedSettingsKeys(mirror);
  if (keys.length) {
    const push = {};
    keys.forEach(k => { push[k] = mirror[k]; });
    await _tbbSet(push);
  }
}

// 합집합 + 실제로 새로 들어오는 항목 목록. 개수만으로는 확인 모달에서 "무엇이 추가되는지"를
// 보여줄 수 없어서 항목 자체를 같이 돌려준다. 로컬 쪽에 중복이 있어도 개수 계산이 어긋나지
// 않도록, 늘어난 개수를 length 차이로 유추하지 않고 원격 유래 항목만 직접 모은다.
function _tbbMergeList(localList, remoteList) {
  const out = [];
  const added = [];
  const seen = new Set();
  const push = (item, fromRemote) => {
    const key = typeof item === 'string' ? item : JSON.stringify(item);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
    if (fromRemote) added.push(item);
  };
  (Array.isArray(localList) ? localList : []).forEach(i => push(i, false));
  (Array.isArray(remoteList) ? remoteList : []).forEach(i => push(i, true));
  return { list: out, added };
}

// 합칠 수 있는 목록만 합집합으로 만들고, 나머지 설정은 이 기기 값을 유지한다.
// 계산과 적용을 나눠 둔 건, 실행 전에 "무엇이 몇 개 늘어나는지"를 먼저 보여주고
// 확인을 받기 위해서다(options-sync.js의 합치기 확인 모달).
async function _tbbComputeMergeLists() {
  const [meta, remote, mirror] = await Promise.all([
    chrome.storage.sync.get([TBB_DATASET_KEY]).catch(() => ({})),
    _tbbReadRemoteSettings(),
    _tbbReadMirror()
  ]);
  const merged = {};
  const summary = {};
  TBB_MERGEABLE_KEYS.forEach(k => {
    if (mirror[k] === undefined && remote[k] === undefined) return;
    const before = Array.isArray(mirror[k]) ? mirror[k].length : 0;
    const { list, added } = _tbbMergeList(mirror[k], remote[k]);
    merged[k] = list;
    summary[k] = { before: before, after: list.length, added: added.length, items: added };
  });
  // 합치지 못하는 설정은 이 기기 값을 그대로 올린다 — 원격 값이 조용히 남는 걸 막는다.
  TBB_SETTINGS_KEYS.forEach(k => {
    if (TBB_MERGEABLE_KEYS.indexOf(k) !== -1) return;
    if (mirror[k] !== undefined) merged[k] = mirror[k];
  });

  return { meta, merged, summary };
}

// 적용 없이 요약만 — 확인 모달이 실행 전에 보여줄 값.
async function _tbbPreviewMergeLists() {
  return (await _tbbComputeMergeLists()).summary;
}

async function _tbbMergeSettingsLists() {
  const { meta, merged, summary } = await _tbbComputeMergeLists();
  const id = meta[TBB_DATASET_KEY] || _tbbNewDatasetId();
  await _tbbWriteLink({ agreedDatasetId: id, holding: false, remoteDatasetId: '', detectedAt: 0, dismissed: false });
  if (!meta[TBB_DATASET_KEY]) await chrome.storage.sync.set({ [TBB_DATASET_KEY]: id }).catch(() => {});
  if (Object.keys(merged).length) await _tbbSet(merged);
  return summary;
}

self.TBBStorage = {
  SYNC_KEYS: TBB_SYNC_KEYS,
  get(keys, callback) {
    const p = _tbbGet(keys);
    if (callback) { p.then(callback); return; }
    return p;
  },
  // 주의: set({ focusEvents })는 구버전 단일 키에 그대로 쓴다(1회성 마이그레이션 전용).
  // 통계 기록은 updateFocusEvents, 백업 복원은 replaceFocusEvents를 써야 한다 —
  // 합산된 배열을 set으로 되쓰면 다른 기기 기록이 이 기기 것으로 복제된다.
  set(obj, callback) {
    const p = _tbbSet(obj);
    if (callback) { p.then(() => callback()); return; }
    return p;
  },
  updateFocusEvents(mutator, callback) {
    const p = _tbbUpdateFocusEvents(mutator);
    if (callback) { p.then(() => callback()); return; }
    return p;
  },
  replaceFocusEvents(events, callback) {
    const p = _tbbReplaceFocusEvents(events);
    if (callback) { p.then(() => callback()); return; }
    return p;
  },
  gcLegacyFocusEvents: _tbbGcLegacyFocusEvents,
  isFocusEventsChange: _tbbIsFocusEventsChange,
  getStreak(events, callback) {
    const p = _tbbGetStreak(events);
    if (callback) { p.then(callback); return; }
    return p;
  },
  refreshStreak(callback) {
    const p = _tbbRefreshStreak();
    if (callback) { p.then(callback); return; }
    return p;
  },

  // ── 설정 덮어쓰기 보호 ──
  SETTINGS_KEYS: TBB_SETTINGS_KEYS,
  MERGEABLE_KEYS: TBB_MERGEABLE_KEYS,
  ensureSyncLink: _tbbEnsureSyncLink,
  getSyncLink: _tbbReadLink,
  getRemoteSettings: _tbbReadRemoteSettings,
  getLocalSettings: _tbbReadMirror,
  dismissConflict: _tbbDismissConflict,
  restoreConflictNotice: _tbbRestoreConflictNotice,
  adoptRemoteSettings: _tbbAdoptRemoteSettings,
  keepLocalSettings: _tbbKeepLocalSettings,
  previewMergeLists: _tbbPreviewMergeLists,
  mergeSettingsLists: _tbbMergeSettingsLists
};
