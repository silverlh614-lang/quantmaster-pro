# ADR-0518 — Corporate Action Guard 일봉 연속성 검증 (false-positive 차단)

Date: 2026-05-24
Status: Accepted
Domain: trading / corporate-action / watchlist
executionImpact: NONE
liveExecutionAllowed: false
operatorApprovalRequired: false
policyPromotionMode: N/A (운영자 명시 요청 수정)

## 배경 (사용자 보고)

피엠티(147760): entryPrice 4,745 (RAW immutable, ADR-0115/0116) → 현재 9,470 = drift +99.6%.
차트상 수 주에 걸친 **정상 연속 급등**(단일일 ±30% 초과 갭 없음, KRX 시세). 그런데
`applyEntryPriceDrift`(`watchlistManager.ts`) → `detectCorporateAction` 가 **magnitude-only(>80%)**
판정으로 분할/병합/권리락을 의심 → universe 제외 + HIGH priority 텔레그램(부팅 시) = **false positive**.

근본 원인: magnitude-only 판정은 "수 주간 정상 +99.6% 랠리"와 "하룻밤 +100% 권리락/병합 갭"을
구분하지 못한다. 둘을 가르는 KIS 일봉 연속성 검증(ADR-0303)이 "후속 PR"로 미뤄져 있었음.

## 문제

ADR-0113 Corporate Action Detector 는 drift 의 *크기*(magnitude)만으로 corporate action 을 의심한다.
크기는 corporate action 의 *필요* 조건이지 *충분* 조건이 아니다. 정상 다일 랠리도 누적 drift 가
80%를 쉽게 초과한다. 결과적으로 건강한 종목이 universe 에서 제외되고 운영자에게 오경보가 나간다.

## 물리적 판별 근거 — 35% 단일일 갭 임계

KRX 일일 ±30% 상한가/하한가 → **정상 매매로는 하루에 ±30%를 초과할 수 없다.** 분할/병합/권리락의
ex-date 는 기계적 가격 조정이라 단일일 close-to-close 갭이 ±30%를 초과한다. 따라서 일봉에 단일일
갭 > 35%(= 30% 상한 + 5% 마진)가 있으면 진짜 corporate action, 없으면 정상 다일 랠리다. 마진 5%는
시간외 단일가·동시호가 잔차·소수 라운딩 등 ±30% 경계 근처의 정상 변동을 흡수하기 위함이다.

```
KRX_DAILY_PRICE_LIMIT_PCT       = 30   // 정상 매매 단일일 한계
CORPORATE_ACTION_GAP_THRESHOLD_PCT = 35   // 30% 상한 + 5% 마진 (ENV override 가능)
```

## ⚠️ 핵심 제약: RAW 일봉 필요 (수정주가는 갭을 지운다)

`fetchKisChartData` 는 KIS `FID_ORG_ADJ_PRC: '0'`(수정주가 = adjusted)로 호출한다. 수정주가는
**분할/병합 갭을 소급 제거**하므로 — 수정주가 일봉에서는 corporate action 갭이 보이지 않는다.
갭 탐지는 반드시 **원주가(raw, `FID_ORG_ADJ_PRC: '1'`)** 로 해야 한다. 따라서 fetcher 에
`rawPrices` 옵션을 추가하고, 본 검증 경로는 raw 일봉을 조회한다.

| FID_ORG_ADJ_PRC | 의미 | corporate action 갭 |
|-----------------|------|---------------------|
| `'0'` (기존 default) | 수정주가 (adjusted) | **소급 제거됨** — 검증 불가 |
| `'1'` (본 ADR 추가) | 원주가 (raw) | **보존됨** — 검증 가능 |

## 결정 사항 (사용자 승인)

KIS 일봉 연속성 검증(ADR-0303 정식 구현). drift > 80% 의심 시 RAW 일봉을 조회해 **addedAt 이후
구간**에서 단일일 |close-to-close| 갭 > 35% 가 있을 때만 CORPORATE_ACTION 을 확정한다. 없으면
GENUINE_RALLY 로 강등한다. 일봉 부족·KIS 미가용·파싱 실패는 UNVERIFIABLE 로 기존 보수적 동작 유지.

검증 로직은 `corporateActionDetector.ts` 의 순수(pure) SSOT `verifyDailyBarContinuity` 로 격리하고,
비동기 조회/강등 wiring 은 `entryPriceDrift.ts` (caller) 에서만 발생한다. 동기 `applyEntryPriceDrift`
(watchlistManager) 는 일봉을 조회하지 않으므로 기존 동기 테스트는 무수정 통과한다.

## 동작 매트릭스 (entryPriceDrift.ts CORPORATE_ACTION 분기)

