# ADR-0590: R6_DEFENSE Trigger Freshness by Trade-Date + Intraday KOSPI Rebound Recognition (Shadow-Gated)

@responsibility policy — R6 trigger freshness 를 봉 거래일(KRX) 기준으로 평가하고 오늘 intraday KOSPI 반등을 recovery 평가에 공급 (shadow-gated, default OFF)

## Status

Accepted

## Context

### 증상 (2026-06-09 현장)

2026-06-08(어제) KOSPI 폭락으로 R6_DEFENSE 가 발동했고, 6-09 장중 강반등에도 R6 가 해제되지 않았다. 두 개의
독립 결함이 결합했다.

**결함 A — Trigger freshness 가 봉 거래일을 무시하고 "지금"을 도장한다.**

- `marketDataRefresh.ts` `refreshKospiSection` 은 `fetchDailyBars('^KS11','65d')` 의 **마지막 완성 일봉**
  (어제 6-08 폭락 봉)으로 `kospiIntradayLowReturn` / `kospiDayReturn` / `kospiIntradayHighReturn` 을 계산한다.
- `computed.kospiTriggerSourceUpdatedAt = new Date().toISOString()` — 봉의 거래일이 어제임에도 freshness
  타임스탬프를 **호출 시각(지금)** 으로 찍는다.
- `regimeBridge.base.ts` `triggerFreshness()` → `macroFreshnessFromUpdatedAt(...)` 은 **시간차(age)만** 보고
  FRESH 판정. 결과: 어제 폭락 봉의 intraday-low(-5%↓)가 오늘 'FRESH intraday trigger' 로 오인되어
  `KOSPI_INTRADAY_LOW_SHOCK` 이 active 로 carry 되고 R6 가 latch 된다.

**결함 B — Recovery 평가에 오늘 intraday KOSPI 수익률 소스가 없다.**

- recovery gate(`buildR6RecoveryEvidence`, `closeRecoveryEligible`)는 `kospiCloseReturn ?? kospiDayReturn > -2`
  로 평가하는데, 이 값은 어제 폭락 봉의 종가수익률(음수 큼)이다.
- 오늘 장중 KOSPI 가 +3% 반등해도 macroState 에 **오늘 현재가 vs 전일종가 기반 intraday 수익률 필드가 없어**
  `kospiDayReturnOk` 가 계속 false → confirmations 누적 불가 → 기존 `R6_STRONG_REBOUND_DECAY_ENABLED`(default OFF,
  3.0% threshold) 경로도 stale `kospiDayReturn` 을 먹어 동작 못 함.

### 근본 원인

freshness 가 **"데이터를 언제 가져왔나"(fetch 시각)** 만 보고 **"데이터가 어느 거래일 것인가"(봉 거래일)** 를
보지 않는다. KRX 거래일 SSOT(`isKrxTradingDay`, ADR-0559) 가 이미 존재하나 R6 trigger 경로에 wiring 되지 않았다.

### 제약 (사용자 결정 = Option 1: 데이터정합 + shadow 선검증)

- R6 임계값 자체(intraday-low/close -5% · VKOSPI dayChange +30 · USDKRW ±3% · strong-rebound +3%) **변경 금지.**
- 9대 불변식 준수: #1 Trading Engine alive · #2 Shadow 항상 ON · #6 providerIssue ≠ bearish.
- ADR-0146 byte-equivalent: LIVE 매매 본체 변경 최소 · ENV 1줄 롤백 · 회귀 테스트 · KIS/KRX quota 침범 0.
- `marketDataRefresh.ts` = 1494/1500 줄 — 신규 로직은 별도 모듈로 분리.
- 거래일 판정은 기존 `krxTradingCalendar.isKrxTradingDay` SSOT 재사용 (자체 휴일셋 신설 금지).
- intraday KOSPI 현재가는 `kisClient` 단일 통로만 (raw KIS REST 금지).

## Decision

### D1. Trade-date 기반 trigger freshness 게이트 신설 (별도 모듈)

신규 모듈 `server/trading/kospiTriggerFreshness.ts` 를 trigger freshness 의 **순수 평가 SSOT** 로 둔다.
입력은 봉 거래일(KST date-key) + age freshness + now 이며, 출력은 기존 `triggerFreshness` union 에
정합하는 값이다. 핵심 규칙:

- 봉 거래일(`kospiTriggerSourceTradeDate`)이 **오늘 KRX 거래일이 아니면**(= 어제 이전 봉) intraday-low/day-return
  기반 R6 트리거를 **'intraday FRESH' 로 취급하지 않는다** — `STALE` 로 강등.
