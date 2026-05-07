# ADR-0430 — Keep Shadow Learning alive under SELL_ONLY as counterfactual records

@responsibility SELL_ONLY / HARD_BLOCK 시점에도 실매수·가상계좌 체결·일반 shadow·provisional shadow 모두 차단 유지하되, 별도 *learning-only* counterfactual record 를 365일 영속한다. SELL_ONLY 는 실매수 차단, 학습 차단이 아니다.

## 배경

ADR-0425 (Gate Decision Router) 가 SELL_ONLY 를 HARD_BLOCK 으로 분류 + ADR-0426/0427 (R3 Provisional Shadow Lane) 는 HARD_BLOCK 시 null 반환. 운영 결과:

- `/scan_blockers` 에서 HARD_BLOCK / SELL_ONLY 일 때 `live=❌ paper=❌ shadow=❌ watch=❌`.
- R3 Provisional Shadow Lane 도 `blockedBy=HARD_BLOCK / SELL_ONLY` 로 `eligible=0, created=0`.
- 실매수 안전성 관점에서는 정합. **그러나 Shadow Learning 관점에서는 학습 샘플이 끊김.**

사용자 핵심 원칙 — *"Sell only 와 관계없이 shadow 는 365일 학습되어야 한다."* SELL_ONLY 일수록 학습 가치는 *오히려 크다* — 실제로 막은 후보가 이후 더 빠졌는지, 반등했는지, Gate 가 과잉 방어였는지 검증 필요.

## 결정

SELL_ONLY / HARD_BLOCK 상황에서도 실매수·가상체결·일반 shadow·provisional shadow 는 *100% 차단 유지*. 그 위에 **별도 learning-only counterfactual shadow record** 를 신설한다.

### 1. 핵심 불변식 (사용자 §C, 절대 변경 금지)

1. SELL_ONLY 는 실매수 차단이다.
2. SELL_ONLY 는 학습 차단이 아니다.
3. Shadow Learning 은 365일 계속되어야 한다.
4. HARD_BLOCK 에서도 learning-only counterfactual record 는 가능하다.
5. 단, `liveAllowed=false`, `paperAllowed=false`, `executionShadowAllowed=false` 는 유지한다.
6. learning-only shadow 는 virtual account cash/holdings/equity 를 절대 변경하지 않는다.
7. 일반 shadow buy / provisional shadow entry / counterfactual learning shadow 는 반드시 분리한다.
8. HARD_BLOCK reason 은 반드시 `blockedBy` / `reasons` 에 남긴다.
9. 이 PR 은 학습 기록 PR 이지 매매 정책 완화 PR 이 아니다.
10. KIS 주문 경로, Gate threshold, Gate2 기준, STRONG_BUY 조건은 절대 변경하지 않는다.

### 2. 신규 SSOT 모듈

**`server/trading/signalScanner/counterfactualShadowLearningLane.ts`** (~390 LoC):

- `CounterfactualShadowLearningLabel` — 5-value union (R3_COUNTERFACTUAL_UNDER_SELL_ONLY / UNDER_HARD_BLOCK / DATA_DEGRADED / GATE2_NOT_CONFIRMED / COUNTERFACTUAL_BLOCKED_BUY).
- `CounterfactualShadowLearningReason` — 12-value union (SELL_ONLY / HARD_BLOCK / R3_EARLY / GATE1_SURVIVOR / SOFT_DEGRADE_DATA / SECTOR_DATA_DEGRADED / SECTOR_DATA_STALE / DATA_UNAVAILABLE / GATE2_NOT_CONFIRMED / TRUE_WEAKNESS / NO_HARD_RISK_BYPASS_ATTEMPT / LEARNING_ONLY).
- `CounterfactualShadowLearningCandidate` schema (사용자 §B 정합):
  - `eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY'` literal — 일반 shadow buy / provisional 분리 마커.
  - `source: 'ADR-0430'` literal.
  - `learningOnly: true` / `provisional: false` / `executionShadow: false` literal.
  - `liveAllowed: false` / `paperAllowed: false` / `executionShadowAllowed: false` literal — TypeScript 강제 (호출자가 true 부여 시 컴파일 에러).
  - `virtualAccountImpact: 'NONE'` literal.
- `deriveCounterfactualShadowLearningCandidate(input)` 결정 트리 SSOT (사용자 §D, 절대 변경 금지):
  1. ENV `COUNTERFACTUAL_SHADOW_LEARNING_DISABLED=true` → null
  2. `regime !== 'R3_EARLY'` → null (학습 표본 R3_EARLY 한정)
  3. `!gate1Passed` → null (Gate1 생존자만)
  4. `technicalBreakdown` → null (학습 표본 오염, ADR-0425/0426 정합)
  5. `router.severity === 'TRUE_WEAKNESS'` → null
  6. `router.severity ∈ {SOFT_DEGRADE, WATCH_ONLY, REDUCED_ENTRY_CANDIDATE, FULL_ENTRY_CANDIDATE}` → null (Provisional / Normal path 우선, 사용자 §J)
  7. `gate2Passed === true` → null (정상 통과 경로)
  8. SELL_ONLY / HARD_BLOCK / emergencyStop / VIX / FOMC / liquidity / RRR / sizingBlocked / Router HARD_BLOCK 중 1+ 충족 → 후보 생성
  9. 그 외 → null (eligible 부재)
