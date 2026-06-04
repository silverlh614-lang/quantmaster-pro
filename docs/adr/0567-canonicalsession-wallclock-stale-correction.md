# ADR-0567 — canonicalSession stale-CLOSED wall-clock 교정 (flag-gated, 진단 정합)

> 상태: Accepted (flag-gated 런타임 — `SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED` default OFF = byte-equal).
> 정식 발급 번호 `0567` — 출처: `docs/adr/INDEX.md` §"다음 발급: 0567" (2026-06-04, 마지막 발급 0566).
> 작성: 2026-06-04 / architect+engine
> 계승: ADR-0559(휴장일 SSOT krxHolidays/isKrxTradingDay).

---

## Context

`/scan_blockers` 장중(2026-06-04 11:03 KST, 거래일) 덤프에서 `Scan Evaluation State.marketSessionState=CLOSED`·
`canonicalSession=CLOSED`·`displaySession=CLOSED_SHADOW_OBSERVE` 가 관측됐다. 같은 덤프의 entryFilter 는
`marketSession=NORMAL` 이라 **세션 분류 불일치**. 장중 11시는 `REGULAR_OPEN` 이어야 한다.

근본원인 — `server/trading/signalScanner/state/scanEvaluationState.ts:resolveScanMarketSessionView`:
상류 `macroGateState.displaySession/canonicalSession` 이 **stale `CLOSED`** 를 주면
`canonicalSessionFromRaw` 가 CLOSED 를 산출하는데, 기존 wall-clock 보정은
**`canonical ∈ {UNKNOWN, REGULAR_OPEN}`** 일 때만 적용돼 **stale CLOSED 를 장중 wall-clock(REGULAR_OPEN)
으로 교정하지 못한다.** 현재는 `riskOverride=SHADOW_ONLY` 라 무증상이나, **live 전환 시 장중을 닫힌 것으로
오판해 live 진입을 잘못 차단**한다.

(부수 발견: 기존 `kstMinuteFromLabel` 의 loose word-boundary 정규식이 ISO 의 `mm:ss` 조각을 시각으로
오인 — 본 ADR 은 교정 분기 한정으로 T-anchored 파서를 도입해 회피, legacy 경로는 byte-equal 보존 위해 무변경.)

## Decision

### D1 — holiday-aware wall-clock stale 교정 (flag-gated)
`resolveScanMarketSessionView` 에 분기 추가: `canonical ∈ {CLOSED, POST_CLOSE}` 이고 ISO T-anchored 파서로
재산출한 intraday wall-clock 이 `REGULAR_OPEN` 이면 **CLOSED-vs-wallclock 충돌**로 보고 진단 로그(silent 금지)를
남긴다. **flag ON + KRX 거래일**일 때만 `canonical='REGULAR_OPEN'` 으로 교정한다.

### D2 — 휴장일 SSOT 위임 (ADR-0559, false-open 방지)
거래일 판정은 `krxTradingCalendar.isKrxTradingDay`(→ `krxHolidays` SSOT) 위임 — **신규 휴일셋 0개**.
공휴일(예 2026-06-03 지방선거)·주말은 거래일 SSOT/weekend 가드가 막아 **CLOSED/HOLIDAY 유지**(live false-open 차단).
장외(pre/after-market wall-clock)는 교정 안 함 — intraday wall-clock=REGULAR_OPEN 일 때만 교정.

### D3 — flag default OFF = byte-equal
`SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED`(default OFF). OFF 경로는 canonical 값을 **바꾸지 않고
진단 로그만** 출력 → 세션 산출(displaySession/marketSessionState) 기존과 동일. 활성화(ON)는 운영자가
shadow 검증 후. ENV 1줄 즉시 롤백.

## 제약 (불변식 정합)

- flag OFF = byte-equal(세션 산출·live 게이팅 불변). flag ON = **live 게이팅 permissive 교정**(장중 false-CLOSED
  해소 → 잘못된 차단 제거; 공휴일/주말/장외 false-open 안 함). 활성화는 본 PR 아님.
- 9대 불변식 VERBATIM 0줄. 불변식 #4·#5 정합 — 세션은 Policy/Permission 만 바꾸고 SourceSnapshot(데이터) 불변.
- 실주문 본체(volumeClock/preflight/entryEngine/buyPipeline/autoTradeEngine) 0줄. 세션 *분류* 만 교정.

## Patch Scope Guard (ADR-530)

- `targetDomain`: signalScanner 세션 분류(scanEvaluationState) + ENV.
- `allowedFiles`: `scanEvaluationState.ts`(교정 분기+헬퍼) · `scanEvaluationState.test.ts` · `.env.example` ·
  `docs/adr/0567-*.md` · `INDEX.md` · `docs/ai/10-patch-history-index.md`.
- `forbiddenFiles`: 실주문 경로 · 휴일셋 신규 생성 · macro 세션 상류 본체.
- `expectedBehaviorChange`: flag OFF 없음(byte-equal). flag ON 장중 stale-CLOSED→REGULAR_OPEN.
- `sourceSnapshotImpact`/`shadowLearningImpact`/`telegramImpact`/`providerImpact`: NONE.
  `executionImpact`: flag OFF NONE / flag ON live-gating permissive 교정.
- `testsRequired`: scanEvaluationState 진리표(평일장중·공휴일·주말·장외 × flag OFF/ON) + precommit.
- `rollbackPlan`: `SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED` 제거 또는 교정 분기 revert(byte-equivalent).

## 결과

- 세션 분류 불일치(장중 CLOSED) 근본 교정 — flag ON 시. flag OFF byte-equal.
- 휴장일 SSOT(ADR-0559) 위임 — 공휴일/주말 false-open 0. 진단 로그로 stale macro 세션 추적.
- 테스트 19 pass(진리표 전수). legacy kstMinuteFromLabel 정규식 결함은 별도 patch 분리 권장.
- INDEX 0567 → 0568 갱신.
