// page-world.js — world: "MAIN" (페이지 JS와 동일한 컨텍스트)
// Isolated World인 content.js에서는 chrome.* API를 쓸 수 있지만
// history 패치가 페이지 JS에 반영되지 않아, MAIN 월드에서 직접 패치 후
// postMessage로 content.js에 알린다.
(function () {
  const MSG = '__TBB_NAV__';

  function notify(url) {
    window.postMessage({ type: MSG, url: url || location.href }, '*');
  }

  if (window.navigation) {
    // W3C Navigation API (Chrome 102+):
    // pushState / replaceState / 뒤로앞으로 / YouTube 등 프레임워크 내부 라우터까지
    // 브라우저가 URL 변경을 표준화된 단일 이벤트로 전달하므로 중복 패치 불필요.
    window.navigation.addEventListener('navigate', (e) => {
      notify(e.destination.url);
    });
  } else {
    // 구형 브라우저 폴백: History API 직접 패치
    const _push = history.pushState.bind(history);
    history.pushState = function (...args) { _push(...args); notify(); };
    const _replace = history.replaceState.bind(history);
    history.replaceState = function (...args) { _replace(...args); notify(); };
    window.addEventListener('popstate', () => notify());
  }
})();