- `formatCounterfactualShadowLearningSection(input)` SSOT — `/scan_blockers` 출력.
- `summarizeCounterfactualShadowLearningCandidates(candidates)` 합성 헬퍼 (Top blockedBy / dominantLabel).
- `isCounterfactualShadowLearningDisabled()` ENV SSOT (ADR-0157 정확 비교).

### 3. 신규 영속 SSOT

**`server/persistence/counterfactualShadowLearningRepo.ts`** (~170 LoC):

- 영속 파일: `data/counterfactual-shadow-learning-ledger.json` (`COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE`).
- **절대 분리** (사용자 §"절대 하지 말 것" #8/#9):
  - `shadow-trades.json` (일반 shadow buy) ≠ counterfactual ledger.
  - `provisional-shadow-ledger.json` (ADR-0427) ≠ counterfactual ledger.
- API:
  - `loadCounterfactualShadowLearningLedger()` read-only.
  - `appendCounterfactualShadowLearningEntry({candidate, scanId, scannedAtKst})` — atomic write, FIFO 2000 trim, dedup.
  - `summarizeCounterfactualShadowLearningLedger()` — totalEntries / todayEntries / topBlockedBy / topLabels / latestEntries.
  - `buildCounterfactualShadowLearningDedupKey(scanId, symbol, nowKst?)` — `${scanId}:${symbol}:ADR-0430`.
  - `__resetCounterfactualShadowLearningLedgerForTests()` — 테스트 격리 전용.

### 4. Gate Decision Router 확장 (옵셔널 후방호환)

`GateDecisionRouterResult` 에 옵셔널 필드 2종 추가:
- `counterfactualLearningAllowed?: boolean`
- `learningShadowAllowed?: boolean` (UI alias, 동의어)

정책 매트릭스 (사용자 §E):
| Severity | live | paper | shadow | watch | counterfactualLearning |
|----------|------|-------|--------|-------|------------------------|
| HARD_BLOCK | ❌ | ❌ | ❌ | ❌ | ✅ (ENV 로 끌 수 있음) |
| TRUE_WEAKNESS | ❌ | ❌ | ❌ | ✅ | ❌ (학습 오염) |
| SOFT_DEGRADE | ❌ | ❌ | ✅ | ✅ | ✅ (Provisional 우선) |
| WATCH_ONLY | ❌ | ❌ | ✅ | ✅ | ✅ |
| REDUCED_ENTRY_CANDIDATE | ❌ | ❌ | ✅ | ✅ | ❌ (정상 shadow 가용) |
| FULL_ENTRY_CANDIDATE | ✅ | ✅ | ✅ | ✅ | ❌ (정상 매수 path) |
| UNKNOWN | ❌ | ❌ | ❌ | ✅ | ❌ (분류 데이터 부족) |

`formatGateDecisionRouterSection` 의 lanes 표시에 `learning=✅/❌` 추가 — UI 분리 표시.

### 5. ScanCounters / ScanSummary 확장 (옵셔널 후방호환)

`ScanCounters` 에 신규 필드:
```typescript
counterfactualShadowEligible: number;
counterfactualShadowCreated: number;
counterfactualShadowSkipped: number;
counterfactualShadowSkipReasons: Record<string, number>;
counterfactualShadowCandidates: CounterfactualShadowLearningCandidate[];
```

`ScanSummary.counterfactualShadowLearning?` 옵셔널 — `summarizeCounterfactualShadowLearningCandidates` 결과 + skip 메타 영속. eligible=0 시 `noEligibleReason` 합성 (DISABLED / no Gate1 survivor / regime 외 / TRUE_WEAKNESS / SOFT_DEGRADE / Provisional 우선).

### 6. buyListLoop wiring

ADR-0427 provisional wiring 직후 try/catch 격리로 Counterfactual SSOT 호출. SSOT 자체 우선순위 enforcement (SOFT_DEGRADE/WATCH_ONLY/REDUCED/FULL → null) 로 둘 다 동시 생성 방지.

본 PR scope 한정 — buyListLoop 진입은 이미 `sellOnly=false` (preflight 사전 차단) 라 *종목별 HARD_BLOCK* (SIZING_BLOCKED, RRR, technical) 시점에만 발화. 진정한 universe-level SELL_ONLY wiring (preflight pre-abort) 은 후속 PR scope.

### 7. /scan_blockers 출력

ADR-0427 provisional 다음에 자동 노출:

```
🧠 Counterfactual Shadow Learning (ADR-0430)
  • learningOnly: ✅
  • eligible: 5
  • created: 5
  • executionImpact: NONE
  • lanes: live=❌ paper=❌ shadow=❌ learning=✅
  • label: R3_COUNTERFACTUAL_UNDER_SELL_ONLY
  • blockedBy:
    1. SELL_ONLY
  • note: 실매수/가상계좌 체결/일반 shadow 는 차단 유지. "그때 샀다면?" 학습 샘플만 별도 ledger 에 기록 (ADR-0430).
```

### 8. ENV 우회

`COUNTERFACTUAL_SHADOW_LEARNING_DISABLED=true` (default OFF, ADR-0157 정확 비교) — 1줄 즉시 비활성. emergencyStop 정책에서도 동일 ENV 로 끌 수 있음 (사용자 §E 정책 분기).

## 안전 invariant

- KIS 주문 함수 5종 import 0건 (정적 grep 가드).
- `autoTradeEngine` / `orderExecutor` / `trancheExecutor` / `shadowTradeRepo` / `provisionalShadowLedger` import 0건.
- virtual account 함수 (setHoldings/setCash/updateEquity) 호출 0건.
- Gate threshold / `MIN_GATE_OVERRIDE` / `STRONG_BUY_OVERRIDE` 0건.
- 외부 API 호출 0 (axios/fetch/node-fetch 부재).
- LIVE 매매 본체 0줄 변경.
- TypeScript literal types 강제 — `liveAllowed: false` / `paperAllowed: false` / `executionShadowAllowed: false` / `virtualAccountImpact: 'NONE'`.

## 잘못된 해결 방법 영구 차단

1. SELL_ONLY 자체 우회·해제 — 실매수 안전성 위반.
2. KIS order / autoTradeEngine 주문 path 변경 — 절대 규칙 #2/#4 위반.
3. Gate threshold 또는 Gate2 통과 기준 완화 — 학습 PR 이 아닌 매매 정책 PR 으로 변질.
4. STRONG_BUY 조건 변경.
5. virtual account holdings/cash 변경 — learning-only invariant 위반.
6. 기존 `shadow-trades.json` 에 learning-only record 섞기 — 일반 shadow buy 통계 오염.
7. `provisional-shadow-ledger.json` 에 execution-style entry 로 섞기 — ADR-0427 schema 오염.
8. SectorEnergy DEGRADED/STOCK_DAILY 를 OK 로 승격.
9. investor-flow semantic availability 재수정.
10. 외부 API 호출 추가.
11. `last 7 days gate_audit reset`.
12. Counterfactual 과 Provisional 동시 생성 (우선순위 위반).

## 회귀 테스트 (28 케이스)

`counterfactualShadowLearningLaneAdr0430.test.ts`:

- §K-1: SELL_ONLY + R3_EARLY + Gate1 → counterfactual entry 생성 + 모든 literal 검증.
- §K-2: HARD_BLOCK + SELL_ONLY 분리 정책 (provisional vs counterfactual source 마커).
- §K-3: SOFT_DEGRADE → null (Provisional 우선).
- §K-4: FULL_ENTRY_CANDIDATE → null (정상 path).
- §K-5: Gate1 미통과 → null.
- §K-6: SSOT 동일 입력 동일 후보 생성.
- §K-7+§K-8: 영속 분리 (`COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE` ≠ `SHADOW_FILE` ≠ `PROVISIONAL_SHADOW_LEDGER_FILE`).
- §K-9: virtualAccountImpact 항상 NONE.
- §K-10: formatter learningOnly + executionImpact NONE + blockedBy 표시.
- §K-11: Router formatter `shadow=❌ learning=✅` 모순 없이 표시.
- §K-12 + §K-12b: ENV DISABLED + 정확 비교.
- §K-13: emergencyStop 정책 (label EMERGENCY_STOP).
- §K-14 + §K-14b: 정적 grep 가드 (KIS 주문 5종 / autoTradeEngine / orderExecutor / shadowTradeRepo / virtual account 변경 함수 / Gate threshold / 외부 API 모두 부재).
- 추가 — append/load round-trip / dedup 차단 / summarize ledger / Router learning lane 4 분기.

## 검증

- vitest 신규 28/28 + 인접 server/trading/signalScanner + persistence 757/757 무회귀.
- LIVE 매매 본체 0줄 변경 (`signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*`).
- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4).
- ADR-0146 PR 자가 review 5 카테고리 PASS.
- ADR-0148 4 정적 검증 baseline 무회귀.

## 잔여 후속 PR

- **ADR-0431** — Counterfactual Shadow Performance Report (`/shadow_counterfactual` 텔레그램, ADR-0428 패턴 차용).
- **ADR-0432** — Provisional / Counterfactual promotion rules (성과 누적 후).
- **ADR-0433** — Universe-level SELL_ONLY wiring (preflight pre-abort 시점, watchlist 전체 후보 영속).
- 실제 paper / live 검토 — 충분한 성과 누적 후 별도 ADR.

## 거버넌스

- ADR-0146 PR 자가 review 5 카테고리 PASS.
- ADR-0148 4 정적 검증 baseline 무회귀.
- ADR-0157 ENV 정확 비교 의무 (`=== 'true'`).
- ADR-0159 별칭 정책 — 0430 신규 (충돌 없음).
- INDEX.md 다음 발급 0430 → 0431 + 전체 인덱스 0430 등재.
