// review-url.js
// 리뷰 요청 배너의 "리뷰 쓰기"가 열 스토어 페이지 URL을 결정한다.
// popup.js(팝업 배너)와 options-init.js(차단 관리 탭 배너)가 공유한다 — 예전엔 두 파일이
// URL을 각각 하드코딩하고 있어서 한쪽만 고치고 넘어가는 사고가 나기 쉬웠다
// (pomodoro-shared.js와 같은 이유로 분리). 스토어 주소는 반드시 이 파일만 수정할 것.
//
// ── 왜 chrome.runtime.id로 URL을 조립하지 않는가 ──
// 1) CWS의 현재 URL 구조는 /detail/<slug>/<확장ID> 로 확장 ID가 "마지막"에 온다.
//    기존 코드의 `/detail/${chrome.runtime.id}/reviews` 는 slug 자리에 확장 ID를, 확장 ID
//    자리에 문자열 "reviews"를 넣은 꼴이어서 스토어가 "사용할 수 없는 페이지"를 띄웠다.
// 2) chrome.runtime.id는 unpacked로 로드한 개발 빌드에서 게시본과 다른 ID를 돌려준다.
//    그 ID는 스토어에 존재하지 않으므로, 형식을 고쳐도 개발 중 테스트에서는 계속 깨진다.
// 3) 파이어폭스 빌드는 애초에 CWS가 아니라 AMO로 가야 한다. 소스는 양 스토어가 100% 공유
//    하므로(빌드 차이는 manifest뿐) 분기는 빌드 타임이 아니라 런타임에 해야 한다.
// 그래서 게시된 스토어 주소를 플랫폼별 상수로 그대로 박는다.

const TBB_REVIEW_URLS = {
  // CWS 리뷰 섹션. 구조는 /detail/<slug>/<32자-확장ID>/reviews 로 확장 ID가 마지막에 온다.
  // slug(focusbox-websiteblock-tim)는 스토어가 리스팅 제목에서 자동 생성한 값이라 추측하면
  // 안 되고, 리스팅 제목을 바꿔 slug가 재생성되면 여기도 같이 고쳐야 한다.
  // 원래 주소에 붙어 있던 ?hl=ko&utm_source=ext_sidebar 는 떼어냈다 — hl=ko는 모든 사용자에게
  // 한국어 스토어를 강제하고(확장은 en/ko 양쪽 지원), utm_source는 사이드바 유입 추적용
  // 파라미터라 코드에 박을 값이 아니다.
  chrome: 'https://chromewebstore.google.com/detail/focusbox-websiteblock-tim/hblkapaebjbgkclmpapmlplkahkfipjb/reviews',

  // AMO 리뷰 페이지. 로케일 접두사(/ko/)는 일부러 생략했다 — AMO가 사용자 브라우저 언어에
  // 맞춰 리다이렉트해 주므로, 박아두면 영어권 사용자도 한국어 페이지를 보게 된다.
  // slug(focusbox)는 gecko.id(focusbox@elta33.github.io)와는 별개 값이다.
  firefox: 'https://addons.mozilla.org/firefox/addon/focusbox/reviews/',
};

// 파이어폭스 판별 — 확장 URL 스킴으로 본다.
// browser 전역 유무로 보지 않는 이유: browser-shim.js가 `chrome = browser`로 덮어쓰기
// 때문에 두 전역이 같은 객체가 되어 판별 의도가 흐려진다. UA 문자열도 쓰지 않는다 — 사용자가
// 바꿀 수 있는 값이다. 확장 URL 스킴(moz-extension:// vs chrome-extension://)은 런타임이
// 정하는 값이라 확실하다.
function tbbIsFirefox() {
  try {
    return chrome.runtime.getURL('').startsWith('moz-extension://');
  } catch (e) {
    return false;
  }
}

function tbbReviewUrl() {
  return tbbIsFirefox() ? TBB_REVIEW_URLS.firefox : TBB_REVIEW_URLS.chrome;
}

// 리뷰 페이지를 새 탭으로 연다. 두 스토어 주소가 다 채워져 있으므로 정상 경로에서는 항상
// 열리지만, 새 플랫폼을 추가하면서 주소를 빠뜨린 경우에 대비해 방어적으로 둔다 — 깨진 페이지로
// 보내는 대신 아무 것도 하지 않고 false를 돌려주면, 호출부가 배너를 "리뷰 완료"로 기록하지
// 않아서 사용자가 다음 주기에 다시 제대로 안내받는다.
function tbbOpenReviewPage() {
  const url = tbbReviewUrl();
  if (!url) {
    console.warn('[TBB] 리뷰 페이지 URL이 설정되지 않았습니다 (review-url.js의 TBB_REVIEW_URLS).');
    return false;
  }
  chrome.tabs.create({ url });
  return true;
}
