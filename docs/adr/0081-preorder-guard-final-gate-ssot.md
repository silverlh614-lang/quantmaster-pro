# ADR-0081 — preOrderGuard Final Gate SSOT (assertSafeOrder Pre-Order 통합 게이트)

## 상태

Accepted (2026-04-28)

## 컨텍스트

`server/trading/preOrderGuard.ts` `assertSafeOrder` 가 LIVE 주문 직전 final
게이트로 작동하지만, 본 ADR 이전에는 **3 가드 (POSITION_EXPLOSION /
STOPLOSS_LOGIC_BROKEN / ORDER_LOOP_SUSPECT)** 만 검증. `getEmergencyStop()` 과
`getDailyLossPct()` 검증이 *부재* 했다.

상위 가드 (cron 진입점) 는 `orchestratorJobs.ts:19` tick 진입부에서 차단:
```ts
if (getEmergencyStop()) return; // tick skip
```

하지만 *cron 외 진입점* 에서 buyPipeline 이 호출되면 우회 가능:
- 텔레그램 `/buy <code>` 명령
- `POST /api/auto-trade/tranches/run` HTTP 엔드포인트
- `POST /api/auto-trade/tranches/manual-add` 수동 트랜치 추가
- `runAutoSignalScan({ forceBuyCodes })` 외부 호출

PR-52 H1 fix 가 `tranchesRouter:25` + `trancheExecutor` 본체에
`AUTO_TRADE_ENABLED` 가드를 추가했지만 **emergencyStop / dailyLossLimit 가드는
부재**. 운영자가 `/stop` 으로 `setEmergencyStop(true)` 설정 후 *기존 PENDING
트랜치* 를 외부 HTTP 호출로 강제 실행시키면 KIS 실주문 발송 가능 — *잠재 LIVE
자본 손실 위험*.

## 결정

`assertSafeOrder` 진입부에 **final 게이트 SSOT 통합**. 모든 LIVE 주문 진입점이
단일 SSOT 함수 통과 → 우회 차단.

### 1. 신규 PreOrderGuardReason 2종

```ts
export type PreOrderGuardReason =
  | 'POSITION_EXPLOSION'
  | 'STOPLOSS_LOGIC_BROKEN'
  | 'ORDER_LOOP_SUSPECT'
  | 'EMERGENCY_STOP_ACTIVE'    // PR-Z7 H2 신규
  | 'DAILY_LOSS_LIMIT_HIT';    // PR-Z7 H2 신규
```

### 2. 가드 우선순위 (assertSafeOrder 진입부)

```
0-A) emergencyStop active → fireKillSwitch('EMERGENCY_STOP_ACTIVE')
0-B) dailyLossPct >= DAILY_LOSS_LIMIT → fireKillSwitch('DAILY_LOSS_LIMIT_HIT')
1)   POSITION_EXPLOSION (기존)
2)   STOPLOSS_LOGIC_BROKEN (기존)
3)   ORDER_LOOP_SUSPECT (기존)
```

신규 가드 2개가 *최우선* — 기존 3 가드보다 먼저 검증해 emergencyStop 상태에서
잘못된 주문이 다른 가드 incident 까지 발생시키는 노이즈 차단.

### 3. DAILY_LOSS_LIMIT 임계 SSOT

`process.env.DAILY_LOSS_LIMIT` (default `'5'`) — `emergency.ts:87` +
`overrideExecutor.ts:64` 와 동일 SSOT 재사용. 임계 정책 단일.

### 4. fireKillSwitch 부수효과 (기존 패턴 보존)

가드 위반 시:
1. `recordIncident()` 영속 — 운영자가 *어떤 종목/경로가 우회를 시도했는지* 추적
2. `setEmergencyStop(true)` — idempotent (이미 active 면 무영향)
3. `cancelAllPendingOrders()` — fire-and-forget
4. CRITICAL 텔레그램 알림 — dedupeKey `pre-order-guard-${reason}`
5. `sendBlastRadiusReport()` — 오염 반경 산정
6. `throw PreOrderGuardError` — 호출자가 catch 해 REJECTED 처리

