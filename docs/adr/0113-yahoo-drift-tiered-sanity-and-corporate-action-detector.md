# ADR-0113: Yahoo drift 4단계 sanity + Corporate Action Detector

## 상태
승인 (2026-04-30)

## 배경

### 1차 로그 P0-2 — Yahoo STALE_BASE 폭주

2026-04-29 23:46 ~ 04-30 02:30 사이 Yahoo `KS`/`KQ` 종목 30+ 건에서 `safePctChange`
sanity bound (±90%) 위반 발생. 대표 사례:

| 종목 | drift | base.asOf | 의심 |
|------|-------|-----------|------|
| 027360 아주IB투자 | -86.34% | 2026-04-28 | 액면병합 |
| 950160 코오롱티슈진 | -83.39% | 2026-04-28 | 액면병합 |
| 095340 ISC | -76.76% | 2026-04-28 | 액면분할 |
| 098460 고영 (워치리스트 drift) | **221%** | 2026-04-28 | 분할 |
| 336260 두산테스나 (워치리스트 drift) | **207%** | 2026-04-28 | 분할 |

ADR-0091 PR-Z4 의 `safePctChangeDetailed` SSOT + STALE_BASE marker + KIS 폴백이
이미 정상 작동했지만 — 모든 위반을 *동일하게* `STALE_BASE_OR_SPLIT_ADJUSTMENT`
로 분류해서 처리. 사용자 분석 #2 의 핵심 통찰:

> "drift 의 *심각도* 에 따라 처리가 달라야 한다. 25% 미만은 정상, 25~60% 경고,
> 60~150% 자동 invalid, **150% 초과는 corporate action 강제 의심** — 워치리스트
> entryPrice 자체를 재설정해야 한다."

### 갭

`safePctChange` 의 단일 sanity bound (±90%) 가 *모든* 임계를 동일 처리.
`watchlistManager.applyEntryPriceDrift` 가 drift > 150% (098460 221%) 시
*아무 행동 안 함* — entryPrice 가 분할 전 값으로 박제되어 다음 sanity 위반 무한 반복.

## 결정

### 1. drift 4단계 분기 SSOT (`safePctChange.ts` 격상)

```typescript
export const DRIFT_TIER_THRESHOLDS = {
  /** < 25% — 정상 */
  NORMAL_MAX: 25,
  /** 25~60% — 경고 (기록만, 사용 가능) */
  WARN_MAX: 60,
  /** 60~150% — 자동 invalid (기존 STALE_BASE 처리) */
  INVALID_MAX: 150,
  /** > 150% — Corporate Action 강제 의심 (워치리스트 격리 + DART 조회) */
  CORPORATE_ACTION_MIN: 150,
} as const;

export type DriftTier = 'NORMAL' | 'WARN' | 'INVALID' | 'CORPORATE_ACTION';

export function classifyDriftTier(absDriftPct: number): DriftTier;
```

`SafePctChangeReason` union 에 `'CORPORATE_ACTION_SUSPECTED'` 추가.
`SafePctChangeResult` 에 옵셔널 `tier?: DriftTier` 필드 추가 (후방호환).

### 2. safePctChangeDetailed 분기 갱신

```typescript
// 분기 변경 — sanity bound 단일 임계 → 4단계 tier
const absPct = Math.abs(pct);
const tier = classifyDriftTier(absPct);

if (tier === 'CORPORATE_ACTION') {
  // 진단 로그 + 워치리스트 격리 권고
  return { value: 0, valid: false, reason: 'CORPORATE_ACTION_SUSPECTED', tier };
}
if (tier === 'INVALID') {
  return { value: 0, valid: false, reason: 'STALE_BASE_OR_SPLIT_ADJUSTMENT', tier };
}
if (tier === 'WARN') {
  // 25~60% — value 유효하지만 warn marker
  return { value: pct, valid: true, reason: 'OK', tier };
}
// NORMAL — 기존 동작
return { value: pct, valid: true, reason: 'OK', tier };
```

`sanityBoundPct` opts 가 명시되면 (예: `sectorEnergyProvider` 의 ±1000% override)
4단계 분기 우회 — 후방호환 100%.

### 3. Corporate Action Detector 모듈 신설

`server/trading/corporateActionDetector.ts` (≤200 LoC, @responsibility SRP):

```typescript
export type CorporateActionType = 'SPLIT' | 'MERGE' | 'RIGHTS' | 'UNKNOWN';

export interface CorporateActionResult {
  detected: boolean;
  type: CorporateActionType;
  driftPct: number;
  reason: string;
  // DART 매칭은 별도 후속 PR. 본 PR 은 drift 패턴 매칭만.
}

export function detectCorporateAction(input: {
  driftPct: number;
  /** 1d 또는 5d drift % (양/음 부호 보존) */
  windowDays?: 1 | 5;
}): CorporateActionResult;
```

