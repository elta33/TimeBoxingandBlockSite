// strong-block-selectors.js
// strong-block-selectors.css와 함께 registerContentScripts로 등록/해제됨.
// CSS 선택자만으로는 표시 텍스트 기반 매칭이 불가능한 요소를 처리하는 보조 스크립트.
//
// 유튜브 검색 결과 상단 필터 칩(#chips > yt-chip-cloud-chip-renderer)은 전체/동영상/Shorts/
// 라이브 등 모든 칩이 완전히 동일한 클래스·구조를 공유하고, "Shorts"라는 라벨도 href나
// title/aria-label이 아니라 안쪽 <div>의 순수 텍스트로만 존재해 CSS 속성 선택자로 구분이 안 됨.
(function () {
  const SHORTS_CHIP_TEXTS = ['Shorts', '쇼츠'];

  function hideShortsChips() {
    document.querySelectorAll('yt-chip-cloud-chip-renderer').forEach(chip => {
      if (chip.dataset.tbbShortsChecked) return;
      chip.dataset.tbbShortsChecked = '1';
      const text = chip.textContent.trim();
      if (SHORTS_CHIP_TEXTS.includes(text)) {
        chip.style.setProperty('display', 'none', 'important');
      }
    });
  }

  hideShortsChips();

  // 검색어를 바꿔가며 이동하는 SPA 내비게이션마다 칩 목록이 통째로 새로 렌더링되므로 계속 감시.
  let _lastRun = 0;
  new MutationObserver(() => {
    const now = Date.now();
    if (now - _lastRun < 300) return;
    _lastRun = now;
    hideShortsChips();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();

// 인스타그램 코스메틱 핸들러들이 공유하는 rAF 기반 디바운스 헬퍼. 원래는 Date.now() 기반
// 시간 스로틀(예: 30ms 이내 재호출 스킵)을 썼는데, 스크롤을 빠르게 계속하면 mutation이
// 스로틀 창보다 촘촘하게 몰려서 스킵된 배치가 "다음 mutation이 올 때까지" 처리가 무기한
// 밀리는 문제가 있었음(스크롤이 멈추면 그 배치가 영영 처리 안 되는 경우도 있었음).
// requestAnimationFrame은 "다음 페인트 직전에 최대 1번" 실행을 보장하므로, 몰아치는
// mutation을 프레임 단위로 합치면서도 누락 없이 전부 반영되고, 처리 시점도 항상 다음
// 페인트 이전이라 화면에 노출되는 시간을 최소화한다.
function tbbScheduleOnNextFrame(fn) {
  let scheduled = false;
  return function () {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn();
    });
  };
}

// 인스타그램 "추천 게시물" 섹션 헤더 숨김 (instaBlockEnabled). 게시물 자체와 "모두
// 확인했습니다" 카드는 strong-block-selectors.css가 순수 CSS(article 태그 선택자,
// img 경로 기반 :has())로 처리해 document_start 시점부터 즉시 적용되지만, "추천 게시물"은
// href/속성 없이 순수 텍스트로만 존재해 CSS로 못 잡고 JS가 필요하다. JS는 MutationObserver
// 콜백이 실행돼야 반영되므로 CSS보다 근본적으로 늦다 — 스로틀 간격을 최소화해 화면에 노출되는
// 시간을 최대한 줄인다(완전 제거는 불가, 알려진 한계). 실제 DevTools 마크업 기준 라벨에서
// 3단계 위 조상이 섹션 전체를 감싸는 wrapper라 그 지점을 숨김.
(function () {
  function hideAncestor(el, levels) {
    let target = el;
    for (let i = 0; i < levels && target.parentElement; i++) target = target.parentElement;
    target.style.setProperty('display', 'none', 'important');
  }

  function hideFeedSectionMarkers() {
    document.querySelectorAll('h3').forEach(h3 => {
      if (h3.dataset.tbbInstaHeaderChecked) return;
      h3.dataset.tbbInstaHeaderChecked = '1';
      if (h3.textContent.trim() === '추천 게시물') {
        hideAncestor(h3, 3);
      }
    });
  }

  hideFeedSectionMarkers();

  new MutationObserver(tbbScheduleOnNextFrame(hideFeedSectionMarkers))
    .observe(document.documentElement, { childList: true, subtree: true });
})();

// 팔로우한 계정 게시물은 홈에 표시 (instaShowFollowedPosts, instaBlockEnabled의 하위 옵션).
// article은 기본적으로 strong-block-selectors.css가 전부 숨기는데, "모두 확인했습니다"/
// "추천 게시물" 경계 마커(위 두 마커도 이미 CSS로 숨겨져 화면엔 안 보임, 위치 판별용으로만
// 씀)보다 DOM 순서상 앞서 렌더링된 article은 팔로우 피드가 아직 안 끝난 시점의 게시물로 보고
// 인라인 !important로 다시 노출한다. "숨김 → 뒤늦게 보이기" 방향이라 최악의 경우에도 팔로우
// 게시물이 살짝 늦게 나타날 뿐, 추천 콘텐츠가 먼저 노출되는 플리커링 위험은 없다(반대 방향은
// 위험함). 이 옵션이 꺼져 있으면 아무 것도 안 하고 즉시 종료.
//
// 스크롤을 오래 이어가면 인스타그램이 화면에서 멀어진 옛 노드(마커 포함)를 메모리 절약을
// 위해 DOM에서 제거하는 가상 스크롤을 쓰는 것으로 보임 — 그때마다 마커를 새로 찾으면
// "마커가 사라졌으니 그 뒤 article도 마커보다 앞"이라고 오판해 추천 게시물을 잘못 노출시켰다가
// 인스타그램이 그 노드를 다시 정리하며 스크롤이 줄어드는 플리커링이 발생했음. 그래서 마커는
// "찾을 때마다 새로 조회"가 아니라 "한 번이라도 찾으면 그 시점부터 영구적으로 경계를 넘은
// 것으로 취급"하는 sticky 플래그로 바꿈 — 무한 스크롤은 항상 아래로만 자라므로, 경계를 이미
// 넘은 뒤에 처음 보는 article은 마커가 DOM에 남아있는지와 무관하게 전부 추천으로 간주해도 안전.
(function () {
  chrome.storage.sync.get(['instaShowFollowedPosts'], ({ instaShowFollowedPosts }) => {
    if (!instaShowFollowedPosts) return;

    let boundaryCrossed = false;
    const knownMarkers = [];

    function collectMarkers() {
      document.querySelectorAll('img[src*="illo-confirm-refresh-light"]').forEach(img => {
        if (!knownMarkers.includes(img)) knownMarkers.push(img);
      });
      document.querySelectorAll('h3').forEach(h3 => {
        if (h3.textContent.trim() === '추천 게시물' && !knownMarkers.includes(h3)) knownMarkers.push(h3);
      });
    }

    function isAfterKnownMarker(article) {
      return knownMarkers.some(marker =>
        document.contains(marker) && (marker.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    }

    function revealFollowedPosts() {
      // 이전 호출에서 이미 경계를 넘었었는지를 먼저 고정(이번 호출에서 새로 찾은 마커는
      // 다음 호출부터 반영 — 마커와 같은 배치로 삽입된 article은 여전히 위치 비교로 정확히
      // 판정하기 위함).
      const wasAlreadyPastBoundary = boundaryCrossed;
      collectMarkers();
      if (knownMarkers.length) boundaryCrossed = true;

      document.querySelectorAll('article').forEach(article => {
        // 결과(노출/유지숨김)와 무관하게 한 번 판정한 article은 다시 검사하지 않는다 — 안
        // 그러면 추천 게시물(계속 숨김 대상)이 무한정 재검사되면서 스캔 비용이 피드가 늘어날수록
        // 계속 커져, 다른 선택자(추천 게시물 헤더 등)의 반영 타이밍까지 밀리는 원인이 됐었음.
        if (article.dataset.tbbInstaChecked) return;
        article.dataset.tbbInstaChecked = '1';
        if (wasAlreadyPastBoundary) return; // 경계를 이미 넘었다면 마커 존재 여부와 무관하게 계속 숨김
        if (isAfterKnownMarker(article)) return;
        article.style.setProperty('display', 'block', 'important');
      });
    }

    revealFollowedPosts();

    new MutationObserver(tbbScheduleOnNextFrame(revealFollowedPosts))
      .observe(document.documentElement, { childList: true, subtree: true });
  });
})();