### 5. NaN/Infinity 안전 가드

`getDailyLossPct()` 가 NaN 반환 시 (state 손상) 비교 false → 통과 (기존 동작
보존). 운영자에게 잘못된 차단 시그널 발생 차단.

## 결과

### 효과

- **모든 LIVE 진입점 우회 차단** — cron / 텔레그램 / HTTP / 외부 호출 4 경로
  모두 assertSafeOrder 단일 SSOT 통과.
- **incident 추적 강화** — 어떤 경로/종목이 우회 시도했는지 영속 기록 →
  운영자가 *왜* 우회가 일어났는지 사후 분석 가능.
- **DAILY_LOSS_LIMIT_HIT 추가** — 일일 손실 한도 도달 후 신규 진입을 *주문
  직전* 까지 보호. 사용자 자본 추가 손실 차단.

### 회귀 위험

- **기존 3 가드 호출 패턴 변경 0** — `assertSafeOrder(ctx)` 시그니처 무수정,
  PreOrderContext 인터페이스 무수정.
- **회귀 테스트 8 케이스 신규** — 정상 통과 / EMERGENCY_STOP_ACTIVE /
  DAILY_LOSS_LIMIT_HIT / 경계값 / 미달 / env override / 우선순위 충돌 / NaN
  안전 / 신규 가드 우선순위.
- **state 모듈 leak 격리** — afterEach 에서 `setEmergencyStop(false) +
  setDailyLoss(0)` reset 으로 다른 테스트 영향 차단.

### LIVE 자동매매 본체 0줄 변경

- `kisClient` / `autoTradeEngine` / `orchestrator` / `signalScanner` 본체 무수정.
- `assertSafeOrder` 함수 본체에 가드 2개 진입부 추가 + import 2종 추가.

## 대안 검토

| 대안 | 채택? | 사유 |
|------|------|------|
| (A) assertSafeOrder 진입부 통합 | ✅ | 본 ADR. 단일 SSOT, 모든 LIVE 진입점 우회 차단. |
| (B) 각 진입점별 개별 가드 추가 | ❌ | 4+ 진입점 분산 → drift 위험. 신규 진입점 도입 시 누락 가능. |
| (C) buyPipeline 진입부 통합 | ❌ | assertSafeOrder 가 이미 buyPipeline 안 final gate — 더 깊은 위치 = 더 안전. |
| (D) tradingOrchestrator tick 통합 | ❌ | cron 진입점만 커버, HTTP/텔레그램 우회 못 차단. |

## 호환성

- `PreOrderGuardError` 클래스 시그니처 무수정 (reason 만 union 확장).
- 기존 호출자(buyPipeline) 의 try/catch 패턴 그대로 작동.
- ENV 오버라이드: `DAILY_LOSS_LIMIT` 기존 SSOT 재사용 (default 5%).

## 후속 PR (scope 외)

- `getAutoTradePaused()` / `getDataIntegrityBlocked()` / `getSmokeTestLiveBlocked()`
  가드 추가 — 본 ADR 의 패턴 그대로 적용 가능. 운영 데이터 누적 후 분리.
- DAILY_LOSS_LIMIT 동적 임계 (regime 별 조정) — kellyHalfLife 학습 기반.

## 페르소나 정합

- **자료 8번 — 손절은 운영비**: 일일 손실 한도가 *주문 직전 final 게이트* 까지
  보호되어 운영비가 통제 불가능 영역으로 폭주하는 것을 차단.
- **원칙 1번 — 필터링**: assertSafeOrder 가 *모든 LIVE 진입점 단일 필터* 로
  격상 — cron/텔레그램/HTTP 4 경로 무차별 차단.
- **자료 22번 — 단일 책임**: "주문 직전 최종 안전 검증" 책임이 단일 함수에
  통합 — 기존 3 가드 + 신규 2 가드 모두 동일 SSOT.
