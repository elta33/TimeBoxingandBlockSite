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
  'customLinks'
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
      _tbbRecordSyncStatus({ trimmedFocusEventsAt: Date.now() });
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
