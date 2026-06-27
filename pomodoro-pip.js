function pad(n) { return String(n).padStart(2, '0'); }
function fmt(s) { return pad(Math.floor(s / 60)) + ':' + pad(s % 60); }

var _state         = { active: false, phase: 'idle' };
var _settings      = { workMins: 25, restMins: 5, cycles: 2 };
var _timer         = null;
var _previewActive = false;
var _previewTimer  = null;

// ── 렌더 ──
function render() {
  var startBtn = document.getElementById('startBtn');
  var isActive = !!_state.active;

  // 버튼 / 입력 상태는 preview 중에도 항상 갱신
  if (startBtn) {
    startBtn.disabled = _state.phase === 'done';
    startBtn.textContent = isActive ? T('pomoPause')
      : (_state.phase === 'work' || _state.phase === 'rest') ? T('pomoResume')
      : T('pomoStart');
  }
  ['workDecr','workIncr','restDecr','restIncr','cyclesDecr','cyclesIncr'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.disabled = isActive;
  });
  var wEl = document.getElementById('workVal');
  var rEl = document.getElementById('restVal');
  var cEl = document.getElementById('cyclesVal');
  if (wEl && document.activeElement !== wEl) { wEl.value = _settings.workMins; wEl.disabled = isActive; }
  if (rEl && document.activeElement !== rEl) { rEl.value = _settings.restMins; rEl.disabled = isActive; }
  if (cEl && document.activeElement !== cEl) { cEl.value = _settings.cycles;   cEl.disabled = isActive; }

  if (_previewActive) return; // 디스플레이는 preview가 담당

  // 디스플레이 갱신
  var phaseEl = document.getElementById('phase-label');
  var timeEl  = document.getElementById('time-display');
  var cycleEl = document.getElementById('cycle-label');
  if (!phaseEl || !timeEl || !cycleEl) return;

  var s = _state, g = _settings;
  document.body.className = (s.phase && s.phase !== 'idle') ? 'phase-' + s.phase : '';

  var phaseNames = { work: T('pomoWork'), rest: T('pomoRest'), done: T('pomoDone'), idle: T('pomoIdle') };
  phaseEl.textContent = phaseNames[s.phase] || T('pomoIdle');

  if (isActive && s.endTime) {
    var rem = Math.max(0, Math.ceil((s.endTime - Date.now()) / 1000));
    timeEl.textContent = fmt(rem);
  } else if (s.pausedRemaining != null) {
    timeEl.textContent = fmt(s.pausedRemaining);
  } else if (s.phase === 'done') {
    timeEl.textContent = '00:00';
  } else {
    timeEl.textContent = fmt(g.workMins * 60);
  }

  var total = s.totalCycles || g.cycles;
  var cur   = s.cycle || 1;
  cycleEl.textContent = (s.phase && s.phase !== 'idle')
    ? (cur + ' / ' + total) : ('1 / ' + total);
}

// ── Preview 피드백 ──
function showPreview(previewPhase, secs, cycles) {
  _previewActive = true;
  clearTimeout(_previewTimer);

  document.body.className = 'preview-' + previewPhase;
  var phaseEl = document.getElementById('phase-label');
  var timeEl  = document.getElementById('time-display');
  var cycleEl = document.getElementById('cycle-label');
  if (phaseEl) phaseEl.textContent = previewPhase === 'work' ? T('pomoWork') : T('pomoRest');
  if (timeEl)  timeEl.textContent  = fmt(secs);
  if (cycleEl) cycleEl.textContent = '1 / ' + cycles;

  _previewTimer = setTimeout(function() {
    _previewActive = false;
    scheduleTick(); // 실제 상태 복원
  }, 1500);
}

// ── endTime 기준 초 경계 정렬 tick ──
function scheduleTick() {
  clearTimeout(_timer);
  render();
  var delay = 1000;
  if (_state.active && _state.endTime) {
    var rem = _state.endTime - Date.now();
    if (rem > 0) delay = (rem % 1000) || 1000;
  }
  _timer = setTimeout(scheduleTick, delay);
}

// ── 스토리지 동기화 ──
chrome.storage.onChanged.addListener(function(changes) {
  if (changes.pomodoroState)    _state    = changes.pomodoroState.newValue    || _state;
  if (changes.pomodoroSettings) _settings = changes.pomodoroSettings.newValue || _settings;
  scheduleTick();
});

chrome.storage.local.get(['pomodoroState', 'pomodoroSettings'], function(data) {
  if (chrome.runtime.lastError) { scheduleTick(); return; }
  if (data.pomodoroState)    _state    = data.pomodoroState;
  if (data.pomodoroSettings) _settings = data.pomodoroSettings;
  scheduleTick();
});