- 거래일 판정 불가(필드 부재/파싱 실패) 시 **legacy 동작 보존**(보수) — 기존 age-only freshness 로 폴백.
- close-shock(POST_CLOSE/EOD close return) 은 거래일이 어제여도 유효할 수 있으므로 intraday-low 강등과
  분리한다(기존 `POST_CLOSE_VALID`/`EOD_SNAPSHOT_VALID` 의미 보존 — age freshness 가 해당 계열이면 강등하지 않음).

`regimeBridge.base.ts` `triggerFreshness()` 가 이 신규 모듈에 위임한다. flag OFF 시 `macroFreshnessFromUpdatedAt`
byte-equivalent.

### D2. 오늘 intraday KOSPI 수익률 소스 공급 (kisClient 단일 통로)

recovery 평가가 **오늘 현재가 vs 전일종가 기반 intraday 수익률**을 볼 수 있도록 macroState 에 신규 필드를 채운다.

- 소스: KIS 국내업종 종합지수(0001, ^KS11 등가) **현재가 + 전일대비율** — `kisClient` 경유
  (`server/clients/kisClient/query/sectorIndex.ts`). raw KIS REST 금지 규칙 준수. **default OFF ENV
  (`R6_KOSPI_INTRADAY_QUOTE_ENABLED`) 로 게이트.**
- macroState 신규 필드 `kospiIntradayReturn`(오늘 현재가 vs 전일종가 %) + `kospiIntradaySourceTradeDate` +
  `kospiIntradayFetchedAt`.
