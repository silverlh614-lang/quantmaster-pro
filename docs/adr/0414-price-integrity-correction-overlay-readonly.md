# ADR-0414 — Price Integrity Checker + Correction Overlay (Stage 1 Read-Only Mode)

- **Status**: Accepted
- **Date**: 2026-05-06
- **Authors**: engine-dev (사용자 명시 작업 지침서 직접 반영)
- **Series**: ADR-0412 (Frozen Quote Detector + Holiday-Aware R3 Streak Guard) 직속 후속 — 입력 데이터 layer 차단의 *종목별 정밀 진단* 격상

## 핵심 문장

> *"원본 데이터는 보존한다. 보정은 scan-local overlay 다. Stage 1 에서는 보정 결과를 판단에 쓰지 않고, 먼저 관측하고 검증한다."*

## 배경

ADR-0412 가 *전체 스캔의 frozen 비율* 단위 진단 (FrozenQuoteDetector — comparable<10/SUSPECT_RATIO=0.1/STALE_RATIO=0.3) 을 차단했지만, *종목별 정밀 결함* 은 여전히 분류 안 됨:

1. **Stale price** — 오늘 currentPrice 가 4영업일 전 close 와 일치 (`Yahoo` 제공자 stale + `KIS` 가 정상값 제공)
2. **Frozen quote** — currentPrice == previousClose (개별 종목 거래정지/관리종목)
3. **역산갭 (Reverse Gap)** — gapPct=±25% 가 `previousCloseDate=T-3` (액면병합/분할/배당락) 같은 *기준일 mismatch* 로 발생
4. **previousClose 기준일 불일치** — `currentPriceDate=T` vs `previousCloseDate=T-3` → gap 산출 자체 무의미
5. **Defensive Cascade Failure** (사용자 명시 보고) — 데이터 결함 → 시스템 결함으로 잘못 분류 → R3 hard latch 영구 차단

**핵심 통찰** (사용자 명시) — *"가격 데이터가 얼어 있으면 시스템 결함이 아니라 데이터 품질 문제로 분류한다."* (ADR-0412 핵심 통찰의 *종목별 정밀 격상*).

본 ADR 은 **Stage 1 Read-Only Mode** — original 데이터 무수정 + corrected 결과 LIVE 매수 판단 사용 0. *관측 + 검증* 만, 의사결정 변경은 Stage 2/3 후속 PR.

## Stage 정책 (사용자 명시 절대 변경 금지)

| Stage | 적용 범위 | corrected 사용처 | 활성화 ENV | 상태 |
|-------|-----------|------------------|------------|------|
| **Stage 1 (본 PR)** | Read-Only Mode | diagnostics only (scanDiagnostics 표시) | `PRICE_CORRECTION_DISABLED` (default OFF) | 본 ADR |
| **Stage 2 (후속 PR scope 외)** | Shadow-only activation | shadow scan 만 | (별도 ENV) | TODO |
| **Stage 3 (후속 PR scope 외)** | Live activation | signalScanner / 27조건 / Gate 1~3 | `PRICE_CORRECTION_LIVE_ENABLED=true` + 운영자 명시 승인 | TODO |

본 PR Stage 2/3 구현 **금지**.

## 결정

### 1. PriceIntegrityChecker — 종목별 입력 데이터 품질 SSOT

신규 모듈 `server/trading/signalScanner/priceIntegrityChecker.ts`.

#### 분류 결정 트리 (사용자 명시 정확 정합 — 절대 변경 금지)

```
입력: { symbol, currentPrice, currentPriceDate, previousClose, previousCloseDate,
       comparableQuoteCount?, secondarySources? }

1. currentPrice / previousClose 부재 → SUSPECT or FAILED
2. currentPriceDate < (최근 유효 거래일 - 2 거래일) → STALE
3. T/T-1 관계 아님 (currentPriceDate vs previousCloseDate 거리 > 1 거래일) → PRICE_BASE_MISMATCH
4. currentPrice ≈ previousClose (EPSILON_PCT 이내) → FROZEN_QUOTE
5. |gapPct| > 7% → SUSPECT
6. |gapPct| > 15% → REVERSE_GAP_SUSPECT
7. |gapPct| > 25% + date mismatch → PRICE_BASE_MISMATCH (격상)
8. comparable 부족 → SUSPECT (FAILED 금지 — 장 전 frozen 만으로 FAILED 처리 금지)
```

