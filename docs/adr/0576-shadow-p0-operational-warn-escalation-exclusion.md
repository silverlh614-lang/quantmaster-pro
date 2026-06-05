# ADR-0576 — SHADOW P0 Operational Warn Escalation Exclusion (SHADOW P0 에스컬레이션 제외)

@responsibility SHADOW(실거래 아님·학습) P0 operational warn 을 T1 ack 폐루프(재발송+60분 에스컬레이션)에서 제외 — 알림 전용, 가시성 보존.

## 상태

Accepted (2026-06-05)

## 컨텍스트

P0 operational warn(`server/observability/telegramCriticalAlertBridge.ts::emitTelegramCriticalAlert`)은
`sendTelegramAlert(priority:'CRITICAL')` → tier `T1_ALARM` → `ackTracker` 에 ack 등록 →
미확인 시 30분 재발송 + 60분 CRITICAL 에스컬레이션 폐루프에 들어간다.

문제: **SHADOW 모드 P0 warn 도 LIVE 와 동일하게 에스컬레이션**한다. 사용자 보고 —
`[T1 경보 60분 미확인 — 에스컬레이션]` 이 `P0 EXECUTION`(symbol=011070, mode=SHADOW)으로
반복 발생. SHADOW 는 paper-fill·학습 경로로 **실제 자금/주문이 없으며**(불변식 #8 실거래
차단 ≠ Shadow 차단), executionImpact 도 `SHADOW_EXECUTION_DEGRADED` /
`APPROVAL_FLOW_DEGRADED`(LIVE_ORDER_BLOCKED 아님)다. 즉 SHADOW P0 는 "학습 파이프라인
헬스" 신호이지 "운영자 즉시 대응 강제" 가 필요한 자금 비상이 아니다. 동일 urgency 의
60분 CRITICAL 에스컬레이션은 과도한 노이즈다.

계보: ADR-0042(개인 DM)·ADR-532(telegram noise)·ADR-0573(ack family 흡수, operationalWarn
확장 포함). 본 ADR 은 ADR-0573 이 줄인 *중복* 위에 SHADOW *에스컬레이션 자체*를 제거한다.

## 결정

- SHADOW / SHADOW_ONLY 모드 P0 operational warn 은 `requireAck:false` 로 발송한다 →
  T1 ack 미등록 → **재발송·60분 에스컬레이션 없음**. 단 **1회 발송으로 가시성은 보존**
  (Telegram + Railway 로그 + `/health` 등 다른 경로로 운영자 추적 가능, 불변식 #2 보존).
- LIVE / 모드 미상 P0 warn 은 기존 T1 ack 폐루프 + 에스컬레이션 **유지**(자금 위험 경로).
- ENV `SHADOW_P0_ACK_LOOP_ENABLED=true` 로 기존 동작(SHADOW 도 ack 루프) 즉시 복원(롤백).
  `=== 'true'` 정확 비교(ADR-0157). default 미설정 = SHADOW 에스컬레이션 제외(노이즈 해소).

## 결과 (Consequences)

- executionImpact = **NONE**: 알림 폐루프 진입 여부만 조정. 실주문/SourceSnapshot/Gate/
  사이징/Shadow 판단/hardStopLoss 무접촉. SHADOW Learning 표본 수집(불변식 #2)·실거래
  차단 분리(불변식 #8) 무영향 — 오히려 #8 에 정합.
- SHADOW P0 가시성: 1회 발송 보존. 미확인 추적이 필요하면 ENV 로 복원 가능.
- ADR-0573 ack family 흡수와 합성: LIVE P0 는 family 흡수(incident 당 1 ack)+에스컬레이션
  유지, SHADOW P0 는 ack 루프 자체 제외.

## 롤백 (Rollback)

ENV `SHADOW_P0_ACK_LOOP_ENABLED=true` 1줄 → SHADOW P0 도 기존 ack 루프/에스컬레이션 복원
(byte-equivalent 동작). 코드 revert 불요.

## 테스트 (Tests)

`server/observability/telegramCriticalAlertBridge.test.ts`:
- SHADOW P0 → `requireAck:false` 전파.
- LIVE P0 → `requireAck` 미설정(undefined) → 기존 ack 루프 유지.
- `SHADOW_P0_ACK_LOOP_ENABLED=true` → SHADOW 도 ack 루프 복원.
- (계승) ackFamilyKey correlationId/symbol+mode/글로벌 undefined.

## 불변식 (Invariants)

9대 불변식 VERBATIM 0줄. #1 Trading Engine liveness·#2 Shadow Learning 무정지·#8 실거래≠
Shadow 정합(SHADOW 알림 urgency 강등이 Shadow *판단/수집* 을 막지 않음). raw KIS/실주문 0.
