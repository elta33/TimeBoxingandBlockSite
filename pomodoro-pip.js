function pad(n) { return String(n).padStart(2, '0'); }
function fmt(s) { return pad(Math.floor(s / 60)) + ':' + pad(s % 60); }

var _state         = { active: false, phase: 'idle' };
var _settings      = { workMins: 25, restMins: 5, cycles: 2 };
var _overrides     = [];
var _timer         = null;
var _previewActive = false;
var _previewTimer  = null;

function _advCycleLabel(n) { return n + T('pomoAdvancedCycleSuffix'); }
function _findCycleOverride(cycleNum, overrides) {
  for (var i = 0; i < overrides.length; i++) { if (overrides[i].cycle === cycleNum) return overrides[i]; }
  return null;
}
function _advEffectiveName(item) {
  return (item.name || '').trim() || _advCycleLabel(item.cycle);
}
function _resolveCycleWork(cycleNum, settings, overrides) {
  var found = _findCycleOverride(cycleNum, overrides);
  return found ? found.workMins : settings.workMins;
}

// ── 상단 탭 고정(Document PiP) 상태 ──
// 승격되면 실제 콘텐츠가 documentPictureInPicture 창의 document로 옮겨가므로,
// 이후 모든 DOM 조회/타이머는 _activeDoc·_activeWin을 통해서 해야 한다.
var AOT_SUPPORTED   = 'documentPictureInPicture' in window;
var _activeDoc      = document;
var _activeWin      = window;
var _realPipWindow  = null;
var _closingIntent  = null; // 'toggleOff' — 토글로 껐는지, 그냥 닫았는지 pagehide에서 구분
var _everPromoted   = false; // 이 창이 실제 PiP로 승격된 적이 있는지 (위치 기록 충돌 방지용)

// pin 없이 이 창(popup) 자체가 그냥 닫히는 경우에도 마지막 위치를 기억해둔다.
// (승격된 적이 있으면 _onRealPipClosed 쪽이 더 정확한 위치를 이미 기록하므로 건너뛴다.)
window.addEventListener('pagehide', function() {
  if (_everPromoted) return;
  try { chrome.storage.local.set({ pomodoroPipPos: { left: window.screenX, top: window.screenY } }); } catch (e) {}
});

