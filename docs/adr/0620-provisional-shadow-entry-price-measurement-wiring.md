# ADR-0620 — Provisional Shadow 측정 기준가(entryPrice) 배선

- Status: Proposed (Phase 0 — 경계·타입·ADR. 측정 정합 정정. 구현은 engine-dev 인계.)
- Date: 2026-06-16
- 계보: ADR-0426 / ADR-0427 / ADR-0428 / ADR-0431 / ADR-0561 / ADR-0146

## Context

`/shadow_provisional` 실데이터 50건이 전부 `INSUFFICIENT_DATA`(observed 0)로 측정 불능.
근본 원인은 신호/정책 결함이 아니라 **측정 기준가 누락**이다.

- `ProvisionalShadowLedgerEntry`(`server/persistence/provisionalShadowLedger.ts:15-48`) 타입에
  `entryPrice` 필드가 없다.
- `buildEntry()`(:129)가 기록 시 기준가를 박지 않는다.
- 성과 리포트(`server/learning/provisionalShadowPerformanceReport.ts:257`)는 이미
  `(entry as { entryPrice?: number }).entryPrice` 로 읽도록 작성돼 있으나 항상 `undefined` →
  `safeReturnPct` 가 `undefined` 반환 → 모든 horizon `DATA_UNAVAILABLE` → summary `INSUFFICIENT_DATA`.
- 출력 레코드 `ProvisionalShadowPerformanceRecord.entryPrice?: number`(:52)는 이미 선언돼 있어
  **소비자는 기준가를 기대하나 생산자가 영속하지 않는** 단방향 배선 결손이다.

기록 호출부(`server/trading/signalScanner/perSymbol/steps/provisionalShadowLane.ts:18` →
`buyListLoop.ts:429`) 시점에 `currentPrice`(buyListLoop.ts:262, `loopInit` 의 KIS 게이트 가격 —
실진입 revalidation 에 쓰이는 동일 소스)가 스코프에 존재한다. 신규 fetch 0.

## Decision

### ADR vs patch 판정 → **ADR 발급 (경계 변경 동반 측정 정정)**

CLAUDE.md §5 "ADR type vs patch type" 기준 적용:

- 동작 본질만 보면 "측정 정합 정정 / 진단 가시화"(patch type)에 가깝다 — 신규 신호·정책·Gate·
  주문 레버 0, LIVE 매매 본체 0줄.
- 그러나 본 수정은 **3개 영속·타입 경계에 additive 필드를 신설**한다:
  `ProvisionalShadowLedgerEntry`(persistence schema), `ProvisionalShadowCandidate`(lane SSOT),
  `DeriveR3ProvisionalShadowInput`. 영속 스키마 필드 추가는 SSOT 타입 계약 변경이며, 이후
  소급 호환·필드 의미(entryPriceSource union)·소비처 신뢰 등급(L1 KIS 기준가)에 대한 결정이
  외부 참조 대상이 된다. CLAUDE.md §5 "신규 경계·정책은 ADR 발급" 에 해당.
- 또한 ADR-0426/0427/0428/0431 provisional-shadow 계보가 전부 ADR 로 발급돼 있어, 그
  측정 파이프라인의 기준가 배선을 patch 로 끼워넣으면 계보 추적성이 끊긴다.

→ **ADR 발급. INDEX 0617 → 0618 갱신.** (patch type 기각: 영속 스키마 필드 신설 + 계보 무결성.)

### 무엇을 바꾸는가 (engine-dev 인계 범위)

1. `ProvisionalShadowLedgerEntry` 에 `entryPrice?: number` + `entryPriceSource?` 추가 (본 ADR PR 에서 타입만 추가 완료).
2. `ProvisionalShadowCandidate` / `DeriveR3ProvisionalShadowInput` 에 동일 additive 필드 추가 (완료).
3. `deriveR3ProvisionalShadowCandidate` 가 입력 `entryPrice`(positive finite) 를 candidate 로 carry (engine-dev 로직).
4. `buildEntry()` 가 candidate 의 `entryPrice`/`entryPriceSource` 를 ledger entry 로 stamp (engine-dev 로직, additive spread 패턴).
5. `provisionalShadowLaneDerive` 시그니처에 `currentPrice: number` 인자 추가 →
   `deriveR3ProvisionalShadowCandidate({ ..., entryPrice: currentPrice, entryPriceSource: 'KIS_CURRENT' })` 주입 (engine-dev wiring).