장 전 frozen 만으로 FAILED 처리 금지 — SUSPECT 또는 FROZEN_QUOTE 분류.

#### 임계값 SSOT

| 상수 | 값 | 의미 |
|------|----|----|
| `EPSILON_PCT` | 0.0001 | currentPrice == previousClose 판정 허용 오차 (0.01%) |
| `STALE_DAYS` | 2 | 최근 유효 거래일 -2 거래일 이상 stale |
| `SUSPECT_GAP_PCT` | 7 | \|gapPct\| > 7% SUSPECT |
| `REVERSE_GAP_PCT` | 15 | \|gapPct\| > 15% REVERSE_GAP_SUSPECT |
| `MISMATCH_GAP_PCT` | 25 | \|gapPct\| > 25% + date mismatch → PRICE_BASE_MISMATCH 격상 |
| `MIN_COMPARABLE` | 10 | comparable 부족 임계 (ADR-0412 정합) |

#### 출력 (`PriceIntegrityResult`)

```typescript
{
  symbol: string,
  status: 'OK' | 'SUSPECT' | 'STALE' | 'FROZEN_QUOTE'
        | 'PRICE_BASE_MISMATCH' | 'REVERSE_GAP_SUSPECT' | 'FAILED',
  reasons: string[],            // 결정 트리 통과 이유
  gapPct: number | null,         // 산출 가능 시 (date mismatch 시 null)
  daysFromLastTradingDay: number | null,
  dateAlignment: 'MATCH' | 'T_MINUS_1' | 'T_MINUS_2' | 'STALE' | 'UNKNOWN',
  computedAt: string,            // ISO
}
```

### 2. PriceCorrectionEngine — Scan-Local Overlay 보정

신규 모듈 `server/trading/signalScanner/priceCorrectionEngine.ts`.

#### 결정 트리 (사용자 명시 절대 변경 금지)

```
입력: PriceIntegrityResult + 다중 출처 (yahoo, kis, krx, recentDailyClose)

1. Yahoo stale + KIS 정상 → USE_KIS_CURRENT
   (Yahoo 시계열 stale 시 KIS 실시간 가격 채택)

2. previousCloseDate=T-3 + KRX prevClose 있음 → USE_KRX_PREV_CLOSE
   (Yahoo previousClose 기준일 mismatch 시 KRX 공식 종가 사용)

3. recentDailyClose 가용 + 다른 출처 부재 → USE_RECENT_DAILY_CLOSE
   (3차 fallback — 최근 일봉 close)

4. previousClose 보정 실패 / reverse gap + cross-source conflict
   → DROP_GAP_CALCULATION
   (사용자 명시 핵심 — *"틀린 gap 계산보다 gap 미사용 우월"*)

5. FAILED 상태 → SHADOW_ONLY
   (보정 자체 불가 — Shadow learning 만 허용)

6. 그 외 → NONE
```

#### `correctionType` 6 union

| 타입 | 의미 |
|------|----|
| `NONE` | 보정 불필요 (Integrity OK) |
| `USE_KIS_CURRENT` | KIS 실시간 가격 채택 |
| `USE_KRX_PREV_CLOSE` | KRX 공식 종가 채택 |
| `USE_RECENT_DAILY_CLOSE` | 최근 일봉 close 채택 |
| `DROP_GAP_CALCULATION` | gap 산출 자체 폐기 |
| `SHADOW_ONLY` | 보정 불가 — Shadow learning 만 |

#### confidence SSOT 공식

```typescript
sourceWeight: { KIS: 1.0, KRX: 0.9, YAHOO: 0.7, RECENT_DAILY: 0.6, CACHE: 0.4, UNKNOWN: 0.2 }
dateAlignmentWeight: { MATCH: 1.0, T_MINUS_1: 0.8, T_MINUS_2: 0.5, STALE: 0.2, UNKNOWN: 0.2 }
crossSourceAgreementWeight: { THREE_SOURCES: 1.0, TWO_SOURCES: 0.8, SINGLE_SOURCE: 0.5, CONFLICT: 0.2 }

confidence = clamp(sourceWeight × dateAlignmentWeight × crossSourceAgreementWeight, 0, 1)
```

#### 임계 상수 SSOT (Stage 2/3 후속 PR 사용)

| 상수 | 값 | Stage |
|------|----|----|
| `PRICE_CORRECTION_LIVE_THRESHOLD` | 0.8 | Stage 3 — LIVE 매수 판단 사용 임계 |
| `PRICE_CORRECTION_SHADOW_THRESHOLD` | 0.5 | Stage 2 — Shadow scan 사용 임계 |

