# ADR-0621 — Provisional Shadow Intraday Horizon OBSERVED Eligibility (Follow-Through Inflation 차단)

**Status:** Proposed (Phase 0 — 경계·타입·ADR. 측정 자격 규칙 신설. 구현은 engine-dev 인계.)
**Date:** 2026-06-18
**대상:** `server/learning/provisionalShadowPriceProvider.ts`
**계보:** ADR-0429 / ADR-0439 (cache-first read-only price provider 라우팅 SSOT) · ADR-0620 (provisional 측정 정합) · ADR-0561 (KIS Primary) · ADR-0146 (PR 자가 review)

## 사용자 핵심 의도

> "`/shadow_promotion` 이 포스코퓨처엠/삼성SDI 를 winRate=100%·confidence=HIGH 로 승격 추천했으나 사유가 전부 POSITIVE_FOLLOW_THROUGH_30M/1H/CLOSE. 그런데 +30m·+1h·close 가 정확히 동일한 +8.31% — cache-only 모드 intraday 캔들 부재로 30m/1h 가 close 와 동일 단일 가격으로 fallback. 한 데이터 포인트가 3중 카운트되어 winRate/confidence 를 인위적으로 부풀린다. T+30m/T+1h 는 resolved source 가 INTRADAY_CANDLE_CACHE 일 때만 OBSERVED, coarser fallback 시 DATA_UNAVAILABLE."

## 배경 — 부풀림 메커니즘 (코드 사실)

ADR-0439 가 `lookupCachedPrice` 의 4-tier cache wiring 을 활성화하면서, §C 라우팅 매트릭스를
다음과 같이 정의했다 (provider 주석 :36-38, SSOT):

- `T_PLUS_30M / T_PLUS_1H / SAME_DAY_CLOSE → INTRADAY → MARKET_DATA → READ_ONLY_QUOTE`
- `NEXT_OPEN / T_PLUS_1D_CLOSE / T_PLUS_3D_CLOSE → DAILY → MARKET_DATA → READ_ONLY_QUOTE`

cache-only 모드(`maxExternalLookups=0`, default)에서 intraday 캔들 캐시가 부재하면:

1. `provisionalIntradayReader` (:254-275) 는 INTRADAY_CANDLE_CACHE 만 반환 가능 → null.
2. `lookupCachedPrice` (:401-407) 가 coarser fallback 으로 진행:
   - `provisionalMarketDataReader` (:311-338) — **`latest` mode** → 종가 근사 단일 점.
   - `provisionalReadOnlyQuoteReader` (:345-358) — entry-time 단일 점.
3. T_PLUS_30M · T_PLUS_1H · SAME_DAY_CLOSE 가 **모두 동일한 latest/quote 단일 가격**으로 resolve.

결과: 한 데이터 포인트(종가 근사)가 30m/1h/close 3개 horizon 에 3중 카운트.
ADR-0426/0427 follow-through 판정(`POSITIVE_FOLLOW_THROUGH_*`)이 인위적으로 부풀려져
winRate=100%·confidence=HIGH 의 가짜 승격 추천을 발생시켰다 (실데이터 포스코퓨처엠/삼성SDI +8.31% ×3).

추가 부풀림 경로: `lookupCachedPrice` 는 horizon 검사 전 `lookupScanSnapshot` (:391-392) 가
있으면 무조건 SCAN_SNAPSHOT(entry-time 단일 점) 으로 선반환 → scanQuote 보유 entry 의 30m/1h 도
entry-time 단일 점으로 OBSERVED → 동일 부풀림.

## 결정

### 1. ADR vs patch 판정 = ADR 발급

본 변경은 표면상 측정 정합 정정이나, 실질은 **ADR-0439 §C 라우팅 fallback 허용 범위를
horizon 별 비대칭으로 축소하는 정책 경계 변경**이다: "어떤 source 가 어떤 horizon 에 대해
OBSERVED 자격(measurement eligibility)을 갖는가"라는 측정 자격 규칙의 신설이며, 코드 내 SSOT
주석(:36-38)도 갱신 대상. CLAUDE.md §5 "신규 경계·정책은 ADR 발급" 에 해당. INDEX 0621→0622 갱신.

### 2. 측정 자격 규칙 (OBSERVED eligibility)

