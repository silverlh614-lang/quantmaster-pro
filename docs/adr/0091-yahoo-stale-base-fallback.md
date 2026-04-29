# ADR-0091 — Yahoo Stale Base 결과 객체화 + KIS 폴백 + STALE_BASE 종목 제외

**상태**: Accepted (PR-Z4)
**작성일**: 2026-04-29
**관련**: ADR-0028 (safePctChange), ADR-0082 (Yahoo range ≤1y), ADR-0004 (Yahoo ADR 역산 폐기)

## 배경

사용자 보고 (Railway 배포 환경 4/29 새벽 로그):

```
[safePctChange] sanity 위반 @yahooQuoteAdapter.changePercent:189300.KS — |-71.01%| > 50%
  (current=8740, base=28450@2026-04-27T00:00:00.000Z src=YAHOO_HISTORICAL).
[safePctChange] sanity 위반 @yahooQuoteAdapter.changePercent:001430.KS — |-85.77%| > 50%
[safePctChange] sanity 위반 @yahooQuoteAdapter.changePercent:027360.KS — |-66.60%| > 50%
[safePctChange] sanity 위반 @yahooQuoteAdapter.changePercent:088280.KS — |-52.13%| > 50%
[safePctChange] sanity 위반 @yahooQuoteAdapter.changePercent:036540.KS — |-50.35%| > 50%
[safePctChange] sanity 위반 @yahooQuoteAdapter.changePercent:163730.KS — |-62.34%| > 50%
```

6개 종목 동일 패턴 — Yahoo `base.asOf=2026-04-27` (4/27 월) vs current=2026-04-29 (4/29 수).
한국 영업일 2일 만에 -50~-86% 변화는 불가능 (상한가 -30% × 2일도 -51% 수준) →
**Yahoo 가 한국 종목의 액면병합/조정/4/28 데이터 누락으로 오염된 base 반환**.

ADR-0028 (PR-Z3 safePctChange) 도입 후 *진단* 은 강화됐지만, 사용자의 정확한 진단:

> **"지금 문제는 Sanity 체크가 없는 게 아니라, Sanity 실패 후에도 Yahoo base 를 계속
> 신뢰하는 구조."**

기존 호출 패턴 `safePctChange(...) ?? 0` 이 sanity 위반을 silent 0 으로 흡수 →
enrichment 가 정상값처럼 받아들이고 의사결정 (gate / momentum / watchlist 등록) 에
사용. 결과적으로 **오염된 데이터로 매매 판단을 내리는 silent degradation**.

## 결정

사용자 패치 방향 직접 반영 — 3 단계 변경:

### 1. `safePctChangeDetailed()` 신설 (server/utils/safePctChange.ts)

기존 `safePctChange(): number | null` 후방호환 유지 + 신규 객체 반환 함수 추가:

```ts
export interface SafePctChangeResult {
  value: number;       // sanity 통과 시 계산값, 실패 시 0
  valid: boolean;      // false 면 *반드시* 다른 출처 폴백 필수
  reason: 'OK' | 'INVALID_PRICE' | 'STALE_BASE_OR_SPLIT_ADJUSTMENT' | 'STALE_BASE_AGE';
}
```

기존 51 호출 site 무수정 — 신규 호출자(yahooQuoteAdapter) 만 detailed 사용.

### 2. yahooQuoteAdapter 의 3 % 변화율 필드 detailed 사용

`changePercent` / `return5d` / `return20d` 가 `?? 0` silent fallback 을 폐기하고
`safePctChangeDetailed` 결과를 *명시적 분기* 처리:

```ts
const result = safePctChangeDetailed(price, prevClose, { mode: 'DAILY', label });
if (result.valid) {
  changePercent = result.value;
} else {
  dataQualityIssues.push('changePercent');
}
```

`YahooQuoteExtended` 에 옵셔널 2 필드 추가:
- `dataQuality?: 'OK' | 'STALE_BASE'`
- `dataQualityIssues?: Array<'changePercent' | 'return5d' | 'return20d'>`

### 3. stockScreener 의 STALE_BASE 분기 — KIS 폴백 + 종목 제외

`fetchYahooQuote` 결과 `dataQuality === 'STALE_BASE'` 시 결정 트리:

```
quote.dataQuality === 'STALE_BASE'?
├── issues = ['changePercent'] only?
│   ├── fetchKisIntraday(stock.code) 호출
│   │   ├── KIS prevClose 정상 + |kisChangePct| ≤ 30%?
│   │   │   ├── YES → quote.changePercent 덮어쓰기 + dataQuality='OK' (KIS_RECOVERED)
│   │   │   └── NO → universe 제외 (rejectionLog)
│   │   └── KIS 폴백 실패 (null)? → universe 제외
│   └── 단일 위반이지만 KIS 도 stale → 제외
└── 다중 위반 (return5d / return20d 도 위반)? → universe 제외 (KIS 일봉 폴백 비용 부담)
```

