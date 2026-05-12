# ADR-0505 — Gate1 Minimum Signal Score Forensic Audit

> **Status**: Accepted (2026-05-12)
> **Scope**: Diagnostic-only — `executionImpact: 'NONE'`, `liveExecutionAllowed: false`, `policyPromotionMode: 'SHADOW_ONLY'`
> **사용자 명시 ADR-0502 → 실제 발급 ADR-0505 정합** — INDEX.md SSOT 의 §"다음 발급" (ADR-0148 거버넌스 정책) 정합. 사용자 명시 *"ADR-0502 Gate1 Minimum Signal Forensic Audit"* 는 충돌 그룹 0502 (a=kis-official-investor-flow-promotion / b=kis-official-global-fallback-until-krx-recovery / c=krxclient-decomposition) 이미 머지 완료 상태라 신규 의미상 후속 ADR 로 0505 재할당 (ADR-0437/0501 동일 패턴).

## 문제

정상 레짐에서도 Shadow 매수 후보가 Gate1 또는 minimum signal score 단계에서 통과하지 못한다. 운영 로그에서 `gate1Pass=0` 또는 `minSignalRequiredScore=70 actualScore≈22 gap=-48` 패턴이 반복되지만, 그 *원인이 종목별·컴포넌트별로 어디서 발생하는지* 가 진단되지 않는다.

이전 ADR 들이 부분적으로 답했지만 한 화면에서 보이지 않는다:

| ADR | 범위 |
|-----|------|
| ADR-0420 | Gate1 fresh attribution (조건별 status 분해, 100점형 점수와 무관) |
| ADR-0422 | Gate2 fresh attribution (`gate1Pass>0` 후 분해) |
| ADR-0466 | Minimum signal score decomposition (raw component scores, 집계 분포) |
| ADR-0497 | Diagnostic taxonomy SSOT (provider vs market signal 의미 분리) |
| ADR-0500 | Empty Scan Root Cause Dashboard (전체 스캔 단위 집계) |

남은 갭 — **종목별 minimum signal score 100점형 채점이 어떤 positive component 의 부재 + 어떤 penalty 의 누적으로 부결됐는지** 를 1차 진단에서 즉시 답하지 못한다.

## 핵심 가설 (사용자 명시 직접 반영)

운영 로그 audit 결과 다음 5가지 패턴이 *동시에* 의심된다:

1. **WATCHLIST_UPSTREAM_SCORE 미import** — Watchlist 단계에서 산출된 upstream score 가 minimum signal score 100점형 컴포넌트에 0 으로 들어간다 (`confidence: MISSING`).
2. **RELATIVE_STRENGTH 입력 결손** — `return20d` / `kospi20dReturn` / `explicitRelativeStrength` 모두 부재.
3. **BREAKOUT_STRUCTURE 입력 결손** — `high20` / `high60` / VCP / breakout condition results 부재.
4. **SUPPLY_CONFLUENCE + INVESTOR_FLOW UNKNOWN penalty** — 데이터 부재가 *음수 점수 또는 0점* 으로 처리되어 score 가 임계 미달.
5. **SECTOR_ENERGY diagnostic/BLOCKED penalty** — `sectorBoost=0` + STRONG_BUY 차단 + minimum score 영향 layer 에서 작동, 운영자에게는 *"매수 차단"* 처럼 보임.

→ **Positive score starvation + UNKNOWN/provider penalty accumulation 의 결합 결함**.

## 두 점수 체계 분리 (사용자 명시 절대 변경 금지)

| 체계 | SSOT | 범위 | normalizedGateScore |
|------|------|------|---------------------|
| **evaluateServerGate raw score** | `server/quantFilter.ts` + `defaultRegistry.run().totalScore` | 17 evaluator, NORMAL 5점 / STRONG 7점 계열 | diagnostic 전용 |
| **minimumSignalScoreTrace 100점형** | `server/trading/signalScanner/minimumSignalScoreTrace.ts` | `buildMinimumSignalScoreTrace()`, `requiredScore=70` default | Gate1 통과 결정 입력 |

**본 ADR 의 forensic audit 은 (2) minimumSignalScoreTrace 100점형 체계의 부결 원인 분해에 집중**한다. (1) raw registry evaluator 순서·산식은 무수정.

## SectorEnergy 역할 (사용자 명시 정합 — ADR-0398 / ADR-0400 / ADR-0448)

SectorEnergy 는 **raw registry evaluator 가 아니다**.

| Layer | SectorEnergy 영향 |
|-------|------------------|
| `defaultRegistry.run()` | 등록 0건 (raw gate score 직접 영향 0) |
| `sectorBoost` (ADR-0400) | Gate Score 가산점 ±2 |
| STRONG_BUY gating (ADR-0398) | 6 조건 OR 차단 (`confidence<0.6` / `DEGRADED` / `FAILED` / `YAHOO_ETF` / `STALE` / `PARTIAL_VOLUME`) |
| minimum signal score component | `SECTOR_ENERGY` 컴포넌트 (penalty 가능) |
| executionImpact (ADR-0448) | **HARD_BLOCK 절대 금지** (`hardBlockAllowed: false` literal type) |