- **T_PLUS_30M, T_PLUS_1H**: resolved source 가 `INTRADAY_CANDLE_CACHE` 일 때만 OBSERVED.
  intraday 캔들 부재 → coarser source(MARKET_DATA_CACHE / READ_ONLY_QUOTE / ENTRY_SNAPSHOT /
  SCAN_SNAPSHOT / DAILY_CANDLE_CACHE) fallback 시 → `status='DATA_UNAVAILABLE'`
  (reason: `no intraday candle — coarser fallback duplicates same-day-close, follow-through inflation 차단`).
- **SAME_DAY_CLOSE**: 현행 유지. intraday miss 시 latest/market-data fallback 이 종가 근사로 정당.
- **NEXT_OPEN / T_PLUS_1D_CLOSE / T_PLUS_3D_CLOSE** (daily horizons): 무변경.

효과: 30m/1h 가짜 OBSERVED 제거 → winRate/confidence 가 distinct point({close, nextOpen, +1d} 등)로만
산출 → 부풀림 해소. promotion 로직·리포트 빌더 변경 불요 — DATA_UNAVAILABLE 는 이미 observed 카운트
제외라 de-inflation 이 자동 전파.

### 3. seam — 정확한 구현 지점

#### 3.1 전용 술어 신설 (`isIntradayHorizon` 재사용 불가)

`isIntradayHorizon` (:360-366) 은 `T_PLUS_30M || T_PLUS_1H || SAME_DAY_CLOSE` 셋 다 포함 →
SAME_DAY_CLOSE 를 제외하는 본 규칙에 부적합. `isIntradayHorizon` 의 **reader 라우팅 책임(:401)은
무변경**(SAME_DAY_CLOSE 도 계속 intraday reader 우선 시도). OBSERVED 자격 전용 술어를 별도 신설:

```
function requiresIntradayCandleSource(horizon: ProvisionalShadowHorizon): boolean {
  return horizon === 'T_PLUS_30M' || horizon === 'T_PLUS_1H';
}
```

한 술어가 라우팅·자격 두 의미를 겸하지 않게 분리(SRP).

#### 3.2 검사 위치 — `lookupCachedPrice` 내부 short-circuit (factory 아님)

factory(`createProvisionalShadowPriceProvider`, :453-508)는 :483 에서 `cached.price`/
`cached.observedAtKst` 만 forward 하고 `cached.source` 를 버린다. → source 검사는 `source` 가
bound 된 유일 지점인 `lookupCachedPrice` 내부에서만 가능. 단순 null 반환이 아니라 **coarser
fallback 진행 이전 short-circuit** 이어야 부풀림이 차단된다:

```
  if (isIntradayHorizon(horizon)) {
    const intraday = provisionalIntradayReader(symbol, targetAtKst);
    if (intraday) return intraday;                  // INTRADAY_CANDLE_CACHE (정당)
    if (requiresIntradayCandleSource(horizon)) {
      return null;                                   // T+30m/T+1h: coarser fallback skip → DATA_UNAVAILABLE
    }
    // SAME_DAY_CLOSE: 종가 근사 fallback 정당 → 계속
  } else { ... }
  // MARKET_DATA / READ_ONLY_QUOTE — SAME_DAY_CLOSE 및 daily horizon 만 도달
```

factory 는 `cached === null` → 기존 DATA_UNAVAILABLE 경로(:494-499) 재사용. status 산출 로직 0줄 변경.

#### 3.3 SCAN_SNAPSHOT 선반환 게이트 (동일 부풀림 경로 차단)

`lookupCachedPrice` :391-392 의 SCAN_SNAPSHOT 선반환을 `!requiresIntradayCandleSource(horizon)`
로 게이트 — scanQuote 보유 entry 의 T+30m/T+1h 가 entry-time 단일 점으로 OBSERVED 되는 동일
부풀림을 차단. (미게이트 시 부풀림 잔존하므로 본 ADR 은 게이트를 결정 범위에 포함.)

#### 3.4 §C 주석 갱신

provider 주석 :36-38 에 T+30m/T+1h 의 OBSERVED 자격 = INTRADAY_CANDLE_CACHE 한정을 명시.

### 4. 무변경 범위 (byte-identical 보존)

