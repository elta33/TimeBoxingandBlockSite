// options-pomodoro.js
// 포모도로 타이머 탭: 타이머 표시/틱, 프리셋 저장·적용, 사이클별 고급 설정(예외 규칙), 포모도로 전용 차단 목록
// 사이클 시간 계산(_resolveCycleTimes/_findCycleOverride/_cycleOverrideDiffs)은 pomodoro-shared.js 공용 — 이 파일에서 재정의하지 말 것
let _pomoInterval      = null;
let _pomoPreviewActive = false;
let _pomoPreviewTimer  = null;

function _fmtPomoTime(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

// 누르고 있으면 연속 입력되는 스테퍼 버튼 헬퍼 (정적/동적 요소 공용)
function _makeRepeatBtnEl(btn, action) {
  if (!btn) return;
  let timer = null;
  const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const schedule = (delay) => {
    timer = setTimeout(() => {
      action();
      schedule(Math.max(80, Math.floor(delay * 0.65)));
    }, delay);
  };
  btn.addEventListener('mousedown', e => { e.preventDefault(); action(); schedule(400); });
  btn.addEventListener('mouseup', stop);
  btn.addEventListener('mouseleave', stop);
}

function _createAdjustIcon(cls) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (cls) svg.setAttribute('class', cls);
  [[4, 6, 20, 6], [4, 12, 20, 12], [4, 18, 20, 18]].forEach(([x1, y1, x2, y2]) => {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    svg.appendChild(line);
  });
  [[8, 6], [16, 12], [10, 18]].forEach(([cx, cy]) => {
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', 2);
    svg.appendChild(c);
  });
  return svg;
}

function _updateAdvancedFeedback(settings, overrides) {
  const diffs   = _cycleOverrideDiffs(settings, overrides);
  const btn     = document.getElementById('pomoAdvancedBtn');
  const summary = document.getElementById('pomoAdvancedSummary');
  if (btn) {
    btn.textContent = diffs.length ? `${T('pomoAdvancedBtn')} · ${diffs.length}` : T('pomoAdvancedBtn');
    btn.classList.toggle('pomo-advanced-btn-active', diffs.length > 0);
  }
  if (summary) {
    if (diffs.length) {
      const cycles = diffs.map(d => d.cycle).sort((a, b) => a - b);
      summary.textContent = cycles.length <= 3
        ? `${cycles.join(', ')}${T('pomoAdvancedDiffLineSuffix')}`
        : `${cycles.length}${T('pomoAdvancedDiffCountSuffix')}`;
      summary.style.display = '';
    } else {
      summary.style.display = 'none';
    }
  }
}

function renderPomoList(list) {
  const ul = document.getElementById('pomoList');
  if (!ul) return;
  ul.innerHTML = '';
  list.forEach((domain, i) => {
    const li   = document.createElement('li');
    li.className = 'custom-domain-item';
    const span = document.createElement('span');
    span.textContent = domain; span.title = domain; span.className = 'domain-text';
    const del = _makeTrashButton(T('delete'), () => {
      TBBStorage.get(['pomodoroList'], r => {
        const arr = r.pomodoroList || [];
        arr.splice(i, 1);
        TBBStorage.set({ pomodoroList: arr }, loadPomoData);
      });
    });
    li.append(span, del);
    ul.appendChild(li);
  });
  _applyDomainFilter('pomoList');
}

const POMO_PRESET_PAGE_SIZE = 4;
let _pomoPresetPage = 0;
let _pomoPresetsCache = [];
let _pomoPresetEditing = false;

function _applyPomoPreset(preset) {
  _savePomoSettings({ workMins: preset.workMins, restMins: preset.restMins, cycles: preset.cycles }, null);
  TBBStorage.set({ pomodoroCycleOverrides: (preset.cycleOverrides || []).map(o => ({ ...o })) });
}

function renderPomoPresets(presets) {
  _pomoPresetsCache = presets;
  const ul        = document.getElementById('pomoPresetList');
  const empty     = document.getElementById('pomoPresetEmpty');
  const prevBtn   = document.getElementById('pomoPresetPrevBtn');
  const nextBtn   = document.getElementById('pomoPresetNextBtn');
  const indicator = document.getElementById('pomoPresetPageIndicator');
  if (!ul) return;

  const totalPages = Math.max(1, Math.ceil(presets.length / POMO_PRESET_PAGE_SIZE));
  _pomoPresetPage = Math.min(Math.max(_pomoPresetPage, 0), totalPages - 1);

  const hasItems = presets.length > 0;
  empty.style.display = hasItems ? 'none' : '';
  if (indicator) { indicator.style.display = hasItems ? '' : 'none'; indicator.textContent = `${_pomoPresetPage + 1} / ${totalPages}`; }
  if (prevBtn) { prevBtn.style.visibility = hasItems ? 'visible' : 'hidden'; prevBtn.disabled = _pomoPresetPage <= 0; }
  if (nextBtn) { nextBtn.style.visibility = hasItems ? 'visible' : 'hidden'; nextBtn.disabled = _pomoPresetPage >= totalPages - 1; }

  ul.classList.toggle('editing', _pomoPresetEditing);
  ul.innerHTML = '';
  const start = _pomoPresetPage * POMO_PRESET_PAGE_SIZE;
  presets.slice(start, start + POMO_PRESET_PAGE_SIZE).forEach((preset, idx) => {
    const i  = start + idx;
    const li = document.createElement('li');
    li.className = 'pomo-preset-item';
    li.onclick = () => _applyPomoPreset(preset);

    const delX = _makeTrashButton(T('delete'), (e) => {
      e.stopPropagation();
      TBBStorage.get(['pomodoroPresets'], r => {
        const arr = r.pomodoroPresets || [];
        arr.splice(i, 1);
        TBBStorage.set({ pomodoroPresets: arr }, loadPomoData);
      });
    }, 'pomo-preset-del-x');

    const name = document.createElement('span');
    name.className = 'pomo-preset-name';
    name.textContent = preset.name;
    name.title = preset.name;

    const diffs = _cycleOverrideDiffs({ workMins: preset.workMins, restMins: preset.restMins }, preset.cycleOverrides);

    const metaRow = document.createElement('div');
    metaRow.className = 'pomo-preset-meta-row';
    const meta = document.createElement('span');
    meta.className = 'pomo-preset-meta';
    meta.textContent = `${preset.workMins}/${preset.restMins} · ${preset.cycles}${T('pomoTimes')}`;
    metaRow.appendChild(meta);
    if (diffs.length) metaRow.appendChild(_createAdjustIcon('pomo-preset-override-icon'));

    li.append(delX, name, metaRow);
    if (diffs.length) {
      const summary = document.createElement('span');
      summary.className = 'pomo-preset-override-summary';
      summary.textContent = `${diffs.length}${T('pomoAdvancedDiffCountSuffix')}`;
      li.appendChild(summary);
    }
    ul.appendChild(li);
  });
}

