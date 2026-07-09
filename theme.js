// theme.js — 다크모드 적용/동기화 (options.html, popup.html, pomodoro-pip.html에서 로드)
// block.html은 이미 자체 다크 오버레이 테마라 이 스크립트를 로드하지 않는다.
//
// storage.darkModeEnabled가 없으면(최초 진입) 기기의 prefers-color-scheme을 따라
// 결정하고 그 값을 storage에 저장해 고정한다. 이후로는 사용자가 토글로 바꾸기
// 전까지 그 값을 그대로 쓴다.
(function () {
  function applyTheme(enabled) {
    document.documentElement.setAttribute('data-theme', enabled ? 'dark' : 'light');
    try { localStorage.setItem('tbb-theme', enabled ? 'dark' : 'light'); } catch (e) {}
  }

  // localStorage 캐시로 즉시 반영(비동기 chrome.storage 응답 전까지의 흰 화면 깜빡임 방지).
  // <head> 맨 앞에서 동기 실행되는 인라인 스크립트가 이미 처리했다면 중복이지만 무해하다.
  try {
    const cached = localStorage.getItem('tbb-theme');
    if (cached === 'dark' || cached === 'light') {
      document.documentElement.setAttribute('data-theme', cached);
    }
  } catch (e) {}

  chrome.storage.local.get(['darkModeEnabled'], result => {
    if (typeof result.darkModeEnabled === 'boolean') {
      applyTheme(result.darkModeEnabled);
    } else {
      const systemDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      chrome.storage.local.set({ darkModeEnabled: systemDark });
      applyTheme(systemDark);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.darkModeEnabled) {
      applyTheme(!!changes.darkModeEnabled.newValue);
    }
  });
})();