6. `buyListLoop.ts:429` 호출에 스코프 내 `currentPrice` 전달 (engine-dev wiring).

`positive finite` 검증(0/NaN/음수 거부)은 ADR-0431 `resolveCounterfactualEntryPrice` 패턴과
동형으로 engine-dev 가 derive 단계에서 수행한다.

## Consequences

- 신규 provisional shadow row 는 KIS 기준가를 영속 → 성과 리포트가 horizon 별 `returnPct` 산출 가능
  → `INSUFFICIENT_DATA` → `OBSERVED`/`PARTIAL`/`COMPLETE` 전환.
- **하위호환**: `entryPrice` 는 optional additive 필드. 기존 entryPrice 없는 50건은 derive 단계에서
  미설정 → 성과 리포트 fallback chain 부재 → `INSUFFICIENT_DATA` 유지 (소급 0, 타입 안전).
- 측정 기준가 신뢰 등급은 L1(KIS) — `entryPriceSource: 'KIS_CURRENT'` 라벨로 추적. 단, 본 값은
  **측정용**이며 매매 결정에 직접 사용되지 않는다(불변식 #7 정합 — L4 미사용, L1 측정 기준가).

## 불변식 점검

- `liveAllowed: false` literal 불변 — entryPrice 는 측정 기준가일 뿐 진입 허용과 무관.
- executionImpact = NONE — autoTradeEngine/kisClient/주문 경로 0줄, 신규 fetch 0(currentPrice 재사용).
- shadowLearningImpact = 측정 정상화(불변식 #2 — Shadow 표본 보존·강화, 차단 0).
- 9대 불변식 0줄 변경 — SourceSnapshot/Gate/Provider/Policy/Confidence/ExecutionPermission 무접촉.
- provisional / counterfactual / 일반 shadow ledger **물리 분리 유지** —
  `PROVISIONAL_SHADOW_LEDGER_FILE` 단일 파일만 read/write, counterfactual·shadow-trades 무접촉.
- 불변식 #6: entryPrice 부재(결손)는 `INSUFFICIENT_DATA` 측정 보류이지 bearish/탈락 신호 아님.

## Alternatives Considered

- (a) patch type 처리 → 기각. 영속 스키마 필드 신설 + ADR-0426~0431 계보 추적성 보존 = ADR 의무.
- (b) `entryPriceSource` 없이 `entryPrice` 단독 → 기각. ADR-0431 counterfactual 레인이 source 라벨
  (`ENTRY_SNAPSHOT`/`SCAN_SNAPSHOT`)을 이미 채택 — 출처 추적 일관성 위해 union 동반.
- (c) counterfactual 처럼 다단 fallback chain(entryPriceHint/conditionSnapshot/quoteSnapshot) →
  기각(현 단계). provisional 레인은 기록 시점에 `currentPrice`(KIS 단일 권위 소스)가 항상 스코프에
  있어 1차 소스로 충분. fallback 확장은 필요 시 후속 ADR.
- (d) 소급 backfill(기존 50건에 추정 기준가 주입) → 기각. 기준가 추정은 측정 오염 — 소급 0 유지,
  신규 row 부터 정상 측정.

## References

- ADR-0426 (provisional shadow lane), ADR-0427 (ledger wiring), ADR-0428 (performance report),
  ADR-0431 (counterfactual entryPrice fallback chain + entryPriceSource 패턴),
  ADR-0561 (KIS Primary Absolute — currentPrice L1 소스), ADR-0146 (PR 자가 review 5 카테고리).
- `server/persistence/provisionalShadowLedger.ts:15-48,129`
- `server/learning/provisionalShadowPerformanceReport.ts:52,257`
- `server/trading/signalScanner/provisionalShadowLane.ts:60-73,121`
- `server/trading/signalScanner/perSymbol/steps/provisionalShadowLane.ts:12-32`
- `server/trading/signalScanner/perSymbol/buyListLoop.ts:262,429`
