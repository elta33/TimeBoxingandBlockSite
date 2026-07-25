// pro.js
// TBB Pro (부분 유료화) feature-flag 인프라.
//
// 설계 목표
//  1) "이 사용자가 지금 Pro인가?"를 한 곳(TBBPro.isActive)에서 판정.
//  2) 출시 기념 "전 기능 무료" 기간에 확장을 쓴 사용자를 영구 무료(grandfathered)로 각인 →
//     나중에 유료화해도 기존 사용자는 쓰던 걸 잃지 않는다(UX 반발 방지).
//  3) 유료화 전환은 아래 TBB_PRO_LAUNCH_FREE 상수 하나만 false로 바꾸면 켜진다.
//
// 로드 방식: background.js는 importScripts, 페이지는 <script src="pro.js">.
//            storage-api.js(TBBStorage)에 의존하므로 항상 그 다음에 로드한다.
//            (self는 서비스워커/윈도우 양쪽에서 전역 — storage-api.js와 동일 패턴)

// ── 마스터 스위치 ──
// true  = 출시 기념 "전 기능 무료" 기간. 모든 사용자가 Pro 기능을 무료로 쓰며,
//         이 기간에 확장을 실행한 사용자는 grandfathered(영구 유지)로 각인된다.
// false = 정식 유료화. grandfathered 사용자와 정품(license) 사용자만 Pro.
// ⚠️ 이 값을 false로 바꾸는 순간이 "과금 시작"이다. 그 전에 반드시 함께 가야 하는 것:
//    (1) 결제·라이선스 검증 구현(_tbbComputeActive의 license 분기),
//    (2) 개인정보처리방침·CWS 데이터 공시 갱신(결제 검증 통신 고지),
//    (3) 각 Pro 기능 호출부에 TBBPro.has('...') 게이트 + UI 자물쇠,
//    (4) manifest version 업 후 재심사 제출.
const TBB_PRO_LAUNCH_FREE = true;

// 어떤 기능이 Pro 대상인지 "선언만" 해둔다(현재는 강제하지 않음 — LAUNCH_FREE라 전부 열림).
// 유료화 시 해당 기능 호출부에서 if (TBBPro.has('key')) { ... } 로 게이트하면 된다.
// value는 그 기능이 속한 화면(문서용 힌트).
const TBB_PRO_FEATURES = {
  customBgUpload:           'block',    // 차단화면 커스텀 배경 이미지 업로드
  pomodoroPresetsUnlimited: 'pomodoro', // 포모도로 프리셋 무제한 + 사이클/도메인 고급 오버라이드
  statsFullHistory:         'stats',    // 통계 30일 전체 + 내보내기
  pinLock:                  'settings', // PIN 잠금
  pipAlwaysOnTop:           'pomodoro', // PiP 항상 위(Always on Top)
};

const TBB_PRO_ENTITLEMENT_KEY = 'proEntitlement';

// 동기 isActive()를 위한 캐시. refresh()로 채운다.
// LAUNCH_FREE 기간엔 캐시와 무관하게 항상 true라, 게이트를 붙이기 전에도 안전하다.
let _tbbProEntitlement = null;

function _tbbDefaultEntitlement() {
  return { grandfathered: false, license: null, updatedAt: 0 };
}

async function _tbbGetEntitlement() {
  const res = await TBBStorage.get([TBB_PRO_ENTITLEMENT_KEY]);
  const ent = res[TBB_PRO_ENTITLEMENT_KEY];
  _tbbProEntitlement = (ent && typeof ent === 'object') ? ent : _tbbDefaultEntitlement();
  return _tbbProEntitlement;
}

async function _tbbSetEntitlement(patch) {
  const cur = await _tbbGetEntitlement();
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  await TBBStorage.set({ [TBB_PRO_ENTITLEMENT_KEY]: next });
  _tbbProEntitlement = next;
  return next;
}

// 정품 여부 계산(캐시 기준, 동기). 게이트 호출부가 쓰는 최종 판정.
function _tbbComputeActive() {
  if (TBB_PRO_LAUNCH_FREE) return true;                 // 출시 무료 기간: 전원 Pro
  const ent = _tbbProEntitlement;
  if (!ent) return false;                               // refresh 전이면 보수적으로 false
  if (ent.grandfathered) return true;                   // 무료 기간 사용자는 영구 유지
  if (ent.license && ent.license.valid) return true;    // (향후) 정품 라이선스
  return false;
}

self.TBBPro = {
  LAUNCH_FREE: TBB_PRO_LAUNCH_FREE,
  FEATURES: TBB_PRO_FEATURES,

  // 동기: 현재 Pro 활성 여부. UI 게이트/자물쇠 표시에 쓴다.
  // 주의: LAUNCH_FREE=false로 바꾼 뒤에는 먼저 refresh()가 한 번 돌아야 정확하다
  //       (그 전까지는 캐시가 비어 있어 보수적으로 false를 돌려준다).
  isActive() { return _tbbComputeActive(); },

  // 개별 기능 게이트. 현재는 isActive와 동일하나, 향후 티어 세분화 여지를 남겨둔다.
  // feature는 TBB_PRO_FEATURES의 키.
  has(feature) {
    if (feature && !(feature in TBB_PRO_FEATURES)) {
      console.warn(`[TBBPro] 알 수 없는 기능 키: ${feature}`);
    }
    return _tbbComputeActive();
  },

  // entitlement를 스토리지에서 읽어 캐시에 적재. isActive()를 신뢰하기 전에 호출.
  async refresh() { await _tbbGetEntitlement(); return _tbbComputeActive(); },

  // 출시 무료 기간에 실행된 사용자를 grandfathered로 1회 각인(멱등).
  // 유료화(LAUNCH_FREE=false) 이후 실행되는 신규 사용자에겐 각인하지 않는다 → 이게 곧 유료벽.
  // background.js의 onInstalled/onStartup에서 호출한다.
  async ensureGrandfather() {
    if (!TBB_PRO_LAUNCH_FREE) return;
    const ent = await _tbbGetEntitlement();
    if (ent.grandfathered) return;
    await _tbbSetEntitlement({ grandfathered: true, grandfatheredAt: Date.now() });
  },

  // 원본 entitlement 조회(설정 화면/디버그용).
  getEntitlement() { return _tbbGetEntitlement(); },
};
