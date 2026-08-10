// browser-shim.js — 크로스 브라우저 API 네임스페이스 통일. 크롬에서는 아무 일도 하지 않는다.
//
// 파이어폭스의 chrome.* 는 "포팅 보조용"이라 콜백만 지원하고 Promise를 반환하지 않는다.
// TBB는 storage-api.js와 background.js가 `await chrome.storage.*` 같은 Promise 스타일을
// 쓰므로, 그대로 두면 await가 undefined를 기다리면서 저장 계층 전체가 조용히 깨진다.
// 파이어폭스의 browser.* 는 Promise를 반환하면서 콜백 인자도 받아주므로, chrome을 browser로
// 가리키면 Promise 스타일과 콜백 스타일이 양쪽 다 살아난다.
//
// 크롬에는 browser 전역이 없어서 이 파일은 no-op이다 — 두 빌드에 똑같이 포함해도 안전하고,
// 덕분에 HTML/JS 소스는 플랫폼 분기 없이 100% 공통으로 유지된다(빌드 차이는 manifest 뿐).
//
// 로드 순서: chrome.* 를 쓰는 다른 어떤 스크립트보다 먼저 실행돼야 한다.
// 콘텐츠 스크립트(content.js, strong-block-selectors.js)는 콜백 스타일만 쓰므로 제외했다 —
// 거기에 Promise 스타일 chrome 호출을 추가하게 되면 그때 이 파일도 같이 주입해야 한다.
if (typeof browser !== 'undefined') {
  globalThis.chrome = browser;
}
