// options-init.js
// 옵션 페이지 부트스트랩 (DOMContentLoaded): 메인 탭 전환, 통계 탭 진입, 요일/다크모드/PIN 설정, 내보내기·불러오기 버튼 연결
// options-core.js·options-stats.js가 정의한 함수(loadSettings, renderStats, initViewTabs, _loadPinStatus 등)에 의존하므로 반드시 그 뒤에 로드할 것

// ── 온보딩 체크리스트 (차단 관리 탭) ──
// 완료 여부는 별도 플래그 없이 실제 storage 상태(리스트/박스 존재 여부)로 매번 판정한다.
// storage.js의 loadSettings()가 호출될 때마다(추가/삭제 등 모든 변경 후) 같이 갱신됨.
function _renderOnboardingChecklist() {
  const card = document.getElementById('onboardingCard');
  if (!card || card.dataset.dismissed === '1') return;
  TBBStorage.get(['generalList', 'permanentList', 'dailyBoxes', 'weeklyBoxes'], result => {
    const hasSites = (result.generalList?.length > 0) || (result.permanentList?.length > 0);
    const hasBoxes = (result.dailyBoxes?.length > 0) || (result.weeklyBoxes?.length > 0);
    document.getElementById('onboardingStep1')?.classList.toggle('done', hasSites);
    document.getElementById('onboardingStep2')?.classList.toggle('done', hasBoxes);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // 온보딩 체크리스트 카드 표시 여부 / 이벤트 연결
  const onboardingCard = document.getElementById('onboardingCard');
  if (onboardingCard) {
    chrome.storage.local.get(['onboardingDismissed'], result => {
      if (result.onboardingDismissed) {
        onboardingCard.dataset.dismissed = '1';
        return;
      }
      onboardingCard.style.display = '';
      _renderOnboardingChecklist();
    });
    document.getElementById('onboardingCloseBtn')?.addEventListener('click', () => {
      onboardingCard.dataset.dismissed = '1';
      onboardingCard.style.display = 'none';
      chrome.storage.local.set({ onboardingDismissed: true });
    });
    onboardingCard.querySelectorAll('.onboarding-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const goto = btn.dataset.goto;
        if (goto === 'block') { document.getElementById('generalDomainInput')?.focus(); return; }
        document.querySelector(`.main-tab[data-tab="${goto}"]`)?.click();
      });
    });
    // 박스 저장 경로가 여러 곳(메인 폼/요일 팝업 등)에 흩어져 있어 개별 호출부마다
    // 체크리스트 갱신을 넣는 대신, storage 변경 자체를 구독해 어디서 저장하든 반영되게 함.
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.generalList || changes.permanentList || changes.dailyBoxes || changes.weeklyBoxes) {
        _renderOnboardingChecklist();
      }
    });
  }

  // 탭 요약 배너 (스케줄러/포모도로/통계/설정 탭 최초 진입 시 안내, 탭별로 독립적으로 닫힘)
  const tabIntroBanners = document.querySelectorAll('.tab-intro-banner[data-tab-key]');
  if (tabIntroBanners.length) {
    chrome.storage.local.get(['tabIntroDismissed'], result => {
      const dismissed = result.tabIntroDismissed || {};
      tabIntroBanners.forEach(banner => {
        banner.style.display = dismissed[banner.dataset.tabKey] ? 'none' : 'flex';
      });
    });
    tabIntroBanners.forEach(banner => {
      banner.querySelector('.tab-intro-close-btn')?.addEventListener('click', () => {
        banner.style.display = 'none';
        chrome.storage.local.get(['tabIntroDismissed'], result => {
          const dismissed = result.tabIntroDismissed || {};
          dismissed[banner.dataset.tabKey] = true;
          chrome.storage.local.set({ tabIntroDismissed: dismissed });
        });
      });
    });
  }

  // 도메인 리스트 검색 입력 연결 (상시/일반/예외/포모도로 차단 리스트)
  _initDomainSearchInputs();
  // 상시/일반/포모도로 추가 입력의 기본 도메인 드롭다운
  _initDomainSuggestions();

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

  // focusEvents 변경 시 통계 탭이 열려있으면 실시간 재렌더링 (local/sync 양쪽 다 반영)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!changes.focusEvents) return;
    const statsPanel = document.getElementById('tab-stats');
    if (statsPanel && statsPanel.classList.contains('active')) {
      renderStats(_statsPeriod);
    }
  });

  // 주 시작 토글 복원
  const weekStartWrap = document.getElementById('weekStartToggleWrap');
  TBBStorage.get(['weekStartMonday'], result => {
    weekStartMonday = !!result.weekStartMonday;
    const radio = document.querySelector(`input[name="weekStart"][value="${weekStartMonday ? 'mon' : 'sun'}"]`);
    if (radio) radio.checked = true;
    syncDaySelector();
  });
  document.querySelectorAll('input[name="weekStart"]').forEach(radio => {
    radio.addEventListener('change', () => {
      weekStartMonday = radio.value === 'mon';
      TBBStorage.set({ weekStartMonday });
      syncDaySelector();
      if (currentView === 'week') loadSettings();
    });
  });

  // 하루 스케줄 활성화 토글
  TBBStorage.get(['dailyScheduleEnabled'], result => {
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
        TBBStorage.set({ dailyScheduleEnabled });
        applyDailyScheduleVisual();
      });
      return;
    }
    dailyScheduleEnabled = !e.target.checked;
    TBBStorage.set({ dailyScheduleEnabled });
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

  // 유튜브 쇼츠 강력 차단 토글
  const shortsBlockToggle = document.getElementById('shortsBlockToggle');
  TBBStorage.get(['shortsBlockEnabled'], result => {
    if (shortsBlockToggle) shortsBlockToggle.checked = !!result.shortsBlockEnabled;
  });
  shortsBlockToggle?.addEventListener('change', e => {
    TBBStorage.set({ shortsBlockEnabled: e.target.checked });
  });

  // 팔로우한 계정 게시물 표시 (인스타 강력 차단의 하위 옵션) — instaBlockToggle 핸들러가
  // 참조하므로 먼저 선언.
  const instaShowFollowedToggle = document.getElementById('instaShowFollowedToggle');
  TBBStorage.get(['instaShowFollowedPosts'], result => {
    if (instaShowFollowedToggle) instaShowFollowedToggle.checked = !!result.instaShowFollowedPosts;
  });
  instaShowFollowedToggle?.addEventListener('change', e => {
    TBBStorage.set({ instaShowFollowedPosts: e.target.checked });
  });

  // 인스타그램 강력 차단 토글
  const instaBlockToggle = document.getElementById('instaBlockToggle');
  TBBStorage.get(['instaBlockEnabled'], result => {
    if (instaBlockToggle) instaBlockToggle.checked = !!result.instaBlockEnabled;
    if (instaShowFollowedToggle) instaShowFollowedToggle.disabled = !result.instaBlockEnabled;
  });
  instaBlockToggle?.addEventListener('change', e => {
    const enabled = e.target.checked;
    const updates = { instaBlockEnabled: enabled };
    // 꺼질 때만 하위 옵션을 강제 해제(켤 때는 자동 체크 안 함 — 사용자가 직접 선택해야 함).
    if (!enabled && instaShowFollowedToggle) {
      instaShowFollowedToggle.checked = false;
      updates.instaShowFollowedPosts = false;
    }
    if (instaShowFollowedToggle) instaShowFollowedToggle.disabled = !enabled;
    TBBStorage.set(updates);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (changes.shortsBlockEnabled && shortsBlockToggle) {
      shortsBlockToggle.checked = !!changes.shortsBlockEnabled.newValue;
    }
    if (changes.instaBlockEnabled && instaBlockToggle) {
      instaBlockToggle.checked = !!changes.instaBlockEnabled.newValue;
      if (instaShowFollowedToggle) instaShowFollowedToggle.disabled = !changes.instaBlockEnabled.newValue;
    }
    if (changes.instaShowFollowedPosts && instaShowFollowedToggle) {
      instaShowFollowedToggle.checked = !!changes.instaShowFollowedPosts.newValue;
    }
  });

  // 동기화 상태 인디케이터 — storage-api.js가 sync 성공/실패·용량 축소 시 기록하는
  // _syncStatus(local 전용)를 읽어 "다른 기기에 왜 반영이 안 되지?"에 답할 정보를 보여준다.
  function _fmtSyncTime(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function _renderSyncStatus(status) {
    const badge = document.getElementById('syncStatusBadge');
    const textEl = document.getElementById('syncStatusText');
    if (!badge || !textEl) return;
    const s = status || {};
    badge.classList.remove('sync-ok', 'sync-warn', 'sync-none');

    const parts = [];
    if (s.lastErrorAt) {
      badge.classList.add('sync-warn');
      parts.push(T('syncStatusFailed', [_fmtSyncTime(s.lastErrorAt)]));
    } else if (s.lastSuccessAt) {
      badge.classList.add('sync-ok');
      parts.push(T('syncStatusOk', [_fmtSyncTime(s.lastSuccessAt)]));
    } else {
      badge.classList.add('sync-none');
      parts.push(T('syncStatusNone'));
    }
    if (s.trimmedFocusEventsAt) parts.push(T('syncStatusTrimmed'));
    textEl.textContent = parts.join(' · ');
  }
  chrome.storage.local.get(['_syncStatus'], result => _renderSyncStatus(result._syncStatus));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes._syncStatus) _renderSyncStatus(changes._syncStatus.newValue);
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
