// strong-block-selectors.js
// strong-block-selectors.css와 함께 registerContentScripts로 등록/해제됨.
// CSS 선택자만으로는 표시 텍스트 기반 매칭이 불가능한 요소를 처리하는 보조 스크립트.
//
// 유튜브 검색 결과 상단 필터 칩(#chips > yt-chip-cloud-chip-renderer)은 전체/동영상/Shorts/
// 라이브 등 모든 칩이 완전히 동일한 클래스·구조를 공유하고, "Shorts"라는 라벨도 href나
// title/aria-label이 아니라 안쪽 <div>의 순수 텍스트로만 존재해 CSS 속성 선택자로 구분이 안 됨.
//
// 주의: 이 칩들은 Polymer가 DOM 노드를 재활용한다 — 검색어를 바꾸거나 필터를 눌러 칩 목록이
// 갱신될 때 새 요소를 만드는 게 아니라 기존 요소의 텍스트만 갈아끼우는 경우가 있다. 그래서
// "한 번 검사한 칩은 다시 안 본다"는 식으로 캐싱하면 (a) 예전에 "쇼츠"였던 칩이 "동영상"으로
// 재활용됐을 때 display:none이 그대로 남아 멀쩡한 필터가 영구히 사라지고, (b) 반대로 예전에
// 다른 라벨이었던 칩이 "쇼츠"로 재활용되면 숨김이 안 걸린다. 캐시 없이 매번 현재 텍스트로
// 판정하고, 쇼츠가 아니면 인라인 스타일을 반드시 되돌린다(칩은 몇 개 안 되므로 비용도 무시 가능).
(function () {
  const SHORTS_CHIP_TEXTS = ['Shorts', '쇼츠'];

  function hideShortsChips() {
    document.querySelectorAll('yt-chip-cloud-chip-renderer').forEach(chip => {
      const isShorts = SHORTS_CHIP_TEXTS.includes(chip.textContent.trim());
      if (isShorts) {
        chip.style.setProperty('display', 'none', 'important');
      } else if (chip.style.display === 'none') {
        // 우리가 숨겼던 칩이 다른 라벨로 재활용된 경우에만 원복(유튜브가 직접 건 스타일은
        // 인라인이 아니므로 여기서 지워도 영향 없음).
        chip.style.removeProperty('display');
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

// 인스타그램 코스메틱 핸들러용 rAF 기반 디바운스 헬퍼. 원래는 Date.now() 기반
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

