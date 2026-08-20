// content.js — Isolated World: page-world.js의 내비게이션 알림 수신 및 차단 판별
// page-world.js(MAIN 월드)가 SPA 내비게이션을 감지해 postMessage를 보내면
// 이쪽에서 background.js에 차단 여부를 묻고 block.html로 이동한다.

function requestBlockCheck(url) {
  chrome.runtime.sendMessage({ type: 'checkBlock', url }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res?.blocked) {
      // 쇼츠/인스타 강력 차단은 "차단됨" 화면 대신 해당 사이트 홈으로 조용히 되돌린다.
      if (res.reason === 'shorts') {
        location.replace('https://www.youtube.com/');
        return;
      }
      if (res.reason === 'insta') {
        location.replace('https://www.instagram.com/');
        return;
      }
      let blockUrl = chrome.runtime.getURL('block.html') + '?reason=' + (res.reason || 'general');
      if (res.domain) blockUrl += '&domain=' + encodeURIComponent(res.domain);
      location.replace(blockUrl);
    }
  });
}

// SPA 내비게이션 감지 (page-world.js → postMessage)
//
// 200ms 쓰로틀: 악성 사이트의 postMessage 폭주로 background 과부하 방지.
//
// 단, 창 안에 들어온 이벤트를 그냥 버리면 안 된다 — 유튜브는 홈에서 영상 썸네일을 한 번
// 클릭할 때 경유 URL(홈)과 목적지 URL(/watch)을 연달아 알려오는데, 앞의 경유 URL이 쓰로틀
// 타이머를 소모해버리면 정작 차단해야 할 목적지가 통째로 유실된다(주소창 직접 입력은 DNR이
// 잡으므로 SPA 클릭에서만 조용히 차단이 안 되는 형태로 나타났음).
// 그래서 창 안의 이벤트는 "마지막 URL 하나만" 남겨뒀다가 창이 끝날 때 반드시 처리한다.
// 중간 경유 URL은 이미 지나간 주소라 검사할 이유가 없고, 실제 도착지는 항상 마지막 것이다.
// 요청량은 창당 최대 2회(즉시 1 + 창 끝 1)로 묶이므로 폭주 방어 효과는 그대로 유지된다.
const NAV_THROTTLE_MS = 200;
let _lastNavCheck = 0;
let _pendingNavUrl = null;
let _pendingNavTimer = null;

function scheduleBlockCheck(url) {
  const elapsed = Date.now() - _lastNavCheck;
  if (elapsed >= NAV_THROTTLE_MS) {
    // 창 밖: 즉시 처리 (차단은 빠를수록 좋다)
    _lastNavCheck = Date.now();
    requestBlockCheck(url);
    return;
  }
  // 창 안: 마지막 URL로 계속 덮어쓰다가 창이 끝나는 시점에 한 번만 처리
  _pendingNavUrl = url;
  if (_pendingNavTimer === null) {
    _pendingNavTimer = setTimeout(() => {
      _pendingNavTimer = null;
      const pending = _pendingNavUrl;
      _pendingNavUrl = null;
      _lastNavCheck = Date.now();
      if (pending) requestBlockCheck(pending);
    }, NAV_THROTTLE_MS - elapsed);
  }
}

window.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== '__TBB_NAV__' || typeof e.data.url !== 'string') return;
  scheduleBlockCheck(e.data.url);
});

// 초기 페이지 로드 시 차단 여부 확인 (DNR 리다이렉트 실패 대비 폴백)
requestBlockCheck(location.href);