본 PR (Stage 1) 에서 LIVE threshold *실제 매수 판단 사용 금지*.

#### 출력 (`PriceCorrectionResult`)

```typescript
{
  symbol: string,
  correctionType: PriceCorrectionType,
  correctedPrice: number | null,         // null = 보정 미적용 또는 DROP
  correctedPreviousClose: number | null,
  correctedGapPct: number | null,        // DROP_GAP_CALCULATION 시 항상 null
  gapBasisDate: string | null,           // null = gap 미사용
  confidence: number,                     // 0~1
  reasons: string[],
  usableForLiveEntry: boolean,           // Stage 3 LIVE 사용 가능 여부
  usableForShadow: boolean,              // Stage 2 Shadow 사용 가능 여부
  lineage?: PriceCorrectionLineage,
}
```

#### DROP_GAP_CALCULATION 정책 (가장 중요)

- `correctedGapPct = null`
- `gapBasisDate = null`
- `usableForLiveEntry = false`
- `usableForShadow = true`
- 원칙: *틀린 gap 계산보다 gap 미사용 우월*.

### 3. Original vs Corrected 사용처 경계 SSOT (사용자 명시 절대 변경 금지)

| 사용처 | Original | Corrected (Stage 1) | Corrected (Stage 2) | Corrected (Stage 3) |
|--------|----------|---------------------|---------------------|---------------------|
| persistence (raw quote / daily / master 영속) | ✅ | ❌ | ❌ | ❌ |
| 백테스트 | ✅ | ❌ | ❌ | ❌ |
| attribution outcome | ✅ | ❌ | ❌ | ❌ |
| learning outcome | ✅ | ❌ | ❌ | ❌ |
| 리포트 실제 체결 | ✅ | ❌ | ❌ | ❌ |
| diagnostics 표시 (`/scan_blockers`) | ✅ | ✅ | ✅ | ✅ |
| Shadow scan | (Original) | ❌ | ✅ | ✅ |
| signalScanner / 27조건 / Gate 1~3 | (Original) | ❌ | ❌ | ✅ (운영자 승인 후) |

**본 PR (Stage 1) 에서 Corrected 사용처 = diagnostics only**. signalScanner / entryEngine / exitEngine / order executor *수정 금지*.

### 4. PriceCorrectionLineage — 결정 추적성 SSOT

신규 모듈 `server/trading/signalScanner/priceCorrectionLineage.ts`.

```typescript
{
  inputSnapshot: {
    yahoo?: { current?, previousClose?, currentDate?, previousCloseDate? },
    kis?: { current?, previousClose?, currentDate?, previousCloseDate? },
    krx?: { previousClose?, previousCloseDate? },
    recentDailyClose?: { close?, date? },
  },
  decisionTrace: string[],            // 결정 과정 단계별 메시지
  correctionType: PriceCorrectionType,
  confidence: number,
  computedAt: string,                  // ISO
  ruleVersion: 'priceCorrectionEngine@v1-readonly',
}
```

모든 correction result 는 lineage 포함 의무 (Stage 2/3 진입 시 사후 검증 가능).

### 5. ENV `PRICE_CORRECTION_DISABLED`

- default OFF (default 정책 적용)
- `=true` 시:
  - PriceCorrectionEngine 실행 *생략*
  - PriceIntegrityChecker 는 *계속 실행*
  - corrected overlay 미생성
  - original-only diagnostics
- 정확 비교 (`process.env.PRICE_CORRECTION_DISABLED === 'true'`) ADR-0157 정합
- `isPriceCorrectionDisabled()` SSOT 헬퍼 — 호출자 측 inline ENV 검사 0건 (ADR-0185~0189 정합)

### 6. ScanSummary 옵셔널 필드 (후방호환)

`ScanSummary` 에 다음 옵셔널 추가 (ADR-0412 `frozenQuote?` 와 책임 분리):

```typescript
{
  // ...기존 필드 (frozenQuote 포함)
  priceIntegrity?: { totalSamples: number; statusCounts: Record<PriceIntegrityStatus, number>;
                     topAffected: Array<{ symbol: string; status: PriceIntegrityStatus }> };
  priceCorrection?: { totalSamples: number; correctionTypeCounts: Record<PriceCorrectionType, number>;
                      averageConfidence: number; dropGapCalculationCount: number;
                      shadowOnlySuggestedCount: number };
}
```

