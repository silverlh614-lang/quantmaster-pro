# Exit Rules Catalog

> 자동 생성 — `npm run build:exit-catalog` (스크립트: `scripts/generate_exit_rules_catalog.js`)
> Schema: [docs/EXIT_RULE_HEADER.md](./EXIT_RULE_HEADER.md)
> Generated: 2026-04-26

**총 16개 매도 규칙** (priority 오름차순).

| # | rule | priority | action | ratio | trigger | rationale | source |
|---|------|---------:|--------|------:|---------|-----------|--------|
| 1 | `R6_EMERGENCY_EXIT` | 1 | `PARTIAL_SELL` | 30% | `currentRegime === 'R6_DEFENSE' && !shadow.r6EmergencySold && shadow.quantity > 0` | 블랙스완 (시장 -3% 이상 하락 또는 VKOSPI 35+) 진입 시 보유 포지션 30% 즉시 시장가 청산. 1회 한정 (재발 방지 플래그). | `server/trading/exitEngine/rules/r6EmergencyExit.ts:2` |
| 2 | `ATR_DYNAMIC_STOP_UPDATE` | 2 | `TRAILING_STOP` | — | `shadow.entryATR14 > 0 && evaluateDynamicStop().effectiveStop > hardStopLoss` | ATR 기반 동적 손절 갱신 (BEP 보호 / 수익 Lock-in). hardStopLoss 는 오직 상향만 허용 (래칫). 매도하지 않고 다음 규칙(하드스톱/RRR/손절접근)에 갱신된 임계 전파. | `server/trading/exitEngine/rules/atrDynamicStop.ts:2` |
| 3 | `MA60_DEATH_FORCE_EXIT` | 3 | `FULL_SELL` | 100% | `!shadow.ma60DeathForced && shadow.ma60ForceExitDate <= todayKst && isMA60Death(ma20, ma60, currentPrice)` | 60일선 역배열 5영업일 유예 만료 후에도 회복 못 하면 "주도주 사이클 종료" 로 판정해 좀비 포지션을 강제 청산. 회복 시 스케줄 초기화 (NO_OP). | `server/trading/exitEngine/rules/ma60DeathForceExit.ts:2` |
| 4 | `HARD_STOP` | 4 | `FULL_SELL` | 100% | `currentPrice <= hardStopLoss` | 하드 스톱 — 고정 손절 / 레짐 손절 / Profit Protection 도달 시 전량 청산. ATR 트레일링이 손절을 초기/레짐 이상으로 끌어올린 경우 PROFIT_PROTECTION 으로 분류 (수익 보호 청산). | `server/trading/exitEngine/rules/hardStopLoss.ts:2` |
| 5 | `CASCADE_FINAL` | 5 | `FULL_SELL` | 100% | `returnPct <= -25` | 캐스케이드 -25% 도달 시 전량 청산. -30% 이하면 180일 블랙리스트 추가 등록 — 손실 폭주 종목의 재진입 차단으로 추가 손실 봉쇄. | `server/trading/exitEngine/rules/cascadeFinal.ts:2` |
| 6 | `TRAILING_PEAK_UPDATE` | 6 | `NO_OP` | — | `shadow.trailingEnabled && currentPrice > shadow.trailingHighWaterMark` | L3-a 트레일링 고점 갱신. 부수효과 없는 단순 mutation — 후속 트레일링 스톱 규칙(trailingStop) 이 사용한다. 매도 행위 자체는 없음. | `server/trading/exitEngine/rules/trailingPeakUpdate.ts:2` |
| 7 | `LIMIT_TRANCHE_TAKE_PROFIT` | 7 | `PARTIAL_SELL` | — | `shadow.profitTranches[i].taken === false && currentPrice >= shadow.profitTranches[i].price` | L3-b LIMIT 트랜치 분할 익절. 진입 시 사전 정의된 가격 트리거 도달 시 ratio 비율 매도. 모든 LIMIT 트랜치 소화 후 트레일링 스톱(trailingStop) 자동 활성화. | `server/trading/exitEngine/rules/trancheTakeProfitLimit.ts:2` |
| 8 | `TRAILING_PROTECTIVE_STOP` | 8 | `FULL_SELL` | 100% | `shadow.trailingEnabled && currentPrice <= shadow.trailingHighWaterMark * (1 - trailPct)` | L3-c 트레일링 스톱 — 고점 대비 trailPct (기본 10%) 하락 시 전량 청산. 상승분의 일부 보호 (이익 보호 손절). 트랜치 모두 소화 후 활성화되어 잔여 분 수익 확정. | `server/trading/exitEngine/rules/trailingStop.ts:2` |
| 9 | `TARGET_EXIT` | 9 | `FULL_SELL` | 100% | `currentPrice >= shadow.targetPrice` | 트랜치 미설정 구형 포지션의 목표가 도달 시 전량 익절 fallback. 정상 흐름은 LIMIT_TRANCHE_TAKE_PROFIT (PR-S 분할 익절) 가 우선 — 이 규칙은 profitTranches=[] 인 레거시 trade 의 안전망. | `server/trading/exitEngine/rules/legacyTakeProfit.ts:2` |
| 10 | `CASCADE_HALF_SELL` | 10 | `PARTIAL_SELL` | 50% | `returnPct <= -15 && (shadow.cascadeStep ?? 0) < 2` | 캐스케이드 -15% 도달 시 50% 반매도 (cascadeStep=2). 전량 청산 전 마지막 단계 — 추가 하락 시 cascadeFinal(-25%) 이 잔여 청산. 1회 한정. | `server/trading/exitEngine/rules/cascadeHalf.ts:2` |
| 11 | `CASCADE_WARN_BLOCK` | 11 | `NO_OP` | — | `returnPct <= -7 && (shadow.cascadeStep ?? 0) < 1` | 캐스케이드 -7% 1회 경보 — 추가 매수 차단 + 모니터링 강화 (cascadeStep=1 + addBuyBlocked=true). 매도 행위 없음. 추가 하락 시 cascadeHalf(-15%) 가 본격 청산. | `server/trading/exitEngine/rules/cascadeWarn.ts:2` |
| 12 | `RRR_COLLAPSE_PARTIAL` | 12 | `PARTIAL_SELL` | 50% | `!shadow.rrrCollapsePartialSold && currentPrice > shadow.shadowEntryPrice && liveRRR < 1.0` | 잔여 기대 RRR (target-currentPrice) / (currentPrice-stop) 가 1.0 미만으로 붕괴 시 50% 자동 익절. 수익 중이지만 잔여 보유 정당성 없는 좀비 포지션 자동 정리. 1회 한정. | `server/trading/exitEngine/rules/rrrCollapseExit.ts:2` |
| 13 | `DIVERGENCE_PARTIAL` | 13 | `PARTIAL_SELL` | 30% | `!shadow.divergencePartialSold && currentPrice > shadow.shadowEntryPrice && detectBearishDivergence(prices, rsi)` | 주가 신고가 + RSI 고점 낮아짐 = 하락 다이버전스 → 가짜 돌파·상투 조기 경보. 수익 중인 포지션 30% 부분 익절로 상투 위험 회피. 1회 한정. | `server/trading/exitEngine/rules/bearishDivergenceExit.ts:2` |
| 14 | `MA60_DEATH_WATCH` | 14 | `NO_OP` | — | `!shadow.ma60DeathDetectedAt && !shadow.ma60DeathForced && isMA60Death(ma20, ma60, currentPrice)` | 60일선 역배열 최초 감지 시 5영업일 강제 청산 일자 스케줄. 매도 없음. 5영업일 후에도 역배열 지속이면 ma60DeathForceExit 가 강제 청산. 회복 시 자동 초기화. | `server/trading/exitEngine/rules/ma60DeathWatch.ts:2` |
| 15 | `STOP_APPROACH_ALERT` | 15 | `NO_OP` | — | `distToStop > 0 && (distToStop < 5 / 3 / 1) && stage < (1 / 2 / 3)` | 손절 접근 3단계 경보 — Stage 1: -5% 이내 🟡 / Stage 2: -3% 이내 🟠 / Stage 3: -1% 이내 🔴. 매도 행위 없음 (운영자 인지). 단계별 dedupeKey 로 중복 차단. | `server/trading/exitEngine/rules/stopApproachAlert.ts:2` |
| 16 | `EUPHORIA_PARTIAL` | 16 | `PARTIAL_SELL` | 50% | `(status==='ACTIVE' \|\| 'PARTIALLY_FILLED') && checkEuphoria(shadow, currentPrice).triggered` | 과열 신호 (RSI 80+/볼린저 상단 이탈/거래량 급증 등) 다중 감지 시 50% 부분 익절. status='EUPHORIA_PARTIAL' 로 전이해 1회 한정 — 잔여 분은 hardStopLoss/trailingStop 가 보호. | `server/trading/exitEngine/rules/euphoriaPartialExit.ts:2` |

---

신규 규칙 추가 시 `docs/EXIT_RULE_HEADER.md` 의 표준 schema 를 따라 헤더 작성 후 재생성.
