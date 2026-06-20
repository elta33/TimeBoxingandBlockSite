// content.js — Isolated World: page-world.js의 내비게이션 알림 수신 및 차단 판별
// page-world.js(MAIN 월드)가 SPA 내비게이션을 감지해 postMessage를 보내면
// 이쪽에서 background.js에 차단 여부를 묻고 block.html로 이동한다.

function requestBlockCheck(url) {
  chrome.runtime.sendMessage({ type: 'checkBlock', url }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res?.blocked) {
      location.replace(
        chrome.runtime.getURL('block.html') + '?reason=' + (res.reason || 'general')
      );
    }
  });
}

// SPA 내비게이션 감지 (page-world.js → postMessage)
window.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== '__TBB_NAV__' || typeof e.data.url !== 'string') return;
  requestBlockCheck(e.data.url);
});

// 초기 페이지 로드 시 차단 여부 확인 (DNR 리다이렉트 실패 대비 폴백)
requestBlockCheck(location.href);