→ 본 forensic audit 의 `sectorEnergyAudit` 필드가 어느 layer 에서 영향 주는지 명시한다.

## 수급 역할 (사용자 명시 정합)

`supply_confluence` 는 **symbol-level investor flow 만 허용**.

- ✅ `kisFlow.foreignNetBuy` / `kisFlow.institutionalNetBuy` / `kisFlow.programNetBuy` — 종목별
- ❌ 시장 단위 program-trade aggregate
- ❌ 섹터 단위 flow aggregate
- ❌ marker-only `semanticAvailable=true` 인데 actual 필드 부재

→ 본 forensic audit 의 `supplyScopeAudit` 가 `quote.symbol ↔ kisFlow.symbol` 일치 검증 + `POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT` warning 자동 발화.

## 결정 — 신규 SSOT 도입

### 1. `buildGate1MinimumSignalForensicAuditAdr0505(input)` SSOT

`server/trading/signalScanner/gate1MinimumSignalForensicAuditAdr0505.ts` 신규 모듈.

**입력**:
- `trace: MinimumSignalScoreTrace` (ADR-0466 본체)
- `candidate: CandidateEntryTrace` (ADR-0464 후속)
- `supplyProviderHealth?: SupplyProviderHealthTrace` (옵셔널)
- `supplyConfluence?: SupplyConfluenceState`
- `kisFlow?: { symbol?, foreignNetBuy?, institutionalNetBuy?, programNetBuy?, semanticAvailable? }`
- `quoteSymbol?`
- `sectorEnergyImpact?: SectorEnergyExecutionImpactResult` (ADR-0448)

**출력** — `Gate1MinimumSignalForensicAuditAdr0505` schema:

```ts
{
  symbol, name,
  scoreSystem: 'MINIMUM_SIGNAL_SCORE_100_SCALE',
  requiredScore, actualScore, scoreGap, passed,
  positiveComponents: Record<string, {…}>,        // weightedScore > 0 또는 confidence VERIFIED/DEGRADED
  penaltyComponents: Record<string, {…}>,          // weightedScore < 0 또는 penaltyApplied
  missingPositiveSources: Array<'WATCHLIST_UPSTREAM_SCORE_MISSING' | …>,
  dominantFailureReason: 'POSITIVE_SCORE_STARVATION' | … | 'MIXED' | 'UNKNOWN',
  supplyScopeAudit: {…},                           // KIS_FLOW_SYMBOL_MISMATCH / MISSING / etc.
  sectorEnergyAudit: {…},                          // diagnosticStatus / scoringImpact / executionImpact
  wouldPassIf: {…},                                // 8 counterfactual flags
  executionImpact: 'NONE',                         // literal 강제
  liveExecutionAllowed: false,                     // literal 강제
  policyPromotionMode: 'SHADOW_ONLY',               // literal 강제
}
```

### 2. ScanSummary 격상

`ScanSummary.gate1MinimumSignalForensicAdr0505?` 옵셔널 후방호환 필드 추가:

```ts
{
  totalCandidates, failedCandidates,
  requiredScoreAvg, actualScoreAvg, avgScoreGap,
  dominantFailureDistribution: Record<string, number>,
  missingPositiveSourceCounts: { watchlistUpstreamMissing, relativeStrengthMissing, breakoutStructureMissing, … },
  penaltyCounts: { supplyUnknownPenalty, investorFlowUnknownPenalty, sectorEnergyPenaltyOrBlocked, … },
  supplyScopeWarnings: Record<string, number>,
  sectorEnergyStrongBuyBlockedCount, sectorEnergyHardBlockCount,
  executionImpact: 'NONE',
  liveExecutionAllowed: false,
  policyPromotionMode: 'SHADOW_ONLY',
}
```

`persistScanResults()` 안에서 try/catch 격리로 합성 (ADR-0500 패턴 차용).

### 3. /scan_blockers compact section

```
🧬 Gate1 Minimum Signal Forensic (ADR-0505)
- candidates=48 failed=48
- requiredAvg=70.0 actualAvg=22.0 gap=-48.0
- dominant=POSITIVE_SCORE_STARVATION
- missing: watchlist=48 rs=44 breakout=42
- penalties: supplyUnknown=37 investorUnknown=31 sectorBlocked=48
- supplyScopeWarnings: symbolMissing=48 mismatch=0 semanticUnavailable=37
- SectorEnergy: boost=0 strongBuyBlocked=48 hardBlock=0
- executionImpact=NONE live=false
```

### 4. 종목별 detail trace JSON

