# ADR-0613 — Gate1 Positive-Ceiling Wiring OFF-by-default Promotion

@responsibility Gate1 천장 배선(RS percentile 입력·BREAKOUT_STRUCTURE·positive max→100 정규화)을 LIVE minimum-signal scorer 경로에 ENV flag default OFF byte-equivalent 로 승격하고 관측 ledger 를 활성화하는 경계·정책 ADR.

- **Status:** Proposed (Phase 0 — 경계·타입·ADR. default OFF byte-equivalent. 구현은 engine-dev 인계.)
- **Date:** 2026-06-15
- **Branch:** claude/scan-blockers-diagnostic-t10u30
- **Supersedes / Extends:** ADR-0467(positive component 회계)·ADR-0468(ceiling repair dry-run)·ADR-0471(live curve FREEZE)·ADR-0475(positive source wiring dry-run)·ADR-0520(scoring-alignment dry-run gate)·ADR-0546(regime-aware required-score OFF=byte-identical 패턴)·ADR-0476(관측 ledger)·ADR-0611(SECTOR_RS component 재활성 패턴)
- **Patch vs ADR:** ADR (신규 경계/정책 — ENV flag·승격 경로). INDEX.md 0613→0614 갱신 의무.

---

## Context

운영자 진단(`/scan_blockers`)에서 강세장(R3_EARLY)인데 Gate1 진입 0:

- `finalScoreAvg = 56.7` < `requiredScore = 70` (ADR-0467/0546 SSOT, 절대 보존)
- positive 점수 천장 저활용: `configuredPositiveMax = 116` vs `observedPositiveMax = 49.2`, `utilizationByMax = 42.4%`, `suspectedCause = SCORE_CEILING_TOO_LOW`
- 진단 `nextAction = WIRE_RS_PERCENTILE_INPUT, WIRE_BREAKOUT_STRUCTURE, NORMALIZE_POSITIVE_MAX_TO_100` (ADR-0467/0468/0475)

근본 원인: 천장을 채울 입력(횡단면 RS percentile·BREAKOUT 구조 점수)·정규화가 **dry-run 모듈에만 존재하고 LIVE scorer(`buildMinimumSignalScoreTrace`)에 배선되지 않음.** 즉 점수 곡선 자체가 문제가 아니라 천장을 채울 배선이 끊겨 있음.

### 운영자 결정 (확정)

> "ENV 플래그 default OFF 로 wiring 머지 + 관측 ledger 활성."

즉 천장 배선을 LIVE Gate1 minimum-signal scorer 경로에 **연결하되**, ENV flag OFF(기본)일 때 live 동작이 현행과 **byte-identical**. 운영자가 forward-outcome 데이터 성숙 후 직접 flip.

### 중요 발견 — 진입 증대가 목적이 아님

시스템 자체 dry-run(ADR-0470) 상 천장 정규화 단독(POSITIVE_REPAIR_ONLY)은 survivors 0 + netAvg 30.7→5.5 하락. 실제 진입 레버는 RISK_SPLIT(ADR-0470). 따라서 본 패치 목적은:

1. 천장 배선을 OFF-by-default 로 live 경로에 **안전하게 연결**(byte-identical 보장).
2. 배선 효과를 **관측 가능화**(ledger stamp).

효과 판단(flip 여부)은 관측 ledger 성숙 후 운영자 몫. 이 ADR 은 "진입을 늘리는 ADR" 이 아니라 "배선을 안전하게 잇고 관측 가능하게 만드는 ADR".

---

## Decision

### 1. OFF-by-default 천장 배선 승격 경로

ADR-0611(SECTOR_RS component 재활성)·ADR-0546(regime-aware required-score)과 **정확히 동일한 패턴**을 적용한다:

- 신규 순수 SSOT `server/trading/signalScanner/gate1PositiveCeilingWiringAdr0613.ts` (provider/store/now/fetch 0) 에 flag-gated component-level transform 3종을 집약.
- `buildMinimumSignalScoreTrace` 의 component 조립 지점에서만 분기. flag OFF → 각 transform 이 **기존 산출과 byte-equivalent** 값(maxScore/normalizedScore/weightedScore 무변경)을 반환.
- 두 번째 점수 공식 신설 금지 — 기존 dry-run 모듈(`gate1PositiveSourceWiringAdr0475.ts`·`gate1ScoreCeilingRepair.ts`·`gate1ScoringAlignmentDryRunGateAdr0520.ts`)의 함수를 재사용해 산출.

