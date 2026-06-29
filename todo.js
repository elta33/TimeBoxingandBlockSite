// ── Todo 플로팅 패널 ──
const TODO_STORE_KEY = 'todoItems';

let _todos   = [];
let _todoOpen = false;

// ── 스토리지 ──
function _todoLoad(cb) {
  chrome.storage.local.get([TODO_STORE_KEY], data => {
    _todos = Array.isArray(data[TODO_STORE_KEY]) ? data[TODO_STORE_KEY] : [];
    if (cb) cb();
  });
}

function _todoSave() {
  chrome.storage.local.set({ [TODO_STORE_KEY]: _todos });
}

// ── UI 업데이트 ──
function _todoUpdateHeader() {
  const badge = document.getElementById('todoBadge');
  if (badge) {
    const done = _todos.filter(t => t.done).length;
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
  _todoUpdateHeader();
  list.innerHTML = '';

  if (!_todos.length) {
    const empty = document.createElement('div');
    empty.className = 'todo-empty';
    empty.textContent = '할 일이 없습니다.';
    list.appendChild(empty);
    return;
  }

  // 미완료 먼저, 완료 나중
  const sorted = _todos
    .map((t, i) => ({ ...t, origIdx: i }))
    .sort((a, b) => Number(a.done) - Number(b.done));

  sorted.forEach(({ id, text, done }) => {
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
    list.appendChild(row);
  });
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
  _todoRender();
  input.value = '';
  input.focus();
}

function _todoToggle(id) {
  const t = _todos.find(t => t.id === id);
  if (!t) return;
  t.done = !t.done;
  _todoSave();
  _todoRender();
}

function _todoDelete(id) {
  _todos = _todos.filter(t => t.id !== id);
  _todoSave();
  _todoRender();
}

// ── 팝업 열기 / 닫기 ──
function _todoOpenPopup() {
  const popup = document.getElementById('todoPopup');
  if (!popup) return;
  _todoOpen = true;
  popup.classList.add('todo-popup-open');
  _todoRender();
  setTimeout(() => {
    const input = document.getElementById('todoInput');
    if (input) input.focus();
  }, 50);
}

function _todoClosePopup() {
  const popup = document.getElementById('todoPopup');
  if (!popup) return;
  _todoOpen = false;
  popup.classList.remove('todo-popup-open');
}

// ── 초기화 ──
(function _todoInit() {
  function setup() {
    _todoLoad(() => _todoUpdateHeader());

    const trigger  = document.getElementById('todoTrigger');
    const closeBtn = document.getElementById('todoCloseBtn');
    const addBtn   = document.getElementById('todoAddBtn');
    const input    = document.getElementById('todoInput');

    if (trigger)  trigger.addEventListener('click',  () => _todoOpen ? _todoClosePopup() : _todoOpenPopup());
    if (closeBtn) closeBtn.addEventListener('click', _todoClosePopup);
    if (addBtn)   addBtn.addEventListener('click',   _todoAdd);
    if (input)    input.addEventListener('keydown',  e => { if (e.key === 'Enter') _todoAdd(); });

    // 팝업 외부 클릭 시 닫기
    document.addEventListener('mousedown', e => {
      if (!_todoOpen) return;
      const popup   = document.getElementById('todoPopup');
      const trigger = document.getElementById('todoTrigger');
      if (!popup || !trigger) return;
      if (popup.contains(e.target) || trigger.contains(e.target)) return;
      _todoClosePopup();
    }, true);

    // storage 변경 실시간 반영 (options ↔ block 공유)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[TODO_STORE_KEY]) return;
      _todos = changes[TODO_STORE_KEY].newValue || [];
      _todoUpdateHeader();
      if (_todoOpen) _todoRender();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
