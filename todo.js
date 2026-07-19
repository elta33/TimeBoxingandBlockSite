// ── Todo 플로팅 패널 ──
const TODO_STORE_KEY = 'todoItems';
const TODO_POS_KEY   = 'todoTriggerPos';
const TODO_POPUP_W   = 280;
const TODO_POPUP_GAP = 8;

let _todos    = [];
let _todoOpen = false;
let _doneOpen = false;
// todoItems는 sync 키라 저장 한 번에 chrome.storage.sync.set + (성공 시) local.remove 정리까지
// 이어져 onChanged가 여러 번(그중엔 newValue가 비어있는 것도) 튈 수 있다. 그때마다 재렌더링하면
// 방금 justAddedId/justCompletedId로 그려둔 애니메이션이 인자 없는 재렌더링에 덮어써진다.
// 그래서 내용 비교 대신, 우리가 방금 저장을 시작한 뒤 짧은 시간 동안의 onChanged는 통째로 무시한다.
let _todoSuppressChangeUntil = 0;

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
  _todoSuppressChangeUntil = Date.now() + 1500;
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
    badge.textContent = T('todoBadge', [String(done), String(_todos.length)]);
  }
  const count = document.getElementById('todoTriggerCount');
  if (count) {
    const undone = _todos.filter(t => !t.done).length;
    count.textContent = undone > 0 ? String(undone) : '';
    count.style.display = undone > 0 ? 'inline-flex' : 'none';
  }
}

function _todoRender(justAddedId, justUncompletedId) {
  const list = document.getElementById('todoList');
  if (!list) return;
  list.innerHTML = '';
  const undone = _todos.filter(t => !t.done);
  if (!undone.length) {
    const e = document.createElement('div');
    e.className = 'todo-empty';
    e.textContent = T('todoEmpty');
    list.appendChild(e);
    return;
  }
  undone.forEach(({ id, text }) => {
    const row = _makeTodoRow(id, text, false);
    list.appendChild(row);
    if (id === justAddedId) _todoAnimateGrow(row);
    else if (id === justUncompletedId) _todoAnimateSlideIn(row, -120, false);
  });
}

function _todoDoneRender(justCompletedId) {
  const list = document.getElementById('todoDoneList');
  if (!list) return;
  list.innerHTML = '';
  const done = _todos.filter(t => t.done);
  if (!done.length) {
    const e = document.createElement('div');
    e.className = 'todo-empty';
    e.textContent = T('todoDoneEmpty');
    list.appendChild(e);
    return;
  }
  done.forEach(({ id, text }) => {
    const row = _makeTodoRow(id, text, true);
    if (id === justCompletedId) {
      // 슬라이드 인이 끝나기 전까지는 취소선을 숨겨둔다 (todo-strike-hidden 참고)
      row.querySelector('.todo-text')?.classList.add('todo-strike-hidden');
    }
    list.appendChild(row);
    if (id === justCompletedId) _todoAnimateSlideIn(row, 120, true);
  });
}

// ── 추가/삭제: 중심 확장/축소 애니메이션 (options-core.js 헬퍼 없이 자체 구현 —
// block.html에도 todo.js가 로드되지만 options-core.js는 로드되지 않는다) ──
function _todoAnimateGrow(el) {
  if (!el) return;
  el.classList.remove('todo-item-grow');
  void el.offsetWidth;
  el.classList.add('todo-item-grow');
}

function _todoAnimateShrinkThenRemove(el, onDone, duration = 200) {
  if (!el) { if (onDone) onDone(); return; }
  el.classList.add('todo-item-remove');
  setTimeout(() => { if (onDone) onDone(); }, duration);
}

// 도메인 리스트 / 포모도로 프리셋 / 타임박스 삭제 버튼과 동일한 쓰레기통 아이콘
// (options-core.js의 TRASH_ICON_SVG와 동일 — todo.js는 그게 없는 block.html에서도
// 동작해야 하므로 자체 상수로 둔다).
const TODO_TRASH_ICON_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

function _makeTodoRow(id, text, done) {
  const row = document.createElement('div');
  row.className = 'todo-item' + (done ? ' todo-done' : '');
  row.dataset.id = id;

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
  del.innerHTML = TODO_TRASH_ICON_SVG;
  del.title = T('delete');
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
  const newTodo = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text,
    done: false,
  };
  _todos.push(newTodo);
  _todoSave();
  _todoUpdateHeader();
  if (_todoOpen) _todoRender(newTodo.id);
  input.value = '';
  input.focus();
}

function _todoToggle(id) {
  const t = _todos.find(t => t.id === id);
  if (!t) return;
  if (!t.done) _todoAnimateCompleteThenToggle(t);
  else         _todoAnimateUncompleteThenToggle(t);
}

// ── 완료 처리: 완료 창을 열고, 메인 목록에서는 박스가 왼쪽으로 슬라이드 아웃하며
// (목록 컨테이너의 overflow-x:hidden에 가려 창 밖으로 나가는 부분은 보이지 않음),
// 완료 창에는 반대쪽(오른쪽)에서 슬라이드 인하며 자연스럽게 나타나 자리를 잡은 뒤
// 왼쪽→오른쪽 취소선 스윕을 재생한다. 두 애니메이션 모두 각 목록의 overflow에 잘리므로
// 팝업 경계를 뚫고 넘어가는 것처럼 보이지 않는다. ──
function _todoAnimateCompleteThenToggle(t) {
  const finish = () => {
    t.done = true;
    _todoSave();
    _todoUpdateHeader();
    if (_todoOpen) _todoRender();
    if (_doneOpen) _todoDoneRender(t.id);
  };

  if (!_doneOpen) _todoDoneOpenPopup();
  else _todoPositionDonePopup();

  const row = document.querySelector(`#todoList .todo-item[data-id="${t.id}"]`);
  _todoAnimateSlideOut(row, -120, finish);
}