- 이 필드는 **오늘 거래일 + freshness FRESH 일 때만** recovery 평가에 사용한다. stale 시 기존 close-return 경로로
  폴백(불변식 #6: stale ≠ tradable, 값 보정·0치환 금지).
- KIS index quote 가 OFF/실패 시 → carry-forward + `emitMarketDataProviderWarn('KOSPI_INTRADAY_CARRY_FORWARD')`
  → recovery 평가는 기존(어제 close-return) 그대로 (byte-equivalent).

### D3. Intraday 강반등 조기해제는 SHADOW 선검증 + operator 승인 후 live (default OFF flag)

- 신규 ENV `R6_INTRADAY_REBOUND_RELEASE_ENABLED` (default OFF). OFF 시 intraday 수익률은 **진단·shadow 관측 라벨**로만
  기록되고 live R6 해제 confirmation 에 기여하지 않는다(기존 동작 byte-equivalent).
- ON 시에도 즉시 live 해제 금지 — 기존 confirmations(`R6_RECOVERY_REQUIRE_CONFIRMATIONS`) + evidenceComplete +
  shock-latch 가드 + (cooldown 또는 fast-track) 전부 통과해야 한다. intraday 수익률은 `kospiDayReturnOk` /
  strong-rebound decay 입력을 **stale 대신 오늘 값으로 정확화**할 뿐, 새 우회 경로를 만들지 않는다.
- 운영자는 N영업일 SHADOW 관측(진단 로그 `[R6_INTRADAY_REBOUND_OBSERVE]`)으로 false-release 0 확인 후 flag ON.

### D4. 진단 가시화 (silent 금지)

- `R6TriggerBreakdown` 에 `kospiTriggerSourceTradeDate` + `tradeDateIsToday`(boolean) + `intradayReturnUsed`(boolean) 추가.
- freshness 강등이 발생하면 `[R6_TRIGGER_TRADEDATE_STALE]` 로그(executionImpact 명시), intraday 소스 사용 시
  `[R6_INTRADAY_REBOUND_OBSERVE]` 로그.

## Consequences

### 긍정

- 어제 폭락 봉이 오늘 'FRESH intraday trigger' 로 오인되는 결함 A 제거 → R6 false-latch 차단.
- 오늘 진짜 intraday 반등이 recovery 평가에 반영 → confirmations 정상 누적(결함 B 해소), 단 flag ON + 검증 후.
- 거래일 SSOT 단일화(ADR-0559 재사용) — R6 경로가 다른 거래일 게이트와 동일 데이터를 본다.

### 비용·위험

- 신규 KIS index quote 호출(D2) — **default OFF**, ON 시 cron 사이클당 1회(종합지수 1심볼), quota 영향 미미.
  실패 시 carry-forward + 운영자 경고(VKOSPI 패턴 재사용).
- freshness 강등(D1)이 너무 공격적이면 정당한 EOD close-shock 까지 막을 위험 → close-shock 경로 분리로 격리,
  거래일 판정 불가 시 legacy 폴백.
- intraday 조기해제(D3)가 whipsaw 유발 위험 → default OFF + SHADOW N영업일 + 임계값 무변경으로 봉인.

### 롤백

1. `R6_INTRADAY_REBOUND_RELEASE_ENABLED=false` (1줄) → intraday 수익률 live 기여 즉시 중단.
2. `R6_KOSPI_INTRADAY_QUOTE_ENABLED=false` (1줄) → KIS index quote 호출 0, macroState 신규 필드 미설정.
3. `R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED=false` (1줄) → trade-date 게이트 OFF, 기존 age-only freshness 복원.

모든 flag OFF = 현 baseline byte-equivalent. LIVE 매매 본체(임계값·latch·confirmation) 0줄 변경.

## Addendum — Codex review 정합 정정 (per-trigger 강등 + intraday TTL)

PR #1374 Codex 자동 리뷰 P1 2건(코드 확인 유효) 정합 정정. ADR-0590 범위 내(신규 ADR 불필요).

- **P1-① per-trigger 강등 (D1 설계 보강):** trade-date 강등이 글로벌 freshness 를 STALE 로 떨궈
  `KOSPI_CLOSE_SHOCK`(폭락 다음날 아침 정당 방어)·`VKOSPI_DAY_SPIKE`·`USDKRW_DAY_SHOCK`(KOSPI 일봉
  거래일과 무관한 별도 소스)까지 일괄 억제하던 결함 수리. `resolveKospiTriggerFreshness` 는 글로벌
  freshness 를 age-only 그대로 보존(recovery/latch side-effect byte-equivalent)하고, intraday-low 강등
  여부를 `intradayDowngraded` boolean 으로만 노출 → `buildR6TriggerBreakdown` 이 `KOSPI_INTRADAY_LOW_SHOCK`
  만 active 에서 per-trigger 제외. 진단 로그 `[R6_TRIGGER_TRADEDATE_STALE]` 가 "intraday-low 만 제외" 명시.
- **P1-② intraday TTL (D2 보강):** `resolveRecoveryKospiDayReturn` 에 `kospiIntradayFetchedAt` TTL 검사 추가
  (신규 ENV `R6_KOSPI_INTRADAY_QUOTE_TTL_SEC`, 기본 900초=15분). KIS 실패 carry-forward 로 아침 stale
  반등값이 오후 내내 live-eligible 되어 R6 조기해제(falling-knife) 되는 위험 차단. fetchedAt 부재/파싱불가/
  TTL 초과 시 보수적으로 intraday 미사용(legacy 폴백) + 진단 로그 `[R6_INTRADAY_REBOUND_STALE_TTL]`.
- R6 임계값(-2/-5/+30/±3/+3%) 무변경. 기존 flag 3개 의미 무변경 + 신규 ENV 1개(TTL, default 900s). flag OFF
  baseline byte-equivalent 유지.

## Alternatives Considered

- **A1. marketDataRefresh.ts 안에서 직접 거래일 검증 + KIS quote.** 기각 — 1494/1500 줄, 6줄 여유로 불가.
  순증을 별도 모듈로 분리해야 복잡도 한계 준수.
- **A2. R6 임계값(-5%) 완화로 해제 쉽게.** 기각 — 사용자 제약(임계값 변경 금지) + 방어 약화 위험.
- **A3. intraday 즉시 live 해제(flag 없이).** 기각 — ADR-0146 byte-equivalent + whipsaw 위험. SHADOW 선검증 필수.
- **A4. Yahoo intraday quote 로 오늘 수익률 공급.** 기각 — ADR-0561 KIS Primary Absolute. KIS(L1) 공급 가능 레이어에서
  Yahoo(L3) primary 금지. KIS index quote 가 정본.
- **A5. 자체 거래일 휴일셋 신설.** 기각 — ADR-0559 거래일 SSOT 재사용 의무(divergence 구조적 소멸 보존).

## References

- ADR-0559 (krxHolidays/krxTradingCalendar 거래일 SSOT 위임)
- ADR-0561 (KIS Primary Absolute) · ADR-0563 (Yahoo burn-down)
- ADR-0146 (byte-equivalent PR 자가 review 5 카테고리)
- ADR-0584 (VKOSPI 신선도 추적 — baseDate/fetchedAt 영속 패턴 재사용 모델)
- ADR-0567 (canonicalSession wall-clock stale correction — default OFF flag + KRX 거래일 게이트 패턴 선례)
- `docs/ai/02-trading-engine-rules.md` (R6_DEFENSE / 불변식 #1·#8)
- `docs/ai/03-source-snapshot-ssot.md` (Information Ownership Registry — macro SSOT)
- `docs/ai/05-provider-policy.md` (stale / Last Good Value / provider health)