// ═══════════════════════════════════════════════
// 고급 설정 (회차별 작업/휴식 시간 예외)
// ═══════════════════════════════════════════════

let _advDraftSettings  = { workMins: 25, restMins: 5, cycles: 2 };
let _advDraftOverrides = []; // [{ cycle, name, workMins, restMins }]

function _advCycleLabel(n) {
  return `${n}${T('pomoAdvancedCycleSuffix')}`;
}

function _renderAdvancedBaseText() {
  const el = document.getElementById('pomoAdvancedBaseText');
  if (!el) return;
  const s = _advDraftSettings;
  el.textContent = `${T('pomoAdvancedBaseLabel')}: ${s.workMins}${T('pomoMin')} / ${s.restMins}${T('pomoMin')} · ${s.cycles}${T('pomoTimes')}`;
}

function _renderCyclePicker() {
  const grid   = document.getElementById('pomoCyclePickerGrid');
  const addBtn = document.getElementById('pomoAdvancedAddBtn');
  if (!grid) return;
  const used = new Set(_advDraftOverrides.map(o => o.cycle));
  grid.innerHTML = '';
  let available = 0;
  for (let n = 1; n <= _advDraftSettings.cycles; n++) {
    if (used.has(n)) continue;
    available++;
    const btn = document.createElement('button');
    btn.className = 'pomo-cycle-picker-item';
    btn.textContent = _advCycleLabel(n);
    btn.onclick = () => {
      _advDraftOverrides.push({ cycle: n, name: '', workMins: _advDraftSettings.workMins, restMins: _advDraftSettings.restMins });
      document.getElementById('pomoCyclePicker')?.classList.remove('open');
      _renderAdvancedList();
      _renderCyclePicker();
    };
    grid.appendChild(btn);
  }
  if (available === 0) {
    const p = document.createElement('p');
    p.className = 'pomo-cycle-picker-empty';
    p.textContent = T('pomoAdvancedPickerEmpty');
    grid.appendChild(p);
  }
  if (addBtn) addBtn.disabled = available === 0;
}

function _advEffectiveName(item) {
  return (item.name || '').trim() || _advCycleLabel(item.cycle);
}

function _buildAdvItemRow(labelText, item, key, min, max) {
  const row = document.createElement('div');
  row.className = 'pomo-advanced-item-fields';

  const label = document.createElement('span');
  label.className = 'pomo-advanced-item-label';
  label.textContent = labelText;

  const numWrap = document.createElement('div');
  numWrap.className = 'pomo-num-input';
  const decrBtn = document.createElement('button');
  decrBtn.type = 'button'; decrBtn.className = 'pomo-num-btn'; decrBtn.textContent = '−';
  const valInput = document.createElement('input');
  valInput.type = 'number'; valInput.className = 'pomo-num-val'; valInput.value = item[key];
  const incrBtn = document.createElement('button');
  incrBtn.type = 'button'; incrBtn.className = 'pomo-num-btn'; incrBtn.textContent = '+';
  numWrap.append(decrBtn, valInput, incrBtn);

  const unit = document.createElement('span');
  unit.className = 'pomo-advanced-item-unit';
  unit.textContent = T('pomoMin');

  const commit = v => {
    v = Math.max(min, Math.min(max, v));
    item[key] = v;
    valInput.value = v;
  };
  _makeRepeatBtnEl(decrBtn, () => { if (item[key] > min) commit(item[key] - 1); });
  _makeRepeatBtnEl(incrBtn, () => { if (item[key] < max) commit(item[key] + 1); });
  valInput.addEventListener('input', () => {
    const v = parseInt(valInput.value);
    if (!isNaN(v) && v > max) valInput.value = max;
  });
  valInput.addEventListener('change', () => {
    let v = parseInt(valInput.value);
    if (isNaN(v)) v = item[key];
    commit(v);
  });

  row.append(label, numWrap, unit);
  return row;
}

