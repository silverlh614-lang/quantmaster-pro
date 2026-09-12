# QuantMaster Pro — 작업 규칙

공통 규칙은 이 파일 한 곳에서 관리한다. src는 화면·공유 타입, server는 매매·데이터·학습 엔진이다. 사용자 지시가 우선한다.

## 9대 불변식

1. Trading Engine은 항상 살아 있어야 한다.
2. Shadow Learning은 어떤 상황에서도 멈추면 안 된다.
3. 모든 판단은 단일 SourceSnapshot에서 출발한다.
4. R6, SELL_ONLY, HOLIDAY, 장전/장후, providerIssue는 SourceSnapshot을 바꾸지 않는다.
5. 위 상태들은 Policy, Confidence, ExecutionPermission, LearningLabel만 바꾼다.
6. Provider 장애는 market signal이 아니다.
7. AI_ESTIMATED 데이터는 live execution에 사용하면 안 된다.
8. 실거래 차단과 Shadow 판단 차단은 분리한다.
9. SourceSnapshot을 우회하여 Gate 내부에서 provider를 직접 조회하지 않는다.

## 필수 경계

- KIS 호출은 server/clients/kisClient.ts, 실주문은 서버 autoTradeEngine 단일 통로로 처리한다. 클라이언트 실주문 금지.
- 자동매매·스크리너 데이터는 stockService, AI 추천 종목 발굴은 aiUniverseService 경유. Gate 내부 provider 직접 조회 금지.
- 데이터 신뢰: L1(KIS/KRX) 매매, L2(FRED/ECOS/DART) Gate, L3(Yahoo/Naver) 신선도 확인 후 최후 fallback, L4(AI 추정) 참조 전용. KIS가 제공 가능한 데이터의 Yahoo 우선 사용 금지.
- 신규 소스 파일 상단 20줄 내 @responsibility 25단어 이하. 파일 1,500줄 한도. 사유 없는 silent catch 금지.
- 기존 거래 원장·실주문 안전장치·공급자 경계는 문서/정리 작업에서 변경하지 않는다.

## 최소 작업 절차

1. 기본은 에이전트 하나다. 역할별 에이전트·하네스·인계 문서를 자동 생성하지 않는다. 병렬 위임은 사용자가 요청할 때만 한다.
2. rg로 관련 파일과 구간만 읽는다. 이미 읽은 규칙을 반복 로드하거나 인덱스·이력 전체를 읽지 않는다. ARCHITECTURE.md도 대상 모듈만 확인한다.
3. 수정 전 범위·동작 영향·검증·복구 방법을 짧게 정한다. 별도 계획서/보고서/작업 폴더는 기본적으로 만들지 않는다.
4. 필요한 변경만 한다. 설명용 계층·타입·flag·별칭·작은 파일을 불필요하게 추가하지 않는다. 계산값과 긴 설명의 중복 저장을 피한다.
5. 새 매매 정책·안전 경계·모듈 경계 결정만 간결한 ADR로 남긴다. 단순 수정·문서 정리는 ADR 없이 진행한다. 번호는 docs/adr/INDEX.md의 다음 발급을 따른다.
6. 기록은 docs/ai/10-patch-history-index.md 한 줄과 Git 커밋을 기본으로 한다. 최근 20건만 간결히 유지하며 오래된 상세는 Git에서 조회한다. 별도 보고서·중복 로그 사본은 요청 또는 복구에 필요한 경우에만 남긴다.
7. 변경에 맞는 검사·테스트를 실행한다. 소스 변경 시 lint와 관련 테스트, 커밋 전 validate:all, 실제 precommit 훅을 통과한다. 실패 은폐·훅 우회 금지. 통과한 검사를 이유 없이 반복하지 않는다.
8. 검증 후 커밋하고 설정된 원격 추적 브랜치로 푸시한다(사용자 상시 승인, 2026-09-12). 원격 반영을 확인한다. 결과는 변경·검증·남은 문제만 짧게 보고한다.

## 필요할 때만 읽기

| 작업 | 참고 |
|---|---|
| 원칙·데이터 신뢰 | docs/ai/00-project-charter.md |
| 경계·구조 | ARCHITECTURE.md, docs/ai/01-architecture-map.md |
| 엔진·실행·사이징 | docs/ai/02-trading-engine-rules.md |
| Snapshot | docs/ai/03-source-snapshot-ssot.md |
| Gate | docs/ai/04-gate-system.md |
| Provider | docs/ai/05-provider-policy.md |
| Telegram | docs/ai/06-telegram-policy.md |
| 학습 | docs/ai/07-learning-engine.md |
| 검증·리팩터링 | docs/ai/08-testing-checklist.md, docs/ai/09-refactor-rules.md |
| 장애 대응 | docs/incident-playbook.md |