| 판정 | 조건 | 동작 |
|------|------|------|
| **CONFIRMED** | RAW 일봉 addedAt 이후 구간에 단일일 |close-to-close| 갭 > 35% 발견 | 기존 동작 유지 — universe 제외 + HIGH 텔레그램 + DART 검토 (gapDate 동봉) |
| **GENUINE_RALLY** | 갭 없음 (모든 단일일 변동 ≤ 35%) | corporate action 아님 → 기존 benign `'REMOVE'` 경로로 강등 (조용히 워치리스트 제거, **corp-action 텔레그램 / DART 프레이밍 없음**, `waitDriftRemove` 카운터) |
| **UNVERIFIABLE** | 일봉 < 2개 / KIS 미가용 / 파싱 실패, 또는 검증 비활성 ENV | 기존 보수적 동작 유지 (universe 제외 + 텔레그램) — **무회귀** (provider 장애가 진짜 corp action 을 통과시키지 않도록) |

GENUINE_RALLY 가 benign REMOVE 로 가는 이유: drift 가 +99.6%면 entryPrice 가 진입가에서 크게
벗어난 stale 후보이므로 워치리스트에서 제거하는 것이 맞다. 다만 그것은 corporate action 이 아니라
정상 랠리에 의한 stale 이므로 corp-action 텔레그램/DART 프레이밍을 붙이지 않는다.

## executionImpact = NONE

GENUINE_RALLY 도 어차피 워치리스트에서 제거(매수 후보 안 됨) → **신규 매수 경로 0 신설**.
변화는 오직 (1) false corp-action 텔레그램 제거 (2) corpAction → benign removal 카운터 전환
(3) 의심 시 read-only RAW 일봉 1회 조회. LIVE 매매 본체(autoTradeEngine / orderExecutor /
trancheExecutor / entryEngine / exitEngine / kisClient 주문 함수 5종) 0줄 변경. KIS 주문 quota
0 침범 (read-only 일봉 1콜 / 의심 종목, rare path — drift > 80% 인 희소 케이스에서만).

## 타입/심볼 계약 (engine-dev 가 corporateActionDetector.ts 에 추가)

PLAN.md "타입/심볼 계약" 섹션을 SSOT 로 인용한다 (engine-dev 가 구현, 본 ADR 은 계약 고정):

```ts
export const KRX_DAILY_PRICE_LIMIT_PCT = 30;
export const CORPORATE_ACTION_GAP_THRESHOLD_PCT = 35; // ENV CORPORATE_ACTION_GAP_THRESHOLD_PCT override
export function isDailyBarVerificationDisabled(): boolean; // ENV CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED === 'true'
export function activeCorporateActionGapThresholdPct(): number;

export type DailyBarVerdictStatus = 'CONFIRMED' | 'GENUINE_RALLY' | 'UNVERIFIABLE';
export interface DailyBarLike { date: string; close: number; }
export interface DailyBarVerdict {
  status: DailyBarVerdictStatus;
  maxSingleDayMovePct: number | null;
  gapDate?: string;
  barsExamined: number;
  reason: string;
}
// PURE — candles old→new. sinceDate(YYYYMMDD or ISO) 이후만 스캔. <2 bars → UNVERIFIABLE.
// 인접 |close[i]/close[i-1]-1|*100 최대값 > threshold → CONFIRMED(gapDate=해당 bar) else GENUINE_RALLY.
export function verifyDailyBarContinuity(
  candles: DailyBarLike[],
  opts?: { sinceDate?: string; thresholdPct?: number },
): DailyBarVerdict;
```

### fetcher 변경 (kisChartDataFetcher.ts) — 기존 51 caller 무영향

```ts
fetchKisChartData(code, period, startDate, endDate, opts?: { rawPrices?: boolean })
fetchKisDailyCandles(code, calendarDays?, opts?: { rawPrices?: boolean })
```

`opts.rawPrices === true` 시 `FID_ORG_ADJ_PRC: '1'`(원주가), 미전달/false 시 기존 `'0'`(수정주가)
그대로 — 후방호환 100% (기존 51 caller 무수정).

## ENV 롤백

| ENV | 효과 |
|-----|------|
| `CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED=true` | 일봉 검증 skip = 기존 항상-제외(ADR-0113/0115) 동작 1줄 복원. `verifyDailyBarContinuity` 미호출, CORPORATE_ACTION 분기는 magnitude-only 보수 동작 유지 |
| `CORPORATE_ACTION_GAP_THRESHOLD_PCT=<n>` | 35% 단일일 갭 임계 override (default 35) |

default = 검증 ON (사용자가 명시 요청한 수정). ENV 정확 비교(ADR-0157) — `'true'` 만 인식.

## ADR-0146 PR 자가 review 5 카테고리

1. **LIVE 매매 안전성** — executionImpact=NONE, LIVE 매매 본체 0줄 변경, KIS read-only 일봉
   1콜/의심 종목 (rare path, drift>80%), KIS/KRX 주문 quota 0 침범. ENV
   `CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED=true` 1줄 즉시 ADR-0113/0115 동작 byte-equivalent 복원.
