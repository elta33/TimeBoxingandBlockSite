// i18n.js — 다국어 지원 유틸리티 (모든 확장 페이지에서 로드)
// chrome.i18n.getMessage가 키를 찾지 못하면 키 자체를 반환해 화면이 깨지지 않도록 처리.
const T = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

(function applyI18n() {
  // textContent 교체
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = T(el.dataset.i18n);
  });
  // placeholder 교체
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = T(el.dataset.i18nPlaceholder);
  });
  // title 속성 교체
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = T(el.dataset.i18nTitle);
  });
  // aria-label 교체
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    el.setAttribute('aria-label', T(el.dataset.i18nAriaLabel));
  });
  // alt 교체
  document.querySelectorAll('[data-i18n-alt]').forEach(el => {
    el.alt = T(el.dataset.i18nAlt);
  });
})();
