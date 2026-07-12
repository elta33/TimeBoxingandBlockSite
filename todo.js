// ── Todo 플로팅 패널 ──
const TODO_STORE_KEY = 'todoItems';
const TODO_POS_KEY   = 'todoTriggerPos';
const TODO_POPUP_W   = 280;
const TODO_POPUP_GAP = 8;

let _todos    = [];
let _todoOpen = false;
let _doneOpen = false;

// ── 스토리지 ──
function _todoLoad(cb) {
  TBBStorage.get([TODO_STORE_KEY, TODO_POS_KEY], data => {
    _todos = Array.isArray(data[TODO_STORE_KEY]) ? data[TODO_STORE_KEY] : [];
    const pos = data[TODO_POS_KEY];
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
      const trigger = document.getElementById('todoTrigger');
      if (trigger) {
        trigger.style.position = 'fixed';
        trigger.style.left   = `${Math.max(0, Math.min(window.innerWidth  - 130, pos.left))}px`;
        trigger.style.top    = `${Math.max(0, Math.min(window.innerHeight -  50, pos.top))}px`;
        trigger.style.right  = 'auto';
        trigger.style.bottom = 'auto';
      }
    }
    if (cb) cb();
  });
}

function _todoSave() {
  TBBStorage.set({ [TODO_STORE_KEY]: _todos });
}

function _todoSavePos(left, top) {
  chrome.storage.local.set({ [TODO_POS_KEY]: { left, top } });
}

// ── 팝업 위치 계산 ──
function _todoPositionPopup() {
  const trigger = document.getElementById('todoTrigger');
  const popup   = document.getElementById('todoPopup');
  if (!trigger || !popup) return;

  const rect = trigger.getBoundingClientRect();
  let left = rect.right - TODO_POPUP_W;
  left = Math.max(8, Math.min(window.innerWidth - TODO_POPUP_W - 8, left));

  // 화면 하단 1/3 지점부터는 아이콘과 가깝게 위쪽으로 열림
  const openAbove = rect.top > (window.innerHeight * 2 / 3);

  popup.style.left = `${left}px`;
  popup.style.right = 'auto';

  if (openAbove) {
    popup.style.maxHeight       = `${Math.max(80, Math.min(440, rect.top - TODO_POPUP_GAP - 8))}px`;
    popup.style.top             = 'auto';
    popup.style.bottom          = `${window.innerHeight - rect.top + TODO_POPUP_GAP}px`;
    popup.style.transformOrigin = 'bottom right';
  } else {
    popup.style.maxHeight       = `${Math.max(80, Math.min(440, window.innerHeight - rect.bottom - TODO_POPUP_GAP - 8))}px`;
    popup.style.top             = `${rect.bottom + TODO_POPUP_GAP}px`;
    popup.style.bottom          = 'auto';
    popup.style.transformOrigin = 'top right';
  }
}

function _todoPositionDonePopup() {
  const popup     = document.getElementById('todoPopup');
  const donePopup = document.getElementById('todoDonePopup');
  if (!popup || !donePopup) return;

  const rect = popup.getBoundingClientRect();
  // 메인 팝업의 좌측 모서리에 맞닿도록 배치 (트리거 아이콘/레이블에 가려지지 않게)
  const left = Math.max(8, rect.left - TODO_POPUP_GAP - TODO_POPUP_W);
  const top  = rect.top;
  const maxH = Math.max(80, Math.min(440, window.innerHeight - top - 8));

  donePopup.style.width     = `${TODO_POPUP_W}px`;
  donePopup.style.maxHeight = `${maxH}px`;
  donePopup.style.left      = `${left}px`;
  donePopup.style.right     = 'auto';
  donePopup.style.top       = `${top}px`;
  donePopup.style.bottom    = 'auto';
}

// ── UI 업데이트 ──
function _todoUpdateHeader() {
  const badge = document.getElementById('todoBadge');
  if (badge) {
    const done  = _todos.filter(t => t.done).length;
    badge.textContent = `완료 ${done}/${_todos.length}`;
  }
  const count = document.getElementById('todoTriggerCount');
  if (count) {
    const undone = _todos.filter(t => !t.done).length;
    count.textContent = undone > 0 ? String(undone) : '';
    count.style.display = undone > 0 ? 'inline-flex' : 'none';
  }
}

function _todoRender() {
  const list = document.getElementById('todoList');
  if (!list) return;
  list.innerHTML = '';
  const undone = _todos.filter(t => !t.done);
  if (!undone.length) {
    const e = document.createElement('div');
    e.className = 'todo-empty';
    e.textContent = '할 일이 없습니다.';
    list.appendChild(e);
    return;
  }
  undone.forEach(({ id, text }) => list.appendChild(_makeTodoRow(id, text, false)));
}