2. **wiring 완료 vs 인프라만** — wiring 완료: `verifyDailyBarContinuity` SSOT (pure) +
   `kisChartDataFetcher` rawPrices 옵션 + `entryPriceDrift.checkEntryPriceDrift` 주입형 fetcher +
   GENUINE_RALLY 강등 분기까지 연결. dead-code 아님.
3. **ADR 발급 무결성** — INDEX.md `다음 발급` 0518 사용, 0519 로 advance, 번호 충돌·건너뛰기 0.
4. **회귀 테스트 적정성** — `corporateActionDetector.test.ts` 확장 (피엠티형 ≤30%/일 → GENUINE_RALLY /
   +100% 단일일 갭 → CONFIRMED / -50% 갭(abs) → CONFIRMED / <2 bars → UNVERIFIABLE / 경계 정확히
   30%·35% / sinceDate 이전 갭 무시) + entryPriceDrift 강등 통합 테스트 1개.
   `watchlistManagerDataHold.test.ts` / `watchlistManager.test.ts` **무수정 통과** (동기 path 는 일봉 미조회).
5. **정책 위반 baseline 무회귀** — Gate threshold / requiredScore=70 / STRONG_BUY / UNKNOWN penalty /
   entryPrice RAW immutable(ADR-0115/0116) 모두 무변경. UNVERIFIABLE 보수 동작으로 provider 장애가
   진짜 corp action 을 통과시키지 않음 (안전 방향 무회귀).

## byte-equivalent 원칙

LIVE 매매 본체 0줄 변경 + ENV 1줄 즉시 롤백 + 회귀 테스트 + KIS/KRX quota 0 침범. 검증 비활성 시
ADR-0113/0115 의 magnitude-only CORPORATE_ACTION(universe 제외 + 텔레그램) 동작과 byte-equivalent.

## 기존 ADR 과의 관계

- **ADR-0113** (Yahoo drift 4단계 sanity + Corporate Action Detector) — 본 ADR 의 직접 base.
  ADR-0113 의 magnitude-only 의심을 일봉 연속성 검증으로 *세분화* (확정/정상랠리/검증불가).
  `corporateActionDetector.ts` SSOT·`applyEntryPriceDrift` CORPORATE_ACTION union·ENV
  `CORPORATE_ACTION_DETECTOR_DISABLED` 모두 보존하고 확장만 한다.
- **ADR-0115** (entryPrice immutable + 실행 레이어 완화) — RAW immutable 원칙 보존. CORPORATE_ACTION
  default 동작 *entryPrice 보존 + universe 제외* 를 유지하되, GENUINE_RALLY 시 corp-action 프레이밍만
  제거 (entryPrice 는 여전히 재설정하지 않음). entryPrice 재설정 0건.
- **ADR-0116** (entryPrice RAW/ADJUSTED 분리) — 본 ADR 의 RAW vs adjusted 인식과 정합. ADR-0116 이
  record 레이어 RAW/adjusted 를 분리했고, 본 ADR 은 *일봉 fetch* 레이어에서 동일 원칙
  (`FID_ORG_ADJ_PRC '1'` = raw 가 corporate action 갭을 보존)을 적용한다.
- **ADR-0117** (Sanity Trade Block Gate) — `safePctChangeStrict` 가 매수 critical path 안전망 유지.
  본 ADR 은 그와 독립적으로 워치리스트 drift 의심 경로에서만 동작 (매수 critical path 무변경).
- **ADR-0301 / ADR-0303** — ADR-0303 의 "KIS 일봉 자동 검증 후속 PR" 의 **정식 구현**이다. ADR-0301/0303
  이 후속으로 미룬 일봉 연속성 검증을 본 ADR 이 SSOT 로 확정한다.

## 후속 PR (scope 외)

1. **DART 공시 cross-check** — CONFIRMED 시 DART `주식분할` / `무상증자결정` / `유상증자결정`
   매칭으로 corporate action type(SPLIT/MERGE/RIGHTS) 확정.
2. **cumulativeAdjustmentFactor 자동 갱신** (ADR-0116 P3 ledger) — gapDate 기준 split factor 계산.
3. **gapDate 다중 갭 처리** — addedAt 이후 복수 corporate action 시 첫 갭만이 아닌 누적 처리.

## 참조

- ADR-0113 (Yahoo drift 4단계 sanity + Corporate Action Detector) — 본 ADR 의 base
- ADR-0115 (entryPrice immutable + 실행 레이어 완화)
- ADR-0116 (entryPrice RAW/ADJUSTED 분리 + Gate3 ENV 완화 wiring)
- ADR-0117 (Sanity Trade Block Gate)
- ADR-0301 / ADR-0303 (KIS 일봉 자동 검증 — 본 ADR 이 정식 구현)
- ADR-0146 (PR 자가 review 5 카테고리)
- ADR-0157 (ENV 정확 비교)
- `_workspace/2026-05-24_corporate-action-dailybar-verify/PLAN.md` (타입/심볼 계약 SSOT)