// ── 완료 해제: 완료 창에서는 오른쪽(메인 창 쪽)으로 슬라이드 아웃하고,
// 메인 목록에는 반대쪽(왼쪽)에서 슬라이드 인하며 나타난다 — 완료 처리 애니메이션을
// 방향만 뒤집어 그대로 재사용한다. 취소선은 그릴 필요가 없어 재생하지 않는다. ──
function _todoAnimateUncompleteThenToggle(t) {
  const finish = () => {
    t.done = false;
    _todoSave();
    _todoUpdateHeader();
    if (_doneOpen) _todoDoneRender();
    if (_todoOpen) _todoRender(undefined, t.id);
  };

  const row = document.querySelector(`#todoDoneList .todo-item[data-id="${t.id}"]`);
  _todoAnimateSlideOut(row, 120, finish);
}

// ── 목록 밖으로 슬라이드 아웃(트랜지션이 끝나면 onDone 호출) ──
// offsetPercent: 양수면 오른쪽으로, 음수면 왼쪽으로 나간다.
function _todoAnimateSlideOut(row, offsetPercent, onDone) {
  if (!row) { if (onDone) onDone(); return; }
  row.style.pointerEvents = 'none';
  void row.offsetWidth; // 리플로우를 확정시킨 뒤 트랜지션을 걸어야 확실히 재생된다
  row.style.transition = 'transform 0.32s ease-in, opacity 0.28s ease-in';
  row.style.transform  = `translateX(${offsetPercent}%)`;
  row.style.opacity    = '0';

  let settled = false;
  const cleanup = () => {
    if (settled) return;
    settled = true;
    if (onDone) onDone();
  };
  row.addEventListener('transitionend', cleanup, { once: true });
  setTimeout(cleanup, 380); // 트랜지션 이벤트가 유실되는 경우 대비 안전망
}

// ── 목록 밖(반대쪽)에서 슬라이드 인 (_todoRender/_todoDoneRender에서 호출) ──
// enterFromPercent: 시작 위치(양수=오른쪽 바깥, 음수=왼쪽 바깥). withStrike면 다 들어온 뒤
// 왼쪽→오른쪽 취소선 스윕을 재생한다(완료 방향에만 해당, 완료 해제는 재생하지 않음).
// 막 생성된 요소에 시작 상태와 최종 상태(트랜지션 포함)를 rAF 한 번으로만 나눠 적용하면
// 브라우저가 두 스타일 변경을 하나로 묶어버려 트랜지션 없이 바로 최종 상태로 "뿅" 나타나는
// 경우가 있다. 시작 상태 적용 직후 강제로 리플로우(offsetWidth 읽기)를 일으켜 그 상태를
// 먼저 확정시킨 뒤에 최종 상태로 바꿔야 트랜지션이 확실히 재생된다.
function _todoAnimateSlideIn(row, enterFromPercent, withStrike) {
  if (!row) return;
  row.style.transition = 'none';
  row.style.transform  = `translateX(${enterFromPercent}%)`;
  row.style.opacity    = '0';
  void row.offsetWidth;
  row.style.transition = 'transform 0.34s cubic-bezier(0.25,0.8,0.4,1), opacity 0.3s ease-out';
  row.style.transform  = 'translateX(0)';
  row.style.opacity    = '1';

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    row.style.transition = '';
    row.style.transform  = '';
    if (withStrike) {
      const textEl = row.querySelector('.todo-text');
      textEl?.classList.remove('todo-strike-hidden');
      textEl?.classList.add('todo-strike-sweep');
    }
  };
  row.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 400); // 트랜지션 이벤트가 유실되는 경우 대비 안전망
}

function _todoDelete(id) {
  const row = document.querySelector(`#todoList .todo-item[data-id="${id}"]`)
           || document.querySelector(`#todoDoneList .todo-item[data-id="${id}"]`);
  const removeNow = () => {
    _todos = _todos.filter(t => t.id !== id);
    _todoSave();
    _todoUpdateHeader();
    if (_todoOpen) _todoRender();
    if (_doneOpen) _todoDoneRender();
  };
  if (row) _todoAnimateShrinkThenRemove(row, removeNow);
  else removeNow();
}

function _todoClearUndone() {
  if (!_todos.some(t => !t.done)) return;
  if (!confirm(T('todoConfirmClearUndone'))) return;
  _todos = _todos.filter(t => t.done);
  _todoSave();
  _todoUpdateHeader();
  if (_todoOpen) _todoRender();
}

function _todoClearDone() {
  if (!_todos.some(t => t.done)) return;
  if (!confirm(T('todoConfirmClearDone'))) return;
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
      // todoItems는 sync 키라 저장 한 번에 로컬/싱크/(정리용) local.remove까지 겹쳐 onChanged가
      // 여러 번 튈 수 있고, 그중 일부는 newValue가 비어있기까지 하다. 방금 이 창에서 저장을
      // 시작했다면(suppress 윈도 안) 전부 무시 — 우리가 이미 justAddedId/justCompletedId로
      // 애니메이션까지 그려둔 상태를 인자 없는 재렌더링이 덮어써서 끊어버리는 걸 막는다.
      // 그 창을 벗어난, 진짜 외부(다른 탭/창) 변경일 때만 반영한다.
      if (Date.now() < _todoSuppressChangeUntil) return;
      _todos = changes[TODO_STORE_KEY].newValue || [];
      _todoUpdateHeader();
      if (_todoOpen) _todoRender();
      if (_doneOpen) _todoDoneRender();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