function _todoDoneRender() {
  const list = document.getElementById('todoDoneList');
  if (!list) return;
  list.innerHTML = '';
  const done = _todos.filter(t => t.done);
  if (!done.length) {
    const e = document.createElement('div');
    e.className = 'todo-empty';
    e.textContent = '완료된 항목이 없습니다.';
    list.appendChild(e);
    return;
  }
  done.forEach(({ id, text }) => list.appendChild(_makeTodoRow(id, text, true)));
}

function _makeTodoRow(id, text, done) {
  const row = document.createElement('div');
  row.className = 'todo-item' + (done ? ' todo-done' : '');

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'todo-cb';
  cb.checked = done;
  cb.addEventListener('change', () => _todoToggle(id));

  const label = document.createElement('span');
  label.className = 'todo-text';
  label.title = text;
  label.textContent = text;

  const del = document.createElement('button');
  del.className = 'todo-del';
  del.innerHTML = '&times;';
  del.title = '삭제';
  del.addEventListener('click', e => { e.stopPropagation(); _todoDelete(id); });

  row.append(cb, label, del);
  return row;
}

// ── CRUD ──
function _todoAdd() {
  const input = document.getElementById('todoInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  _todos.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text,
    done: false,
  });
  _todoSave();
  _todoUpdateHeader();
  if (_todoOpen) _todoRender();
  input.value = '';
  input.focus();
}

function _todoToggle(id) {
  const t = _todos.find(t => t.id === id);
  if (!t) return;
  t.done = !t.done;
  _todoSave();
  _todoUpdateHeader();
  if (_todoOpen) _todoRender();
  if (_doneOpen) _todoDoneRender();
}

function _todoDelete(id) {
  _todos = _todos.filter(t => t.id !== id);
  _todoSave();
  _todoUpdateHeader();
  if (_todoOpen) _todoRender();
  if (_doneOpen) _todoDoneRender();
}

function _todoClearUndone() {
  if (!_todos.some(t => !t.done)) return;
  if (!confirm('미완료 할 일을 모두 삭제하시겠습니까?')) return;
  _todos = _todos.filter(t => t.done);
  _todoSave();
  _todoUpdateHeader();
  if (_todoOpen) _todoRender();
}

function _todoClearDone() {
  if (!_todos.some(t => t.done)) return;
  if (!confirm('완료된 항목을 모두 삭제하시겠습니까?')) return;
  _todos = _todos.filter(t => !t.done);
  _todoSave();
  _todoUpdateHeader();
  if (_doneOpen) _todoDoneRender();
}

// ── 팝업 열기 / 닫기 ──
function _todoOpenPopup() {
  const popup = document.getElementById('todoPopup');
  if (!popup) return;
  _todoOpen = true;
  _todoPositionPopup();
  popup.classList.add('todo-popup-open');
  _todoRender();
  setTimeout(() => { const i = document.getElementById('todoInput'); if (i) i.focus(); }, 50);
}

function _todoClosePopup() {
  _todoOpen = false;
  const popup = document.getElementById('todoPopup');
  if (popup) popup.classList.remove('todo-popup-open');
  _todoDoneClosePopup();
}

function _todoDoneOpenPopup() {
  const dp = document.getElementById('todoDonePopup');
  if (!dp) return;
  _doneOpen = true;
  _todoPositionDonePopup();
  dp.classList.add('todo-popup-open');
  _todoDoneRender();
}

function _todoDoneClosePopup() {
  _doneOpen = false;
  const dp = document.getElementById('todoDonePopup');
  if (dp) dp.classList.remove('todo-popup-open');
}

