# ADR-0146 — R3 Sanity Block 텔레그램 간편 해제 명령 도입

**Status**: Accepted
**Date**: 2026-05-03
**Context**:
ADR-0120 (R3 Sanity Check)에 의해 `R3_EARLY` 등의 우호적 시장 환경에서 매수 신호가 없을 경우, 시스템 결함(Data Stale, 파이프라인 누락 등)을 의심하여 자동매매를 차단(R3 Sanity Block)하고 있다.
기존에는 이를 해제하기 위해 서버 환경변수(`R3_SANITY_OPERATOR_ACK`)를 셸에서 직접 수정하거나 서버를 재시작해야 하는 운영상 큰 불편함과 딜레이가 존재했다.

**Decision**:
1. 텔레그램 시스템 명령어 `/sanity` (alias: `/r3sanity`, `/r3`)를 새로 도입한다.
2. `/sanity` 입력 시 현재 R3 Sanity Block의 활성화 여부, 위반 사유, 발동 시간을 즉시 반환한다.
3. `/sanity ack` (또는 `unlock`) 입력 시, 발동 시점의 `triggeredAt` 값을 `process.env.R3_SANITY_OPERATOR_ACK`에 주입하고 `acknowledgeR3SanityBlock()`을 호출하여 서버 재시작 없이 차단을 즉각 해제한다.

**Consequences**:
- **Positive**: 운영자가 외부에서 모바일 메신저를 통해서도 즉각적인 Sanity Block 해제가 가능해져, 시스템 결함 오탐지 시 자동매매 복구 리드타임이 비약적으로 단축된다.
- **Positive**: 환경변수 조작이라는 Low-level 인터페이스를 텔레그램 챗봇이라는 High-level 인터페이스로 격상했다.
- **Negative**: 인가되지 않은 사용자가 차단 해제를 시도할 수 있다.
  - *Mitigation*: 명령어 속성에 `riskLevel: 1`, `visibility: 'ADMIN'`을 부여하여, 기존 텔레그램 봇의 보안 및 채널/관리자 인가 통제 체계에 권한 검증을 위임한다.