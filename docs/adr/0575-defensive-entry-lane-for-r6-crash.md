# ADR-0575: defensive entry lane for r6 crash

@responsibility trading — defensive entry lane for r6 crash

## Status

Withdrawn (2026-06-05) — 기존 `server/trading/signalScanner/r6ShadowCounterfactualEntryPolicy.ts`
가 이미 R6 (shadow) 매수 엔진을 제공함이 확인되어 본 ADR(병행 레인)은 철회·코드 revert.
재구축 금지: R6 진입은 그 기존 엔진을 본다. 본 ADR 의 가격 기준(과매도+RS+우량) 평가기 코드는
git 히스토리(be64af81)에 보존 — 향후 *evidence 기반*으로 기존 엔진의 추가 선정 경로로 통합 가능.

아래는 철회 전 원안(기록 보존용).

## (원안) Status

Accepted (Phase 1 + 1b)

## Context

이 시스템은 모멘텀/돌파 매수기다(Gate1 핵심 = breakout_momentum·volume_breakout·turtle_high·
relative_strength). 따라서 R6_DEFENSE(폭락: KOSPI_CRASH·BLACK_SWAN·KOSPI_CLOSE_SHOCK·
KOSPI_INTRADAY_LOW_SHOCK + shockLatch)에서는:
- 모멘텀·신고가가 구조적으로 부재 → Gate1 점수 붕괴(예: 46/70) → 매수 0.
- 추가로 R6 → SHADOW_ONLY → liveEntryAllowed=false(entryPolicySemantics)로 live 전면 차단.

사용자 전략: **"폭락 = 오히려 기회 — 방어적 매수가 일어나야 한다."** 즉 모멘텀 레인으론 못 사는
폭락 저점을, 우량주 과매도+RS 방어 기준으로 *별개 레인*에서 사고 싶다. 이는 추세추종과 반대인
역추세/저점매수 전략이라 기존 레인 확장이 아니라 신규 레인 신설이 필요하다. 기존 r6 정책
(r6ShadowHoldPolicy·r6LiveEmergencyExitPolicy)은 전부 *청산* 측이고 R6 *진입* 레인은 없었다.

## Decision

`DEFENSIVE_ENTRY_LANE_ENABLED`(default OFF) 플래그로 **R6 방어 진입 레인**을 2단계로 신설한다.
사용자 선택: 진입 기준 = **조합(과매도 + RS 방어 + 우량)**, 범위 = **DEFENSE + PANIC 둘 다**(PANIC 더 축소).

**진입 기준(전부 충족, `evaluateDefensiveEntryLane` 순수 평가기):**
- ① 우량: 부채비율 < 150% + ROE ≥ 0(흑자) + (시총 대형 or 미상). 재무 미상이면 보수적 탈락
  (폭락에 known-good 품질만).
- ② 과매도: 60일 고점 대비 −20%↓ + RSI(14) < 35.
- ③ RS 방어: 20일 상대수익률(vs KOSPI) > 0(시장보다 덜 빠짐).
- 사이징: DEFENSE → Kelly ×0.30, PANIC(BLACK_SWAN/KOSPI_CRASH) → ×0.15.

**Phase 1 (shadow 전용)**: 순수 평가기 + flag SSOT(`defensiveEntryLane.ts`) + 단위 테스트.
live·실주문 0줄, 기존 모멘텀 레인 무영향.

**Phase 1b (완료)**: 스캔 진단에 read-only 관측 섹션 배선 — `buildDefensiveEntryLaneSection`
(scanBlockersMessageSections)이 R6(`mg.regime==='R6_DEFENSE'` or activeR6Triggers)+flag 시 후보
trace에서 방어 기준을 평가, `scanBlockersFormatter` 가 macroGate 섹션 뒤에 표시. PANIC =
activeR6Triggers/riskOverride ∈ {KOSPI_CRASH, BLACK_SWAN}, 아니면 DEFENSE. trace 경로는 gate2
confluence(buildRsAxis/buildFundamentalAxis)와 동일 키 재사용(quote.price/high60d/rsi14,
symbolFeatures.relativeReturn20d/external.benchmark, external.dartFinancials.debtRatio/roe). 미상
필드는 평가기 finite()가 보수적 탈락 → 오경로도 안전. flag OFF/비-R6 = 빈배열 = byte-identical.
기존 counterfactual forward-return 추적이 모든 후보를 커버하므로 적격 후보 성과 관측 가능.

**Phase 2 (shadow 검증 후, 별도 flag)**: 방어 레인 live 허용 — 축소 사이징 + R6 진입 예외.
실계좌는 기존 KIS_REAL_MONEY_ACK 하드가드 유지.

## Consequences

- **default OFF = byte-identical**: flag OFF 면 평가기 미호출(호출측 gate). 현행 매수/스캔 무변경.
  단위 테스트 10종(세 축·전량/부분·재무미상 보수탈락·PANIC/DEFENSE 사이징·flag).
- **Phase1 단계엔 production caller 0** — 평가기는 strategy SSOT(기준 정의). Phase1b 배선 전까지
  스캔/매매 경로 무접촉(검증·리뷰용 코어). executionImpact NONE.
- **Phase2 ON 시 executionImpact**: 폭락(R6)에서 방어 레인이 live 매수를 생성한다(축소 사이징).
  이는 명시적 의도 — 모멘텀 시스템의 사각(폭락 저점)을 역추세 우량주 매수로 보완. shadow 검증 의무.
- 임계값(−20%/RSI35/RS>0, Kelly 0.30·0.15)은 guard 모듈 export — 관측 후 조정 가능.

## Guardrails

- No live trading path change in Phase 1 (default OFF, no production caller). 실주문/Kelly/Shadow 무변.
- **Buy behavior change is intentional and phased/flag-gated**: Phase2 ON 시에만 R6 방어 live 매수
  생성. Phase1/1b 는 평가·관측만.
- No KIS/order import added in Phase 1 — 순수 평가기.
- No provider fetch behavior change.
- No data promotion behavior change.
