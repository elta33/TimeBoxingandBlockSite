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