// ── 렌더 ──
function render() {
  var startBtn = _activeDoc.getElementById('startBtn');
  var isActive = !!_state.active;

  // 버튼 / 입력 상태는 preview 중에도 항상 갱신
  if (startBtn) {
    startBtn.disabled = _state.phase === 'done';
    startBtn.textContent = isActive ? T('pomoPause')
      : (_state.phase === 'work' || _state.phase === 'rest') ? T('pomoResume')
      : T('pomoStart');
  }
  ['workDecr','workIncr','restDecr','restIncr','cyclesDecr','cyclesIncr'].forEach(function(id) {
    var el = _activeDoc.getElementById(id); if (el) el.disabled = isActive;
  });
  var wEl = _activeDoc.getElementById('workVal');
  var rEl = _activeDoc.getElementById('restVal');
  var cEl = _activeDoc.getElementById('cyclesVal');
  if (wEl && _activeDoc.activeElement !== wEl) { wEl.value = _settings.workMins; wEl.disabled = isActive; }
  if (rEl && _activeDoc.activeElement !== rEl) { rEl.value = _settings.restMins; rEl.disabled = isActive; }
  if (cEl && _activeDoc.activeElement !== cEl) { cEl.value = _settings.cycles;   cEl.disabled = isActive; }

  if (_previewActive) return; // 디스플레이는 preview가 담당

  // 디스플레이 갱신
  var phaseEl  = _activeDoc.getElementById('phase-label');
  var timeEl   = _activeDoc.getElementById('time-display');
  var cycleEl  = _activeDoc.getElementById('cycle-label');
  var badgeEl  = _activeDoc.getElementById('custom-badge');
  if (!phaseEl || !timeEl || !cycleEl) return;

  var s = _state, g = _settings;
  _activeDoc.body.className = (s.phase && s.phase !== 'idle') ? 'phase-' + s.phase : '';

  var effectiveCycle = (s.phase && s.phase !== 'idle') ? (s.cycle || 1) : 1;
  var ov = _findCycleOverride(effectiveCycle, _overrides);

  var phaseNames = { work: T('pomoWork'), rest: T('pomoRest'), done: T('pomoDone'), idle: T('pomoIdle') };
  var phaseText = phaseNames[s.phase] || T('pomoIdle');
  if ((s.phase === 'work' || s.phase === 'rest') && ov) {
    phaseText = _advEffectiveName(ov) + ' · ' + phaseText;
  }
  phaseEl.textContent = phaseText;

  if (isActive && s.endTime) {
    var rem = Math.max(0, Math.ceil((s.endTime - Date.now()) / 1000));
    timeEl.textContent = fmt(rem);
  } else if (s.pausedRemaining != null) {
    timeEl.textContent = fmt(s.pausedRemaining);
  } else if (s.phase === 'done') {
    timeEl.textContent = '00:00';
  } else {
    timeEl.textContent = fmt(_resolveCycleWork(1, g, _overrides) * 60);
  }

  var total = s.totalCycles || g.cycles;
  var cur   = s.cycle || 1;
  cycleEl.textContent = (s.phase && s.phase !== 'idle')
    ? (cur + ' / ' + total) : ('1 / ' + total);

  if (badgeEl) {
    var differs = ov && (ov.workMins !== g.workMins || ov.restMins !== g.restMins);
    badgeEl.style.display = (s.phase !== 'done' && differs) ? '' : 'none';
  }
}

// ── Preview 피드백 ──
function showPreview(previewPhase, secs, cycles) {
  _previewActive = true;
  _activeWin.clearTimeout(_previewTimer);

  _activeDoc.body.className = 'preview-' + previewPhase;
  var phaseEl = _activeDoc.getElementById('phase-label');
  var timeEl  = _activeDoc.getElementById('time-display');
  var cycleEl = _activeDoc.getElementById('cycle-label');
  if (phaseEl) phaseEl.textContent = previewPhase === 'work' ? T('pomoWork') : T('pomoRest');
  if (timeEl)  timeEl.textContent  = fmt(secs);
  if (cycleEl) cycleEl.textContent = '1 / ' + cycles;

  _previewTimer = _activeWin.setTimeout(function() {
    _previewActive = false;
    scheduleTick(); // 실제 상태 복원
  }, 1500);
}

// ── endTime 기준 초 경계 정렬 tick ──
function scheduleTick() {
  _activeWin.clearTimeout(_timer);
  render();
  var delay = 1000;
  if (_state.active && _state.endTime) {
    var rem = _state.endTime - Date.now();
    if (rem > 0) delay = (rem % 1000) || 1000;
  }
  _timer = _activeWin.setTimeout(scheduleTick, delay);
}

// ── 스토리지 동기화 ──
chrome.storage.onChanged.addListener(function(changes) {
  if (changes.pomodoroState)         _state     = changes.pomodoroState.newValue         || _state;
  if (changes.pomodoroSettings)      _settings  = changes.pomodoroSettings.newValue      || _settings;
  if (changes.pomodoroCycleOverrides) _overrides = changes.pomodoroCycleOverrides.newValue || [];
  scheduleTick();
});

chrome.storage.local.get(['pomodoroState', 'pomodoroSettings', 'pomodoroCycleOverrides'], function(data) {
  if (chrome.runtime.lastError) { scheduleTick(); return; }
  if (data.pomodoroState)    _state     = data.pomodoroState;
  if (data.pomodoroSettings) _settings  = data.pomodoroSettings;
  _overrides = data.pomodoroCycleOverrides || [];
  scheduleTick();
});

