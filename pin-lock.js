// pin-lock.js
// PIN 잠금 해제 모달 (options.html + popup.html 공용). 스타일은 styles/components.css.
// 호출부는 _openPinModal(버튼 라벨, 성공 콜백)만 쓰면 되고, 2단계 잠금이 켜져 있으면
// PIN 다음에 평문 입력 단계가 자동으로 이어진다.
//
// storage(전부 local — PIN과 마찬가지로 기기별 설정):
//   lockPin             { hash, salt, enabled }
//   lockTwoStepEnabled  boolean (기본 false)
//   lockTwoStepPhrases  string[] (해제할 때마다 그중 하나가 무작위로 나옴. 없으면 로케일 기본 문구 하나)
//
// 모달 DOM은 처음 열 때 JS로 만든다 — 두 페이지에 같은 마크업을 복붙하지 않기 위함.
const TBB_LOCK_PHRASE_MAX = 100;

let _pendingPinAction = null;
let _pinModalStep = 'pin'; // 'pin' | 'phrase'
let _pinModalPhrase = '';

async function _hashPin(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + pin));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// storage 결과에서 평문 목록을 꺼낸다. lockTwoStepPhrase는 단일 평문 시절의 키로, 첫 저장 때 지워진다.
function tbbLockPhrasesOf(stored) {
  if (Array.isArray(stored.lockTwoStepPhrases) && stored.lockTwoStepPhrases.length) return stored.lockTwoStepPhrases;
  return [stored.lockTwoStepPhrase || T('lockPhraseDefault')];
}

// 조합형 입력이 NFD로 들어오는 환경에서도 눈에 같은 글자면 같게 본다.
function _normalizeLockPhrase(s) {
  return (s || '').normalize('NFC').trim();
}

function _pinModalEl(tag, className, id) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (id) el.id = id;
  return el;
}

