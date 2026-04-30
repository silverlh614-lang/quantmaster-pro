# ADR-0114: Data Trust Layer 3-tier SSOT 정책

## 상태
승인 (2026-04-30)

## 배경

### 사용자 분석 #2 직접 반영

> "Yahoo 를 버릴 것인가? 아니다. **Yahoo 를 신뢰도 계층화할 것인가?** 가 맞다.
> KIS / DART / KRX = truth layer / Yahoo = indicator layer / AI = interpretation layer.
> 가장 중요한 전략적 판단."

### 현재 코드베이스 — 부분 충족

| ADR | 정책 | 적용 영역 |
|-----|------|----------|
| ADR-0011 (PR-25) | AI 추천 KIS/KRX 분리 | google_search + naver_finance 만 사용 |
| ADR-0015 (PR-34) | LIVE reconciliation KIS SSOT | 수량/평단가/현금 KIS truth |
| ADR-0064 (PR-α) | Yahoo prefill overlay (AI hallucination 차단) | KOSPI/KOSDAQ/Dow/NASDAQ/JPY/EUR/금/WTI |
| ADR-0094 (PR-Z7) | UI Language SSOT | INTERPRETATION 라벨링 |
| ADR-0095 (PR-Z8) | DataQuality 5-tier | UI 시각화 |
| ADR-0098 (PR-Z11) | ConfluenceMeter 4축 | UI 합치도 |

→ 부분 충족이지만 *전체 시스템* 에 대한 명시적 SSOT 정책 부재. 신규 호출자가
*어떤 출처를* *어떤 용도로* 써야 하는지 명문화 안 됨. 결과적으로:
- ADR-0064 같은 결함 (AI 가 가격 추정) 이 다른 영역에서 재발 가능
- 신규 데이터 출처 추가 시 어느 tier 인지 결정 트리 부재
- 정적 검증 기반 회귀 차단 안 됨

## 결정

### 1. 3-tier SSOT 데이터 모듈 — `server/data/dataTrustLayer.ts`

```typescript
export type DataTrustTier = 1 | 2 | 3;

export type TrustedSource =
  // Tier 1 — TRUTH (reconciliation_anchor)
  | 'KIS_REAL_QUOTE'
  | 'KIS_DAILY'
  | 'KRX_OPENAPI'
  | 'DART_FILING'
  // Tier 2 — INDICATOR (derivation_input)
  | 'YAHOO_FINANCE'
  | 'NAVER_MOBILE'
  | 'NAVER_FINANCE'
  | 'GOOGLE_SEARCH'
  // Tier 3 — INTERPRETATION (narrative_only)
  | 'GEMINI_AI';

export type TrustedUse =
  // Tier 1 only
  | 'LIVE_TRADING'
  | 'POSITION_RECONCILE'
  | 'CORPORATE_ACTION'
  // Tier 1+2
  | 'SCREENING'
  | 'BACKTEST'
  | 'CHART_UI'
  // Tier 1+2+3
  | 'NARRATIVE'
  | 'REFLECTION'
  | 'PRE_MORTEM';

export const DATA_TRUST_LAYER = {
  TRUTH: {
    tier: 1,
    sources: ['KIS_REAL_QUOTE', 'KIS_DAILY', 'KRX_OPENAPI', 'DART_FILING'],
    role: 'reconciliation_anchor',
    allowedUse: ['LIVE_TRADING', 'POSITION_RECONCILE', 'CORPORATE_ACTION',
                 'SCREENING', 'BACKTEST', 'CHART_UI', 'NARRATIVE', 'REFLECTION', 'PRE_MORTEM'],
  },
  INDICATOR: {
    tier: 2,
    sources: ['YAHOO_FINANCE', 'NAVER_MOBILE', 'NAVER_FINANCE', 'GOOGLE_SEARCH'],
    role: 'derivation_input',
    allowedUse: ['SCREENING', 'BACKTEST', 'CHART_UI', 'NARRATIVE', 'REFLECTION', 'PRE_MORTEM'],
  },
  INTERPRETATION: {
    tier: 3,
    sources: ['GEMINI_AI'],
    role: 'narrative_only',
    allowedUse: ['NARRATIVE', 'REFLECTION', 'PRE_MORTEM'],
  },
} as const;

/** source 가 어느 tier 인지 반환 (등록 안 된 source → null). */
export function getDataTrustTier(source: string): DataTrustTier | null;

/** source × intendedUse 조합이 정책에 부합하면 통과, 위반 시 throw. */
export function assertDataTrustLayer(
  source: TrustedSource,
  intendedUse: TrustedUse,
): void;

/** 위반 분류 (테스트 + 진단용) */
export function evaluateDataTrustViolation(
  source: string,
  intendedUse: string,
): { ok: boolean; tier?: DataTrustTier; reason?: string };
```

