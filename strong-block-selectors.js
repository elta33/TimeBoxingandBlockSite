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
      if (h3.textContent.trim() === '추천 게시물') {
        hideAncestor(h3, 3);
      }
    });
  }

  hideFeedSectionMarkers();

  // 스로틀을 300ms→30ms로 줄여 삽입 후 화면에 노출되는 시간을 최소화(완전 제거는 CSS가 아닌
  // 이상 불가능 — MutationObserver 콜백 자체가 다음 이벤트 루프 틱에야 실행되기 때문).
  let _lastMarkerRun = 0;
  new MutationObserver(() => {
    const now = Date.now();
    if (now - _lastMarkerRun < 30) return;
    _lastMarkerRun = now;
    hideFeedSectionMarkers();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