function _renderAdvancedList() {
  const ul    = document.getElementById('pomoAdvancedList');
  const empty = document.getElementById('pomoAdvancedEmpty');
  if (!ul) return;
  ul.innerHTML = '';
  _advDraftOverrides.sort((a, b) => a.cycle - b.cycle);
  empty.style.display = _advDraftOverrides.length ? 'none' : '';

  _advDraftOverrides.forEach(item => {
    const li = document.createElement('li');
    li.className = 'pomo-advanced-item';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'pomo-advanced-name-input';
    nameInput.maxLength = 30;
    nameInput.value = item.name || '';
    nameInput.placeholder = `${T('pomoAdvancedNameLabel')}/${T('pomoAdvancedBaseLabel')}: ${_advCycleLabel(item.cycle)}`;

    const cycleTag = document.createElement('span');
    cycleTag.className = 'pomo-advanced-item-cycletag';
    cycleTag.textContent = _advCycleLabel(item.cycle);
    cycleTag.style.display = (item.name || '').trim() ? '' : 'none';

    nameInput.addEventListener('input', () => {
      item.name = nameInput.value;
      cycleTag.style.display = (item.name || '').trim() ? '' : 'none';
    });

    const workFields = _buildAdvItemRow(T('pomoAdvancedWorkLabel'), item, 'workMins', 1, 60);
    const restFields = _buildAdvItemRow(T('pomoAdvancedRestLabel'), item, 'restMins', 1, 60);

    const delBtn = document.createElement('button');
    delBtn.className = 'pomo-advanced-item-del';
    delBtn.textContent = '×';
    delBtn.title = T('delete');
    delBtn.onclick = () => {
      _advDraftOverrides = _advDraftOverrides.filter(o => o !== item);
      _renderAdvancedList();
      _renderCyclePicker();
    };

    li.append(nameInput, cycleTag, workFields, restFields, delBtn);
    ul.appendChild(li);
  });
}

const ADV_BASE_INPUT_IDS = { workMins: 'advWorkVal', restMins: 'advRestVal', cycles: 'advCyclesVal' };

function _advSetBase(key, newVal) {
  const oldVal = _advDraftSettings[key];
  _advDraftSettings[key] = newVal;
  const el = document.getElementById(ADV_BASE_INPUT_IDS[key]);
  if (el) el.value = newVal;
  if (key === 'workMins' || key === 'restMins') {
    _advDraftOverrides.forEach(o => { if (o[key] === oldVal) o[key] = newVal; });
  }
  if (key === 'cycles') {
    _advDraftOverrides = _advDraftOverrides.filter(o => o.cycle <= newVal);
  }
  _renderAdvancedBaseText();
  _renderAdvancedList();
  _renderCyclePicker();
}

function _openAdvancedModal() {
  TBBStorage.get(['pomodoroSettings', 'pomodoroCycleOverrides'], data => {
    const settings = data.pomodoroSettings || { workMins: 25, restMins: 5, cycles: 2 };
    _advDraftSettings  = { workMins: settings.workMins, restMins: settings.restMins, cycles: settings.cycles };
    _advDraftOverrides = (data.pomodoroCycleOverrides || []).map(o => ({
      ...o,
      name: o.name === _advCycleLabel(o.cycle) ? '' : o.name,
    }));

    const wEl = document.getElementById('advWorkVal');
    const rEl = document.getElementById('advRestVal');
    const cEl = document.getElementById('advCyclesVal');
    if (wEl) wEl.value = _advDraftSettings.workMins;
    if (rEl) rEl.value = _advDraftSettings.restMins;
    if (cEl) cEl.value = _advDraftSettings.cycles;

    _renderAdvancedBaseText();
    _renderAdvancedList();
    _renderCyclePicker();

    const overlay = document.getElementById('pomoAdvancedOverlay');
    if (overlay) overlay.style.display = 'flex';
  });
}

function _closeAdvancedModal() {
  const overlay = document.getElementById('pomoAdvancedOverlay');
  if (overlay) overlay.style.display = 'none';
  document.getElementById('pomoCyclePicker')?.classList.remove('open');
  document.getElementById('pomoAdvSavePopover')?.classList.remove('open');
}

