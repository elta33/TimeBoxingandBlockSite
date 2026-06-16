// block.js
// ─────────────────────────────────────────────
//  ▼▼▼  여기에 항목을 추가하세요  ▼▼▼
// ─────────────────────────────────────────────

// [1] 배경 이미지 목록
//  - 프로젝트 폴더(block.html과 같은 위치)에 파일을 넣고
//    파일명만 문자열로 추가하면 됩니다.
//  - 하위 폴더에 넣었다면 "images/foo.jpg" 처럼 상대경로로 적으세요.
const BG_IMAGES = [
  "Image/red-gaze.gif",
  // "focus2.jpg",
  // "images/wallpaper3.png",
];

// [2] 랜덤 문구 목록
//  - 한 줄에 하나씩 따옴표로 감싸고 끝에 쉼표를 붙여 추가하세요.
const QUOTES = [
  "고작 이런 곳에 쓰려고 당신의 시계가 되돌아가는 것은 아닐 겁니다, 관리자 단테헤...",
  // "여기에 문구를 계속 추가하세요.",
];

// ─────────────────────────────────────────────
//  ▲▲▲  추가 영역 끝 — 아래는 로직  ▲▲▲
// ─────────────────────────────────────────────

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// 배경 이미지 적용
(function applyBackground() {
  const file = pickRandom(BG_IMAGES);
  if (!file) return; // 등록된 이미지가 없으면 단색 배경 유지
  const layer = document.getElementById('bg-layer');
  const url = chrome.runtime.getURL(file);
  const img = new Image();
  img.onload = () => {
    layer.style.backgroundImage = 'url("' + url + '")';
    layer.classList.add('loaded');
  };
  img.onerror = () => {
    console.warn('배경 이미지를 불러오지 못했습니다:', file);
  };
  img.src = url;
})();

// 랜덤 문구 적용
(function applyQuote() {
  const quote = pickRandom(QUOTES);
  const el = document.getElementById('quote');
  if (quote) el.textContent = quote;
  else el.style.display = 'none';
})();