reader 4종 본문 0줄 · `isIntradayHorizon` 0줄 · `resolveHorizonTargetTimeKst` /
`PROVISIONAL_HORIZON_OFFSET_MS` 0줄 · factory status 산출 0줄 · SAME_DAY_CLOSE/daily horizon 0줄 ·
promotion·report 빌더 0줄 · counterfactualShadowPriceProviderAdapter 본체 0줄(헬퍼 import 만) ·
타입 유니언 0줄(DATA_UNAVAILABLE 기존 멤버).

## Consequences

- **긍정**: follow-through inflation 제거. winRate/confidence 가 distinct point 로만 산출 →
  promotion 자동 de-inflation. 측정 정직성 회복. 코드 변경 최소(술어 1 + 분기 short-circuit + scan 게이트 + 주석).
- **트레이드오프**: provisional shadow 측정 표본 감소(intraday 캔들 캐시가 없는 한 30m/1h OBSERVED 0).
  이는 **정직한 결손**이며 Shadow Learning 정지가 아니다(불변식 #2 — close/nextOpen/+1d 표본은 계속 산출).
  intraday 캔들 hydration 성숙 시 30m/1h OBSERVED 가 정당하게 복원된다.
- **executionImpact: NONE** — read-only 관측 provider, 주문/fetch 0줄, liveAllowed 무관.
- **providerImpact: NONE** — cache-only 유지(maxExternalLookups=0 불변), KIS/KRX/Yahoo quota 0,
  신규 Yahoo-first 0(ADR-0561 무관).

## 9대 불변식 점검

- #1 Trading Engine 무중단 · #2 **Shadow Learning 무정지**(표본 축소 ≠ 정지) · #3 SourceSnapshot 우회/변경 0 ·
  #6 DATA_UNAVAILABLE 는 결손이지 bearish 아님(reason 명시) · #7 관측 전용 live 무관 ·
  #8 실거래/Shadow 차단 분리 무관 · #9 신규 raw provider 조회 0. → 9대 불변식 0줄 위반.

## 테스트 (engine-dev 인계)

1. T+30m/T+1h intraday miss → DATA_UNAVAILABLE.
2. T+30m/T+1h intraday hit → OBSERVED(INTRADAY_CANDLE_CACHE).
3. SAME_DAY_CLOSE intraday miss → MARKET_DATA fallback OBSERVED (현행 유지).
4. scanQuote 보유 entry 의 T+30m/T+1h → 게이트 적용 → DATA_UNAVAILABLE.
5. daily horizon(NEXT_OPEN/T+1d/T+3d) 무변경.
6. DATA_UNAVAILABLE 가 observed 카운트 제외 → winRate de-inflation 회귀(30m/1h/close collapse 소멸).

## Alternatives Considered

- (a) factory(:483)에서 source 검사 — **기각**: factory 가 `cached.source` 를 버려 검사 불가.
- (b) intraday 분기에서 단순 null 반환(short-circuit 없이) — **기각**: coarser fallback 으로 새서
  MARKET_DATA/READ_ONLY_QUOTE 가 여전히 OBSERVED → 부풀림 잔존.
- (c) `isIntradayHorizon` 재사용 — **기각**: SAME_DAY_CLOSE 포함이라 종가 근사 fallback 정당성 훼손.
  전용 술어 `requiresIntradayCandleSource` 분리(SRP).
- (d) SCAN_SNAPSHOT 게이트 생략 — **기각**: scanQuote 경로로 동일 부풀림 잔존.
- (e) promotion/report 빌더 수정 — **기각**: DATA_UNAVAILABLE observed 제외로 de-inflation 자동 전파, 불요.
- (f) ENV flag default OFF — **기각(권고)**: 부풀림 차단은 측정 정직 기본값이라 default-on. (engine-dev
  가 점진 롤아웃 선호 시 flag 추가 가능하나 본 ADR 권고는 즉시 정직.)
- (g) patch type — **기각**: ADR-0439 §C 라우팅 의미·OBSERVED 자격 규칙 신설 = ADR 발급 의무.

## References

- ADR-0429 / ADR-0439 — provisional shadow price provider cache lookup.
- ADR-0426 / ADR-0427 — counterfactual/provisional follow-through 학습.
- ADR-0620 — provisional shadow entry-price 측정 정합(동일 계보 측정 수리).
- ADR-0561 — KIS Primary Absolute(본 변경 무관·quota 0).
- CLAUDE.md §2.1 9대 불변식 #2/#6 · §5 ADR vs patch.