function updatePomoDisplay(state, settings, overrides) {
  if (_pomoPreviewActive) return;
  const display    = document.getElementById('pomoDisplay');
  const phaseEl    = document.getElementById('pomoPhaseLabel');
  const timeEl     = document.getElementById('pomoTimeLabel');
  const cycleEl    = document.getElementById('pomoCycleLabel');
  const startBtn   = document.getElementById('pomoStartBtn');
  const customBadge = document.getElementById('pomoCustomBadge');
  if (!display) return;

  const phase       = state?.phase || 'idle';
  const totalCycles = state?.totalCycles || settings.cycles;
  const cycle       = state?.cycle       || 1;
  const isActive    = !!state?.active;
  const effectiveCycle = phase === 'idle' ? 1 : cycle;
  const ov = _findCycleOverride(effectiveCycle, overrides);

  display.className = 'pomo-display' + (phase !== 'idle' ? ' phase-' + phase : '');

  const phaseNames = { work: T('pomoWork'), rest: T('pomoRest'), done: T('pomoDone'), idle: T('pomoIdle') };
  let phaseText = phaseNames[phase] || T('pomoIdle');
  if ((phase === 'work' || phase === 'rest') && ov) {
    phaseText = `${_advEffectiveName(ov)} · ${phaseText}`;
  }
  if (phaseEl) phaseEl.textContent = phaseText;

  if (timeEl) {
    if (isActive && state.endTime) {
      const rem = Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000));
      timeEl.textContent = _fmtPomoTime(rem);
    } else if (!isActive && state?.pausedRemaining != null) {
      timeEl.textContent = _fmtPomoTime(state.pausedRemaining);
    } else if (phase === 'done') {
      timeEl.textContent = '00:00';
    } else {
      const cur = _resolveCycleTimes(1, settings, overrides);
      timeEl.textContent = _fmtPomoTime(cur.workMins * 60);
    }
  }

  if (cycleEl) {
    cycleEl.textContent = phase === 'idle'
      ? `1 / ${settings.cycles}`
      : `${cycle} / ${totalCycles}`;
  }

  if (customBadge) {
    const differs = ov && (ov.workMins !== settings.workMins || ov.restMins !== settings.restMins);
    customBadge.style.display = (phase !== 'done' && differs) ? '' : 'none';
  }

  if (startBtn) {
    startBtn.disabled = phase === 'done';
    if (isActive)                              startBtn.textContent = T('pomoPause');
    else if (phase === 'work' || phase === 'rest') startBtn.textContent = T('pomoResume');
    else                                       startBtn.textContent = T('pomoStart');
  }

  const isDone   = phase === 'done';
  const resetBtn = document.getElementById('pomoResetBtn');
  const doneBtn  = document.getElementById('pomoDoneBtn');
  if (startBtn) startBtn.style.display = isDone ? 'none' : '';
  if (resetBtn) resetBtn.style.display = isDone ? 'none' : '';
  if (doneBtn)  doneBtn.style.display  = isDone ? '' : 'none';

  const settingsBtns = ['workDecrBtn','workIncrBtn','restDecrBtn','restIncrBtn','cyclesDecrBtn','cyclesIncrBtn','pomoWorkVal','pomoRestVal','pomoCyclesVal','pomoSavePresetBtn','pomoAdvancedBtn','pomoPresetEditBtn'];
  settingsBtns.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = isActive; });
  document.getElementById('pomoPresetList')?.classList.toggle('pomo-preset-list-disabled', isActive);
}

function _previewPomoDisplay(previewPhase, secs, cycles) {
  const display = document.getElementById('pomoDisplay');
  if (display) display.className = 'pomo-display phase-' + previewPhase;
  const phaseEl = document.getElementById('pomoPhaseLabel');
  if (phaseEl) phaseEl.textContent = previewPhase === 'work' ? T('pomoWork') : T('pomoRest');
  const timeEl = document.getElementById('pomoTimeLabel');
  if (timeEl) timeEl.textContent = _fmtPomoTime(secs);
  const cycleEl = document.getElementById('pomoCycleLabel');
  if (cycleEl) cycleEl.textContent = `1 / ${cycles}`;
}

function _advancePomoPhase(state, settings, overrides) {
  const now         = Date.now();
  const cycle       = state.cycle       || 1;
  const totalCycles = state.totalCycles || settings.cycles;
  let newState;

  if (state.phase === 'work') {
    const cur = _resolveCycleTimes(cycle, settings, overrides);
    newState = cycle >= totalCycles
      ? { active: false, phase: 'done', endTime: null, cycle, totalCycles, advancedAt: now }
      : { ...state, phase: 'rest', endTime: now + cur.restMins * 60 * 1000, advancedAt: now };
    _statsLogPomoSession(cur.workMins);
  } else if (state.phase === 'rest') {
    const next = _resolveCycleTimes(cycle + 1, settings, overrides);
    newState = { ...state, phase: 'work', endTime: now + next.workMins * 60 * 1000, cycle: cycle + 1, advancedAt: now };
  }

  if (newState) TBBStorage.set({ pomodoroState: newState });
}

function _pomoTick() {
  TBBStorage.get(['pomodoroState', 'pomodoroSettings', 'pomodoroCycleOverrides'], data => {
    const state     = data.pomodoroState    || { active: false, phase: 'idle' };
    const settings  = data.pomodoroSettings || { workMins: 25, restMins: 5, cycles: 2 };
    const overrides = data.pomodoroCycleOverrides || [];
    if (state.active && state.endTime && Date.now() >= state.endTime) {
      _advancePomoPhase(state, settings, overrides);
    } else {
      updatePomoDisplay(state, settings, overrides);
    }
    // endTime 기준 초 경계에 정렬해 다음 tick 예약 — setInterval 드리프트 방지
    let delay = 1000;
    if (state.active && state.endTime) {
      const rem = state.endTime - Date.now();
      if (rem > 0) delay = (rem % 1000) || 1000;
    }
    _pomoInterval = setTimeout(_pomoTick, delay);
  });
}

function loadPomoData() {
  TBBStorage.get(['pomodoroSettings', 'pomodoroList', 'pomodoroState', 'pomodoroPresets', 'pomodoroCycleOverrides'], data => {
    const settings  = data.pomodoroSettings || { workMins: 25, restMins: 5, cycles: 2 };
    const list      = data.pomodoroList     || [];
    const state     = data.pomodoroState    || { active: false, phase: 'idle' };
    const presets   = data.pomodoroPresets  || [];
    const overrides = data.pomodoroCycleOverrides || [];

    const wEl = document.getElementById('pomoWorkVal');
    const rEl = document.getElementById('pomoRestVal');
    const cEl = document.getElementById('pomoCyclesVal');
    if (wEl) wEl.value = settings.workMins;
    if (rEl) rEl.value = settings.restMins;
    if (cEl) cEl.value = settings.cycles;

    renderPomoList(list);
    renderPomoPresets(presets);
    updatePomoDisplay(state, settings, overrides);
    _updateAdvancedFeedback(settings, overrides);
  });
}

