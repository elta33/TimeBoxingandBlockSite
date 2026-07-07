# TBB (FocusBox) — 프로젝트 지침

## 응답 언어

이 프로젝트에서 대화할 때는 항상 한국어로 답변한다. 코드/커밋 메시지/파일 내 기존 언어 관례는 그대로 따르되, 사용자에게 하는 설명·질문·요약은 한국어를 사용한다.

## 검증 워크플로우 지침

이 프로젝트는 dev 서버가 없는 Manifest V3 크롬 확장이다. `options.html`/`popup.html`/`block.html`을 일반 웹페이지처럼 브라우저 탭에 띄워도 `chrome.storage`, `chrome.declarativeNetRequest`, `chrome.alarms`, `chrome.tabs` 등 확장 API가 없는 컨텍스트라서 실제 동작(저장, 차단, 알람)은 검증되지 않는다.

## 검증 규칙

- **Claude Preview(mcp__Claude_Preview__*)를 기본 검증 수단으로 쓰지 않는다.** "UI 변경이면 브라우저에서 확인" 같은 범용 지침보다 이 지침이 우선한다.
- 기본 검증은 **사용자가 직접** `chrome://extensions`에 unpacked로 로드해서 확인한다. 코드 수정 후 완료 보고 시 "브라우저에서 확인했다"고 말하지 말고, 로직을 추적한 근거만 설명한다.
- Preview는 순수 레이아웃/CSS 확인(정적 마크업 확인) 용도로만, 필요할 때 명시적으로 언급하고 사용한다. 그 결과를 기능 검증의 근거로 제시하지 않는다.
- DNR 우선순위 변경, storage 마이그레이션, 알람↔setTimeout 경쟁 조건처럼 조용히 깨져도 티가 안 나는 고위험 변경에 한해서만, 사용자가 명시적으로 요청하면 `claude-in-chrome`으로 unpacked 확장을 1차 스모크 테스트할 수 있다. 이는 사용자의 실제 크롬 프로필을 건드리는 행위이므로 기본값이 아니라 예외로 취급한다.
