# ADR-0623 — Price Correction Stage 2: Shadow-only Activation

- **Status**: Accepted
- **Date**: 2026-06-18
- **Authors**: engine-dev (architect 설계 SSOT `_workspace/2026-06-18_b14-pricecorrection-stage2-shadow/architect/design.md` 직접 반영)
- **Series**: ADR-0414 (Price Integrity Checker + Correction Overlay, Stage 1 Read-Only) 직속 후속 — ADR-0414 §"Stage 정책" 의 Stage 2 칸을 본 ADR 로 확정.

## 핵심 문장

> *"Stage 1 에서 관측·검증한 corrected 값을, **SHADOW 분기에서만** shadow 판단 입력으로 채택한다. LIVE 경로는 절대 무접촉. 원본 영속은 절대 무수정. 외부 API 호출 0. 기본 OFF (byte-equivalent)."*

## 본 PR 구현 범위 (중요)

본 ADR 본문은 **Stage 2 전체(2a + 2b) 정책을 SSOT 로 기술**한다. 다만 본 PR 의 실제 구현 범위는 다음으로 한정한다:

- **구현 범위 = Stage 2a** — 신규 ENV `PRICE_CORRECTION_SHADOW_ENABLED` (default OFF) + `isPriceCorrectionShadowEnabled()` SSOT 헬퍼 + Seam A (ScanSummary `priceIntegrity`/`priceCorrection` diagnostics 집계 채움).
- **Stage 2b(shadow corrected 치환) 는 후속 PR** — `kisIntradayCorrectionStep` 입력을 corrected 값으로 치환하는 의사결정 wiring(Seam B)은 본 PR 에서 구현하지 않는다. ENV 헬퍼만 도입하고 채택 분기는 추가하지 않는다.

## 배경

ADR-0414 가 도입한 `priceIntegrityChecker.ts` / `priceCorrectionEngine.ts` / `priceCorrectionLineage.ts` 는 Stage 1 에서 **dead-but-tested** 상태였다 (프로덕션 호출자 0건, 의도된 dead code). 포매터(`formatPriceIntegritySection` / `formatPriceCorrectionOverlaySection`) · ScanSummary 옵셔널 필드 · static-guard 앵커는 이미 wiring 준비 완료였으나 실제로 비어 있던 것은 (a) ScanSummary 집계 채움 호출, (b) shadow gate 입력 corrected 치환 두 가지였다.

Stage 2a 는 그 중 (a) 만을 안전 증분으로 채운다: 이미 수집된 per-symbol 데이터(`reCheckQuote`/`currentPrice`)로 integrity/correction 을 평가해 `/scan_blockers` 에 종목별 데이터 품질을 가시화한다. corrected 값은 어떤 의사결정에도 사용하지 않는다.

## Stage 정책 (ADR-0414 §"Stage 정책" 의 Stage 2 칸 확정 — Stage 1/3 칸 절대 변경 금지)

| Stage | 적용 범위 | corrected 사용처 | 활성화 ENV | 상태 |
|-------|-----------|------------------|------------|------|
| Stage 1 (ADR-0414) | Read-Only | diagnostics only | `PRICE_CORRECTION_DISABLED` (default OFF=실행) | DONE |
| **Stage 2 (본 ADR-0623)** | **Shadow-only activation** | **diagnostics + shadow 판단 입력 (SHADOW 분기만)** | **`PRICE_CORRECTION_SHADOW_ENABLED` (default OFF)** | 2a 구현 / 2b 후속 |
| Stage 3 (후속 scope 외) | Live activation | signalScanner / 27조건 / Gate1~3 | `PRICE_CORRECTION_LIVE_ENABLED=true` + 운영자 승인 | TODO |

## 결정

1. **신규 ENV `PRICE_CORRECTION_SHADOW_ENABLED` (default OFF)** — `isPriceCorrectionShadowEnabled()` SSOT 헬퍼 (`priceCorrectionEngine.ts`, `isPriceCorrectionDisabled()` 인접). 정확 비교 `=== 'true'` (ADR-0157). inline ENV 검사 0건.
2. **`PRICE_CORRECTION_DISABLED=true` 시 shadow 활성화도 자동 생략** (disabled 우선). 헬퍼 내부에서 `isPriceCorrectionDisabled()===true` 면 즉시 `false` 반환.
3. **corrected 채택 게이팅 4중 조건 (2b)**: `shadowEnabled && !disabled && usableForShadow===true && confidence ≥ PRICE_CORRECTION_SHADOW_THRESHOLD(0.5)`.
4. **corrected 치환은 SHADOW 분기에서만 (2b)** — `stockShadowMode===true`. LIVE 후보(`stockShadowMode===false`) gate 입력 절대 무접촉.
5. **ScanSummary.priceIntegrity / .priceCorrection 집계 채움 (Stage 2a)** — `evaluatePriceIntegrity` + `evaluatePriceCorrection` per-symbol 호출 결과를 `ScanCounters.priceIntegritySamples`/`.priceCorrectionSamples` (additive 옵셔널) 에 누적 → `persistScanResults` 가 `statusCounts` / `correctionTypeCounts` / `averageConfidence` / `dropGapCalculationCount` / `shadowOnlySuggestedCount` / `topAffected` 로 reduce. ENV 무관 항상(diagnostics, ADR-0414 §28 Stage1 허용범위). 단 `PRICE_CORRECTION_DISABLED=true` 시 correction 산출 생략.

