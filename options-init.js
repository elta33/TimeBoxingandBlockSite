// options-init.js
// 옵션 페이지 부트스트랩 (DOMContentLoaded): 메인 탭 전환, 통계 탭 진입, 요일/다크모드/PIN 설정, 내보내기·불러오기 버튼 연결
// options-core.js·options-stats.js가 정의한 함수(loadSettings, renderStats, initViewTabs, _loadPinStatus 등)에 의존하므로 반드시 그 뒤에 로드할 것
document.addEventListener('DOMContentLoaded', () => {
  // 요일 팝업 닫기 버튼
  document.getElementById('dayPopupCloseBtn')?.addEventListener('click', closeDayPopup);

  // 메인 탭
  document.querySelectorAll('.main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
      // 다른 탭으로 이동 시 박스 수정 모드 종료
      if (_editingBoxIndex !== null) exitBoxEditMode();
      if (tab.dataset.tab === 'stats') renderStats(_statsPeriod);
    });
  });

  // 통계 기간 탭
  document.querySelectorAll('.stats-period-tab').forEach(btn => {
    btn.addEventListener('click', () => renderStats(btn.dataset.period));
  });

  // focusEvents 변경 시 통계 탭이 열려있으면 실시간 재렌더링
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.focusEvents) return;
    const statsPanel = document.getElementById('tab-stats');
    if (statsPanel && statsPanel.classList.contains('active')) {
      renderStats(_statsPeriod);
    }
  });

  // 주 시작 토글 복원
  const weekStartWrap = document.getElementById('weekStartToggleWrap');
  chrome.storage.local.get(['weekStartMonday'], result => {
    weekStartMonday = !!result.weekStartMonday;
    const radio = document.querySelector(`input[name="weekStart"][value="${weekStartMonday ? 'mon' : 'sun'}"]`);
    if (radio) radio.checked = true;
    syncDaySelector();
  });
  document.querySelectorAll('input[name="weekStart"]').forEach(radio => {
    radio.addEventListener('change', () => {
      weekStartMonday = radio.value === 'mon';
      chrome.storage.local.set({ weekStartMonday });
      syncDaySelector();
      if (currentView === 'week') loadSettings();
    });
  });

  // 하루 스케줄 활성화 토글
  chrome.storage.local.get(['dailyScheduleEnabled'], result => {
    dailyScheduleEnabled = result.dailyScheduleEnabled !== false;
    const toggle = document.getElementById('dailyScheduleDisableToggle');
    if (toggle) toggle.checked = !dailyScheduleEnabled;
    applyDailyScheduleVisual();
  });
  document.getElementById('dailyScheduleDisableToggle')?.addEventListener('change', e => {
    if (_pinEnabled) {
      const toggle = e.target;
      toggle.checked = !toggle.checked; // 원래 상태 즉시 복원
      _openPinModal('비활성화', () => {
        toggle.checked = !toggle.checked;
        dailyScheduleEnabled = !toggle.checked;
        chrome.storage.local.set({ dailyScheduleEnabled });
        applyDailyScheduleVisual();
      });
      return;
    }
    dailyScheduleEnabled = !e.target.checked;
    chrome.storage.local.set({ dailyScheduleEnabled });
    applyDailyScheduleVisual();
  });

  // 다크모드 토글
  const darkModeToggle = document.getElementById('darkModeToggle');
  chrome.storage.local.get(['darkModeEnabled'], result => {
    if (darkModeToggle) darkModeToggle.checked = !!result.darkModeEnabled;
  });
  darkModeToggle?.addEventListener('change', e => {
    chrome.storage.local.set({ darkModeEnabled: e.target.checked });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.darkModeEnabled && darkModeToggle) {
      darkModeToggle.checked = !!changes.darkModeEnabled.newValue;
    }
  });

  function updateWeekStartToggleVisibility() {
    if (weekStartWrap) weekStartWrap.style.display = currentView === 'week' ? 'flex' : 'none';
  }
  updateWeekStartToggleVisibility();
  updateDailyToggleVisibility();

  initViewTabs(() => {
    updateWeekStartToggleVisibility();
    updateDailyToggleVisibility();
    applyDailyScheduleVisual();
  });
  loadSettings();

  // 스케줄러 섹터(타임테이블) 안에서 박스 이외의 곳을 클릭하면 상세 패널 닫기 + 선택 해제
  // 범위를 문서 전체가 아닌 이 섹터로 좁힌 이유: 박스 수정 시 폼(다른 섹터)에 입력하는 클릭까지 선택 해제로 이어지면 안 됨
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('weekDetailPanel');
    if (!panel || panel.style.display !== 'block') return;
    const sector = document.getElementById('schedulerSector');
    if (!sector || !sector.contains(e.target)) return; // 스케줄러 섹터 밖 클릭은 무시
    if (e.target.closest('.tbox')) return; // 박스 자체 클릭은 박스의 클릭 핸들러가 처리
    if (panel.contains(e.target)) return;  // 패널 내부(주소 추가 등) 클릭은 무시
    panel.style.display = 'none';
    panel.dataset.openIndex = '';
    document.querySelectorAll('.tbox.selected').forEach(el => el.classList.remove('selected'));
  });

  // 입력 시 경고 숨김
  ['generalDomainInput', 'permanentDomainInput', 'customDomainInput', 'boxName']
    .forEach((id, idx) => {
      document.getElementById(id)?.addEventListener('input', () => hideWarn(['generalWarn','permanentWarn','customWarn','boxWarn'][idx]));
    });
  ['startTime', 'endTime'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('input',  () => hideWarn('boxWarn'));
    el?.addEventListener('change', () => hideWarn('boxWarn'));
  });

  document.getElementById('permanentDomainInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('addPermanentBtn').click(); });
  document.getElementById('generalDomainInput')?.addEventListener('keydown',   e => { if (e.key === 'Enter') document.getElementById('addGeneralBtn').click(); });
  document.getElementById('customDomainInput')?.addEventListener('keydown',    e => { if (e.key === 'Enter') document.getElementById('addCustomStagingBtn').click(); });

  // 내보내기 / 불러오기
  document.getElementById('exportBtn')?.addEventListener('click', exportSettings);
  document.getElementById('importBtn')?.addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) { importSettings(file); e.target.value = ''; }
  });

  // ── PIN 초기화 ──
  _loadPinStatus();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.lockPin) return;
    const lp = changes.lockPin.newValue;
    _pinEnabled = !!(lp?.enabled && lp?.hash);
    _updatePinUI();
    loadSettings(); // 박스 카드 버튼 상태 재렌더링
  });

  // PIN 모달 이벤트
  document.getElementById('pinModalCancelBtn')?.addEventListener('click', _closePinModal);
  document.getElementById('pinModalConfirmBtn')?.addEventListener('click', _attemptPinUnlock);
  document.getElementById('pinModalOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'pinModalOverlay') _closePinModal();
  });
  document.getElementById('pinModalInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter')  _attemptPinUnlock();
    if (e.key === 'Escape') _closePinModal();
  });

  // PIN 등록
  async function _doSetPin() {
    const newPin     = document.getElementById('pinNewInput')?.value || '';
    const confirmPin = document.getElementById('pinNewConfirmInput')?.value || '';
    const errorEl    = document.getElementById('pinSetError');
    const showErr = msg => { if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; } };
    if (!newPin)            { showErr('PIN을 입력하세요.'); return; }
    if (newPin.length < 4)  { showErr('PIN은 4자 이상이어야 합니다.'); return; }
    if (newPin !== confirmPin) { showErr('PIN이 일치하지 않습니다.'); return; }
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    const hash = await _hashPin(newPin, salt);
    chrome.storage.local.set({ lockPin: { hash, salt, enabled: true } }, () => {
      if (errorEl) errorEl.style.display = 'none';
      document.getElementById('pinNewInput').value = '';
      document.getElementById('pinNewConfirmInput').value = '';
    });
  }
  document.getElementById('pinSetBtn')?.addEventListener('click', _doSetPin);
  ['pinNewInput','pinNewConfirmInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') _doSetPin(); });
    document.getElementById(id)?.addEventListener('input', () => {
      const err = document.getElementById('pinSetError');
      if (err) err.style.display = 'none';
    });
  });

  // PIN 변경
  async function _doChangePin() {
    const currentPin = document.getElementById('pinCurrentInput')?.value    || '';
    const newPin     = document.getElementById('pinChangeNewInput')?.value   || '';
    const confirmPin = document.getElementById('pinChangeConfirmInput')?.value || '';
    const errorEl    = document.getElementById('pinChangeError');
    const showErr = msg => { if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; } };
    if (!currentPin || !newPin || !confirmPin) { showErr('모든 항목을 입력하세요.'); return; }
    if (newPin.length < 4)  { showErr('새 PIN은 4자 이상이어야 합니다.'); return; }
    if (newPin !== confirmPin) { showErr('새 PIN이 일치하지 않습니다.'); return; }
    chrome.storage.local.get(['lockPin'], async result => {
      const lp = result.lockPin;
      if (!lp?.hash || !lp?.salt) return;
      const hash = await _hashPin(currentPin, lp.salt);
      if (hash !== lp.hash) {
        showErr('현재 PIN이 올바르지 않습니다.');
        document.getElementById('pinCurrentInput').value = '';
        return;
      }
      const newSalt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
      const newHash = await _hashPin(newPin, newSalt);
      chrome.storage.local.set({ lockPin: { hash: newHash, salt: newSalt, enabled: true } }, () => {
        if (errorEl) errorEl.style.display = 'none';
        ['pinCurrentInput','pinChangeNewInput','pinChangeConfirmInput'].forEach(id => {
          const el = document.getElementById(id); if (el) el.value = '';
        });
      });
    });
  }
  document.getElementById('pinChangeBtn')?.addEventListener('click', _doChangePin);
  ['pinCurrentInput','pinChangeNewInput','pinChangeConfirmInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') _doChangePin(); });
    document.getElementById(id)?.addEventListener('input', () => {
      const err = document.getElementById('pinChangeError');
      if (err) err.style.display = 'none';
    });
  });

  // PIN 해제
  document.getElementById('pinRemoveBtn')?.addEventListener('click', () => {
    _openPinModal('PIN 해제', () => {
      chrome.storage.local.set({ lockPin: { hash: '', salt: '', enabled: false } });
    });
  });
});