// ── 설정 헬퍼 ──
function getUISettings() {
  return {
    workMins: parseInt(document.getElementById('workVal').value)   || _settings.workMins,
    restMins: parseInt(document.getElementById('restVal').value)   || _settings.restMins,
    cycles:   parseInt(document.getElementById('cyclesVal').value) || _settings.cycles,
  };
}

function applySettings(s, previewPhase) {
  _settings = s;
  chrome.storage.local.set({ pomodoroSettings: s });
  if (previewPhase && !_state.active) {
    var secs = previewPhase === 'work' ? s.workMins * 60 : s.restMins * 60;
    showPreview(previewPhase, secs, s.cycles);
  } else {
    render();
  }
}

// ── 연속 입력 (가속) ──
function makeRepeatBtn(id, action) {
  var btn = document.getElementById(id);
  if (!btn) return;
  var timer = null;
  var stop = function() { if (timer) { clearTimeout(timer); timer = null; } };
  var schedule = function(delay) {
    timer = setTimeout(function() { action(); schedule(Math.max(80, Math.floor(delay * 0.65))); }, delay);
  };
  btn.addEventListener('mousedown', function(e) { e.preventDefault(); action(); schedule(400); });
  btn.addEventListener('mouseup', stop);
  btn.addEventListener('mouseleave', stop);
}

// ── 시작 / 일시정지 ──
document.getElementById('startBtn').addEventListener('click', function() {
  chrome.storage.local.get(['pomodoroState', 'pomodoroSettings'], function(data) {
    var state    = data.pomodoroState    || { active: false, phase: 'idle' };
    var settings = data.pomodoroSettings || _settings;
    if (state.active) {
      var rem = Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000));
      chrome.storage.local.set({ pomodoroState: Object.assign({}, state, { active: false, endTime: null, pausedRemaining: rem }) });
    } else if (state.phase === 'idle' || state.phase === 'done') {
      var s = getUISettings();
      chrome.storage.local.set({
        pomodoroSettings: s,
        pomodoroState: { active: true, phase: 'work', endTime: Date.now() + s.workMins * 60 * 1000, cycle: 1, totalCycles: s.cycles },
      });
    } else {
      var rem2 = (state.pausedRemaining != null) ? state.pausedRemaining
        : (state.phase === 'work' ? settings.workMins * 60 : settings.restMins * 60);
      chrome.storage.local.set({ pomodoroState: Object.assign({}, state, { active: true, endTime: Date.now() + rem2 * 1000, pausedRemaining: null }) });
    }
  });
});

// ── 중지 ──
document.getElementById('stopBtn').addEventListener('click', function() {
  chrome.storage.local.get(['pomodoroSettings'], function(d) {
    var s = d.pomodoroSettings || _settings;
    chrome.storage.local.set({ pomodoroState: { active: false, phase: 'idle', endTime: null, cycle: 1, totalCycles: s.cycles } });
  });
});

// ── 작업 +/- ──
makeRepeatBtn('workDecr', function() { var s = getUISettings(); if (s.workMins <= 1)  return; s.workMins--; applySettings(s, 'work'); });
makeRepeatBtn('workIncr', function() { var s = getUISettings(); if (s.workMins >= 60) return; s.workMins++; applySettings(s, 'work'); });

// ── 휴식 +/- ──
makeRepeatBtn('restDecr', function() { var s = getUISettings(); if (s.restMins <= 1)  return; s.restMins--; applySettings(s, 'rest'); });
makeRepeatBtn('restIncr', function() { var s = getUISettings(); if (s.restMins >= 60) return; s.restMins++; applySettings(s, 'rest'); });

// ── 반복 +/- ──
makeRepeatBtn('cyclesDecr', function() { var s = getUISettings(); if (s.cycles <= 1)  return; s.cycles--; applySettings(s, null); });
makeRepeatBtn('cyclesIncr', function() { var s = getUISettings(); if (s.cycles >= 10) return; s.cycles++; applySettings(s, null); });

// ── 직접 입력 ──
[
  { id: 'workVal',   key: 'workMins', min: 1, max: 60, preview: 'work' },
  { id: 'restVal',   key: 'restMins', min: 1, max: 60, preview: 'rest' },
  { id: 'cyclesVal', key: 'cycles',   min: 1, max: 10, preview: null   },
].forEach(function(cfg) {
  var el = document.getElementById(cfg.id);
  if (!el) return;
  // 입력 중 최대값 초과 시 즉시 클램핑 (저장은 change에서만)
  el.addEventListener('input', function() {
    var v = parseInt(this.value);
    if (!isNaN(v) && v > cfg.max) this.value = cfg.max;
  });
  el.addEventListener('change', function() {
    var val = Math.max(cfg.min, Math.min(cfg.max, parseInt(this.value) || cfg.min));
    this.value = val;
    var s = getUISettings();
    s[cfg.key] = val;
    applySettings(s, cfg.preview);
  });
});

scheduleTick();
