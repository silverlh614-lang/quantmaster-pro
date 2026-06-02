# ADR-0551: leadershipBridge intraday leader injection wiring

@responsibility screener — leadershipBridge intraday leader injection wiring

## Status

Accepted

## Context

ADR-0550(Stage1 risk-on leader capture) 활성 + `/krx_scan` 전수 재스크린(완화 ON) 후에도
스캔 universe 가 소외주로 유지됐다 (관측 2026-06-02 11:33: avgRelativeReturn20d ≈ -20.8%,
medianRelativeReturn20d ≈ -31.6% — KOSPI +29% 대비 심한 소외, 후보 종목·통과수 거의 불변).
즉 **Stage1 화면-경로 완화(임계+점수)만으로는 강세장 리더를 universe 에 못 넣는다**가 실증됐다.

근본 이유: stage1QuantFilter 는 KIS 등락률 상위(당일 리더)를 ingest 하지만, 리더가
필터·top-N 랭킹에서 탈락·강등돼 메인 watchlist 에 안 남는다. 한편 `intradayScanner`
(장중 "오전 주도주" 발굴)는 이미 리더를 발굴하고 `evaluateServerGate(quote)` 로 gateScore·
MTAS 까지 산출하지만, 결과를 **별도 intradayWatchlist 에만** 적재해 메인 scan-eval universe
(scan_blockers 의 50 후보)에는 반영되지 않았다. `leadershipBridge`(qualifiesAsLeader: gateScore≥4.5
· MTAS≥6 · sectorRS≥KOSPI, MOMENTUM 4h TTL 편입)는 정확히 이 갭을 메우려 만들어졌으나 런타임
미배선(dead)이었다 (ADR-0550 후속으로 명시).

## Decision

`intradayScanner.discoverIntradayCandidates` 의 **이미 계산된 quote + gateResult 를 재사용**해
발굴 리더를 메인 watchlist MOMENTUM 레인으로 편입하는 **flag-gated 경로**를 배선한다.

- ENV `LEADERSHIP_BRIDGE_ENABLED=true` (default OFF, `isLeadershipBridgeEnabled()`).
  OFF 면 수집·편입 0 → **byte-identical** (ENV 1줄 즉시 롤백).
- 발굴 루프에서 intraday-strong + `gateScore≥minGate` 를 통과한 후보를 `LeaderCandidate`
  (gateScore·mtas=gateResult, sectorRelativeStrength=quote.changePercent, currentPrice=quote.price)
  로 수집 → 루프 종료 후 `bridgeLeadersToMomentum(leaders, { kospiDayReturn })` 1회 호출.
- `kospiDayReturn` 은 `loadMacroState().kospiDayReturn`. 최종 편입 판정은 bridge 의
  `qualifiesAsLeader` 가 수행(gateScore≥4.5·mtas≥6·RS≥KOSPI·price>0).
- **새 KIS 호출 0** (intradayScanner 가 이미 fetch 한 quote 재사용). 기존 intraday 발굴·저장
  동작 무변경. bridge 호출은 기존 saveIntradayWatchlist 완료 후 + try/catch 격리 → 본체 영향 0.

편입된 리더는 MOMENTUM(4h TTL)로 메인 watchlist 에 들어가 다음 scan-eval universe 후보가 된다.
이후 Gate1/2/3 평가·주문 경로는 무변경 — universe 후보 유입만 확장한다.

## Consequences

- default OFF 면 LIVE universe·intraday 발굴 무변경(byte-equivalent, ADR-0146). 활성화는 운영자
  ENV 결정이며, 활성화 전 shadow/counterfactual 로 편입 리더의 진입 품질을 검증한다.
- 활성화 시 강세장 리더가 메인 universe·MOMENTUM 에 유입돼 shadow/counterfactual 관측 대상이 된다.
  **단 편입 리더도 Gate1 min-signal 70 임계 + Gate2 breakout-confirm 벽은 동일** — (나)는
  universe·shadow 가시성까지이며, live 신호는 ADR-0546(regime-aware threshold)가 별도 레버다.
- marketSignal=false, executionImpact=NONE — provider 장애/시장신호 변환 0, 주문 경로 0.
- intradayScanner 의 발굴 필터(isIntradayStrong + regime별 minGate)를 리더 정의로 재사용 —
  완화 임계·점수가 아니라 거래량 폭발·돌파/수급 강도 기반이라 Stage1 화면 필터를 우회한다.
- 후속(미해결): 편입 리더의 forward outcome counterfactual 튜닝, ADR-0546 threshold 검토 연계.

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