function _ensurePinModal() {
  const existing = document.getElementById('pinModalOverlay');
  if (existing) return existing;

  const overlay = _pinModalEl('div', 'pin-modal-overlay', 'pinModalOverlay');
  overlay.style.display = 'none';
  const modal = _pinModalEl('div', 'pin-modal');

  const icon = _pinModalEl('div', 'pin-modal-lock-icon');
  icon.textContent = '🔒';
  const title = _pinModalEl('div', 'pin-modal-title');
  title.textContent = T('pinModalTitle');
  const sub = _pinModalEl('div', 'pin-modal-sub', 'pinModalSub');

  const pinInput = _pinModalEl('input', 'pin-modal-input', 'pinModalInput');
  pinInput.type = 'password';
  pinInput.placeholder = T('pinModalPlaceholder');
  pinInput.maxLength = 20;
  pinInput.autocomplete = 'off';

  const phraseWrap = _pinModalEl('div', 'pin-modal-phrase-wrap', 'pinModalPhraseWrap');
  phraseWrap.style.display = 'none';
  const phraseText = _pinModalEl('div', 'pin-modal-phrase', 'pinModalPhraseText');
  const phraseInput = _pinModalEl('input', 'pin-modal-input pin-modal-phrase-input', 'pinModalPhraseInput');
  phraseInput.type = 'text';
  phraseInput.placeholder = T('pinModalPhrasePlaceholder');
  phraseInput.maxLength = TBB_LOCK_PHRASE_MAX + 20;
  phraseInput.autocomplete = 'off';
  phraseInput.spellcheck = false;
  // 2단계의 목적은 "직접 타이핑하게 해서 한 번 더 생각하게 하는 것"이라 붙여넣기는 막는다.
  ['paste', 'drop'].forEach(type => phraseInput.addEventListener(type, e => e.preventDefault()));
  phraseWrap.append(phraseText, phraseInput);

  const errorEl = _pinModalEl('div', 'pin-modal-error', 'pinModalError');
  const footer = _pinModalEl('div', 'pin-modal-footer');
  const cancelBtn = _pinModalEl('button', 'btn-ghost', 'pinModalCancelBtn');
  cancelBtn.textContent = T('cancelEdit');
  const confirmBtn = _pinModalEl('button', 'btn', 'pinModalConfirmBtn');
  footer.append(cancelBtn, confirmBtn);

  modal.append(icon, title, sub, pinInput, phraseWrap, errorEl, footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  cancelBtn.addEventListener('click', _closePinModal);
  confirmBtn.addEventListener('click', _attemptPinUnlock);
  overlay.addEventListener('click', e => { if (e.target === overlay) _closePinModal(); });
  [pinInput, phraseInput].forEach(input => {
    input.addEventListener('keydown', e => {
      // 한글 조합 중 Enter는 글자 확정용이라 제출로 치지 않는다(조합 끝난 뒤 keydown이 한 번 더 온다).
      if (e.isComposing) return;
      if (e.key === 'Enter')  _attemptPinUnlock();
      if (e.key === 'Escape') _closePinModal();
    });
  });
  return overlay;
}

function _showPinModalStep(step) {
  _pinModalStep = step;
  const isPhrase = step === 'phrase';
  document.getElementById('pinModalSub').textContent = T(isPhrase ? 'pinModalPhraseSub' : 'pinModalSub');
  document.getElementById('pinModalInput').style.display = isPhrase ? 'none' : '';
  document.getElementById('pinModalPhraseWrap').style.display = isPhrase ? '' : 'none';
  document.getElementById('pinModalPhraseText').textContent = _pinModalPhrase;
  document.getElementById('pinModalError').textContent = '';
  const input = document.getElementById(isPhrase ? 'pinModalPhraseInput' : 'pinModalInput');
  input.value = '';
  input.classList.remove('pin-shake');
  setTimeout(() => input.focus(), 60);
}

function _openPinModal(actionLabel, onSuccess) {
  const overlay = _ensurePinModal();
  _pendingPinAction = onSuccess;
  document.getElementById('pinModalConfirmBtn').textContent = actionLabel;
  document.body.classList.add('pin-modal-open');
  overlay.style.display = 'flex';
  _showPinModalStep('pin');
}

function _closePinModal() {
  const overlay = document.getElementById('pinModalOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.classList.remove('pin-modal-open');
  ['pinModalInput', 'pinModalPhraseInput'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  const errorEl = document.getElementById('pinModalError');
  if (errorEl) errorEl.textContent = '';
  _pendingPinAction = null;
}

function _pinModalReject(input, message, clear) {
  document.getElementById('pinModalError').textContent = message;
  input.classList.remove('pin-shake');
  void input.offsetWidth;
  input.classList.add('pin-shake');
  if (clear) input.value = '';
  setTimeout(() => { input.classList.remove('pin-shake'); input.focus(); }, 360);
}

function _finishPinUnlock() {
  const action = _pendingPinAction;
  _closePinModal();
  if (action) action();
}

function _attemptPinUnlock() {
  if (_pinModalStep === 'phrase') { _attemptPhraseUnlock(); return; }
  const input = document.getElementById('pinModalInput');
  const pin = input.value;
  if (!pin) return;
  chrome.storage.local.get(['lockPin', 'lockTwoStepEnabled', 'lockTwoStepPhrases', 'lockTwoStepPhrase'], async result => {
    const lp = result.lockPin;
    if (!lp?.hash || !lp?.salt) return;
    const hash = await _hashPin(pin, lp.salt);
    // 해시를 계산하는 사이에 취소됐거나, Enter 연타로 이미 다음 단계로 넘어간 경우
    if (!_pendingPinAction || _pinModalStep !== 'pin') return;
    if (hash !== lp.hash) { _pinModalReject(input, T('pinErrWrong'), true); return; }
    if (!result.lockTwoStepEnabled) { _finishPinUnlock(); return; }
    const phrases = tbbLockPhrasesOf(result);
    _pinModalPhrase = phrases[Math.floor(Math.random() * phrases.length)];
    _showPinModalStep('phrase');
  });
}

function _attemptPhraseUnlock() {
  const input = document.getElementById('pinModalPhraseInput');
  if (!input.value) return;
  if (_normalizeLockPhrase(input.value) === _normalizeLockPhrase(_pinModalPhrase)) {
    _finishPinUnlock();
  } else {
    // 긴 문장을 처음부터 다시 치게 하진 않는다(PIN과 달리 틀린 곳만 고치면 됨).
    _pinModalReject(input, T('pinErrPhraseWrong'), false);
  }
}
