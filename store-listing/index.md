# TBB (FocusBox) — Privacy Policy / 개인정보 처리방침

_Last updated / 최종 갱신: 2026-07-24_

> 이 문서는 Chrome Web Store 심사에 제출할 Privacy Policy의 **본문 원고**입니다. CWS는 텍스트 붙여넣기가 아니라 **실제로 접근 가능한 공개 URL**을 요구하므로, 이 내용을 GitHub Pages·공개 Notion 페이지 등에 게시한 뒤 그 URL을 Developer Dashboard에 등록하십시오(게시 방법은 파일 하단 "게시 안내" 참고). 리뷰어 자동번역 오류를 줄이기 위해 각 절을 한국어 + 영어로 병기했습니다.

---

## 1. 개요 / Overview

**한국어**
TBB(FocusBox, 이하 "본 확장")는 사용자가 직접 지정한 웹사이트를 차단하여 타임박싱·포모도로 기반의 집중 시간관리를 돕는 크롬 확장 프로그램입니다. 본 확장은 **어떠한 개인정보나 사용자 데이터도 수집·저장·전송하지 않습니다.** 개발자는 사용자의 데이터에 접근할 수 없습니다.

**English**
TBB (FocusBox, "the Extension") is a Chrome extension that helps users manage their focus time through time-boxing and Pomodoro sessions by blocking websites the user chooses. **The Extension does not collect, store, or transmit any personal information or user data.** The developer has no access to any user data.

---

## 2. 수집하는 데이터가 없습니다 / No Data Collection

**한국어**
본 확장은 원격 서버로 어떠한 데이터도 전송하지 않습니다. 코드베이스에는 `fetch`, `XMLHttpRequest` 등 외부 네트워크 통신 코드가 전혀 존재하지 않으며, 분석 도구(애널리틱스)나 추적기(트래커)도 포함되어 있지 않습니다.

본 확장이 동작을 위해 다루는 유일한 정보는 **현재 이동하려는 페이지의 URL**입니다. 이 URL은 사용자가 설정한 차단 목록과 즉시 대조되어 "허용할지 / 차단 안내 페이지로 리다이렉트할지"를 판단하는 데에만 사용되며, 판단 직후 버려집니다. **이 URL은 저장·로깅되지 않고, 기기 밖으로 전송되지 않으며, 개발자를 포함한 그 누구에게도 전달되지 않습니다.** 본 확장은 페이지의 본문 콘텐츠(텍스트, 이미지, 입력값 등)를 읽지 않고 오직 URL/내비게이션 변경만 관찰합니다.

**English**
The Extension transmits no data to any remote server. The codebase contains no external network calls (`fetch`, `XMLHttpRequest`, etc.), no analytics, and no trackers.

The only information the Extension processes to function is the **URL of the page currently being navigated to**. This URL is compared in real time against the user's own block list solely to decide whether to allow the navigation or redirect it to a local block page, and is discarded immediately afterward. **This URL is never stored, logged, transmitted off the device, or shared with anyone, including the developer.** The Extension does not read page content (text, images, form inputs); it only observes URL/navigation changes.

---

## 3. 광범위한 호스트 권한(`<all_urls>`)을 요청하는 이유 / Why the Extension Requests Broad Host Access

**한국어**
본 확장은 설치 시 **모든 사이트(`<all_urls>`)에 대한 접근 권한**을 요청합니다. 이는 넓은 권한처럼 보이지만, 차단 기능의 특성상 반드시 필요합니다.

본 확장의 핵심 기능은 **사용자가 차단하고 싶은 웹사이트를 직접 자유롭게 입력**하는 것입니다. 어떤 사이트를 차단할지는 개발자가 미리 정해두는 것이 아니라 **설치 후 사용자 각자가 결정**하며, 그 목록에는 제한이 없습니다. 따라서 확장은 사용자가 **어떤 사이트를 차단 목록에 추가하시든 그 사이트에서 차단 기능이 작동해야 하므로**, 특정 도메인 몇 개로 권한 범위를 좁힐 수 없고 모든 사이트에 대한 접근 권한이 필요합니다.