### ENV 상호작용 진리표 (SSOT)

| `PRICE_CORRECTION_DISABLED` | `PRICE_CORRECTION_SHADOW_ENABLED` | integrity 실행 | correction 실행 | corrected→shadow 채택 |
|---|---|---|---|---|
| OFF (기본) | OFF (기본) | YES | YES (diagnostics) | **NO** ← byte-equivalent baseline |
| OFF | ON | YES | YES | **YES (SHADOW 분기만, 2b)** |
| ON | OFF | YES | NO (skip) | NO |
| ON | ON | YES | **NO** (disabled 우선) | **NO** ← disabled 가 shadow 차단 |

## 안전 invariant (ADR-0414 10종 100% 계승 + Stage 2 전용 4종 추가)

**ADR-0414 계승 (1~10):** 원본 quote/daily/master 영속 무수정 / correction 은 scan-local overlay only / **corrected 값 LIVE 매수 판단 사용 금지 (단 SHADOW 는 본 ADR 가 신규 허용)** / original+corrected 동시 계산+차이 기록 / lineage 영속 / DROP_GAP_CALCULATION 시 gap 미산출 / correction 실패 시 SHADOW_ONLY / health metric 기록 / LIVE·KIS 주문 함수·order executor 무수정 / 외부 API 직접 호출 0.

> **주의:** 계승 #3 은 Stage 2 에서 "corrected→LIVE entry 금지"로 범위 축소 유지된다. SHADOW 채택만 본 ADR 가 신규 허용하며, LIVE 금지는 불변이다.

**Stage 2 전용 (11~14):**

- **(11)** `PRICE_CORRECTION_SHADOW_ENABLED` OFF(기본) 시 corrected 채택 0 → shadow 결과 byte-equivalent. Stage 2a 단독으로는 채택 분기 자체가 부재 → LIVE+shadow 결과 0변화 (집계 필드만 추가).
- **(12)** corrected 치환은 `stockShadowMode===true` 분기에서만 (2b) — LIVE 후보 gate 입력 무접촉.
- **(13)** corrected 입력은 **이미 수집된 per-symbol 데이터**(`reCheckQuote`/`quote`)에서만 합성 — 외부 fetch 추가 0 (ADR-0414 #10 계승 강화).
- **(14)** entryEngine / exitEngine / order executor / kisClient / autoTradeEngine 0줄 수정 (정적 grep 가드).

## 잘못된 해결 (ADR-0414 §"잘못된 해결" 6종 100% 계승 + Stage 2 전용 2종)

**ADR-0414 계승 (1~6):** corrected→LIVE 사용 / 원본 데이터 덮어쓰기 / DROP_GAP 무시하고 틀린 gap 사용 / 외부 fetch 추가 / status·correctionType union 임의 추가 / confidence 산출식 변경 — 전부 금지.

**Stage 2 전용 (7~8):**

- **(7)** ❌ LIVE 후보에도 corrected 치환 — invariant #12 위반.
- **(8)** ❌ `usableForShadow===false` 또는 `confidence < 0.5` 인데 corrected 채택 — 게이팅 SSOT 위반.

## 호환성

- **ADR-0157** (ENV 정확 비교) / **ADR-0185~0189** (ENV 헬퍼 SSOT) — `isPriceCorrectionShadowEnabled()` 가 `=== 'true'` 정확 비교 + 단일 통로 헬퍼로 정합.
- **ADR-0436** (LIVE_ELIGIBLE vs SHADOW_OBSERVABLE split) / **ADR-0608·0619** (shadow 진입 라벨·관측 ledger) 정합.
- **9대 불변식 #4·#9** (`docs/ai/03-source-snapshot-ssot.md`): corrected 는 SourceSnapshot 을 바꾸지 않는다 (providerIssue/SELL_ONLY/R6 와 동급으로 snapshot 무변경; scan-local overlay 라 SourceSnapshot 우회 아님 — 불변식 #9 무위반).
- **불변식 #1** (Trading Engine 항상 생존): Seam A 집계 호출은 try/catch 격리 — 집계 실패가 매수/스캔 흐름 차단 0.
- **불변식 #8** (실거래 차단 ↔ shadow 차단 분리): LIVE corrected 채택 0, SHADOW 만 — 분리 강화.

## 롤백

`PRICE_CORRECTION_SHADOW_ENABLED=false` (기본값) — 채택 0. 집계는 `PRICE_CORRECTION_DISABLED=true` 로 correction 생략. 코드 롤백 시 Seam A 호출 1블록 제거 = baseline.
