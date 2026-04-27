# ADR-0077: TradeSignalStatus 상태머신 — AI 추천→자동매매 명시적 전이 영속 SSOT

- 일자: 2026-04-27
- 상태: ACCEPTED
- 작성자: QuantMaster Harness (orchestrator)
- 관련: ADR-0019 (RecommendationSnapshot), ADR-0029 (ConditionSourceTier), ADR-0036 (BudgetPolicy), ADR-0072 (EntryCircuitBreaker), 절대 규칙 #2/#3/#4

## 1. 배경

사용자 audit 결과 — AI 추천(`StockRecommendation`)이 `signalScanner` 의
`addRecommendation` 호출 직후부터 buyApproval 큐에 진입하기까지의 경로에 다음 7
단계 게이트가 작동 중:

1. AI 추천 발생 (signalScanner perSymbolEvaluation)
2. EntryGate Phase B 7 게이트 (cooldown / blacklist / addBuyBlock / rrr / sectorConcentration / sectorPreGuard / portfolioRisk — ADR-0030)
3. RevalidationStep 5 단계 (kisIntradayCorrection / yahooAvailability / mtas / sellOnlyException / entryRevalidation — ADR-0031)
4. SizingDecider 3 (sizingTier / kellyBudget / stopLossPolicy — ADR-0031)
5. EnemyCheck 데이터 수집 (현재 관찰 레이어만, ADR-0031 후속)
6. buyApproval 텔레그램 사용자 승인 (Telegram 인라인 키보드)
7. trancheExecutor / orderDispatch 실주문

게이트는 모두 작동하지만 **각 단계의 통과·차단 결과가 영속화되지 않아** 운영자가
"이 종목이 어느 단계에서 멈췄는지" 즉시 추적 불가. Telegram 알림은 일부 단계만
발송되고, 일관된 SSOT 부재.

## 2. 결정

`TradeSignalStatus` 6 단계 상태머신을 명시적 영속 SSOT 로 도입한다. 본 ADR 은
**상태 *기록 레이어* 만 추가** — 차단·통과 결정은 기존 게이트 본체 그대로
사용하며, 기존 게이트 함수 시그니처/본체는 0 줄 수정.

### 2.1 상태 union (6 값)

```ts
export type TradeSignalStatus =
  | 'AI_CANDIDATE'      // signalScanner 가 후보 발견 직후 (addRecommendation 시점)
  | 'DATA_VERIFIED'     // entryRevalidationStep 통과 후 (kisIntradayCorrection + Gate 재검증 통과)
  | 'RISK_APPROVED'     // sectorConcentration / portfolioRisk / kellyBudget 모두 통과 후
  | 'USER_APPROVED'     // 텔레그램 사용자 승인 (buy_approve callback) 또는 자동 승인 정책
  | 'AUTO_TRADE_READY'  // 실주문 직전 (createBuyTask.execute 진입 직전)
  | 'BLOCKED';          // 어느 단계든 차단 (blockGate + blockReason 별도 필드)
```

`AUTO_TRADE_READY` 와 `BLOCKED` 는 terminal — 이후 전이 불가.

### 2.2 상태 전이 매트릭스 (canTransition SSOT)

| from \ to        | AI_CANDIDATE | DATA_VERIFIED | RISK_APPROVED | USER_APPROVED | AUTO_TRADE_READY | BLOCKED |
|------------------|--------------|---------------|---------------|---------------|------------------|---------|
| (initial)        | ✅           | ❌            | ❌            | ❌            | ❌               | ❌      |
| AI_CANDIDATE     | ❌           | ✅            | ❌            | ❌            | ❌               | ✅      |
| DATA_VERIFIED    | ❌           | ❌            | ✅            | ❌            | ❌               | ✅      |
| RISK_APPROVED    | ❌           | ❌            | ❌            | ✅ (수동/자동) | ❌               | ✅      |
| USER_APPROVED    | ❌           | ❌            | ❌            | ❌            | ✅               | ✅      |
| AUTO_TRADE_READY | ❌           | ❌            | ❌            | ❌            | ❌ (terminal)    | ❌      |
| BLOCKED          | ❌           | ❌            | ❌            | ❌            | ❌ (terminal)    | ❌      |

**예외 — RISK_APPROVED → AUTO_TRADE_READY 직접 전이 허용**: SHADOW 모드 또는
향후 자동 승인 정책(레짐별 auto-approve, ADR 별도 필요) 도입 시. 본 PR 에서는
SHADOW 만 활용 — buyApproval 가 SHADOW 인지 명시적 검증 후 직접 전이.