// ── 설정 헬퍼 ──
function getUISettings() {
  return {
    workMins: parseInt(_activeDoc.getElementById('workVal').value)   || _settings.workMins,
    restMins: parseInt(_activeDoc.getElementById('restVal').value)   || _settings.restMins,
    cycles:   parseInt(_activeDoc.getElementById('cyclesVal').value) || _settings.cycles,
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
  var btn = _activeDoc.getElementById(id);
  if (!btn) return;
  var timer = null;
  var stop = function() { if (timer) { _activeWin.clearTimeout(timer); timer = null; } };
  var schedule = function(delay) {
    timer = _activeWin.setTimeout(function() { action(); schedule(Math.max(80, Math.floor(delay * 0.65))); }, delay);
  };
  btn.addEventListener('mousedown', function(e) { e.preventDefault(); action(); schedule(400); });
  btn.addEventListener('mouseup', stop);
  btn.addEventListener('mouseleave', stop);
}

// ── 시작 / 일시정지 ──
_activeDoc.getElementById('startBtn').addEventListener('click', function() {
  chrome.storage.local.get(['pomodoroState', 'pomodoroSettings', 'pomodoroCycleOverrides'], function(data) {
    var state     = data.pomodoroState    || { active: false, phase: 'idle' };
    var settings  = data.pomodoroSettings || _settings;
    var overrides = data.pomodoroCycleOverrides || [];
    if (state.active) {
      var rem = Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000));
      chrome.storage.local.set({ pomodoroState: Object.assign({}, state, { active: false, endTime: null, pausedRemaining: rem }) });
    } else if (state.phase === 'idle' || state.phase === 'done') {
      var s = getUISettings();
      chrome.storage.local.set({
        pomodoroSettings: s,
        pomodoroState: { active: true, phase: 'work', endTime: Date.now() + _resolveCycleWork(1, s, overrides) * 60 * 1000, cycle: 1, totalCycles: s.cycles },
      });
    } else {
      var ovCur = _findCycleOverride(state.cycle || 1, overrides);
      var curWork = ovCur ? ovCur.workMins : settings.workMins;
      var curRest = ovCur ? ovCur.restMins : settings.restMins;
      var rem2 = (state.pausedRemaining != null) ? state.pausedRemaining
        : (state.phase === 'work' ? curWork * 60 : curRest * 60);
      chrome.storage.local.set({ pomodoroState: Object.assign({}, state, { active: true, endTime: Date.now() + rem2 * 1000, pausedRemaining: null }) });
    }
  });
});