**ADR-0412 `frozenQuote?` 와 책임 분리** — frozenQuote 는 *전체 스캔의 frozen 비율*, priceIntegrity 는 *종목별 stale/frozen/mismatch/reverse_gap 분류*.

### 7. `/scan_blockers` 메시지 표시

`formatPriceIntegritySection` + `formatPriceCorrectionOverlaySection` SSOT 추가. 작업 지침서 §7 출력 예시 정합.

UI 문구 정책 (사용자 명시):
- "매수 차단" 표현 **금지** (price integrity / correction 은 데이터 품질 진단)
- "결함" / "에러" 표현 **금지** — "데이터 품질 문제" 로 분류 (ADR-0412 정합)
- Stage 1 표기 — "관측 + 검증" 명시

## 안전 invariant (절대 원칙 10종)

1. **원본 quote / daily / master 데이터 절대 덮어쓰기 금지** (persistence 무수정).
2. correction 결과는 *scan-local overlay 또는 read-only comparison* 만.
3. **이번 PR 에서 corrected 값을 LIVE 매수 판단에 사용 금지** (signalScanner / entryEngine / exitEngine / order executor 모두 무수정).
4. original + corrected 동시 계산 + 차이 기록.
5. correctionType / confidence / lineage / reasons 모두 영속.
6. **gap 기준일 불일치 시 gapPct 계산 금지** (DROP_GAP_CALCULATION 명시 지원).
7. correction 실패 시 SHADOW_ONLY 분류만.
8. correction 자체가 새로운 단일 장애점 되지 않도록 health metric 기록.
9. **LIVE 주문 함수 / KIS 주문 함수 / order executor 수정 금지** (절대 규칙 #2/#3/#4).
10. 외부 API 직접 호출 금지 — 이미 수집된 데이터만 사용.

## 잘못된 해결 방법 영구 차단 (6종)

1. ❌ **Stage 1 에서 corrected → LIVE entry 사용** — 절대 원칙 #3 위반.
2. ❌ original quote/master/daily 영속 덮어쓰기 — 절대 원칙 #1 위반 (saveStockMaster / saveQuoteSnapshot 호출 0건).
3. ❌ DROP_GAP_CALCULATION 무시 + 강제 gap 산출 — 절대 원칙 #6 위반.
4. ❌ 외부 API 직접 호출 (Yahoo/KIS/KRX 추가 fetch) — 절대 원칙 #10 위반.
5. ❌ correctionType 6 union 외 신규 type 임의 추가 — 결정 트리 SSOT 위반.
6. ❌ confidence 산출식 임의 변경 (3축 가중치 곱셈 외) — 사용자 명시 SSOT 변경 금지.

## 회귀 테스트 (≥30 케이스)

### PriceIntegrityChecker (1~8)

1. 정상 T/T-1 + gap 정상 → OK
2. currentPriceDate=T, previousCloseDate=T-3 → PRICE_BASE_MISMATCH
3. currentPriceDate=T-2 → STALE
4. currentPrice === previousClose → FROZEN_QUOTE
5. \|gapPct\|=8% → SUSPECT
6. \|gapPct\|=18% → REVERSE_GAP_SUSPECT
7. \|gapPct\|=28% + date mismatch → PRICE_BASE_MISMATCH
8. comparable 부족 → SUSPECT (FAILED 금지)

### PriceCorrectionEngine (9~17)

9. Yahoo stale + KIS 정상 → USE_KIS_CURRENT
10. previousCloseDate=T-3 + KRX prevClose 있음 → USE_KRX_PREV_CLOSE
11. previousClose 보정 실패 → DROP_GAP_CALCULATION
12. reverse gap + cross-source conflict → DROP_GAP_CALCULATION
13. FAILED → SHADOW_ONLY
14. confidence 산출 정상 (3축 가중치 곱셈)
15. confidence < shadow threshold → usableForLiveEntry=false
16. lineage 포함 (inputSnapshot + decisionTrace + ruleVersion)
17. **original 데이터 변경 0건** (input 객체 mutate 금지)

### Stage 1 통합 (18~21)

18. corrected 결과가 Gate / Signal / Entry 판단에 사용되지 않음 (정적 grep 가드)
19. scanDiagnostics 에 original vs corrected 차이 표시 (formatPriceCorrectionOverlaySection)
20. PRICE_CORRECTION_DISABLED=true → correction 생략 / integrity 는 실행
21. PriceIntegrityChecker 는 disabled 상태에서도 실행 가능

### 정적 grep 가드 (22~30)

22. priceCorrectionEngine.ts KIS 주문 함수 5종 import 0건
23. priceCorrectionEngine.ts autoTradeEngine import 0건
24. priceCorrectionEngine.ts order executor import 0건 (orchestrator/tradingOrchestrator 등)
25. persistence 원본 quote/master/daily overwrite 0건 (saveStockMaster / saveQuoteSnapshot 등 호출 부재)
26. signalScanner / entryEngine / exitEngine / order executor 가 corrected 값을 live decision 에 사용하지 않음 (정적 grep — `corrected` 키워드 부재)
27. Stage 1 entryEngine.ts 수정 0줄 (git diff 0)
28. Stage 1 exitEngine/** 수정 0줄
29. priceCorrectionEngine.ts 외부 API 직접 호출 0건 (fetch/axios/node-fetch 0건)
30. priceCorrectionEngine.ts 가 이미 수집된 입력 데이터만 사용 (외부 의존성 0)

## 후속 작업 (Stage 2/3, scope 외)

- **PR-PriceCorrection-Stage2-Shadow** — `PRICE_CORRECTION_SHADOW_ENABLED=true` ENV 도입 + Shadow scan 에서 corrected 값 사용 (signalScanner Shadow 분기 wiring). PENDING_WIRING.md P1 등재.
- **PR-PriceCorrection-Stage3-Live** — `PRICE_CORRECTION_LIVE_ENABLED=true` ENV 도입 + 운영자 명시 승인 + signalScanner / 27조건 / Gate 1~3 wiring. PENDING_WIRING.md P0 등재.
- **PR-PriceCorrection-HealthMetric** — `priceCorrectionHealth` (mode/total/correctionSuggested/shadowOnlySuggested/dropGapCalculationCount/averageConfidence/status) 영속 + `/health` 진단 라인 추가. health diagnostics 구조 변경 시 별도 ADR.
- **PR-PriceCorrection-Lineage-Persistence** — `priceCorrectionLineage` 디스크 영속 + 운영자 사후 추적 진단 명령 (`/price_correction_audit <symbol>`).
- **PR-PriceCorrection-Replay-Backtest** — Stage 2 Shadow 1주 데이터 누적 후 corrected vs original 백테스트 비교 (Stage 3 활성화 결정 입력).

## 호환성

- ADR-0028 (safePctChange) — 본 ADR 의 `gapPct` 산출은 `safePctChange` 또는 `safePctChangeStrict` 사용 (ADR-0117 정합).
- ADR-0091 (Yahoo Stale Base) / ADR-0113 (Drift Tier Sanity) — 본 ADR 의 `STALE` / `PRICE_BASE_MISMATCH` 가 격상 분류, 단일 통합.
- ADR-0117 (Sanity Trade-Block Gate) — 본 PR 은 Stage 1 read-only 라 ADR-0117 의사결정 layer 무관. Stage 3 진입 시 정합 의무.
- ADR-0118 (scan_blockers diagnostic) — `formatPriceIntegritySection` + `formatPriceCorrectionOverlaySection` 가 ADR-0118 메시지 빌더에 합성.
- ADR-0157 (ENV 정확 비교 의무) — `PRICE_CORRECTION_DISABLED` 정확 비교.
- ADR-0185~0189 (ENV 헬퍼 SSOT 위임) — `isPriceCorrectionDisabled()` SSOT 헬퍼.
- ADR-0395 (P2 영속 ExecutionMode) — 본 ADR 은 영속 ExecutionMode 무관 (read-only).
- ADR-0396/0397/0398 (sectorEnergy 시리즈) — 본 ADR 은 가격 데이터 layer, sectorEnergy 와 직교.
- ADR-0411 (technicalProviderDegraded) — 본 ADR 의 `STALE` / `PRICE_BASE_MISMATCH` 가 ADR-0411 marker 와 의미 분리 (ADR-0411=시계열 evaluator 강등, 본 ADR=현재가/이전종가 보정).
- ADR-0412 (Frozen Quote Detector + R3 Streak Guard) — `frozenQuote?` 와 `priceIntegrity?` *책임 분리* (전체 vs 종목별).
- ADR-0146 PR 자가 review 5 카테고리 모두 PASS.
- ADR-0148 4 정적 검증 baseline 무회귀.