// ── 드래그 & 드랍 ──
function _todoInitDrag() {
  const trigger = document.getElementById('todoTrigger');
  if (!trigger) return;

  let isDragging = false;
  let hasMoved   = false;
  let startX, startY, startLeft, startTop;

  trigger.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const rect = trigger.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    hasMoved = false; isDragging = false;

    // 자석 그랩 애니메이션
    trigger.style.transition = 'transform 0.18s cubic-bezier(0.34,1.4,0.64,1)';
    trigger.style.transform  = 'scale(1.12)';
  });

  document.addEventListener('mousemove', e => {
    if (startX === undefined) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!hasMoved && Math.sqrt(dx * dx + dy * dy) > 4) {
      hasMoved = true; isDragging = true;
      trigger.style.position = 'fixed';
      trigger.style.right  = 'auto';
      trigger.style.bottom = 'auto';
      trigger.style.left   = `${startLeft}px`;
      trigger.style.top    = `${startTop}px`;
      trigger.style.transition = 'transform 0.12s ease';
      trigger.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    }

    if (!isDragging) return;
    const maxL = window.innerWidth  - trigger.offsetWidth;
    const maxT = window.innerHeight - trigger.offsetHeight;
    trigger.style.left = `${Math.max(0, Math.min(maxL, startLeft + dx))}px`;
    trigger.style.top  = `${Math.max(0, Math.min(maxT, startTop  + dy))}px`;

    // 드래그 중에도 팝업이 아이콘과의 좌표를 유지하며 따라오도록 실시간 반영
    if (_todoOpen) {
      _todoPositionPopup();
      if (_doneOpen) _todoPositionDonePopup();
    }
  });

  function onMouseUp(e) {
    if (e.button !== 0 || startX === undefined) return;

    if (isDragging) {
      isDragging = false;
      document.body.style.userSelect = '';
      trigger.style.cursor = '';
      // 드랍 스프링 애니메이션
      trigger.style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1)';
      trigger.style.transform  = 'scale(1)';
      setTimeout(() => { trigger.style.transition = ''; }, 360);
      _todoSavePos(parseInt(trigger.style.left), parseInt(trigger.style.top));
      if (_todoOpen) {
        _todoPositionPopup();
        if (_doneOpen) _todoPositionDonePopup();
      }
    } else if (!hasMoved) {
      // 클릭: scale 복원 후 팝업 토글
      trigger.style.transition = 'transform 0.18s cubic-bezier(0.34,1.4,0.64,1)';
      trigger.style.transform  = 'scale(1)';
      setTimeout(() => { trigger.style.transition = ''; }, 200);
      if (_todoOpen) _todoClosePopup();
      else           _todoOpenPopup();
    }
    startX = startY = undefined;
    hasMoved = isDragging = false;
  }

  document.addEventListener('mouseup',    onMouseUp);
  document.addEventListener('mouseleave', e => {
    if (isDragging && e.target === document.documentElement) {
      isDragging = false;
      document.body.style.userSelect = '';
      trigger.style.cursor = '';
      trigger.style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1)';
      trigger.style.transform  = 'scale(1)';
      setTimeout(() => { trigger.style.transition = ''; }, 360);
      _todoSavePos(parseInt(trigger.style.left) || 0, parseInt(trigger.style.top) || 0);
      if (_todoOpen) {
        _todoPositionPopup();
        if (_doneOpen) _todoPositionDonePopup();
      }
      startX = startY = undefined;
      hasMoved = false;
    }
  });
}

// ── 초기화 ──
(function _todoInit() {
  function setup() {
    _todoLoad(() => _todoUpdateHeader());

    const closeBtn     = document.getElementById('todoCloseBtn');
    const addBtn       = document.getElementById('todoAddBtn');
    const input        = document.getElementById('todoInput');
    const badge        = document.getElementById('todoBadge');
    const clearBtn     = document.getElementById('todoClearAllBtn');
    const doneClose    = document.getElementById('todoDoneCloseBtn');
    const doneClear    = document.getElementById('todoDoneClearAllBtn');

    if (closeBtn)  closeBtn.addEventListener('click',  _todoClosePopup);
    if (addBtn)    addBtn.addEventListener('click',    _todoAdd);
    if (input)     input.addEventListener('keydown',   e => { if (e.key === 'Enter') _todoAdd(); });
    if (badge)     badge.addEventListener('click',     () => _doneOpen ? _todoDoneClosePopup() : _todoDoneOpenPopup());
    if (clearBtn)  clearBtn.addEventListener('click',  _todoClearUndone);
    if (doneClose) doneClose.addEventListener('click', _todoDoneClosePopup);
    if (doneClear) doneClear.addEventListener('click', _todoClearDone);

    _todoInitDrag();

    // 팝업 외부 클릭 시 닫기
    document.addEventListener('mousedown', e => {
      const popup  = document.getElementById('todoPopup');
      const donePop = document.getElementById('todoDonePopup');
      const trig   = document.getElementById('todoTrigger');
      if (!popup || !trig) return;
      const inMain = popup.contains(e.target);
      const inDone = donePop && donePop.contains(e.target);
      const inTrig = trig.contains(e.target);
      if (!inMain && !inDone && !inTrig && _todoOpen) _todoClosePopup();
    }, true);

    // storage 변경 실시간 반영 (options ↔ block 공유, local/sync 양쪽 다 반영)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (!changes[TODO_STORE_KEY]) return;
      _todos = changes[TODO_STORE_KEY].newValue || [];
      _todoUpdateHeader();
      if (_todoOpen) _todoRender();
      if (_doneOpen) _todoDoneRender();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