function _getPomoSettingsFromUI() {
  return {
    workMins: parseInt(document.getElementById('pomoWorkVal')?.value) || 25,
    restMins: parseInt(document.getElementById('pomoRestVal')?.value) || 5,
    cycles:   parseInt(document.getElementById('pomoCyclesVal')?.value) || 2,
  };
}

function _savePomoSettings(s, previewPhase) {
  TBBStorage.set({ pomodoroSettings: s });
  const wEl = document.getElementById('pomoWorkVal');
  const rEl = document.getElementById('pomoRestVal');
  const cEl = document.getElementById('pomoCyclesVal');
  if (wEl) wEl.value = s.workMins;
  if (rEl) rEl.value = s.restMins;
  if (cEl) cEl.value = s.cycles;

  if (previewPhase) {
    // onChanged → loadPomoData → updatePomoDisplay 연쇄가 preview를 덮어쓰지 못하도록 플래그 설정
    _pomoPreviewActive = true;
    clearTimeout(_pomoPreviewTimer);
    _pomoPreviewTimer = setTimeout(() => {
      _pomoPreviewActive = false;
      TBBStorage.get(['pomodoroState', 'pomodoroSettings', 'pomodoroCycleOverrides'], d => {
        updatePomoDisplay(d.pomodoroState || { active: false, phase: 'idle' }, d.pomodoroSettings || s, d.pomodoroCycleOverrides || []);
      });
    }, 1500);
    const secs = previewPhase === 'work' ? s.workMins * 60 : s.restMins * 60;
    _previewPomoDisplay(previewPhase, secs, s.cycles);
  } else {
    TBBStorage.get(['pomodoroState', 'pomodoroCycleOverrides'], d => {
      const state = d.pomodoroState || { active: false, phase: 'idle' };
      if (!state.active) updatePomoDisplay(state, s, d.pomodoroCycleOverrides || []);
    });
  }
}

function _importFromList(storageKey) {
  TBBStorage.get([storageKey, 'pomodoroList'], data => {
    const source  = data[storageKey]  || [];
    const current = data.pomodoroList || [];
    const curSet  = new Set(current);
    const toAdd   = source.filter(d => !curSet.has(d));
    if (!toAdd.length) { alert(T('noNewItems')); return; }
    TBBStorage.set({ pomodoroList: [...current, ...toAdd] }, loadPomoData);
  });
  document.getElementById('pomoImportMenu')?.classList.remove('open');
}