`data/diagnostics/gate1-minimum-signal-forensic-adr0505.json` (atomic write tmp→rename + FIFO 200건 + 7일 TTL) — 별도 영속, 다른 ledger (shadow-trades / counterfactual-* / provisional-*) 와 물리 분리. raw payload / token / cookie / 계좌번호 / `total_assets` / `orderable_cash` / personal Telegram ID 영속 0건 (ADR-0445 sanitized 정합).

## 안전 invariants (사용자 명시 절대 변경 금지)

1. `executionImpact: 'NONE'` literal 강제 (TypeScript 컴파일 타임 강제, 호출자 측 invariant 위반 즉시 컴파일 에러)
2. `liveExecutionAllowed: false` literal 강제
3. `policyPromotionMode: 'SHADOW_ONLY'` literal 강제
4. `requiredScore=70` 변경 금지 — 본 forensic audit 은 *진단 layer*, threshold 완화 금지
5. UNKNOWN penalty 수치 변경 금지 — penalty 산출 자체는 ADR-0466 본체 SSOT 가 결정
6. SectorEnergy hard block 추가 금지 — `sectorEnergyAudit.directRawGateScoreImpact: 0` literal 강제
7. watchlist score live 승격 금지 — forensic audit 은 *진단*, score 입력 본체 변경 0
8. KIS 주문 함수 5종 import 0건 (정적 grep 가드)
9. autoTradeEngine / orderExecutor / trancheExecutor import 0건
10. defaultRegistry evaluator 순서 변경 금지
11. evaluateServerGate raw score 산식 변경 금지
12. live candidate promotion 금지 — forensic audit 결과가 매수 결정 / 주문 / 회로 무관

## 잘못된 해결 방법 영구 차단

- **threshold 완화** (`requiredScore=70 → 60` 등): forensic 결과를 보고 *원인이 진짜로 임계 미달인지 unknown penalty 누적인지* 먼저 분해 — 임계 변경은 별도 ADR + 데이터 누적 의무
- **WATCHLIST_UPSTREAM_SCORE 를 즉시 live 로 꽂기**: 수급 scope 혼입 여부 검증 전 wiring 시 silent degradation
- **UNKNOWN penalty 수치 낮추기**: ADR-0466 본체 변경, 본 PR scope 외
- **SectorEnergy diagnostic 을 OK 로 격상**: ADR-0399 + ADR-0423 4-axis SSOT 위반
- **forensic 결과를 매매 결정 입력에 사용**: 본 ADR 은 *부검 layer*, 실제 fix 는 별도 PR
- **모든 정보를 `/scan_blockers` 본 메시지에 노출**: ADR-0478 4000-char budget 위반 — compact line 만, 상세는 detail trace JSON

## 성공 기준

1. Gate1 실패 원인이 *종목별로* 설명 가능 (dominantFailureReason 분기 명확)
2. missing positive source 와 penalty contributor 가 분리 (운영자가 *원인 vs 결과* 즉시 구분)
3. 수급 scope 혼입 여부 표시 (`supplyScopeAudit.warning` 명시)
4. SectorEnergy 가 점수/승격/차단 중 어느 layer 에서 영향을 주는지 표시
5. `executionImpact: 'NONE'` literal type 강제로 매매 본체 영향 영구 차단

## 호환성

- `MinimumSignalScoreTrace` (ADR-0466) 본체 무수정 — read-only consumer
- `ScanSummary` 옵셔널 후방호환 필드 추가만
- `CandidateEntryTrace` (ADR-0464) 무수정 — read-only consumer
- `SectorEnergyExecutionImpactResult` (ADR-0448) 무수정 — read-only consumer
- 호출자 0건 (Phase 1 dead code) → `persistScanResults` 안 try/catch 격리 wiring 만 추가
- ENV `GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED=true` (default OFF, ADR-0157 정확 비교 — `'1'` / `'TRUE'` / `'yes'` 모두 거부) → 1줄 즉시 audit 비활성 (ADR-0500 동작 100% 보존)

## References

- ADR-0420 — Fresh Scan Blocker Attribution (Gate1 status 분해, 본 PR 의 형제)
- ADR-0422 — Gate2 Leadership Attribution
- ADR-0466 — Minimum Signal Score Decomposition (본체 SSOT)
- ADR-0398 — SectorEnergy STRONG_BUY Confidence Gate
- ADR-0400 — SectorEnergy STRONG_BUY Gate wiring
- ADR-0445 — sanitized diagnostic metadata 영속 정책
- ADR-0448 — Trading Engine Liveness First (auxiliary signal hard-block 금지)
- ADR-0500 — Empty Scan Root Cause Dashboard (전체 단위 형제)
- ADR-0478 — `/scan_blockers` Compact Output Policy (4000-char budget)
- ADR-0479 — Detail Trace Registry SSOT (per-symbol detail 영속 패턴)