// ── 중지 ──
_activeDoc.getElementById('stopBtn').addEventListener('click', function() {
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
  var el = _activeDoc.getElementById(cfg.id);
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

// ── 상단 탭 고정: 이 창을 실제 always-on-top Document PiP 창으로 승격 ──
var aotToggle = _activeDoc.getElementById('aotToggle');
if (aotToggle) {
  aotToggle.disabled = !AOT_SUPPORTED;
  aotToggle.addEventListener('change', function() {
    if (aotToggle.checked) {
      _promoteToRealPip();
    } else if (_realPipWindow) {
      _closingIntent = 'toggleOff'; // 그냥 닫는 것과 구분 — html로 넘어가야 함
      _realPipWindow.close();
    }
  });
}

// 이 문서가 popup 창으로 로드된 경우(토글을 직접 눌러 스스로를 승격시키는 경로)
// Document PiP 창은 moveTo()로 스폰 위치를 지정할 수 없다(크롬이 자체적으로 배치한다) —
// 시도했지만 어떤 좌표를 넘겨도 반영되지 않아 포기했다. 위치 지정 없이 콘텐츠만 옮긴다.
function _promoteToRealPip() {
  chrome.windows.getCurrent(function(hostWin) {
    documentPictureInPicture.requestWindow({ width: 280, height: 340 }).then(function(pipWindow) {
      _adoptRealPipWindow(pipWindow, hostWin.id);
      chrome.windows.update(hostWin.id, { state: 'minimized' }); // 콘텐츠 이동 후에 치운다
    }).catch(function() {
      aotToggle.checked = false;
    });
  });
}

// 이미 만들어진 pipWindow에 이 문서의 콘텐츠를 옮겨 담는다.
// self-promote 경로와, 옵션 페이지가 미리 requestWindow()까지 마친 뒤 넘겨주는 경로 양쪽에서 재사용.
function _adoptRealPipWindow(pipWindow, hostWindowId) {
  _everPromoted = true;
  document.querySelectorAll('style').forEach(function(styleEl) {
    pipWindow.document.head.appendChild(styleEl.cloneNode(true));
  });

  var root = document.getElementById('pomoPipRoot');
  pipWindow.document.body.appendChild(root); // 노드 이동 — 리스너는 그대로 유지됨

  _activeDoc = pipWindow.document;
  _activeWin = pipWindow;
  _realPipWindow = pipWindow;
  var t = _activeDoc.getElementById('aotToggle');
  if (t) t.checked = true;

  pipWindow.addEventListener('pagehide', function() {
    var lastX = pipWindow.screenX, lastY = pipWindow.screenY;
    var wantsHtml = _closingIntent === 'toggleOff';
    _closingIntent = null;

    document.body.appendChild(root); // 콘텐츠를 원래 문서로 복귀 — html로 돌아갈 때 내용이 비어있지 않도록
    _activeDoc = document;
    _activeWin = window;
    _realPipWindow = null;
    scheduleTick();

    _onRealPipClosed(lastX, lastY, wantsHtml, hostWindowId);
  }, { once: true });

  scheduleTick();
}

// ── 실제 PiP 창이 닫힐 때 ──
// 토글로 껐다면(wantsHtml) html로 넘어가고, 그냥 닫았다면(X 버튼 등) 아무것도 열지 않고 끝낸다.
function _onRealPipClosed(lastX, lastY, wantsHtml, hostWindowId) {
  if (typeof lastX === 'number' && typeof lastY === 'number') {
    chrome.storage.local.set({ pomodoroPipPos: { left: lastX, top: lastY } });
  }
  if (wantsHtml) {
    // pomodoroDefaultAlwaysOnTop(옵션 페이지 체크박스)은 건드리지 않는다 — 이건 이번 세션의
    // pin만 해제하는 것이지 "기본값"을 바꾸는 게 아니다.
    if (hostWindowId != null) {
      // state 복귀와 위치 이동을 한 번에 묶으면 최소화 해제 시 위치가 무시되는 경우가 있어 분리한다.
      chrome.windows.update(hostWindowId, { state: 'normal', focused: true }, function() {
        chrome.windows.update(hostWindowId, { left: lastX, top: lastY });
      });
    } else {
      var pipUrl = chrome.runtime.getURL('pomodoro-pip.html');
      chrome.windows.create({ url: pipUrl, type: 'popup', width: 280, height: 340, left: lastX, top: lastY }, function(win) {
        chrome.storage.local.set({ pipWindowId: win.id });
      });
    }
  } else if (hostWindowId != null) {
    chrome.windows.remove(hostWindowId); // 최소화돼 있던 원본 팝업까지 완전히 닫는다
  }
  // 옵션 페이지의 숨겨진 iframe에서 이어받은 경우, 모든 정리가 끝난 뒤에야 스스로를 제거한다
  // (미리 제거하면 이 콜백이 실행 중인 realm 자체가 사라질 위험이 있다).
  if (window.frameElement) { window.frameElement.remove(); }
}

// 옵션 페이지가 iframe으로 이 스크립트를 새로 로드시킨 뒤, requestWindow()로 만든 pipWindow를 넘겨줄 때 호출한다.
window._adoptRealPipWindow = _adoptRealPipWindow;

scheduleTick();