### 2.3 BlockGate 분류 (12 값)

```ts
export type TradeSignalBlockGate =
  | 'DATA'                  // entryRevalidationStep 데이터 무결성 실패
  | 'GATE_0'                // 시장 레짐 R6_DEFENSE 등 차단
  | 'GATE_1'                // 종목 생존 필터
  | 'GATE_2'                // 성장/수급 검증
  | 'GATE_3'                // 타이밍 검증
  | 'RISK_BUDGET'           // accountRiskBudget / kellyBudgetDecider 차단
  | 'SECTOR'                // sectorConcentrationGate / sectorPreGuardGate
  | 'PORTFOLIO'             // portfolioRiskGate
  | 'ENEMY'                 // enemyCheck (향후 자동 차단)
  | 'USER_REJECT'           // 텔레그램 buy_reject
  | 'AUTO_TRADE_DISABLED'   // process.env.AUTO_TRADE_ENABLED !== 'true'
  | 'EMERGENCY_STOP'        // getEmergencyStop() === true
  | 'OTHER';                // 그 외 (logMessage 본문 보존)
```

### 2.4 TradeSignalRecord 영속 schema

```ts
export interface TradeSignalTransition {
  from: TradeSignalStatus | null;   // null = 초기 진입
  to: TradeSignalStatus;
  reason: string;                   // 사람이 읽는 본문 (예: "Gate 1: 4/5 통과")
  at: string;                       // ISO timestamp
}

export interface TradeSignalRecord {
  id: string;                       // signalId = `${signalTimeIso}:${stockCode}`
  stockCode: string;
  stockName: string;
  status: TradeSignalStatus;        // 현재 상태 (transitions 배열 마지막 to 와 동일)
  recommendationType: 'STRONG_BUY' | 'BUY' | 'CONFIRMED_STRONG_BUY';
  signalGateScore?: number;         // signalScanner 의 weightedGateScore
  createdAt: string;                // AI_CANDIDATE 진입 ISO
  transitions: TradeSignalTransition[];
  blockReason?: string;             // status === 'BLOCKED' 시 사유 본문
  blockGate?: TradeSignalBlockGate; // status === 'BLOCKED' 시 분류
  finalizedAt?: string;             // status ∈ {AUTO_TRADE_READY, BLOCKED} 도달 ISO
  schemaVersion: 1;
}
```

### 2.5 영속 정책

- 파일: `data/trade-signal-status.json` (paths.ts 의 `TRADE_SIGNAL_STATUS_FILE`)
- atomic write (tmp → rename, 다른 영속 모듈 패턴 차용)
- FIFO trim 1000 건 (최근 추천 우선) — 영속 파일 비대화 차단
- `appendTransition(id, to, reason, gate?)` 멱등: 동일 (id, currentStatus, to) 중복 시 silent skip
- 손상 JSON / 빈 파일 / null / array → 빈 배열 fallback (시스템 무중단)

### 2.6 wiring 정책 (4 진입점)

| 진입점                                                     | 호출 함수                          | from              | to               |
|-----------------------------------------------------------|------------------------------------|-------------------|------------------|
| `signalScanner.ts:~70` `addRecommendation` 직후           | `recordAiCandidate(...)`           | (initial)         | AI_CANDIDATE     |
| `perSymbolEvaluation` `entryRevalidationStep` proceed 후  | `markDataVerified(id, gateScore)`  | AI_CANDIDATE      | DATA_VERIFIED    |
| `perSymbolEvaluation` 모든 게이트 통과 + sized 결정 후    | `markRiskApproved(id, reason)`     | DATA_VERIFIED     | RISK_APPROVED    |
| `buyApproval.ts:208` `buy_approve` callback              | `markUserApproved(id, by)`         | RISK_APPROVED     | USER_APPROVED    |
| `buyApproval.ts:208` `buy_reject` callback               | `markBlocked(id, 'USER_REJECT')`   | RISK_APPROVED     | BLOCKED          |
| `buyPipeline.ts createBuyTask.execute` 직전              | `markAutoTradeReady(id)`           | USER_APPROVED     | AUTO_TRADE_READY |
| 어느 게이트든 차단 시                                       | `markBlocked(id, gate, reason)`    | (current)         | BLOCKED          |

**핵심**: 모든 wiring 은 `try { ... } catch (e) { console.warn(...) }` 로 감싸서
영속 실패가 매매 게이트 결정을 차단하지 않도록 보장.

### 2.7 Telegram /signal_status 진단 명령