분류 규칙 (DART 공시 매칭은 후속):
- `|drift| > 150%` AND drift > 0 → 'SPLIT' (역분할/감자, 가격 상승)
- `|drift| > 150%` AND drift < 0 → 'MERGE' or 'SPLIT' (분할 후 가격 하락)
- 60~150% AND drift > 50% AND windowDays=1 → 'RIGHTS' (권리락 추정)
- 그 외 → 'UNKNOWN'

ENV `CORPORATE_ACTION_DETECTOR_DISABLED=true` → 항상 `{ detected: false }` 반환.

### 4. watchlistManager entryPrice 자동 보정

`server/screener/watchlistManager.ts` 의 `applyEntryPriceDrift` 가 driftPct >
`DRIFT_TIER_THRESHOLDS.CORPORATE_ACTION_MIN` (150%) 감지 시:

1. `detectCorporateAction({ driftPct })` 호출
2. `detected=true` 시:
   - `entry.entryPrice = currentPrice` (재설정)
   - `entry.corporateActionAdjusted = true` (마커)
   - `entry.corporateActionAdjustedAt = new Date().toISOString()`
   - 텔레그램 HIGH priority 알림 (24h dedupeKey `corp_action:${stockCode}`)
   - 결과 = `'REPLACE'`
3. `detected=false` 시 → 기존 동작 (REMOVE/KEEP)

### 5. 진단 로그 강화

기존 `[safePctChangeDetailed] STALE_BASE_OR_SPLIT_ADJUSTMENT` 로그 라인을:
- WARN: `[safePctChangeDetailed] WARN_DRIFT @${label} — |${pct}%| in 25~60% (...)`
- INVALID: 기존 STALE_BASE_OR_SPLIT_ADJUSTMENT 로그 보존
- CORPORATE_ACTION: `[safePctChangeDetailed] CORPORATE_ACTION_SUSPECTED @${label} — |${pct}%| > 150% (...) — 워치리스트 자동 격리 + DART 조회 권고.`

각 라벨별 60s throttle (기존 패턴).

### 6. ENV 롤백

| ENV | 효과 |
|-----|------|
| `DRIFT_TIERED_SANITY_DISABLED=true` | 4단계 분기 비활성, 기존 단일 ±90% bound 복원 |
| `CORPORATE_ACTION_DETECTOR_DISABLED=true` | 자동 보정 차단, 기존 동작 (REMOVE/KEEP) |
| `WATCHLIST_ENTRY_PRICE_AUTO_CORRECT_DISABLED=true` | applyEntryPriceDrift 의 REPLACE 분기만 차단 |

## 효과

### 1차 로그 시뮬

| 종목 | drift | 기존 처리 | ADR-0113 처리 |
|------|-------|-----------|---------------|
| 027360 아주IB투자 | -86.34% | INVALID + KIS 폴백 | INVALID + KIS 폴백 (동일) |
| 098460 고영 (entryPrice drift) | +221% | REMOVE 또는 KEEP (drift > 90%로 인한 비결정) | **CORPORATE_ACTION → entryPrice 재설정 + DART 조회 권고** |
| 336260 두산테스나 (entryPrice drift) | +207% | (동일) | (동일) |

→ 워치리스트 분할 종목 자동 정합 + DART 매칭 후속 PR 의 데이터 인프라 마련.

## 영향 범위

| 영역 | 변경 | 위험 |
|------|------|------|
| `safePctChange.ts` SSOT | 4단계 tier + reason union 1 추가 | 후방호환 100% (기존 valid/reason 보존) |
| `corporateActionDetector.ts` | 신규 SSOT 모듈 | 외부 의존 0 |
| `watchlistManager.applyEntryPriceDrift` | REPLACE 분기 1개 추가 | drift > 150% 만 영향 (희소 케이스) |
| 기존 호출자 | 0줄 변경 | 후방호환 자동 검증 |
| LIVE 매매 본체 | 0줄 변경 | — |
| KIS/KRX quota | 0건 | DART 매칭은 후속 PR |

## 후속 PR (scope 외)

1. **DART 공시 매칭** — `corporateActionDetector` 가 DART `유상증자결정` /
   `주식분할` / `무상증자결정` 매칭 후 자동 base 갱신
2. **PriceSnapshot 4 필드 영속** (`rawClose` / `adjustedClose` /
   `splitAdjustedBase` / `corporateActionFlag`)
3. **Corporate Action 24h 격리** — 워치리스트 `corporateActionAdjusted` 종목을
   24h 동안 신호 스캔에서 제외

## 참조
- ADR-0028 (safePctChange) — 본 ADR 의 base
- ADR-0091 PR-Z4 (Yahoo Stale Base) — 본 ADR 의 직전 단계
- ADR-0014 (kisPost idempotency) — KIS 폴백 SSOT
