// pomodoro-shared.js
// 포모도로 사이클별 시간(회차 예외) 계산 공용 로직.
// background.js(importScripts) / options-pomodoro.js / pomodoro-pip.js 세 곳이 공유한다.
// 예전엔 이 로직이 세 파일에 각각 따로 구현되어 있어 한 곳만 고치고 넘어가는
// 버그가 났었다 — 반드시 이 파일만 수정할 것.

function _findCycleOverride(cycleNum, overrides) {
  return (overrides || []).find(o => o.cycle === cycleNum) || null;
}

function _resolveCycleTimes(cycleNum, settings, overrides) {
  const found = _findCycleOverride(cycleNum, overrides);
  return {
    workMins: found ? found.workMins : settings.workMins,
    restMins: found ? found.restMins : settings.restMins,
  };
}

// override 하나가 base 설정과 실제로 다른 값을 갖는지 (우연히 같은 값이면 "다름"이 아님)
function _cycleOverrideDiffers(override, baseSettings) {
  return !!override && (override.workMins !== baseSettings.workMins || override.restMins !== baseSettings.restMins);
}

// baseSettings와 실제로 다른 예외만 골라낸다
function _cycleOverrideDiffs(baseSettings, overrides) {
  return (overrides || []).filter(o => _cycleOverrideDiffers(o, baseSettings));
}
