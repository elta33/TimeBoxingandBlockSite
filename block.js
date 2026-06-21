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

const _params = new URLSearchParams(window.location.search);
const _reason = _params.get('reason');

// 차단 사유별 하단 문구 분기
(function applyReasonMessage() {
  const el = document.getElementById('subtitle');
  if (!el) return;
  const MESSAGES = {
    permanent: '상시 차단에 의해 접속이 제한되었습니다.',
    general:   '현재 스케줄에 의해 접속이 제한되었습니다.',
    custom:    '현재 스케줄에 의해 접속이 제한되었습니다.',
  };
  el.textContent = MESSAGES[_reason] || '현재 스케줄에 의해 접속이 제한되었습니다.';
})();

// 설정 열기 버튼
document.getElementById('openSettings')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 남은 차단 시간 표시 (상시 차단 제외)
(function applyRemainingTime() {
  if (_reason === 'permanent') return;

  function timeToMins(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  function isActive(box) {
    const now = new Date();
    let nowM = now.getHours() * 60 + now.getMinutes();
    const startM = timeToMins(box.startTime);
    const [eH, eMin] = box.endTime.split(':').map(Number);
    let endM = eH * 60 + eMin;
    if (endM <= startM) {
      endM += 24 * 60;
      if (nowM <= eH * 60 + eMin) nowM += 24 * 60;
    }
    return nowM >= startM && nowM < endM;
  }

  function getRemainingMins(endStr) {
    const [eH, eM] = endStr.split(':').map(Number);
    const now = new Date();
    const nowM = now.getHours() * 60 + now.getMinutes();
    let endM = eH * 60 + eM;
    if (endM <= nowM) endM += 24 * 60;
    return endM - nowM;
  }

  function fmt(mins) {
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h > 0 && m > 0) return `${h}시간 ${m}분 후 해제`;
    if (h > 0) return `${h}시간 후 해제`;
    return `${m}분 후 해제`;
  }

  chrome.storage.local.get(['dailyBoxes', 'weeklyBoxes', 'dailyScheduleEnabled'], data => {
    const dailyEnabled = data.dailyScheduleEnabled !== false;
    const dailyBoxes = dailyEnabled ? (data.dailyBoxes || []).map(b => ({ ...b, days: [] })) : [];
    const weeklyBoxes = data.weeklyBoxes || [];
    const todayDow = (new Date().getDay() + 6) % 7;

    const activeBox = [...dailyBoxes, ...weeklyBoxes].find(box => {
      const days = box.days || [];
      if (days.length > 0 && !days.includes(todayDow)) return false;
      return isActive(box);
    });
    if (!activeBox) return;

    const remaining = getRemainingMins(activeBox.endTime);
    if (remaining <= 0) return;
    const el = document.getElementById('remaining-time');
    if (el) { el.textContent = fmt(remaining); el.style.display = 'block'; }
  });
})();
