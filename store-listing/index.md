---
title: FocusBox — Privacy Policy
---

# FocusBox — Privacy Policy

_Last updated / 2026-07-24_ · [한국어](index-ko.md)

---

## 1. Overview

FocusBox is a Chrome extension that helps users manage their focus time through time-boxing and Pomodoro sessions by blocking websites the user chooses. **The Extension does not collect, store, or transmit any personal information or user data.** The developer has no access to any user data.

---

## 2. No Data Collection

The Extension transmits no data to any remote server. The codebase contains no external network calls (`fetch`, `XMLHttpRequest`, etc.), no analytics, and no trackers.

The only information the Extension processes to function is the **URL of the page currently being navigated to**. This URL is compared in real time against the user's own block list solely to decide whether to allow the navigation or redirect it to a local block page, and is discarded immediately afterward. **This URL is never stored, logged, transmitted off the device, or shared with anyone, including the developer.** The Extension does not read page content (text, images, form inputs); it only observes URL/navigation changes.

---

## 3. Why the Extension Requests Broad Host Access

The Extension requests access to all sites (`<all_urls>`) at install time. While this looks broad, it is required by the nature of a blocking feature. The core feature lets users freely enter any website they want to block; the blocked set is decided by each user after installation and is unbounded, not predefined by the developer. Because the blocking feature must work on **whatever site the user adds to their block list**, the Extension cannot be scoped to a fixed list of domains and needs access to all sites. Concretely, this access is used only to (1) detect in-page (SPA) navigation on domains the user chose to block, and (2) redirect to the local block page (block.html). Again, no page content is read or collected.

---

## 4. Local Storage

All user settings (block lists, schedules, statistics, Pomodoro settings, block-screen background images, etc.) are stored **only in the browser's local `chrome.storage`**. **This data is never transmitted to any server**, and no developer-operated server exists. All data stays on the user's device. Uninstalling the Extension removes the locally stored data along with it.

---

## 5. About Chrome Account Sync

The Extension uses Chrome's standard sync feature (`chrome.storage.sync`) so that some settings can be shared across the user's devices. In this case, the setting data moves and syncs between the user's own devices **through the user's own Google account infrastructure**.

To be clear: this synchronization is a **built-in browser feature provided by Google**, and the data travels solely through the **user's own Google account**. **The developer cannot access this synced data and does not separately collect it or bring it to any developer server.** Google's privacy policy governs the handling of this data.

---

## 6. Third-Party Sharing and Sale

Because the Extension collects no data, it sells or shares no data with any third party. No data is used or transferred for purposes unrelated to the Extension's core functionality, such as creditworthiness or lending assessment.

---

## 7. Contact

For questions about this privacy policy or the Extension, please contact:

- **Email:** tbbbusiness33@gmail.com