**핵심 원칙**:
- `?? 0` silent fallback 영구 차단 — 모든 경로가 명시적 분기
- KIS 폴백은 *changePercent 단일 위반* 에만 적용 (KIS intraday 호출 비용 ↓)
- return5d / return20d 위반은 KIS 일봉 호출 비용 부담으로 *종목 제외* (보수적)
- 제외된 종목은 rejectionLog 에 사유 기록 — 운영자가 사후 진단 가능

## 테스트 매트릭스

`safePctChangeDetailed.test.ts` 23 케이스:
- INVALID_PRICE 분기 7 (base/current NaN/Infinity/0/음수)
- STALE_BASE_OR_SPLIT_ADJUSTMENT 분기 7 (이미지 시나리오 + boundary)
- STALE_BASE_AGE 분기 4 (PriceBase asOf stale)
- 진단 로그 + throttle 3
- 사용자 패치 호출 패턴 검증 2

`yahooQuoteAdapter.test.ts +5` 케이스:
- 정상 시세 → dataQuality=OK
- changePercent -71% (이미지 189300 시나리오) → STALE_BASE
- return5d 위반 → STALE_BASE
- 다중 위반 → issues 누적
- STALE_BASE_OR_SPLIT_ADJUSTMENT 진단 로그 출력

`stockScreenerStaleBase.test.ts` 10 케이스:
- 결정 트리 8 (PASS/KIS_RECOVERED/EXCLUDED 분기 + boundary)
- 이미지 6 종목 일괄 검증

## 비결과 (out-of-scope)

- **KIS 일봉 폴백 (return5d / return20d 보정)**: 호출 비용 부담으로 본 PR 보류.
  운영 데이터 누적 후 *얼마나 자주 발생하는지* 확인 후 후속 PR.
- **종목별 sanity 위반 누적 → 24h 자동 블랙리스트**: 옵션 A 였으나 본 PR 의 KIS
  폴백 + 종목 제외로 동등 효과 달성. PR-24 패턴 활용은 후속 옵션.
- **Gate/MOMENTUM 점수 감점**: 사용자 패치 §"momentumScore = Math.min(score, 40)
  + gateEligible = false" 는 본 PR 의 *universe 제외* 로 동등 효과 (제외된 종목은
  애초에 gate 평가에 안 들어감). Gate 통과 종목에 대한 STALE_BASE marker 표시는
  후속 PR.
- **autoPopulateWatchlist 외 다른 호출자 wiring**: stockScreener 의 다른 함수
  (preScreenStocks 등) 의 STALE_BASE 분기 일관 적용은 후속 PR (회귀 위험 격리).

## 운영 효과 (배포 후)

이미지 시나리오 (4/29 6 종목) 재현 시:

**기존 동작**:
1. yahooQuoteAdapter 가 changePercent=0 silent fallback (sanity 위반 무시)
2. stockScreener 가 정상 시세로 받아들임
3. 시간대 프리셋 changePercentMin=-3 통과 (0 > -3)
4. 종목 watchlist 등록 — *오염된 가격으로 의사결정*
5. 매 분 cron 마다 동일 sanity 위반 로그 폭주 + 동일 데이터로 의사결정 반복

**본 PR 후**:
1. yahooQuoteAdapter 가 dataQuality='STALE_BASE' marker 부여
2. stockScreener 가 KIS intraday 호출 → 정상 changePercent 폴백
3. 폴백 성공 시 정상 의사결정 + 진단 로그 1줄 (`KIS changePercent X.XX% 폴백`)
4. 폴백 실패 시 universe 제외 + rejectionLog 기록 (`Yahoo 데이터 오염`)
5. 매 분 cron 마다 동일 종목 — 5분 캐시 hit + KIS 폴백 결과 재사용 (호출 비용 0)

## 회귀 위험 평가

- **LIVE 매매 본체 0줄 변경** — yahooQuoteAdapter 의 `?? 0` 패턴 → 명시적 0 + marker.
  기존 호출자가 `quote.changePercent` 를 number 로 사용하는 부분 무영향.
- **stockScreener 의 분기 1개 추가** — STALE_BASE 종목만 KIS 폴백 시도 + 실패 시 제외.
  정상 종목 (dataQuality='OK' 또는 미설정) 은 기존 흐름 100% 보존.
- **KIS quota 영향 미미** — fetchKisIntraday 는 `FHKST01010100` 단일 TR (KIS 회로
  + 24h 블랙리스트 자동 적용). 이미지 6 종목 시나리오 → 매 분 cron 6회 추가 호출
  (동일 종목 5분 캐시 hit 으로 자연 throttle).
- **회귀 테스트 73 케이스** — detailed 23 + adapter 40 + screener 분기 10.

## 후속 PR 후보

- **Phase 2 — KIS 일봉 폴백 (return5d/return20d)**: 운영 데이터 누적 후 발생 빈도
  확인 후 도입.
- **Phase 3 — 종목별 sanity 위반 카운터 + 24h 블랙리스트**: PR-24 패턴 활용.
  현재는 5분 캐시로 자연 throttle 되지만 누적 통계로 *영구 차단* 가능.
- **Phase 4 — Gate/MOMENTUM marker**: STALE_BASE 회복된 종목에 대한 *데이터 신뢰도
  감점* (옵셔널 — 사용자 패치 §"감점 또는 제외" 의 감점 옵션).