document.addEventListener('DOMContentLoaded', () => {

  // ── 반복 입력 헬퍼 (누르고 있으면 연속 입력) ──
  function _makeRepeatBtn(id, action) {
    _makeRepeatBtnEl(document.getElementById(id), action);
  }

  // ── 설정 +/- 버튼 ──
  [
    { decr: 'workDecrBtn',   incr: 'workIncrBtn',   key: 'workMins', min: 1, max: 60, preview: 'work' },
    { decr: 'restDecrBtn',   incr: 'restIncrBtn',   key: 'restMins', min: 1, max: 60, preview: 'rest' },
    { decr: 'cyclesDecrBtn', incr: 'cyclesIncrBtn', key: 'cycles',   min: 1, max: 10, preview: null   },
  ].forEach(({ decr, incr, key, min, max, preview }) => {
    _makeRepeatBtn(decr, () => {
      const s = _getPomoSettingsFromUI(); if (s[key] <= min) return;
      s[key]--; _savePomoSettings(s, preview);
    });
    _makeRepeatBtn(incr, () => {
      const s = _getPomoSettingsFromUI(); if (s[key] >= max) return;
      s[key]++; _savePomoSettings(s, preview);
    });
  });

  // ── 숫자 직접 입력 처리 ──
  [
    { id: 'pomoWorkVal',   key: 'workMins', min: 1, max: 60, fallback: 25, preview: 'work' },
    { id: 'pomoRestVal',   key: 'restMins', min: 1, max: 60, fallback: 5,  preview: 'rest' },
    { id: 'pomoCyclesVal', key: 'cycles',   min: 1, max: 10, fallback: 2,  preview: null   },
  ].forEach(({ id, key, min, max, fallback, preview }) => {
    const el = document.getElementById(id);
    if (!el) return;
    // 입력 중 최대값 초과 시 즉시 클램핑 (저장은 change에서만)
    el.addEventListener('input', () => {
      const v = parseInt(el.value);
      if (!isNaN(v) && v > max) el.value = max;
    });
    el.addEventListener('change', () => {
      let val = parseInt(el.value);
      if (isNaN(val)) val = fallback;
      val = Math.max(min, Math.min(max, val));
      el.value = val;
      const s = _getPomoSettingsFromUI();
      s[key] = val;
      _savePomoSettings(s, preview);
    });
  });

  // ── 시작 / 일시정지 / 재개 ──
  document.getElementById('pomoStartBtn')?.addEventListener('click', () => {
    TBBStorage.get(['pomodoroState', 'pomodoroSettings', 'pomodoroCycleOverrides'], data => {
      const state     = data.pomodoroState    || { active: false, phase: 'idle' };
      const settings  = data.pomodoroSettings || _getPomoSettingsFromUI();
      const overrides = data.pomodoroCycleOverrides || [];

      if (state.active) {
        const rem = Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000));
        TBBStorage.set({ pomodoroState: { ...state, active: false, endTime: null, pausedRemaining: rem } });
      } else if (state.phase === 'idle' || state.phase === 'done') {
        const s = _getPomoSettingsFromUI();
        const cur = _resolveCycleTimes(1, s, overrides);
        TBBStorage.set({
          pomodoroSettings: s,
          pomodoroState: { active: true, phase: 'work', endTime: Date.now() + cur.workMins * 60 * 1000, cycle: 1, totalCycles: s.cycles },
        });
      } else {
        const cur = _resolveCycleTimes(state.cycle || 1, settings, overrides);
        const rem = state.pausedRemaining ?? (state.phase === 'work' ? cur.workMins * 60 : cur.restMins * 60);
        TBBStorage.set({ pomodoroState: { ...state, active: true, endTime: Date.now() + rem * 1000, pausedRemaining: null } });
      }
    });
  });

  // ── 중지 / 완료 확인 ──
  function _resetPomoState() {
    TBBStorage.get(['pomodoroSettings'], d => {
      const s = d.pomodoroSettings || { workMins: 25, restMins: 5, cycles: 2 };
      TBBStorage.set({ pomodoroState: { active: false, phase: 'idle', endTime: null, cycle: 1, totalCycles: s.cycles } });
    });
  }
  document.getElementById('pomoResetBtn')?.addEventListener('click', _resetPomoState);
  document.getElementById('pomoDoneBtn')?.addEventListener('click', _resetPomoState);

  // ── 기본 상단 탭 고정 체크박스 ──
  // pomodoroDefaultAlwaysOnTop은 이 체크박스만 쓰고 바꾸는 영구 설정이다. popup 안 토글은
  // 그때그때의 세션(지금 열린 창을 pin할지)만 다루고, 이 기본값에는 관여하지 않는다 —
  // 그래야 "기본 켜짐" 상태에서 popup 쪽 토글을 껐다 닫아도 다음 PiP 클릭은 여전히 곧장 PiP로 간다.
  const defaultAotCheckbox = document.getElementById('pomoDefaultAlwaysOnTop');
  const aotCheckboxSupported = 'documentPictureInPicture' in window;
  if (defaultAotCheckbox) {
    defaultAotCheckbox.disabled = !aotCheckboxSupported;
    TBBStorage.get(['pomodoroDefaultAlwaysOnTop'], ({ pomodoroDefaultAlwaysOnTop }) => {
      defaultAotCheckbox.checked = aotCheckboxSupported && !!pomodoroDefaultAlwaysOnTop;
    });
    defaultAotCheckbox.addEventListener('change', () => {
      TBBStorage.set({ pomodoroDefaultAlwaysOnTop: defaultAotCheckbox.checked });
    });
  }

  // ── PiP 버튼 ──
  // pomodoroDefaultAlwaysOnTop이 켜져 있으면 html 팝업을 띄우지 않고 바로 실제 PiP로 진입한다.
  document.getElementById('pomoPipBtn')?.addEventListener('click', () => {
    const aotSupported = 'documentPictureInPicture' in window;
    TBBStorage.get(['pomodoroDefaultAlwaysOnTop'], ({ pomodoroDefaultAlwaysOnTop }) => {
      if (aotSupported && pomodoroDefaultAlwaysOnTop) {
        _createDirectPipWindow();
        return;
      }
      TBBStorage.get(['pipWindowId'], ({ pipWindowId }) => {
        if (pipWindowId) {
          chrome.windows.get(pipWindowId, win => {
            if (chrome.runtime.lastError || !win) {
              _createPipWindow();
            } else {
              chrome.windows.update(pipWindowId, { focused: true });
            }
          });
        } else {
          _createPipWindow();
        }
      });
    });
  });

  function _createPipWindow() {
    const pipUrl = chrome.runtime.getURL('pomodoro-pip.html');
    TBBStorage.get(['pomodoroPipPos'], ({ pomodoroPipPos }) => {
      const opts = { url: pipUrl, type: 'popup', width: 280, height: 340 };
      if (pomodoroPipPos) { opts.left = pomodoroPipPos.left; opts.top = pomodoroPipPos.top; }
      chrome.windows.create(opts, win => {
        TBBStorage.set({ pipWindowId: win.id });
      });
    });
  }

  // ── 옵션 페이지를 opener로 바로 실제 PiP(always-on-top) 창을 여는 경로 ──
  // 옵션 페이지 클릭에는 진짜 user activation이 있으므로 requestWindow()는 여기서 바로 호출한다.
  // 콘텐츠는 숨겨진 iframe으로 pomodoro-pip.html을 정상적으로 로드시킨 뒤,
  // 그 안에서 이미 살아 움직이는 DOM/로직을 pipWindow로 옮겨 재사용한다
  // (pip 문서에 <script>를 직접 주입하는 방식은 동작하지 않아 폐기했다).
  async function _createDirectPipWindow() {
    if (documentPictureInPicture.window) {
      documentPictureInPicture.window.focus();
      return;
    }
    let pipWindow;
    try {
      pipWindow = await documentPictureInPicture.requestWindow({ width: 280, height: 340 });
    } catch (e) {
      _createPipWindow();
      return;
    }

    // Document PiP 창은 moveTo()로 스폰 위치를 지정할 수 없어(크롬이 자체 배치) 위치 지정은 포기했다.

    // iframe은 pip 세션이 끝날 때(pomodoro-pip.js가 window.frameElement.remove()를 호출) 스스로 정리된다.
    // 여기서 바로 제거하면 그 안에서 동작 중인 realm이 통째로 사라질 수 있다.
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = chrome.runtime.getURL('pomodoro-pip.html');
    iframe.addEventListener('load', () => {
      iframe.contentWindow._adoptRealPipWindow(pipWindow, null);
    }, { once: true });
    document.body.appendChild(iframe);
  }

  // ── 프리셋 저장 팝오버 ──
  const presetSaveBtn  = document.getElementById('pomoSavePresetBtn');
  const presetPopover  = document.getElementById('pomoPresetPopover');
  const presetNameInput = document.getElementById('pomoPresetNameInput');

  presetSaveBtn?.addEventListener('click', e => {
    e.stopPropagation();
    presetPopover?.classList.toggle('open');
    if (presetPopover?.classList.contains('open')) presetNameInput?.focus();
  });

  function _confirmSavePreset() {
    const name = (presetNameInput?.value || '').trim();
    if (!name) { presetNameInput?.focus(); return; }
    const s = _getPomoSettingsFromUI();
    TBBStorage.get(['pomodoroPresets', 'pomodoroCycleOverrides'], d => {
      const arr = d.pomodoroPresets || [];
      arr.push({ name, workMins: s.workMins, restMins: s.restMins, cycles: s.cycles, cycleOverrides: (d.pomodoroCycleOverrides || []).map(o => ({ ...o })) });
      TBBStorage.set({ pomodoroPresets: arr }, () => {
        if (presetNameInput) presetNameInput.value = '';
        presetPopover?.classList.remove('open');
        _pomoPresetPage = Math.ceil(arr.length / POMO_PRESET_PAGE_SIZE) - 1;
        loadPomoData();
      });
    });
  }
  document.getElementById('pomoPresetConfirmBtn')?.addEventListener('click', _confirmSavePreset);
  presetNameInput?.addEventListener('keydown', e => { if (e.key === 'Enter') _confirmSavePreset(); });
  document.addEventListener('click', e => {
    if (!presetPopover?.classList.contains('open')) return;
    if (!presetPopover.contains(e.target) && e.target !== presetSaveBtn) {
      presetPopover.classList.remove('open');
    }
  });

  // ── 프리셋 편집 모드 ──
  const presetEditBtn = document.getElementById('pomoPresetEditBtn');
  presetEditBtn?.addEventListener('click', () => {
    _pomoPresetEditing = !_pomoPresetEditing;
    presetEditBtn.classList.toggle('active', _pomoPresetEditing);
    renderPomoPresets(_pomoPresetsCache);
  });
  // 편집 모드 중 다른 곳을 클릭하면 편집 모드만 종료하고, 그 클릭이 노린 원래 동작(버튼 클릭 등)은
  // 수행되지 않아야 하므로 캡처 단계에서 전파를 막는다. X 삭제 버튼과 편집 버튼 자신은 예외.
  document.addEventListener('click', e => {
    if (!_pomoPresetEditing) return;
    if (presetEditBtn && presetEditBtn.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.pomo-preset-del-x')) return;
    _pomoPresetEditing = false;
    presetEditBtn?.classList.remove('active');
    renderPomoPresets(_pomoPresetsCache);
    e.stopPropagation();
    e.preventDefault();
  }, true);

  document.getElementById('pomoPresetPrevBtn')?.addEventListener('click', () => {
    _pomoPresetPage--;
    renderPomoPresets(_pomoPresetsCache);
  });
  document.getElementById('pomoPresetNextBtn')?.addEventListener('click', () => {
    _pomoPresetPage++;
    renderPomoPresets(_pomoPresetsCache);
  });

  // ── 고급 설정(회차별 시간) 모달 ──
  document.getElementById('pomoAdvancedBtn')?.addEventListener('click', _openAdvancedModal);
  document.getElementById('pomoAdvancedCloseBtn')?.addEventListener('click', _closeAdvancedModal);
  document.getElementById('pomoAdvancedOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'pomoAdvancedOverlay') _closeAdvancedModal();
  });

  [
    { decr: 'advWorkDecrBtn',   incr: 'advWorkIncrBtn',   key: 'workMins', min: 1, max: 60 },
    { decr: 'advRestDecrBtn',   incr: 'advRestIncrBtn',   key: 'restMins', min: 1, max: 60 },
    { decr: 'advCyclesDecrBtn', incr: 'advCyclesIncrBtn', key: 'cycles',   min: 1, max: 10 },
  ].forEach(({ decr, incr, key, min, max }) => {
    _makeRepeatBtn(decr, () => { if (_advDraftSettings[key] > min) _advSetBase(key, _advDraftSettings[key] - 1); });
    _makeRepeatBtn(incr, () => { if (_advDraftSettings[key] < max) _advSetBase(key, _advDraftSettings[key] + 1); });
  });

  [
    { id: 'advWorkVal',   key: 'workMins', min: 1, max: 60, fallback: 25 },
    { id: 'advRestVal',   key: 'restMins', min: 1, max: 60, fallback: 5  },
    { id: 'advCyclesVal', key: 'cycles',   min: 1, max: 10, fallback: 2  },
  ].forEach(({ id, key, min, max, fallback }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseInt(el.value);
      if (!isNaN(v) && v > max) el.value = max;
    });
    el.addEventListener('change', () => {
      let v = parseInt(el.value);
      if (isNaN(v)) v = fallback;
      v = Math.max(min, Math.min(max, v));
      el.value = v;
      _advSetBase(key, v);
    });
  });

  document.getElementById('pomoAdvancedAddBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('pomoCyclePicker')?.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    const picker = document.getElementById('pomoCyclePicker');
    const addBtn = document.getElementById('pomoAdvancedAddBtn');
    if (!picker?.classList.contains('open')) return;
    if (!picker.contains(e.target) && e.target !== addBtn) picker.classList.remove('open');
  });

  document.getElementById('pomoAdvancedClearBtn')?.addEventListener('click', () => {
    if (!_advDraftOverrides.length) return;
    if (!confirm(T('pomoAdvancedClearConfirm'))) return;
    _advDraftOverrides = [];
    _renderAdvancedList();
    _renderCyclePicker();
  });

  document.getElementById('pomoAdvancedApplyBtn')?.addEventListener('click', () => {
    _savePomoSettings({ ..._advDraftSettings }, null);
    TBBStorage.set({ pomodoroCycleOverrides: _advDraftOverrides.map(o => ({ ...o, name: _advEffectiveName(o) })) });
    _closeAdvancedModal();
  });

  const advSaveBtn       = document.getElementById('pomoAdvancedSaveBtn');
  const advSavePopover    = document.getElementById('pomoAdvSavePopover');
  const advSaveNameInput  = document.getElementById('pomoAdvSaveNameInput');
  advSaveBtn?.addEventListener('click', e => {
    e.stopPropagation();
    advSavePopover?.classList.toggle('open');
    if (advSavePopover?.classList.contains('open')) advSaveNameInput?.focus();
  });
  function _confirmAdvancedSavePreset() {
    const name = (advSaveNameInput?.value || '').trim();
    if (!name) { advSaveNameInput?.focus(); return; }
    TBBStorage.get(['pomodoroPresets'], d => {
      const arr = d.pomodoroPresets || [];
      arr.push({
        name,
        workMins: _advDraftSettings.workMins,
        restMins: _advDraftSettings.restMins,
        cycles: _advDraftSettings.cycles,
        cycleOverrides: _advDraftOverrides.map(o => ({ ...o, name: _advEffectiveName(o) })),
      });
      TBBStorage.set({ pomodoroPresets: arr }, () => {
        if (advSaveNameInput) advSaveNameInput.value = '';
        advSavePopover?.classList.remove('open');
        _pomoPresetPage = Math.ceil(arr.length / POMO_PRESET_PAGE_SIZE) - 1;
        _closeAdvancedModal();
        loadPomoData();
      });
    });
  }
  document.getElementById('pomoAdvSaveConfirmBtn')?.addEventListener('click', _confirmAdvancedSavePreset);
  advSaveNameInput?.addEventListener('keydown', e => { if (e.key === 'Enter') _confirmAdvancedSavePreset(); });
  document.addEventListener('click', e => {
    if (!advSavePopover?.classList.contains('open')) return;
    if (!advSavePopover.contains(e.target) && e.target !== advSaveBtn) advSavePopover.classList.remove('open');
  });

  // ── 도메인 추가 ──
  function doAddPomoDomain() {
    const input  = document.getElementById('pomoDomainInput');
    const domain = cleanDomain((input?.value || '').trim());
    if (!domain) return;
    TBBStorage.get(['pomodoroList'], d => {
      const arr = d.pomodoroList || [];
      const idx = arr.indexOf(domain);
      if (idx !== -1) {
        const ul = document.getElementById('pomoList');
        if (ul?.children[idx]) scrollAndBounce(ul, ul.children[idx], 'pomoWarn', T('alreadySameAddress'));
        return;
      }
      arr.push(domain);
      TBBStorage.set({ pomodoroList: arr }, () => {
        if (input) input.value = '';
        hideWarn('pomoWarn');
        loadPomoData();
      });
    });
  }
  document.getElementById('addPomoBtn')?.addEventListener('click', doAddPomoDomain);
  document.getElementById('pomoDomainInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') doAddPomoDomain(); });
  document.getElementById('pomoDomainInput')?.addEventListener('input', () => hideWarn('pomoWarn'));

  // ── 전체 초기화 ──
  document.getElementById('clearPomoListBtn')?.addEventListener('click', () => {
    if (!confirm(T('clearPomoConfirm'))) return;
    TBBStorage.set({ pomodoroList: [] }, loadPomoData);
  });

  // ── 불러오기 드롭다운 ──
  const importBtn  = document.getElementById('pomoImportBtn');
  const importMenu = document.getElementById('pomoImportMenu');
  importBtn?.addEventListener('click', e => {
    e.stopPropagation();
    importMenu?.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!document.getElementById('pomoImportWrap')?.contains(e.target)) {
      importMenu?.classList.remove('open');
    }
  });
  document.getElementById('importFromPermanent')?.addEventListener('click', () => _importFromList('permanentList'));
  document.getElementById('importFromGeneral')?.addEventListener('click',   () => _importFromList('generalList'));

  // ── 스토리지 변경 시 UI 동기화 ──
  chrome.storage.onChanged.addListener(changes => {
    if (changes.pomodoroState || changes.pomodoroSettings || changes.pomodoroList || changes.pomodoroPresets || changes.pomodoroCycleOverrides) {
      loadPomoData();
    }
  });

  // ── 초기 로드 + 틱 시작 ──
  loadPomoData();
  _pomoTick();
});