구체적으로 이 권한은 (1) 사용자가 차단 목록에 넣은 도메인에서 페이지 내 이동(SPA 내비게이션)을 감지하고, (2) 차단 시 안내 페이지(block.html)로 리다이렉트하는 데에만 사용됩니다. 다시 강조하지만, 이 권한으로 페이지 콘텐츠를 읽거나 수집하는 일은 없습니다.

**English**
The Extension requests access to all sites (`<all_urls>`) at install time. While this looks broad, it is required by the nature of a blocking feature. The core feature lets users freely enter any website they want to block; the blocked set is decided by each user after installation and is unbounded, not predefined by the developer. Because the blocking feature must work on **whatever site the user adds to their block list**, the Extension cannot be scoped to a fixed list of domains and needs access to all sites. Concretely, this access is used only to (1) detect in-page (SPA) navigation on domains the user chose to block, and (2) redirect to the local block page (block.html). Again, no page content is read or collected.

---

## 4. 로컬 저장 vs 서버 전송 / Local Storage vs. Server Transmission

**한국어**
사용자의 모든 설정(차단 목록, 스케줄, 통계, 포모도로 설정, 차단 화면 배경 이미지 등)은 오직 브라우저 내부의 **`chrome.storage`(로컬 저장소)에만 저장**됩니다. **이 데이터는 어떤 서버로도 전송되지 않으며**, 개발자가 운영하는 서버는 존재하지 않습니다. 모든 데이터는 사용자의 기기 안에 머무릅니다.

사용자가 확장을 삭제하면 로컬에 저장된 데이터도 함께 제거됩니다.

**English**
All user settings (block lists, schedules, statistics, Pomodoro settings, block-screen background images, etc.) are stored **only in the browser's local `chrome.storage`**. **This data is never transmitted to any server**, and no developer-operated server exists. All data stays on the user's device. Uninstalling the Extension removes the locally stored data along with it.

---

## 5. Chrome 계정 동기화(`chrome.storage.sync`)에 대하여 / About Chrome Account Sync

**한국어**
본 확장은 일부 설정을 여러 기기에서 동일하게 사용할 수 있도록 크롬의 표준 동기화 기능(`chrome.storage.sync`)을 이용합니다. 이 경우 해당 설정 데이터는 **사용자 본인의 Google 계정 인프라를 통해** 사용자의 기기들 사이에서 이동·동기화됩니다.

여기서 분명히 구분해야 할 점은, 이 동기화는 **Google이 제공하는 브라우저 기본 기능**이며, 데이터가 이동하는 경로는 전적으로 **사용자 본인의 Google 계정**이라는 것입니다. **개발자는 이 동기화 데이터에 접근할 수 없고, 이를 별도로 수집하거나 개발자 서버로 가져오지 않습니다.** 이 데이터의 처리에는 Google의 개인정보 처리방침이 적용됩니다.

**English**
The Extension uses Chrome's standard sync feature (`chrome.storage.sync`) so that some settings can be shared across the user's devices. In this case, the setting data moves and syncs between the user's own devices **through the user's own Google account infrastructure**.

To be clear: this synchronization is a **built-in browser feature provided by Google**, and the data travels solely through the **user's own Google account**. **The developer cannot access this synced data and does not separately collect it or bring it to any developer server.** Google's privacy policy governs the handling of this data.

---

## 6. 제3자 공유·판매 / Third-Party Sharing and Sale

**한국어**
본 확장은 수집하는 데이터 자체가 없으므로, 어떠한 데이터도 제3자에게 판매하거나 공유하지 않습니다. 데이터를 신용평가·대출 심사 등 확장의 핵심 기능과 무관한 목적으로 사용하거나 전송하지 않습니다.

**English**
Because the Extension collects no data, it sells or shares no data with any third party. No data is used or transferred for purposes unrelated to the Extension's core functionality, such as creditworthiness or lending assessment.

---

## 7. 문의 / Contact

**한국어**
본 개인정보 처리방침이나 확장에 대한 문의는 아래로 연락해 주십시오.

**English**
For questions about this privacy policy or the Extension, please contact:

- **Email:** tbbbusiness33@gmail.com

---