운영자가 텔레그램에서 `/signal_status [N]` 입력 시 최근 N 건 (기본 10, 최대 30)
TradeSignalRecord 를 표 형식으로 노출. 각 종목의 현재 상태 + 마지막 전이 시각 +
BLOCKED 면 사유 + 게이트.

응답 예:
```
📊 신호 상태 (최근 10건)

✅ 005930 삼성전자 — AUTO_TRADE_READY (15:42)
🟡 035420 NAVER — RISK_APPROVED (15:41) — 사용자 승인 대기
❌ 247540 에코프로 — BLOCKED (15:40) — SECTOR (배터리 32% 초과)
❌ 042700 한미반도체 — BLOCKED (15:38) — GATE_1 (RRR 1.2 < 2.0)
🟢 028260 삼성물산 — DATA_VERIFIED (15:35) — 리스크 평가 중
```

## 3. 대안 검토

### A) 메모리 only Map (영속 미수행)
- ❌ 재시작 시 모든 상태 손실
- ❌ 운영자 진단 불가능
- ✅ 가장 단순

### B) 기존 RecommendationSnapshot 확장 (PR-B)
- ❌ RecommendationSnapshot 은 lifecycle (PENDING/OPEN/CLOSED) 추적용 — 의미 다름
- ❌ 두 SSOT 가 결합되면 둘 다 망가짐
- ✅ 신규 영속 파일 0개

### C) 본 ADR (별도 영속 SSOT) ← 채택
- ✅ 단일 책임 명확
- ✅ 운영자 진단 즉시 가능
- ✅ 다른 SSOT (RecommendationSnapshot, RecommendationRecord) 와 독립
- 비용: 영속 파일 +1, 모듈 +1

## 4. 회귀 위험 분석

본 PR 은 **상태 *기록*만** — 차단 로직 0 줄 변경. 위험 시나리오 분석:

1. **영속 실패 시 매매 차단?** → 모든 wiring 이 try/catch 로 감싸짐. 영속 throw 시
   console.warn 만, 게이트 결정 그대로 진행.
2. **wiring 코드 자체가 throw 하면?** → 신규 호출 위치는 모두 게이트 통과 *후* 또는
   결정 *직후*. 동기 순수 함수만 호출 (recordAiCandidate / markDataVerified 등).
   throw 가능성 0 (입력 검증만 수행).
3. **상태 영속 파일 손상 시?** → loadTradeSignalRecords 가 빈 배열 fallback. 다음
   appendTransition 부터 새 파일 자연 생성.
4. **AUTO_TRADE_READY 도달 후 KIS 주문 실패?** → 본 PR 은 AUTO_TRADE_READY 까지만
   추적. 실주문 결과는 기존 fillMonitor / orderQueue 영속 (TradeEvent / shadowTrade).
5. **terminal 상태 강제 전이 시도?** → canTransition 매트릭스 false 반환 → silent
   skip. 호출자에게 throw 안 함.

LIVE 자동매매 본체 0 줄 변경 (절대 규칙 #4 준수). KIS 호출 0 건 (절대 규칙 #2).
서버↔클라 직접 import 없음 (절대 규칙 #3 — 본 PR 은 서버 측 only).

## 5. 후속 PR (본 PR scope 밖)

- **UI 카드** (`AutoTradePage` 의 "신호 상태" 섹션): 영속 데이터 시각화. 본 PR
  데이터 누적 후 별도 PR.
- **Auto Approval 정책** (Gap 3 대응): RISK_APPROVED → USER_APPROVED 자동 전이를
  레짐/Kelly/EnemyCheck 조건으로 수행. 별도 ADR.
- **Enemy Checklist 자동 차단** (Gap 2 잔여): markBlocked('ENEMY', ...) 호출자
  enemyCheckClient 결과 기반 자동 wiring. 별도 PR (운영 데이터 누적 후 임계 결정).

## 6. 검증 체크리스트

- [ ] vitest server/persistence/tradeSignalStatusRepo.test.ts ≥ 12 케이스
- [ ] vitest server/telegram/commands/system/signalStatus.test.ts ≥ 6 케이스
- [ ] vitest 4 wiring 위치 단위 테스트 ≥ 8 케이스 (각 진입점 mock)
- [ ] lint(client + server tsc) + validate:all 8 종 + ALLOW_DEPLOY_WINDOW=1 precommit
- [ ] 기존 신호/매매/Gate 회귀 테스트 0 건 깨짐
- [ ] LIVE 매매 본체 0 줄 변경 검증 (`git diff --stat` 에 entryEngine / kisClient / autoTradeEngine 부재)