### 2. 정적 검증 스크립트 — `scripts/check_data_trust.js`

`validate:dataTrust` npm 스크립트 + `validate:all` + `precommit` 통합 (총 12종).

**검사 패턴 (정규식 + 주석/문자열 컨텍스트 인식)**:

1. **AI 가격 hallucination 차단**:
   - `gemini.*\.(currentPrice|priceKrw|stopLoss|targetPrice)` 직접 사용 → 차단
   - AI 응답에서 **수치 결정** 사용 시 화이트리스트 필요
2. **LIVE_TRADING 경로 INDICATOR 사용 차단**:
   - `placeKisOrder` / `placeKisSellOrder` / `autoTradeEngine` 인근 코드에서
     `yahoo`/`naver` 가격 변수를 매수가/손절가/목표가 입력으로 사용 시 차단
3. **화이트리스트** (정책 SSOT 자기 자신 + 진단/테스트 + ADR 자동 인식)

본 PR 은 *정책 + lint 인프라* 만 신설. 본 lint 가 baseline (현재 코드베이스 0건
위반) 위에서 회귀 차단으로 작동. 위반 발견 시 *후속 PR* 에서 마이그레이션.

### 3. ENV 롤백 — `DATA_TRUST_ENFORCEMENT_DISABLED`

`assertDataTrustLayer` 가 throw 대신 `console.warn` 만 출력 → 비상 운영 우회.
정적 lint 는 ENV 무관하게 작동 (영구 회귀 차단).

### 4. 후방호환

본 PR 은 신규 SSOT + lint 만 추가. 기존 호출자 0줄 변경. 점진 마이그레이션 PR
들이 신규 호출자에서 `assertDataTrustLayer` 사용 정착.

## 영향 범위

| 영역 | 변경 |
|------|------|
| `server/data/dataTrustLayer.ts` | 신규 SSOT 모듈 |
| `scripts/check_data_trust.js` | 신규 정적 검증 |
| `package.json` | validate:dataTrust 추가 + validate:all/precommit 통합 |
| ARCHITECTURE.md | data trust boundary rule |
| 기존 호출자 | 0줄 변경 |
| LIVE 매매 본체 | 0줄 변경 |
| KIS/KRX quota | 0건 |

## 후속 PR (scope 외)

1. **assertDataTrustLayer wiring** — 신규 호출자에서 명시 사용 (예:
   `enrichment.ts` 가 Yahoo 가격 사용 시 `assertDataTrustLayer('YAHOO_FINANCE', 'SCREENING')`)
2. **AI 가격 hallucination 영구 차단** (ADR-0064 PR-α 패턴 격상) — Gemini
   응답에서 numeric price 추출 시 lint 강제 차단
3. **신규 데이터 출처 onboarding 가이드** — `docs/data-source-onboarding.md`

## 참조
- ADR-0011 (AI 추천 KIS/KRX 분리)
- ADR-0015 (LIVE reconciliation KIS SSOT)
- ADR-0064 (Yahoo prefill overlay)
- ADR-0094 (UI Language SSOT)
- ADR-0095/0098 (DataQuality 5-tier / ConfluenceMeter)
- 사용자 분석 §"Yahoo 신뢰도 계층화"