### 2. ENV flag 계약

| 항목 | 값 |
|------|-----|
| **flag 이름** | `GATE1_POSITIVE_CEILING_WIRING_ENABLED` |
| **default** | OFF (미설정/`!== 'true'` = OFF) |
| **정확 비교** | `=== 'true'` (ADR-0157 — `'1'`/`'TRUE'`/`'yes'` 거부) |
| **SSOT 함수** | `isGate1PositiveCeilingWiringEnabled()` (`server/trading/gateConfig.ts`) |
| **소유** | gateConfig.ts (live scorer 가 import) — 호출자 inline ENV 검사 금지 |
| **롤백** | flag 1줄 OFF = 즉시 baseline |

ADR-0546 의 `isGate1RegimeAwareRequiredEnabled()` 가 동일 파일에 거주하므로 같은 모듈에 배치(Gate1 ENV 게이트 단일 거주지).

### 3. 3개 배선 — flag ON 동작 (각 component 천장 capacity 복원)

배선은 **개별 component 의 maxScore/입력을 복원**할 뿐 `requiredScore=70` 과 `computedScore = Σ weightedScore` 공식·`passed = actualScore >= requiredScore` 판정 라인은 무변경. flag OFF 면 셋 다 0 효과.

**(a) RS percentile 입력 배선 — `WIRE_RS_PERCENTILE_INPUT`**
- 현행 `normalizedRelativeStrength` 는 `rsRankPct`/`explicitRelativeStrength` 를 우선 소비하나, 횡단면 percentile(ADR-0597 산출물 `crossSectionalPercentile`)이 입력으로 threaded 되지 않아 sparse 시 천장 미도달.
- flag ON: ADR-0597 의 횡단면 percentile 을 RELATIVE_STRENGTH 컴포넌트의 추가 입력 우선순위로 배선(ADR-0469 dedup 정합 — 시장상대/rsRankPct 와 이중계상 회피). 부재 → 기존 경로 graceful fallback(불변식 #6).
- maxScore 10 천장 무변경 — 입력 hydration 만.

**(b) BREAKOUT_STRUCTURE 배선 — `WIRE_BREAKOUT_STRUCTURE`**
- 현행 `breakoutScore` 는 mapped score / breakout state 만 소비. ADR-0475 `resolveBreakoutStructureSource` 의 OHLCV(high20/high60/MA20/MA60/volumeRatio/vcp) 풍부 산출이 LIVE 에 배선 안 됨.
- flag ON: trace 에 OHLCV 입력이 있으면 `resolveBreakoutStructureSource`(ADR-0475 재사용) 결과를 BREAKOUT_STRUCTURE normalizedScore 의 추가 소스로 배선. 부재 → 기존 breakoutScore 경로 무변경(불변식 #6).
- maxScore 10 천장 무변경 — 결손 채움만.

**(c) positive max → 100 정규화 — `NORMALIZE_POSITIVE_MAX_TO_100`**
- `configuredPositiveMax = 116` ≠ 100 이라 천장 회계가 스케일 불일치. ADR-0468 `NORMALIZE_TO_100` scaling mode 산출(dry-run) 을 LIVE positive 합산 정규화에 배선.
- flag ON: positive weightedScore 합을 ADR-0468 의 NORMALIZE_TO_100 변환으로 정규화(component 별 maxScore 비례 보존, requiredScore 70 무변경).
- **주의(운영자에게 이미 공유):** 단독 적용 시 survivors 0 + netAvg 하락 — 이 배선은 진입 레버가 아니라 천장 회계 정합. 효과는 관측 ledger 로 측정.

### 4. 관측 ledger 활성

flag 무관하게 **항상** flag-ON-가정(hypothetical) delta 를 ADR-0476 관측 ledger 행에 stamp:
- `ceilingWiringRsPercentileDelta` / `ceilingWiringBreakoutDelta` / `ceilingWiringNormalizeDelta` / `ceilingWiringHypotheticalActualScore` / `ceilingWiringHypotheticalPassed`
- 목적: flag OFF 상태에서도 "ON 이면 어떤 종목이 통과했을지" forward-outcome 누적 → 운영자 flip 판단 근거.
- stamp 는 try/catch 격리(불변식 #1 — ledger 실패가 scorer/엔진 정지 유발 금지).

### 5. ADR-0471 freeze / ADR-0520 정합

- ADR-0471 freeze rule: live Gate1 minimum-signal scoring **curve** 는 FROZEN. 본 패치는 곡선 변경이 아니라 **OFF-by-default 승격 경로 추가**(ADR-0520 dry-run gate 와 동일 철학 — 관측 우선, 운영자 flip).
- flag OFF = curve byte-identical. flag ON 은 곡선 교체가 아니라 끊긴 입력 배선 복원(천장은 열되 데이터가 채움 — ADR-0611 문구 계승).

---

## Consequences

### 긍정
- 천장 배선이 LIVE 경로에 연결돼 운영자가 ENV 1줄로 활성 가능(인프라 wiring 완료).
- 관측 ledger 가 flag OFF 상태에서도 hypothetical delta 를 누적 → flip 판단 데이터 성숙.
- 단일 통로 유지 — 기존 dry-run 함수 재사용, 두 번째 점수 공식 0.

### 비용 / 위험
- flag ON 시 천장 회계가 바뀌어 진입 분포가 변할 수 있음 — 그래서 default OFF + 운영자 flip.
- positive max→100 정규화 단독은 netAvg 하락(검증됨) — 운영자가 RISK_SPLIT(ADR-0470)·다른 레버와 조합 판단 필요. 본 ADR 은 그 판단을 막지 않되 강제하지도 않음.

### executionImpact
- flag OFF: **NONE** (LIVE 매매 본체 0줄 의미변경, KIS/KRX quota 0 침범, byte-equivalent).
- flag ON: gate1-scoring-adjacent (LIVE Gate1 점수 천장 회계 변경 — autoTradeEngine/kisClient/order path 0줄, requiredScore 70 무변경).

---

## Alternatives Considered

1. **천장 배선을 dry-run 모듈에만 유지(현행)** — 기각. 운영자가 flip 하려면 매번 코드 배포 필요. wiring 완료 vs 인프라만(ADR-0146 §2) 갭 미해소.
2. **flag ON default 로 즉시 활성** — 기각. ADR-0471 freeze 위반 + 검증 안 된 곡선 변경 + netAvg 하락 리스크. 운영자 forward-outcome 성숙 전 flip 금지.
3. **requiredScore 70 을 동시 하향** — 기각(절대 보존, ADR-0467/0546/0609). 천장 배선과 임계 완화는 독립 레버.
4. **신규 두 번째 점수 공식 작성** — 기각(단일 통로 위반). 기존 ADR-0475/0468/0520 함수 재사용 필수.
5. **positive max→100 정규화 단독 머지** — 기각. survivors 0 + netAvg 하락(검증됨). 3 배선을 단일 flag 로 묶고 관측에 맡김.

---

## References

- 진단: `/scan_blockers` (finalScoreAvg 56.7·configuredPositiveMax 116·utilizationByMax 42.4%·SCORE_CEILING_TOO_LOW)
- ADR-0467(positive 회계)·0468(ceiling repair dry-run)·0471(live curve FREEZE)·0475(positive source wiring dry-run)·0476(관측 ledger)·0520(scoring-alignment dry-run gate)·0546(regime-aware required-score OFF=byte-identical)·0597(횡단면 percentile shadow score)·0611(SECTOR_RS 재활성 패턴)·0146(byte-equivalent·wiring vs 인프라)
- 재사용 함수: `resolveBreakoutStructureSource`/`resolveRelativeStrengthSource`(ADR-0475)·`NORMALIZE_TO_100` scaling(ADR-0468)·`buildGate1ScoringAlignmentDryRunGate`(ADR-0520)
- 코드 seam: `buildMinimumSignalScoreTrace` (`server/trading/signalScanner/minimumSignalScoreTrace.ts:121-482`) component 조립부
