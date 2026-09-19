# ADR Index — QuantMaster Pro

@responsibility ADR 번호 발급 SSOT — 충돌·누락 추적, 다음 발급 번호 단일 출처.

본 인덱스는 `docs/adr/*.md` 의 단일 발급 통로. 신규 ADR 작성 시 본 파일의 *다음 발급 번호* 만 사용하고, 작성 직후 본 파일에 한 줄 추가.

## 발급 룰

1. **다음 발급 번호** — 본 인덱스 §"다음 발급" 섹션의 정수값. 신규 ADR 의 파일명 prefix 는 정확히 그 값.
2. **번호 충돌 금지** — 동일 번호 ADR 파일이 ≥2건이면 발급 결함. 신규 ADR 작성 전 반드시 본 인덱스 갱신 (충돌 회피).
3. **건너뛰기 금지** — 누락된 번호는 §"누락 (Gap)" 에 기록만, 재사용 금지 (git history 추적성 보존).
4. **PR 머지 후** — CLAUDE.md "변경 이력" 추가 + 본 인덱스 §"전체 인덱스" 한 줄 추가 동시 의무.
5. **ADR 번호 = 1회 발급** — 머지된 ADR 의 번호 변경 금지 (외부 참조·git diff 무결성).

## 다음 발급

**다음 ADR 번호: `0679`**
(2026-09-19 기준, 마지막 발급 0678 — Shadow 동시 조건 관측과 독립 재무 보강.)



최근 발급: 2026-09-19, [0678 — Shadow 동시 조건 관측과 독립 재무 보강](0678-shadow-observation-features.md), Accepted.

상세 결정은 해당 ADR, 과거 구현 내역은 Git에서 조회한다. 이 파일에는 발급 번호와 검색 목록만 남긴다.

## 알려진 충돌 (Known Conflicts)

머지된 ADR 들의 번호 중복. 향후 신규 발급 시 본 인덱스 검증으로 영구 차단. 기존 ADR 번호 변경은 git diff·외부 참조 무결성 보호를 위해 *금지* — 본 표가 단일 진실 출처.

**별칭 정책 (ADR-0159, 2026-05-02 도입)** — 충돌 ADR 인용 시 *별칭 사용 권장* (예: `ADR-0028a` exitEngine 분해 / `ADR-0028b` rejection-universe-tracker / `ADR-0028c` ui-redesign-p0). 비충돌 ADR 은 기존 형식 그대로 (예: `ADR-0085`). 별칭 부여 기준 — 동일 그룹 내 PR 머지 시점 오름차순 (a → b → c). 강제 검증 default OFF (회귀 위험 격리, 6개월 운영 후 활성화 검토).

| 번호 | 별칭 | 파일 | 의도 도메인 | PR / 머지 시점 | 비고 |
|------|------|------|-------------|----------------|------|
| 0028 | **0028a** | `0028-exitEngine-decomposition.md` | exitEngine 분해 (P2) | PR-53 (2026-04-26) | 절대 규칙 #6 (1500줄) |
| 0028 | **0028b** | `0028-rejection-universe-tracker.md` | 거절 종목 사후 추적 | PR-L (2026-04-26) | 자기학습 시리즈 |
| 0028 | **0028c** | `0028-ui-redesign-p0-banners-badges-cards.md` | UI P0-A 배너/배지/카드 | PR-A (2026-04-26) | UI 재설계 |
| 0029 | **0029a** | `0029-condition-source-tier-and-recommendation-history.md` | UI P0-B 조건 출처 + 이력 | PR-B (2026-04-26) | UI 재설계 |
| 0029 | **0029b** | `0029-counterfactual-twin-portfolio.md` | Twin Portfolio Ranking | PR-M (2026-04-26) | 자기학습 시리즈 |
| 0029 | **0029c** | `0029-stockScreener-decomposition.md` | stockScreener 분해 (P1) | PR-55 (2026-04-26) | 절대 규칙 #6 |
| 0030 | **0030a** | `0030-latent-signal-scorer.md` | VCP + Catalyst 사전 신호 | PR-N (2026-04-26) | 자기학습 시리즈 |
| 0030 | **0030b** | `0030-price-alert-watcher.md` | UI P0-C Web Notification | PR-C (2026-04-26) | UI 재설계 |
| 0030 | **0030c** | `0030-signalScanner-entry-gates-phase-b.md` | EntryGate Chain Phase B | PR-57 (2026-04-26) | signalScanner 분해 |
| 0031 | **0031a** | `0031-last-trigger-enemy-tranche-cards.md` | Last Trigger + Enemy Card | PR-D (2026-04-26) | UI 재설계 |
| 0031 | **0031b** | `0031-order-type-optimizer.md` | 슬리피지 학습 + 주문 타입 | PR-O (2026-04-26) | 자기학습 시리즈 |
| 0031 | **0031c** | `0031-signalScanner-revalidation-and-sizing-patterns.md` | RevalidationStep 패턴 | PR-59 (2026-04-26) | signalScanner 분해 |
| 0032 | **0032a** | `0032-sector-rotation-heatmap.md` | UI P1-E 섹터 히트맵 | PR-E (2026-04-26) | UI 재설계 |
| 0032 | **0032b** | `0032-self-learning-series-overview.md` | 자기학습 시리즈 통합 SSOT | PR-P (2026-04-26) | 자기학습 시리즈 |
| 0067 | **0067a** | `0067-multi-timeframe-confluence-gate.md` | MTF Confluence Gate | PR-Q (2026-04-26) | EntryGate Phase B |
| 0067 | **0067b** | `0067-marketoverview-boundary-guard.md` | MarketOverview boundary lint | PR-α 후속 (2026-04-27) | 데이터 안정성 |
| 0068 | **0068a** | `0068-macrostate-stale-block.md` | macroState stale 차단 | PR-α 후속 (2026-04-27) | 데이터 안정성 |
| 0068 | **0068b** | `0068-shadow-learning-hooks-wiring.md` | Rejection + Twin wiring | PR-R (2026-04-28) | 자기학습 시리즈 |
| 0124 | **0124a** | `0124-regime-coverage-suggest-false-positive.md` | regimeCoverage 표본 임계 | (날짜 추가 필요) | 학습 시그널 정합 |
| 0124 | **0124b** | `0124-telegram-reports-be-visibility.md` | 텔레그램 리포트 BE 표기 | PR-ADR-0124 (2026-04-30) | BE 정합 |
| 0146 | **0146a** | `0146-pr-pace-audit-rule.md` | 10-PR audit 룰 + 자가 review 체크리스트 | PR-Governance-3 (2026-05-01) | 거버넌스 |
| 0146 | **0146b** | `0146-telegram-sanity-unlock-cmd.md` | `/sanity` 텔레그램 명령 R3 Block 즉시 해제 | (2026-05-03) | 운영 명령어 |
| 0147 | **0147a** | `0147-kis-token-disk-persistence.md` | KIS 토큰 디스크 영속 (재부팅 OAuth2 차단) | (2026-05-01) | 인프라 |
| 0147 | **0147b** | `0147-signalScanner-orchestration-migration.md` | signalScanner Phase 3 6단계 오케스트레이터 승격 | (2026-05-03) | 리팩토링 |
| 0168 | **0168a** | `0168-kelly-clamp-ssot.md` | Kelly clamp 수치 정책 SSOT | PR-Kelly-Clamp-SSOT (2026-05-02) | 사이징 |
| 0168 | **0168b** | `0168-emergency-data-quality-circuit-breaker.md` | Emergency Data Quality Circuit Breaker | (2026-05-03~05-05) | 데이터 안전 |
| 0502 | **0502a** | `0502-kis-official-investor-flow-promotion.md` | KIS 공식 투자자 흐름 evidence 라우터 wiring | 6867ed3 (2026-05-11 23:05) | 수급 데이터 |
| 0502 | **0502b** | `0502-kis-official-global-fallback-until-krx-recovery.md` | KIS 공식 가격 fresh 시 Yahoo 진단 강등 | 70c409b (2026-05-11 23:39) | 데이터 안정성 |
| 0502 | **0502c** | `0502-krxclient-decomposition.md` | krxClient 분해 (ACMA 1500줄 한계 해소) | PR-Refactor-krxClient (2026-05-12) | 절대 규칙 #6 (1500줄) |

**충돌 그룹 12개 / 충돌 ADR 29개 (별칭 29건 부여, ADR-0159)**. 향후 신규 발급은 §"다음 발급" 번호 사용 → 충돌 0건 유지.

## 누락 (Gap)

미사용 번호 — 발급 실수·rebase 충돌 회피 누락. *재사용 금지* (git history 추적성 보호).

| 번호 | 사유 (추정) |
|------|-------------|
| 0062 | rebase 충돌 회피 (main #380 ADR-0061 vs 본 시리즈 0064~0066 그룹 재할당) |
| 0063 | 동일 |
| 0089 | 누락 원인 불명 (후속 audit 가능) |
| 0105 | UI Phase 시리즈 stack rebase 시 누락 |
| 0106 | 동일 |
| 0143 | KIS GitHub 검증 PR rebase 시 누락 (0144/0145 그룹) |
| 0196~0210 | 세션 2026-05-06 fast iteration — commit message 가 0211 부터 시작, INDEX.md 등재 안 됨 |
| 0212~0220 | 동일 (0211 다음 0221 점프) |
| 0222~0230 | 동일 (0221 다음 0231 점프) |
| 0232~0233 | 동일 (0231 다음 0234) |
| 0236 | 동일 (0235 다음 0237) |
| 0238~0240 | 동일 (0237 다음 0241) |
| 0243~0244 | 동일 (0242 다음 0245) |
| 0246~0247 | 동일 (0245 다음 0248) |
| 0253 | **포기 결정** — Yahoo→KIS 시계열 합성 (회귀 위험 큼, DECIDED_NOT_WIRING) |
| 0254 | **포기 결정** — 점심 회로 절전 (ADR-0237 와 책임 중복, DECIDED_NOT_WIRING) |
| 0257 | 세션 fast iteration — commit message 가 0258 점프 |

총 누락 47개 (기존 6 + 세션 2026-05-06 41). 번호 재사용 금지 (git history 추적성 보호).

## 전체 인덱스

| 번호 | 제목 | 도메인 |
| 0678 | Shadow 동시 조건 관측과 독립 재무 보강 | learning |
| 0677 | Shadow 마감 요약과 장중 판단 사유 보존 | learning |
| 0676 | Shadow 상장기업 공시 수집과 사실 관측 | learning |
| 0675 | Shadow 기관·외국인 수급과 후속 성과 상관 연구 | learning |
| 0674 | Shadow 뉴스 방향 기록과 독립 성과 비교 | learning |
| 0654 | 주문 TR 신스킴 default-ON flip + 프록시 차단목록 동반 완성 — ADR-0653 신스킴을 default OFF→ON 승격(운영자 silverlh614 승인). constants.ts flag `=== 'true'`→`!== 'false'`(default ON·kill-switch `KIS_ORDER_TR_NXT_SCHEME_ENABLED=false`·ADR-0157 거울·본체 0줄). 동반 kisProxyPolicy.FORBIDDEN_TR_IDS 신스킴 주문 TR 6종(TTTC0012U/0011U/0013U+V) 추가(절대 규칙 #4 안전망 — 신스킴 default-ON 시 구 TR 만 막으면 클라이언트 신 TR 프록시 우회 가능). 안전: SHADOW_ONLY→live 주문 0(불변식 #8)·프록시 경로+TR 2겹 차단. executionImpact ON=신스킴(현 live 0)/=false=byte-identical 롤백. 회귀 402/402+default-ON/kill-switch/프록시 신TR 가드. 계보 0653/0157/0146 | kis-client / order-tr default-on-flip |
| 0653 | 국내 주문 TR_ID 신스킴(KRX+NXT 통합) 마이그레이션 — 첨부 공식 SDK(open-trading-api, ADR-0555 vintage) 재대조로 라이브 주문 경로가 구 KRX 전용 스킴(매수 TTTC0802U/매도 TTTC0801U/정정취소 TTTC0803U/일별체결 TTTC8001R)에 잔존함을 확인. 공식은 2025 Nextrade(NXT) 도입으로 KRX+NXT 통합 신스킴(매수 TTTC0012U/매도 TTTC0011U/정정취소 TTTC0013U/일별체결 TTTC0081R + order-cash 신규 필수 param EXCG_ID_DVSN_CD/SLL_TYPE/CNDT_PRIC)으로 이행. ⚠️ 매수↔매도 swap 함정(공식 order_cash.py sell→0011U/buy→0012U, 구스킴 끝자리와 반대) 동결 주석+가드 테스트. constants.ts 단일 SSOT ORDER_TR_SCHEME 스위치(KIS_NXT/KIS_LEGACY_ORDER_TR_IDS)로 BUY/SELL/CCLD/RVSECNCL TR_ID 전부 flag-aware화 + 어댑터 nxtOrderCashParams/nxtCancelParams spread(OFF→{}) + selectCancelOrderTrId/selectCcldTrId(isReal 경로 보존). ENV KIS_ORDER_TR_NXT_SCHEME_ENABLED default OFF=byte-equivalent(회귀 378/378 green). 활성화는 VTS(모의) 회귀+운영자 승인 후 ENV 1줄 ON. NXT/통합 거래소 확대는 후속 ADR. 동반 P1: kisOfficialEndpointRegistry.ts read-only endpoint trId 10건 메타 정합(executionImpact=NONE). 계보 ADR-0555/0561/0146. 불변식 #2(kisClient 단일통로)/#4 보존 | kis-client / order-tr flag-gated |
| 0639 | Leader Universe 장중 갱신 cron — 운영자가 leader 플래그 둘(INJECTION+DAILY_REFRESH) 다 켰는데 ADR-0638 funnel이 `캐시 EMPTY·cut OVEREXTENDED 0`로 실측, 원인=dynamic-universe 캐시 영구 빔. 근본: KIS 순위 TR은 장중에만 데이터(getRanking ADR-0009 장외 스킵→[]), 그런데 캐시 채우는 cron이 전부 장외(08:10 장전·16:55 장후·토)→getRanking 항상 [] →캐시 못 채움. 수리: 기존 runLeaderUniverseDailyRefresh() 본체 0줄 재사용, 장중 주기 cron leader_universe_intraday_refresh 신설(평일 매시 32분 KST 09:32~15:32 cron `32 0-6`·TRADING_DAY_ONLY·09:30 혼잡 회피 stagger)·기존 LEADER_DAILY_REFRESH_ENABLED 재사용(신규 ENV 0)·getRanking isMarketOpen 이중가드. quota +36 TR/거래일(6슬롯×3키×2시장)·전량 KIS Primary·Yahoo-first 0. executionImpact OFF=NONE byte-identical/ON=발굴 풀 확장(SHADOW_ONLY 출하 안전·ENV 1줄 롤백). 신규 타입/함수 0·screenerJobs cron 1+scheduleCatalog 1. shadowDataGate real-KIS Yahoo폴백 사각지대는 ADR-0561 위반소지로 제외 | screener / scheduler |
| 0638 | Leader Pipeline Funnel 관측 — 운영자가 leader/intraday 플래그 ON 했는데 20일 +35% 주도주가 풀에 미진입하는 원인이 (a) OVEREXTENDED 추격금지 설계인지 (b) dynamic-universe.json 캐시 빔/stale 결함인지 추측 없이 판별. ADR-0617 관측은 Stage1 통과분만 봐서 탈락 leader 비가시→신규 funnel 필요. 관측 2종: ① 캐시 신선도(leader entry 수·age·stale·empty) ② funnel(cacheLeaderCodes→enteredStage1→cutByOverextended/Overheat/Other→preservedIntoPool, ADR-0617 leadersInPoolCount 재사용). seam=universeScanner Stage1 루프(:420-449) stock.source×evaluateStage1FilterTracked().reason 교차(신규 fetch 0). /scan_blockers 1섹션+rolling ledger. ENV LEADER_PIPELINE_FUNNEL_OBS_ENABLED default OFF. 판별: cacheEmpty/stale→(b), dominantCut=OVEREXTENDED+캐시정상→(a). executionImpact NONE·발굴/컷/정렬 0줄·cacheStale≠bearish(#6) | screener |
| 0637 | Provisional Shadow Intraday Horizon OBSERVED 자격 — `/shadow_promotion` winRate 100%·confidence HIGH 가 cache fallback 인플레로 부풀려진 문제 수리. cache-only 모드에서 +30m/+1h 가 intraday 캔들 부재 시 종가/최신가로 fallback→동일 가격 3중 카운트로 follow-through 부풀림. requiresIntradayCandleSource(30m/1h) 술어 신설(isIntradayHorizon 과 별개·SRP)+lookupCachedPrice 2지점 게이트(SCAN_SNAPSHOT 선반환 차단+intraday miss 시 coarser fallback 이전 null short-circuit)→30m/1h 는 INTRADAY_CANDLE_CACHE 로만 OBSERVED, 아니면 DATA_UNAVAILABLE. winRate/confidence 가 close/nextOpen/+1d distinct point 로만 산출(자동 de-inflation·report/promotion 빌더 0줄). SAME_DAY_CLOSE·daily horizon 무변경. 관측 전용·executionImpact NONE·타입 변경 0·cache-only 유지·9대 불변식 0줄 | learning |
| 0636 | 운영자 승인 활성화 절차(LIVE_ADJACENT_REVIEW 전용) — ADR-0635 가 등재한 T2 lever 4종(R6 신선도·R6 stuck-exit·Gate1 RS 연속·intraday 신선화)은 LIVE-인접이라 자가 활성 금지·"운영자 1-체크포인트". 그 1-클릭 승인 절차 구현. 영속 승인 ledger(autoActivationApprovalRepo·streakRepo 동형·atomic·self-heal·물리분리·승인0건=byte-identical) + 엔진 3함수(applyOperatorApproval/revokeOperatorApproval/reapplyOperatorApprovals·LIVE_ADJACENT_REVIEW 만 허용·T3/EXCLUDED/LIVE master 절대 불가·OperatorApprovalResult) + telegram cmd 3종(/review_activations r0·/approve_activation r2·/revoke_activation r2·operator 게이팅 strategy apply_live 재사용·CH4 통지) + 부팅 재적용 wiring(승인0건 no-op). master flag 와 독립한 운영자 명시 행위·신규 ENV 0·executionImpact 승인0건 NONE/승인 시 해당 T2 LIVE 동작 변경(명시 승인분 한정·autoTradeEngine/kisClient/order 0줄). 불변식 #1/#7/#8 정합 | trading / persistence+telegram |
| 0620 | Provisional Shadow 측정 기준가(entryPrice) 배선 — `/shadow_provisional` 50건 전부 INSUFFICIENT_DATA(observed 0)의 근본 수리(신호 결함 아닌 측정 기준가 누락). ProvisionalShadowLedgerEntry entryPrice 필드 부재→buildEntry 미기록→성과 리포트가 (entry as {entryPrice?}).entryPrice undefined→전 horizon DATA_UNAVAILABLE. 기록 호출부(provisionalShadowLane.ts→buyListLoop.ts:446)에 currentPrice(KIS 게이트 가격·실진입 동일 소스 ADR-0561 정합) 스코프 존재·신규 fetch 0. 타입 pin: entryPrice?:number + entryPriceSource?:'KIS_CURRENT'|'SCAN_SNAPSHOT'(ADR-0431 source 라벨 동형) 3경계 additive(ledger·candidate·derive input). 로직: derive positive-finite carry→buildEntry stamp→provisionalShadowLaneDerive(currentPrice 인자)→buyListLoop 전달. 하위호환 기존 50건 미설정→INSUFFICIENT 유지(소급 0). liveAllowed:false 불변·executionImpact NONE·9대 불변식 0줄·provisional/counterfactual/일반 shadow ledger 물리 분리 유지·#6(결손=측정 보류≠bearish)·#7(L1 측정 기준가·매매 직접 미사용) | learning / persistence+signalScanner |
| 0618 | 주도주 소스 일일 신선화 — ADR-0617 이 보존하는 주도주(LEADER_SOURCES=FOREIGN/INST/MARKET_CAP)가 dynamicUniverseExpander 캐시(runDynamicUniverseExpansion 주 1회 토 09:00 + 14일 TTL)에서 와 **최대 2주 묵은 주도주** 주입 위험(외인·기관 수급 매일 회전→stale leader). 재사용 seam expandOnEmpty(랭킹 발굴 getShadowSafeRanking×RANKING_KEYS·5분 캐시·allSettled)를 LEADER 매핑분만 매 거래일 돌려 신선화(신규 fetch 경로 0). 신규 runLeaderUniverseDailyRefresh(market-cap/institutional-net-buy/volume[외인 근사] 3키만·fluctuation/large-volume/short-balance 미호출=주간 유지)·단축 TTL 3일(stale 자동 만료)·공통 헬퍼 추출(expandOnEmpty byte-identical 보존)·Telegram 무음. 신규 cron KST 08:10(스캔 전·TRADING_DAY_ONLY·flag-gated 단락). ENV LEADER_DAILY_REFRESH_ENABLED default OFF byte-identical(OFF→cron no-op·주간만). TTL/중복 정합: per-entry expiresAt 혼재 안전·같은 code 일일 upsert(연장)+source 재기입·주간 비주도 무영향·expandOnEmpty skip 과 의도적 분기(refreshExisting). quota 일일 LEADER 3키(주당 +15·5분 캐시 흡수·KIS Primary 0561·KRX/Yahoo 0). executionImpact OFF=NONE / ON=신선도 변경(0617 도 ON 이면 보존 대상 갱신·둘 다 default OFF·SHADOW_ONLY 출하 안전). 불변식 #1/#3/#4/#7/#9 보존(정밀 외인 TR·일중 재갱신 후속 ADR) | screener / scheduler |
| 0617 | 주도주 Stage1 보존 — "외인·기관 순매수 대형 주도주 발굴"은 이미 가동 중(dynamicUniverseExpander source FOREIGN/INST/MARKET_CAP)이나 universeScanner stage1QuantFilter 3중 무력화(① scanUniverse 항상 full master → expanded 주도주 폐기 ② source 태그 미탑재 ③ top-60 점수컷 소형주 편향 탈락). 처방=source 태그 Stage1 carry + top-60 점수컷에서 주도주 강제 보존(union·중복제거). 주도주=FOREIGN_NET_BUY/INST_NET_BUY/MARKET_CAP만(SHORT_HEAVY 반대 신호 보존 금지)·**Stage1 품질 관문(price>0·tradable·관리종목·OVERHEAT·OVEREXTENDED) 통과 필수·점수-랭크 컷만 면제**(불변식 #7). 신규 모듈 leaderUniverseInjectionAdr0617.ts·CandidateStock.source? additive(DynamicStock['source'] 재사용·두 번째 enum 0)·dynamicUniverseExpander getExpandedUniverseSourceMap getter·ledger(ADR-0614 패턴·preservedCount=드롭됐을 수+source 분포)·paths.ts 1줄. ENV LEADER_UNIVERSE_INJECTION_ENABLED default OFF byte-identical(:388-390/:424-427 현행 동치)·신규 fetch 0(cron 캐시 재사용). executionImpact OFF=NONE / ON=EXECUTION_ADJACENT(유니버스 변경·SHADOW_ONLY 출하 안전). 불변식 #3/#7/#9 보존(후속 ADR 발굴 신선도·보존 확대·Gate 승격) | policy / screener |
| 0616 | 유니버스 구성 편향 per-scan 관측 전용 ledger — 발굴 코스닥 소형주/낙폭반등 편향(디버전스 장 코스피 대형 주도주 누락·후보 RS −8.97%)을 편향 교정 전 fetch-0·OFF-safe 로 정량화. per-scan aggregate: ① 시장 구성(getStockByCode market KOSPI/KOSDAQ/기타·로컬 마스터 fetch 0) ② leader/laggard(RS=quote.return20d−kospi20dReturn 둘 다 %·calcStage1Score RS 정의 재사용·두 번째 공식 0·RS>=0 leader/<0 laggard·avg/median·벤치마크 null→skip) ③ 시총 tier(listedShares×price LARGE 3조/MID 1조/SMALL·결손→skip 가짜 시총 0 불변식 #6·전원 불가 null SKIP) ④ topLaggardCodes N. 신규 모듈 universeCompositionBiasObservationAdr0616.ts(getStockByCode 만 경유·신규 fetch 0)·ledger(ADR-0614 패턴 atomic+FIFO 60스캔+손상 fallback+scanDateKey upsert·단일 배열)·paths.ts UNIVERSE_COMPOSITION_BIAS_LEDGER_FILE 물리 분리. stamp universeScanner Stage3 루프 이후 1회(aggregate)·try/catch 격리. ENV UNIVERSE_COMPOSITION_BIAS_OBSERVATION_ENABLED default OFF byte-equivalent. 발굴/Stage1 필터/정렬/Gate score/주문/autoTradeEngine/kisClient/SourceSnapshot 0줄(관측 전용·후속 ADR 발굴 편향 교정) | policy / screener |
| 0615 | 뉴스시차 진입윈도우 관측 전용 stamp — newsLagBayesian getOptimalEntryWindow(dead, /news_patterns 표시만)를 후보 선정 시점에 surface. 각 후보 sector 의 활성 NewsSupplyRecord(미완료)×lag posterior 조인→진입 윈도우 PRE/IN/PAST 분류·stamp. sector 단위 조인으로 per-stock newsType 부재 정직 우회(candidate.sector↔record.sector, computeEtfSectorBoost 선례)·per-stock 귀속 후속 ADR. 신규 모듈 newsLagEntryWindowObservationAdr0615.ts(loadNewsSupplyRecords·getOptimalEntryWindow 기존 export 만 경유·내부 store 0). 분류 ci95 채택(이미 노출·μ±σ 대비 두 번째 공식 0)·now 주입(테스트 결정성)·graceful skip(n<3/손상 detectedAt/미매칭, 불변식 #6). stamp universeScanner.ts:696-719(ADR-0614 인접·try/catch 격리)·CandidateStock.newsLagEntryWindow? additive·ScanSummary 집계 1필드. ledger 불필요(입력 영속 존재·후속 ADR). ENV NEWS_LAG_ENTRY_WINDOW_OBSERVATION_ENABLED default OFF byte-equivalent. Gate score/주문/autoTradeEngine/kisClient/SourceSnapshot/entryTimingSignal 0줄·신규 fetch 0(관측 전용·후속 ADR Gate 승격) | policy / learning+screener |
| 0614 | 외국인/기관 연속 순매수 관측 전용 시계열 ledger — supply_confluence 가 당일 동반 순매수만 보고 버리는 연속(N영업일)/누적 신호를 신규 ledger 로 누적. c.kisFlow piggyback(신규 fetch 0·KIS/KRX quota 0)·per-stock rolling window(10d FIFO)+글로벌 캡 600·investorFlowSemanticAvailability 단일통로(OK만 기록·결손≠신호 불변식 #6)·dateKey×stockCode upsert last-write-wins·atomic write. ENV CONSECUTIVE_NETBUY_OBSERVATION_ENABLED default OFF byte-equivalent. Gate score/주문/autoTradeEngine/kisClient/SourceSnapshot 0줄(관측 전용·후속 ADR Gate 승격) | policy / signalScanner |
| 0613 | Gate1 천장 배선 OFF-by-default 승격 — RS percentile 입력·BREAKOUT_STRUCTURE OHLCV·positive max→100 정규화 3종을 LIVE minimum-signal scorer 에 연결, GATE1_POSITIVE_CEILING_WIRING_ENABLED default OFF byte-equivalent + 관측 ledger hypothetical delta stamp. dry-run 함수 재사용(두 번째 공식 0)·requiredScore=70 무변경·ADR-0471 freeze 정합 | policy / signalScanner |
| 0612 | 유니버스 선정 RS 게이트 — 발굴 MOMENTUM momentum20d≥시장 필터(graceful fallback) + Stage1 0-floor RS 보너스(clamp(return20d−KOSPI20d,0,3)). 강세장 laggard 유입 차단, no-op 함정 회피(필터·비선형), default OFF·신규 fetch 0·requiredScore 무변경 | policy / services+screener |
| 0611 | Gate1 SECTOR_RELATIVE_STRENGTH 재활성 — ADR-0467 advisory 주차로 봉인된 8점 capacity(108 vs configured 116) 복원, 섹터상대수익만 소비(RS 이중계상 회피), default OFF·requiredScore=70 무변경 | policy / signalScanner |
| 0610 | counterfactualOutcomeBoard format-layer extraction — 1,499~1,500줄 ACMA 한계 고착(R1 net-0·다음 변경 영구 차단) 선제 분해. format(표시) 함수 10종(formatCounterfactual* SafetyChecks/BoardSummary/Gate1/Gate2/Gate3/Missed/Today/Review/Debug/CommandReply)+표시 전용 5헬퍼(pct/num/safetyLine/distributionLine/formatBandRows, grep 확인 build 미사용)+CounterfactualCommandMode/resolveCounterfactualCommandMode 를 신규 counterfactualOutcomeBoardFormat.ts(244줄)로 순수 이동, 본체(1,500→1,279줄)는 build 집계 함수+타입 잔류 + format 심볼 re-export(호출처 import 경로 무변경 byte-equivalent). 순환 회피: format→board 는 import type(런타임 엣지 0)·board→format 값 re-export 1방향. 소비처 3곳 무수정 green. LIVE 무관(learning board 표시층)·executionImpact=NONE·9대 불변식 #1/#2 보존·R1/ADR-0609 무영향. 계보 ADR-0596/0524/0521/0523 | refactor / learning / complexity |
| 0609 | Gate1 상수블록 eligibility shadow 판정(Phase 0 관측 전용·LIVE 점수 0줄) — 신규 순수 SSOT gate1EligibilityShadowScoreAdr0609.ts buildGate1EligibilityShadowReportAdr0609/judgeGate1EligibilityAdr0609. 입력 ADR-0597 산출물(marketBlockScore·totalPercentile)+상수 컴포넌트, 산출 eligible(WATCHLIST>0&&REGIME>=0&&INVESTOR>=0, 불변식 #6 결손→보류 보수 통과·bearish 변환 0)·marketOnlyPassed(>=42 null→null)·percentilePassed(>=70). 잠정 임계 GATE1_ELIGIBILITY_SHADOW_THRESHOLDS SSOT(Phase 1 보정). 배선 ADR-0597 동형 ScanSummary 집계+ledger stamp(try/catch 격리). 소비처 0(buyList/Gate/entry/Kelly 미소비, 3중 분리). LIVE byte-equivalent minimumSignalScoreTrace D1-D4·gateConfig 70·0fetch | gate1 / scoring-shadow / observation-only |
| 0608 | SHADOW 전용 regime-aware Gate1 진입 임계 — 신규 순수 SSOT gate1ShadowEntryThreshold.ts resolveEntryMinGateScore({regime,isShadow}) = ENV ON&&isShadow→getEffectiveGateThreshold(regime) / 그 외→getMinGateScore byte-equivalent. 진입 차단 단일 지점 evaluateEntryRevalidation(entryEngine.ts:370, minGate 호출자 주입) seam=entryRevalidationStep.ts:67. SHADOW paper fill 도 LIVE 와 동일 임계 공유 확인(분기=stockShadowMode). 타입 ServerShadowTrade+클라 미러 additive entryThresholdMode?:'LEGACY'\|'REGIME_AWARE_SHADOW'. ENV GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED default OFF=byte-equivalent, LIVE 본체 0줄·KIS 0 | trading / entry-threshold / flag-gated |
| 0607 | LIVE 모드 SHADOW 메시지 CH4(JOURNAL) 격리 — 신규 순수 SSOT shadowQuietRouting.ts resolveShadowChannelRoute 3중 AND(LIVE_SHADOW_QUIET_ENABLED·getExecutionMode LIVE·isShadow)→JOURNAL. 적용 routeTelegramEvent SIGNAL 분기 + channelBuySignalEmitted(mode-aware). channelSellSignal/개인DM 은 scope 제외(follow-up). ENV default OFF=byte-equivalent, 현 SHADOW 운영 영향 0·LIVE 본체 0줄·KIS 0 | telegram / channel-routing / flag-gated |
| 0606 | 러너(Runner) 모드 — 추세추종 익절(전량 트랜치 스킵 + 넓은 트레일링 resolveRunnerTrailPct floor 0.15) + 슬롯 카운트 제외(computeSlotConsumption 단일 SSOT, runnerCount additive). 승격=마지막 LIMIT 트랜치 OR +18%(ENV). 신규 순수 SSOT runnerPolicy.ts + ServerShadowTrade 옵셔널 5필드(클라 미러 동기). ENV 2게이트 독립 default OFF=byte-equivalent, SHADOW 전용·LIVE 본체 0줄 | trading / exit-engine+slot / flag-gated |
| 0605 | 미국 선행지수 연결 잔여 이행 — fast-upgrade 보조 AND(④ SPX 야간 비급락, default OFF) + SOX 수집·Gate2 반도체 proxy 축(stockVsSector 단독 주입 62 캡, default OFF) + /us_overnight NDX 밴드 분리(표시 전용) | policy / regime+gate2+learning |
| 0604 | 미국 야간↔KOSPI stratify 관측(2단계, /us_overnight 5밴드 실측·게이트 미소비) + 야간 급락 개장 전 보수 강등(3단계 — bias -12·R6 회복 가속 차단, default OFF, usOvernightBoost 하방 대칭). 활성화 기준=밴드 실측 n>=10 | policy / learning+regime |
| 0603 | 미국 지수 KIS-primary 승격 — SPX Yahoo→KIS 해외지수 일봉(FHKST03030100, 일캐시·fallback 보존·소비식 0줄) + NDX 관측 수집. 미국 선행지수↔한국 레짐 연결 1단계, 2/3단계(야간 stratify→게이트 반영)는 로드맵 | policy / kisClient+marketDataRefresh |
| 0602 | 동일 섹터 강자 교체 phased 도입 — Phase 0 관측(proposeSameSectorReplacement+가드 차단 시 교체 후보 1줄 표기, 실집행 0, default ON). 교체 엔진 미배선+동일섹터 금지 이중 갭의 출구를 한도 해제 대신 데이터 검증으로. Phase 1 shadow 집행/Phase 2 live 는 설계만 | policy / trading+entryGates |
| 0601 | Gate2 Supply 축 KIS 네이티브 hydration — 기존 단일통로 investor-flow evidence 를 결손 후보 전체로 확장 주입(일중 캐시·스캔당 상한 16·실패 격리, default ON). L1>시맨틱 fallback>missing 우선순위. D4 KOSDAQ 마스터 업종코드는 Phase 2 | policy / signalScanner+supply |
| 0600 | Gate2 Supply/Sector 결손 축 보수 fallback — Gate1 시맨틱 수급(78캡)·스캔 동종군 상대수익(62상한) DEGRADED/ADVISORY 소비, BULLISH 민팅 금지·fetch 0·default ON(진단 차선 한정). KIS 네이티브(inquire-investor·KOSDAQ 마스터 업종코드) 1순위 후속 ADR-0601 로드맵 명시 | policy / quant |
| 0599 | Gate2 confluence 가용 축 비례 요구 — 결손 축이 STRONG/WEAK 절대 개수 조건(bullish>=3)을 역설적으로 강화하는 갭 보정(ceil 60%·<=3), flag default OFF + dry-run 상시 관측(proportionalDryRun). 점수 임계·BULLISH 컷 불변, ADR-0416 정합 완성. 계보 Gate2 추적 20260611/0416/0519 | policy / quant |
| 0598 | 과열 추격 가드 갭 봉인 — G1 FOMO 쿨다운 진입 시점 재평가(REGRET_ENTRY_REEVALUATION_ENABLED) + G2 Gate3 ma20 결손 시 BREAKOUT_CONFIRMED 보수화(GATE3_EXTENSION_GUARD_STRICT_ENABLED). 둘 다 default OFF byte-equivalent·observe 로그, live 만 보수화·shadow 무영향(불변식 #8). 계보 유진테크 추적 20260611/0030/0578 | policy / signalScanner+quant |
| 0597 | Gate1 횡단면 percentile shadow 보조점수 — canonical 점수(ADR-0541)에서 스캔 내 midrank 백분위 + 시장신호 블록 합(상수블록 제외) 산출, ScanSummary+ADR-0476 ledger 행 stamp (관측 전용, Gate 판정 미소비, fetch 0). 절대 vs 횡단면 임계 논쟁의 forward 증거 수집 개시. 계보 리뷰 20260611/0541/0546/0476 | policy / signalScanner |
| 0596 | minimumSignalScoreTrace component decomposition — 점수 컴포넌트 계산(scorer 5종)·trace 경로 해석·집계 리포트를 minimumSignalScoreTrace/ 하위 3모듈(traceFieldResolver/componentScorers/decompositionReport)로 순수 이동, 본체 1,500→~690줄(조립 4종 잔류). re-export byte-equivalent·정책 0변경·advisory-only. 가드 갱신 0건(requiredScore 단언 본체 잔류). 계보 ADR-0524/0466/0594 | refactor / signalScanner |
| 0595 | marketDataRefresh section-module decomposition — refresh*Section 도메인 그룹(지수거시/수급신용/프로그램매매/섹터에너지)+공유 observability 를 marketDataRefresh/ 하위 5모듈로 순수 이동, 본체 1,497→~375줄(오케스트레이터+MERGE 영속+re-export 잔류). 호출 그래프·순서 불변, 정적 가드 9파일 ADR-0444 concat 패턴 갱신(단언 무수정). 계보 ADR-0580/0589/0592 | refactor / trading |
| 0594 | Gate1 regime-aware reversal momentum credit — risk-on 국면(RISK_ON_REGIMES) 한정 quote.changePercent 를 PRICE_MOMENTUM 에 bounded 양수 가산(T_min~T_cap 선형·MAX_BONUS 상한·maxScore 20 천장 불변·hard-block/감점 무변경). 신규 SSOT signalScanner/reversalMomentumCredit.ts. flag GATE1_REVERSAL_MOMENTUM_ENABLED default OFF=byte-equivalent. 계보 ADR-0593/0592/0550/0546 | trading / gate1 / flag-gated |
| 0593 | regime risk-on fast-upgrade — R6 -5% 블랙스완 하락 트리거의 상방 대칭. 3중 AND(KOSPI 당일 강반등≥T·VKOSPI 진정·breadth 우위) 동시 충족 시 classifyRegime fall-through 직전 provisional R3_EARLY 승급(캡 — R2/R1 직행 금지). 신규 SSOT regime/riskOnFastUpgrade.ts. flag REGIME_RISK_ON_FAST_UPGRADE_ENABLED default OFF=byte-equivalent. 계보 ADR-0550/0592/0581/0561 | trading / regime / flag-gated |
| 0592 | R6_DEFENSE trigger freshness by trade-date + intraday KOSPI rebound recognition (shadow-gated). 봉 거래일(KRX) 기준 freshness 강등(결함 A false-latch 차단) + 오늘 intraday KOSPI 수익률(KIS 종합지수 0001 L1) recovery 공급(결함 B). 신규 SSOT kospiTriggerFreshness.ts(순수) + marketDataRefresh/kospiIntradayRefresh.ts. MacroState +4 / R6TriggerBreakdown +3 옵셔널. flag 3종 default OFF=byte-equivalent. 임계값 무변경, KIS 단일 통로, 9대 불변식 #1/#2/#6. 계보 ADR-0559/0561/0567/0584 | trading / regime / flag-gated |
| 0591 | market truth layer trading date ssot | trading |
| 0590 | routeBuilder investor flow router cyclomatic complexity reduction | refactor |
| 0589 | summaryBuilder and marketDataRefresh cyclomatic complexity reduction | refactor |
| 0588 | persistScanResults mid-scan diagnostic blocks extraction | refactor |
| 0587 | kisSectorEnergyProvider type-extraction decomposition | refactor |
| 0586 | VKOSPI flat-during-move 휴리스틱 revert — /vkospi_index_dump 결과 73.4 가 진짜 KRX-공식 VKOSPI(실제 대폭락: KRX300 레버리지 −11.88%·SK하이닉스 선물레버 −26.70%, VIX 16 은 한국발 국지폭락 디커플링). 휴리스틱이 진짜 plateau 를 오격리 → ADR-0584 Phase B 가드+ADR-0585 교정+⚠️STALE 마커+flag 2종+vkospiFreshness.ts 제거, ADR-0530 classic 가드 원복. 유지: Phase A 사실 가시화(baseDate/fetchedAt/경고)+/vkospi_index_dump. 부수: VKOSPI 이름필터 정밀화('최소변동성지수' 동음이의 배제, byte-equivalent). 교훈=단일지표 implausibility 판정 전 시장맥락 우선. 계보 ADR-0530/0584/0585 | regime / data-trust |
| 0585 | VKOSPI fetch 교정(ADR-0584 후속, flag VKOSPI_FETCH_CORRECTION_ENABLED default OFF byte-identical, 격리 flag와 독립): frozen(flat-during-move) KRX 값 거부→Yahoo `^VKOSPI` 검증값 채택→둘 다 frozen이면 carry-forward. 격리에 그치지 않고 실제값 교정. 안전 판별자=flat-during-move만(진짜 spike 미마스킹). KIS-primary(KRX L1 우선)·불변식 #6 보존. 잔존: 공식 인덱스코드 검증·risk axis 소비. 계보 ADR-0530/0584 | regime / data-trust / flag-gated |
| 0584 | VKOSPI stale 가시화(Phase A always-on·executionImpact=NONE: baseDate(BAS_DD)/fetchedAt 영속·carry-forward/ambiguous 경고·/regime ⚠️STALE) + flag-gated flat-during-move 격리(Phase B VKOSPI_STALE_GUARD_ENABLED default OFF byte-identical: KOSPI 급변 중 VKOSPI flat=frozen → UNTRUSTED_IMPLAUSIBLE, ADR-0530 G2 폭락일 갭 차단, 진짜 spike 미마스킹). 신규 SSOT vkospiFreshness.ts. 불변식 #6 보존. 한계(후속): risk-axis 격리·공식 인덱스코드 검증·baseDate 캘린더 stale-gate. 계보 ADR-0530 | regime / data-trust / flag-gated |
| 0583 | MHS 소스 저하(FRED/ECOS 결손) end-to-end 가시화(Phase A always-on·executionImpact=NONE) + flag-gated confluence 가드(Phase B MHS_DEGRADE_GUARD_ENABLED default OFF·byte-identical). 신규 SSOT mhsDegrade.ts(deriveMhsDegrade FULL/PARTIAL/FALLBACK·isMhsDegradeGuardEnabled), marketDataRefresh→MacroState(mhsSourcesOk/mhsConfidence/mhsDegraded) 영속+/regime 신뢰도 라인, Phase B ON+degraded 시 calcMacroScore MHS 낙관부스트 비대칭 억제(≥70 +8→+3·55~69 +3→0·<40 -15 보존). 불변식 #6/#9·VERBATIM 0줄, 테스트 30 | macro / confluence / flag-gated |
| 0582 | 조건 검증가능성 3-tier 분리 + 기술지표 계산 검증 승격 — VERIFIABLE(24)/AI_INTRINSIC(3:촉매·심리·엘리엇) 분리해 본질-AI 를 weightedScore 분모에서 제외(점수=검증가능 항목 중 검증율), 기술 6조건 OHLCV 결정적 계산으로 checklist 덮어쓰기→COMPUTED 승격 + marginAcceleration DART 영업이익률 추세→API 승격, 검증가능 13→20·상한 ~74→~92, 표시/진단 전용·executionImpact=NONE·9대 불변식 VERBATIM 0줄, UI 3-구분 노출, 회귀 finalScore 59→60 (최초 0581→main 충돌 0582 재번호) | dashboard / scoring / data-trust |
| 0581 | shadow→live 조건가중치 승격 파이프라인 (phased, flag-gated). Phase 0~2 토대 구현(flag·candidate reader·provider seam, byte-equivalent·executionImpact=NONE); Phase 3~4(promoter·rollout) follow-up·pre-live | learning / promotion / flag-gated |
| 0580 | marketDataRefresh ACMA 한계 임박 선제 분해 (1499→1327, 타입 8종+순수헬퍼 11→types.ts/helpers.ts, byte-equivalent·executionImpact=NONE, refreshMarketRegimeVars 무접촉) | refactor / complexity |
| 0579 | ACMA 1500 한계 임박 파일 선제 type-extraction 분해 (gate1DryRunObservationLedgerAdr0476 1500→1242 · sectorEnergyProvider 1499→1343, types.ts 추출·byte-equivalent) | refactor / complexity |
| 0578 | gate1 technical indicator injection (ma/rsi/atr 미배선 해소, flag-gated) | engine / signalScanner |
| 0577 | 섹터에너지 canonical 일원화 — per-candidate Gate2 SECTOR_LEADERSHIP 축 데이터원을 레거시 basket(KIS_SECTOR_ISCD_MAP 2xxx·DIAGNOSTIC_ONLY)에서 canonical verified official(OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS L1·11/11 VERIFIED)로 단일화. normalizeSectorThemeCycleForGate2 우선순위 raw??canonical(L1)??basket fallback, 기존 2-flag 재사용 default OFF byte-identical, executionImpact=execution-adjacent(sectorReturn20d→sectorScoreBoost +2/-1→STRONG_BUY)→shadow A/B 필수, 데이터위계 canonical=L1·basket=diagnostic(ADR-0561 정합), /sector_energy_diag 모순 collapse(DISPLAY_ONLY). ※ 최초 0572 발급→main 0572(ATR)와 충돌→merge 시 0577 재번호 | sector-energy / gate2 / kis-primary / flag-gated / execution-adjacent |
| 0576 | SHADOW P0 operational warn 에스컬레이션 제외 — SHADOW/SHADOW_ONLY P0 는 requireAck:false(재발송·60분 CRITICAL 에스컬레이션 0, 1회 발송 가시성 보존), LIVE 는 ack 루프 유지, ENV SHADOW_P0_ACK_LOOP_ENABLED 롤백, executionImpact NONE, 불변식 #8 정합 | telegram / alert-noise / ack-escalation / shadow |
| 0575 | defensive entry lane for r6 crash | trading |
| 0574 | kis sector name canonical normalization | quant |
| 0569 | take profit reentry guard | trading |
| 0568 | sector energy gate2 confluence wiring | quant |
| 0570 | Sector index 20d/5d return cycle 배선 — 공식 섹터 index daily(fetchKisSectorIndexDaily, realDataKisGet SSOT)에서 sectorReturn20d/5d 계산 → SectorEnergyInput 배선 → Gate2 sector cycle "Sector 0/25"(SECTOR_THEME_CYCLE_MISSING) 데이터 정확화(ADR-0568 confluence threading 과 상보), 섹터→iscd verifiedMapping 재사용·신규매핑 0, 6h+캐시·섹터당 1콜·후보당 재fetch 0, flag SECTOR_INDEX_CYCLE_WIRING_ENABLED default OFF=byte-equal(KIS콜 0), executionImpact=(b)execution-adjacent(hasKisSectorMetrics 점화→scoring formula→tier→applySectorScoreBoost +2/-1→STRONG_BUY 영향)→shadow 검증 필수, hardBlock/marketSignal 무회귀, ADR-0423 후속 | sector-energy / gate2 / kis-primary / flag-gated / execution-adjacent |
| 0568 | sector energy gate2 confluence wiring — sectorEnergyResult 를 Gate2 confluence external coverage 입력에 thread(SECTOR_ENERGY_GATE2_WIRING_ENABLED default OFF), SECTOR_LEADERSHIP MISSING 해소, ADR-0423 후속 | sector-energy / gate2 / flag-gated |
| 0573 | T1 ack 패밀리 흡수 — 같은 ackFamilyKey 새 ack 가 이전 pending 흡수, 손절 접근 다단계 재발송/에스컬레이션 종목당 3→1 축소, ackFamilyKey 미지정 byte-equivalent, executionImpact NONE, ADR-0572 상보 | telegram / alert-noise / ack-escalation / exit-engine |
| 0572 | 손절 접근 밴드 ATR 동적화 — 고정 5/3/1% → min(배수×ATR%, 고정) cap, 저변동주 과민 해소, ENV STOP_APPROACH_ATR_BANDS_DISABLED 롤백, default ON, 알림전용 executionImpact NONE | exit-engine / telegram / alert-noise / flag-gated |
| 0571 | 후보 sector→Gate2 sectorThemeCycle.sector 합성 배선 — repo 전체 sectorThemeCycle producer 0건이라 후보 sector=UNKNOWN→"Sector 0/25" 잔존(0568 threading·0570 데이터 켜도). sectorThemeCycleProducer 신설(canonicalizeSectorName: 세분화 라벨→12 canonical KRX 섹터명 귀속, getSectorByCode fallback, KIS콜 0·sectorMap SSOT 재사용), externalCoverage flag ON 시 호출→normalizer 매칭→OK_WITH_DATA, 미분류→undefined graceful(byte-equal), ADR-0568 동일 flag 재사용(신규 0) default OFF=byte-equal, executionImpact=(b)execution-adjacent(sectorScoreBoost→STRONG_BUY)→shadow 필수, ADR-0448 hardBlock 무신설·marketSignal:false, ADR-0423/0568/0570 완결편 | sector-energy / gate2 / flag-gated / execution-adjacent |
| 0567 | canonicalSession stale-CLOSED wall-clock 교정 — 장중 stale macro CLOSED 를 거래일+wall-clock=REGULAR_OPEN 시 교정(flag SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED default OFF=byte-equal), 휴장일 SSOT(isKrxTradingDay, ADR-0559) 위임으로 공휴일/주말 false-open 차단, flag ON=live-gating permissive 교정, 진단 정합 | scanner / session / execution-gating / flag-gated / calendar-ssot |
| 0566 | newsSupplyLogger 국내 종가 KIS(L1) 분리 — 국내 code 만 fetchNDayChangeDomestic(KIS-first flag-gated), EWY 글로벌(B4)은 Yahoo 유지, 잔존 fetchCloses=EWY 전용 → grandfather 8→7(WHITELIST 승격), flag OFF byte-equal(import 그래프 포함 lazy), 비실행(학습 귀인)·shadow A/B 미적용, 잔존 burn-down #3(혼합 callsite 심볼 분리) | learning / data-trust / kis-primary / yahoo-boundary / flag-gated |
| 0565 | lateWinEvaluator KIS(L1) 일봉 OHLCV 1차 삽입 — KIS→Yahoo(flag-gated, KIS_OHLCV_PRIMARY_ENABLED 재사용), Yahoo fallback 강등, grandfather 12→10(WHITELIST 승격), flag OFF byte-equal(import 그래프 포함 lazy), 비실행(learningOrchestrator)·shadow A/B 미적용, 잔존 burn-down #2(ADR-0563 §D4 OHLCV shape) | learning / data-trust / kis-primary / yahoo-boundary / flag-gated |
| 0564 | koreanQuoteBridge KIS(L1) 2차 삽입 — KRX→KIS→Yahoo 3단(flag-gated, KIS_OHLCV_PRIMARY_ENABLED 재사용), Yahoo 최후 fallback 강등, grandfather 13→12(WHITELIST 승격), flag OFF byte-equal, 비실행(krxRouter REST)·shadow A/B 미적용, 잔존 burn-down #1(ADR-0563 §D4) | provider / data-trust / kis-primary / yahoo-boundary / flag-gated |
| 0563 | 실행경로 Yahoo burn-down 완료 선언 + 잔존 비실행 동결 — Gate quote(C1)·LIVE 청산 종가 grandfather 0, 잔존 13 hit/7파일(학습 귀인·텔레그램 표시·KRX-fallback) FROZEN_NON_EXECUTION_ADR0563 동결(추적 유지·신규 Yahoo-first 차단 유지, 재활성=shape별 deliberate ADR), 두더지잡기 종료, 런타임 동작 0줄 | provider / data-trust / kis-primary / yahoo-boundary / static-guard / docs-only |
| 0562 | Yahoo(L3) Dependency Boundary Lock — 영구 차용 5건(B4+D1) 잠금 + 가드 전수 탐지 확장(직접 URL·.KS/.KQ concat·fetchCloses 국내심볼·Yahoo client 직접호출, C5 grandfather burn-down, 통합 단일가드, 런타임 0줄·구현 후속 engine-dev) | provider / data-trust / kis-primary / yahoo-boundary / static-guard / docs-only |
| 0561 | KIS(L1) Primary 절대불변식 — KIS-capable 레이어 Yahoo(L3)-first 금지 (§2.3 엄격·절대화·ADR-0547 §8 스캔 Yahoo-first 폐기·quota=엔지니어링 해결·진짜 대체불가 per 1개만 허용·grandfather→burn-down·가드 사양 후속 engine-dev·런타임 0줄) | provider / data-trust / kis-primary / invariant / static-guard / docs-only |
| 0560 | SSOT Drift-Prevention Registry + 정적 가드 (동일개념 다중구현 신규 재발 커밋타임 차단·docs/SSOT_REGISTRY.md 데이터 SSOT·grandfather/burn-down·진짜 drift 만 차단·가드 구현 선행 계약) | governance / ssot / drift-prevention / static-guard / docs-only |
| 0559 | Calendar(휴장일) SSOT 통합 — krxHolidays 데이터 SSOT / krxTradingCalendar 위임 헬퍼 (LIVE 게이트 2027+12/31 구멍 폐쇄·소비처 무변경·안전방향 only·구현 선행 계약) | trading-engine / calendar / live-gating / ssot / docs-only |
| 0558 | universeScanner Lazy/Budget = Legitimate Non-Funnel Boundary (SSOT Single-Funnel 프로그램 **마무리 ADR**·factory eager 통합 금지·supply 단일함수 공유 충족·V1 allowlist LEGITIMATE_BUDGET_LAZY 영구허용·묶음5/6 비추진 종결) | governance / source-snapshot / candidate-universe / non-funnel-boundary / ssot / docs-only |
| 0557 | Unified SourceSnapshot Consumer Threading (정본 소비 배포 계약·C+B 채택·A retention store 기각·Consumer Contract dead carry 방지·묶음3/5/6 재개 roadmap) | governance / source-snapshot / consumer-threading / ssot / docs-only |
| 0556 | SourceSnapshot Factory Boundary & Contract (ADR-0519 collector 확장·신규 factory 신설 기각, 입출력 11필드 계약, freshness 기존 enum 재사용, ADR-0011 경로분리, quota 순증 0) | governance / source-snapshot / factory-boundary / ssot / docs-only |
| 0555 | SSOT Single-Funnel Enforcement Constitution (Information Ownership Registry + 순서대로 로드맵 + KIS 레퍼런스 바인딩) | governance / ssot / source-snapshot / enforcement / docs-only |
| 0554 | counterfacture-gate self-tuning threshold pipeline | learning |
| 0553 | VTS paper-trading order symmetry + real-money startup guard | trading |
| 0552 | remove phantom KRX lunch break session window | trading |
| 0551 | leadershipBridge intraday leader injection wiring | screener |
| 0550 | stage1 risk-on regime leader capture | screener |
| 0549 | Market Rally Search Lens (추천/관측 전용 read-model, 자동매매 분리, ENV OFF byte-equivalent) | recommendation / read-model / source-snapshot-carry / isolation-guard / shadow-only |
| 0548 | KIS chk-holiday(CTCA0903R) opnd_yn 을 L1 권위 휴장 출처로 도입 (하이브리드 fallback, HOLIDAY_CACHE 배선) | provider / calendar / market-clock / kis-quota |
| 0547 | 기술지표 OHLCV 시계열 1차 출처 KIS 일봉(L1) 승격, Yahoo(L3) fallback 강등 (Phase 1 정밀경로) | provider / screener-adapter / technical-quote / kis-quota |
| 0546 | Gate1 Required-Score SSOT 통합 (Phase 1, 동작 보존) | gate-system / diagnostics / scan-blockers / config-ssot / shadow-only |
| 0545 | SectorEnergy Last-Known Verified Snapshot (Display + Shadow-Only) | sector-energy / display-classification / last-known-snapshot / persistence / shadow-only |
| 0544 | SectorEnergy Session-Not-Verifiable Display Isolation | sector-energy / display-classification / session-isolation / provider-policy / shadow-only |
| 0543 | Macro shortSelling KIS L1 Proxy Fallback (KRX OTP outage remediation) | provider / macro-health / regime / shadow-only / data-source-policy |
| 0542 | Investor Flow Supply Router KIS output1/output2 Bucket Realign + KIS-first Reprioritization | provider / supply-routing / kis-client / shadow-only |
| 0541 | Positive Score Starvation Audit Relocation to persistScanResults | gate-system / diagnostics / scan-blockers / display-only |
| 0540 | Macro shortSelling Trading-Day-Aware Freshness | regime / provider / macro-health / live-gating |
| 0539 | R6 Recovery Regime-Linked Cooldown Fast-Track | trading-engine / regime / r6-cooldown / live-gating |
| 0538 | scanBlockers Message Section Decomposition | telegram / scan-blockers / refactor / godfunction |
| 0537 | kisClient/query.ts Decomposition | kis-client / refactor / complexity-baseline |
| 0536 | yahoo-quotesummary-per-eps-opportunistic-enrichment | discovery / enrichment / data-source |
| 0535 | regime-authority-hierarchy-decision-context-ssot | governance |
| 0534 | sector-energy-canonical-baseline-lock | domain / trading / telegram / ssot |
| 0533 | Unified Forward Outcome Labeling Bus | learning / gate3 / gate1 / near-miss / counterfactual |
| 0532 | KIS Finance Fundamentals Migration | gate2 |
| 0531 | gate0-regime-ssot-single-source | trading / regime / gate0 / ssot / migration |
| 0530 | vkospi-stale-implausible-trust-guard | trading / regime / provider-sanity / invariant-6 |
| 0529 | DART Financials Canonical Inclusion into SourceSnapshot | trading |
| 0528 | railway decision log correlation standard | observability / decision-log / correlation |
| 0527 | ExecutionPermissionResolution Unification and PositionPolicyDecision SSOT | trading / execution-permission / position-policy-ssot |
| 0526 | CandidateGateEvaluationView SSOT | trading / gate-evaluation / candidate-view-ssot |
| 0525 | Gate Debug Raw Canonical Summary Rebinding | telegram / debug-raw / canonical-projection |
| 0524 | minimumSignalScoreTrace types and scoring decomposition | refactor |
| 0523 | gate2ExternalDataProvider types and helpers decomposition | refactor |
| 0522 | regimeLearningBank analytics helper decomposition | refactor |
| 0521 | sectorEnergyMasterSupplyUnknownPolicyAdr0488 decomposition | refactor |
|------|------|--------|
| 0520 | gate1-scoring-alignment-dry-run-gating | trading / gate1 / dry-run / observation / feature-flag |
| 0519 | unified-source-snapshot | trading / data-collection / source-snapshot / feature-flag |
| 0518 | corporate-action-guard-dailybar-continuity-verification | trading / corporate-action / watchlist / dailybar-verify |
| 0517 | kis-investor-flow-supply-health-bridge | kis / supply / forensic / wiring / patch |
| 0516 | watchlist-tier-based-kis-rest-usage | trading / watchlist / kis-rest / tier-policy |
| 0515 | volume-clock-lunch-window-adr0192-alignment | trading / volume-clock / sell-only / time-window |
| 0514 | sell-only-gate-flat-row-carry-restore | supply / sell-only / gate-semantic |
| 0513 | supply-gate-semantic-unwrap-wiring | supply / gate-semantic / diagnostics |
| 0511 | kis-sector-index-daily-fetcher | kis / sector-energy / proxy-fallback / callable-only |
| 0510 | krx-first-universe-and-sector-energy-pipeline-design | design / krx-first / sector-energy / pipeline |
| 0509 | unified-gate-score-kernel-audit | telegram / unified-gate-kernel / display-only |
| 0508 | sigterm-graceful-inflight-approval-drain | telegram / shadow-approval / graceful-shutdown / runtime |
| 0507 | gate1-forensic-collector-wiring-and-gate-compact-split | telegram / scan-blockers / forensic-collector / display-only |
| 0506 | scan-blockers-compact-and-adr0505-emission-verification | telegram / scan-blockers / display-only |
| 0488 | sector-energy-master-and-supply-unknown-policy | diagnostics / sector-energy / supply-unknown |
| 0487 | fresh-data-supply-layer-foundation | diagnostics / fresh-data / supply-foundation |
| 0486 | supply-recovery-runtime-mount-verification | diagnostics / supply / runtime-mount |
| 0485 | supply-advisory-promotion-readiness-audit | diagnostics / supply / readiness-audit |
| 0484 | supply-coverage-recovery-observation | diagnostics / supply / recovery-observation |
| 0483 | supply-source-freshness-dual-clock-refresh-job | diagnostics / freshness / shadow-refresh |
| 0482 | semantic-net-buy-normalizer-implementation | diagnostics / investor-flow / semantic-normalizer |
| 0481 | naver-investor-trend-collector-wiring | diagnostics / investor-flow / shadow-only |
| 0480 | operator-action-router-remediation-queue | diagnostics / operator-action / scan-blockers |
| 0479 | scan-blockers-detail-trace-registry | scan-blockers / detail-trace / read-only |
| 0478 | scan-blockers-compact-output-policy | scan-blockers / compact-output / priority-registry |
| 0477 | investor-flow-provider-router-wiring | signalScanner / supply / provider-router |
| 0476 | gate1-near-miss-dry-run-observation-ledger | signalScanner / gate1 / observation |
| 0475 | gate1-positive-source-wiring | signalScanner / gate1 / dry-run |
| 0474 | sector-energy-indexcode-coverage-recovery | clients / sectorEnergy / dry-run |
| 0473 | supply-provider-warmup-semantic-netbuy-cache-policy | supply / signalScanner / dry-run |
| 0462 | sector-energy-ssot-fallback-contamination-gate-router | sectorEnergy / gate-router / liveness |
| 0469 | gate1-penalty-deduplication-dry-run | signalScanner / gate1 / dry-run |
| 0470 | gate1-risk-double-count-dry-run | signalScanner / risk / dry-run |
| 0472 | gate1-scoring-alignment-and-dry-run-policy-promotion | signalScanner / gate1 / dry-run |
| 0456 | dart-name-disambiguation | governance / persistence / dart / disambiguation |
| 0455 | krx-master-db-enrichment-automation | governance / persistence / krx-master |
| 0454 | sector-energy-inputs-writer-wiring | governance / silent-degradation / sectorEnergy |
| 0453 | adr-index-baseline-retrofit (commit-label only, fast-iteration) | governance / infra |
| 0452 | shadow-near-breakout-entry-liveness | signalScanner / shadow / liveness |
| 0451 | empty-scan-liveness-policy | signalScanner / liveness / empty-scan |
| 0450 | kis-ws-pre-breakout-priority-routing | signalScanner / kis-ws / priority |
| 0449 | pre-breakout-wait-liveness-policy | signalScanner / liveness / wait |
| 0448 | trading-engine-liveness-first-auxiliary-no-hard-block | sectorEnergy / liveness / r3 |
| 0447 | sector-energy-alias-registry-expansion-and-aggregate-row-filtering | sectorEnergy / observability |
| 0446 | sector-energy-recovery-phase2-and-sanity-decomposition | sectorEnergy / observability |
| 0445 | krx-investor-flow-parser-empty-rows-hardening | supply / observability |
| 0444 | static-grep-guards-hardening | infrastructure / static-checks |
| 0443 | yahoo-symbol-resolver-ssot-migration | infrastructure / adapters |
| 0442 | kis-ws-subscription-diagnostics-exposure | infrastructure / clients |
| 0441 | kis-stream-bulk-apply-priority-wiring | infrastructure / kis-stream |
| 0440 | symbol-normalizer-direct-import-migration | infrastructure / utils |
| 0439 | provisional-shadow-price-provider-cache-lookup-hardening | learning / persistence |
| 0438 | symbol-resolver-invalid-krx-code-normalization | infrastructure / utils |
| 0437 | kis-websocket-subscription-priority-queue | infrastructure / clients |
| 0436 | gate-eligibility-split | learning / trading / orchestration |
| 0435 | investor-flow-provider-recovery | data / learning / telegram |
| 0434 | counterfactual-price-provider-cache-wiring | learning / telegram |
| 0001 | signalScanner-decomposition | refactor |
| 0002 | test-colocation | infra |
| 0003 | legacy-warn-backlog | infra |
| 0004 | yahoo-adr-deprecation | data |
| 0005 | strong-buy-and-telegram-trim | trading |
| 0006 | attribution-composite-key | learning |
| 0007 | learning-feedback-loop-policy | learning |
| 0008 | kelly-time-decay-wiring | trading |
| 0009 | external-data-call-budget | data |
| 0010 | external-call-budget-hardening | data |
| 0011 | ai-recommendation-source-split | data |
| 0012 | search-page-market-context-consolidation | ui |
| 0013 | multi-source-stock-master | data |
| 0014 | kis-retry-safety-policy | trading |
| 0015 | reconciliation-source-priority | trading |
| 0016 | weekend-ai-universe-fallback | data |
| 0017 | telegram-meta-commands-stage1 | telegram |
| 0018 | self-learning-data-integrity | learning |
| 0019 | recommendation-snapshot-lifecycle | learning |
| 0020 | source-weighted-learning | learning |
| 0021 | loss-reason-tagging | learning |
| 0022 | loss-reason-weighted-learning | learning |
| 0023 | condition-profit-factor-edge-score | learning |
| 0024 | regime-memory-bank | learning |
| 0025 | loss-reason-manual-override | learning |
| 0026 | attribution-classifier | learning |
| 0027 | learning-shadow-model | learning |
| 0028 | exitEngine-decomposition | conflict ×3 |
| 0029 | condition-source-tier | conflict ×3 |
| 0030 | latent-signal-scorer | conflict ×3 |
| 0031 | last-trigger-enemy-tranche | conflict ×3 |
| 0032 | sector-rotation-heatmap | conflict ×2 |
| 0033 | candidate-pipeline-visualization | ui |
| 0034 | macro-intelligence-and-history-extensions | ui |
| 0035 | attribution-and-correlation | learning |
| 0036 | budget-policy-extraction | trading |
| 0037 | alert-router-vibration-policy | telegram |
| 0038 | private-vs-channel-separation | telegram |
| 0039 | telegram-callsite-migration | telegram |
| 0040 | macro-digest-cron | telegram |
| 0041 | weekly-self-critique-report | telegram |
| 0042 | channel-test-and-stop-countdown | telegram |
| 0043 | market-day-classifier-and-schedule-guard | infra |
| 0044 | holiday-resume-policy | trading |
| 0045 | krx-holiday-annual-audit | infra |
| 0046 | f2w-drift-detector | learning |
| 0047 | reflection-module-halflife | learning |
| 0048 | learning-coverage-heatmap | learning |
| 0049 | context-adaptive-auto-trade-layout | ui |
| 0050 | account-survival-gauge | ui |
| 0051 | invalidation-meter | ui |
| 0052 | one-decision-resolver | ui |
| 0053 | nightly-reflection-card | ui |
| 0054 | concordance-matrix | ui |
| 0055 | gate-mini-indicator | ui |
| 0056 | yahoo-probe-resilience | data |
| 0057 | fomc-policy-v4 | trading |
| 0058 | egressguard-intent-tags | data |
| 0059 | safe-pct-change-helper | infra |
| 0060 | shadow-trade-sector-persistence | trading |
| 0061 | fomc-day-liquidation | trading |
| **0062** | *(누락)* | — |
| **0063** | *(누락)* | — |
| 0064 | market-overview-prefill-overlay | data |
| 0065 | market-indicators-snapshot-resilience | data |
| 0066 | market-overview-swr-cache | data |
| 0067 | marketoverview-boundary-guard | conflict ×2 |
| 0068 | macrostate-stale-block | conflict ×2 |
| 0069 | x-field-stale-ui-badge | ui |
| 0070 | market-data-health-score | data |
| 0071 | cross-source-data-validation | data |
| 0072 | entry-circuit-breaker | trading |
| 0073 | regime-holding-period-shortening | trading |
| 0074 | regime-message-live-regime-line | telegram |
| 0075 | sector-score-boost | trading |
| 0076 | fomc-regime-kelly-precedence | trading |
| 0077 | trade-signal-status-state-machine | trading |
| 0078 | enemy-auto-block | trading |
| 0079 | atr-buffered-bep-glide | trading |
| 0080 | capital-weighted-slot-accounting | trading |
| 0081 | preorder-guard-final-gate-ssot | trading |
| 0082 | yahoo-range-restriction-policy | data |
| 0083 | walk-forward-framework-extension | learning |
| 0084 | condition-lifecycle-status-policy | learning |
| 0085 | two-bar-confirmation-and-slot-sizing | trading |
| 0086 | shadow-walk-forward-framework | learning |
| 0087 | shadow-condition-attribution | learning |
| 0088 | shadow-learning-dashboard | ui |
| **0089** | *(누락)* | — |
| 0090 | cache-coherence-auditor | infra |
| 0091 | yahoo-stale-base-fallback | data |
| 0092 | channel-sell-cumulative-remaining-qty | telegram |
| 0093 | gating-alert-dedupe | telegram |
| 0094 | ui-language-ssot | ui |
| 0095 | data-quality-5tier-auto-ladder | ui |
| 0096 | idontknow-and-data-quality-ribbon | ui |
| 0097 | verdict-card-and-time-band | ui |
| 0098 | confluence-meter-and-axis-reason | ui |
| 0099 | ui-verbosity-toggle | ui |
| 0100 | ui-verbosity-toggle-embed | ui |
| 0101 | verdict-card-verbosity-wiring | ui |
| 0102 | confluence-meter-verbosity-wiring | ui |
| 0103 | ribbon-idontknow-verbosity-wiring | ui |
| 0104 | gating-alert-window-and-fomc-liquidation-label | telegram |
| **0105** | *(누락)* | — |
| **0106** | *(누락)* | — |
| 0107 | mhs-axis-and-gate-zero-context | trading |
| 0108 | operator-noise-reduction | telegram |
| 0109 | data-quality-badge-verbosity-wiring | ui |
| 0110 | gate-status-card-verbosity-wiring | ui |
| 0111 | circuit-breaker-baseline-reset | trading |
| 0112 | breakeven-classification-and-circuit-isolation | trading |
| 0113 | yahoo-drift-tiered-sanity-and-corporate-action-detector | data |
| 0114 | data-trust-layer-policy | data |
| 0115 | entry-price-immutable-and-execution-relaxation | trading |
| 0116 | raw-adjusted-price-and-gate3-relaxation-wiring | trading |
| 0117 | sanity-trade-block-gate | data |
| 0118 | scan-blockers-diagnostic-infrastructure | trading |
| 0119 | empty-scan-reason-classification | trading |
| 0120 | gate-pass-counters-and-r3-sanity | trading |
| 0121 | price-source-policy | data |
| 0122 | sector-energy-krx-matching-and-data-quality | trading |
| 0123 | be-isolation-in-learning-and-reports | learning |
| 0124 | regime-coverage-suggest-false-positive | conflict ×2 |
| 0125 | sector-energy-data-quality-wiring | trading |
| 0126 | price-source-policy-execution-wiring | trading |
| 0127 | scan-summary-sector-energy-quality | trading |
| 0128 | data-verification-timing-and-data-hold-state-machine | data |
| 0129 | mdd-ssot-be-narrative-macro-gate-wiring | learning |
| 0130 | cumulative-reflection-context | learning |
| 0131 | self-health-check-loop | infra |
| 0132 | edge-trigger-scheduler-logging-and-holiday-enter-alert | infra |
| 0133 | file-complexity-gate-integrity | infra |
| 0134 | persymbol-evaluation-decomposition | refactor |
| 0135 | kisclient-decomposition | refactor |
| 0136 | fss-records-age-diagnostic-and-passive-active-null | data |
| 0137 | kis-stock-program-trade-today | data |
| 0138 | kis-market-program-trade | data |
| 0139 | ecos-margin-balance-5d-change | data |
| 0140 | naver-foreigner-ratio-trend | data |
| 0141 | fss-investor-detail-fetcher | data |
| 0142 | fss-passive-active-mapping | data |
| **0143** | *(누락)* | — |
| 0144 | kis-program-trade-endpoint-correction | data |
| 0145 | diagnose-short-macro-state | telegram |
| 0146 | pr-pace-audit-rule | governance |
| 0146 | telegram-sanity-unlock-cmd | telegram |
| 0147 | kis-token-disk-persistence | infra |
| 0147 | signalScanner-orchestration-migration | refactor |
| 0148 | governance-followup-static-checks | governance |
| 0149 | condition-mapping-fix | learning |
| 0150 | phase1-dart-finalize | learning |
| 0151 | phase2-kis-supply-audit | learning |
| 0152 | naver-foreigner-trend-endpoint | learning |
| 0153 | phase3-globalintel-synthesis | learning |
| 0154 | phase4-closeout-and-residual-policy | learning |
| 0155 | krx-investor-trend-endpoint | learning |
| 0156 | yahoo-consensus-endpoint | learning |
| 0157 | feedback-loop-now-injection | learning |
| 0158 | wiring-sla-auto-expiry | governance |
| 0159 | adr-alias-diaspora | governance |
| 0160 | reflection-signal-routing | learning |
| 0161 | position-sizing-engine-tier-based | trading |
| 0162 | position-sizing-engine-shadow-apply | trading |
| 0163 | position-sizing-engine-extension-3-paths | trading |
| 0164 | peak-equity-tracking | trading |
| 0165 | position-sizing-engine-live-activation | trading |
| 0166 | regime-exposure-budget | trading |
| 0167 | current-equity-exposure-accurate | trading |
| 0168 | kelly-clamp-ssot | trading |
| 0168 | emergency-data-quality-circuit-breaker | data |
| 0169 | tranche-executor-exposure-budget-wiring | trading |
| 0170 | exposure-regime-auto-mapping | trading |
| 0171 | sizing-exposure-budget-verbose-log | trading |
| 0172 | sizing-engine-liquidity-sector-real-data | trading |
| 0173 | shadow-learning-on-blocked-days | trading |
| 0174 | safety-gate-attribution-and-shadow-live-delta | learning |
| 0175 | future-return-resolver-cron | learning |
| 0176 | missed-learning-queue-cron-wiring | learning |
| 0177 | learning-sanity-dashboard-endpoint | learning |
| 0178 | learning-sanity-dashboard-ui | learning |
| 0179 | missed-learning-queue-stats-card | learning |
| 0180 | rejected-winners-card | learning |
| 0181 | stale-reflections-card | learning |
| 0182 | unresolved-counterfactuals-card | learning |
| 0183 | shadow-learning-blocked-day-wiring | trading |
| 0184 | emergency-data-quality-guards-wiring-phase-a | dataQuality |
| 0185 | emergency-data-quality-guards-wiring-phase-b | dataQuality |
| 0186 | order-type-optimizer-wiring-phase-1 | trading |
| 0187 | macro-state-dead-read-wiring | persistence |
| 0188 | lint-baseline-cleanup | quality |
| 0189 | premarket-gap-probe-krx-calendar | trading |
| 0190 | safe-pct-change-krx-calendar | trading |
| 0191 | position-truth-ssot-and-shadow-mode-header | persistence |
| 0192 | trade-window-policy-update | trading |
| 0193 | block-new-buy-manage-only-symmetric-coupling | trading |
| 0194 | telegram-block-guard-commands | telegram |
| 0195 | r3-sanity-block-telegram-unblock | telegram |
| 0211 | gate-evaluation-fallback (commit-label only, fast-iteration) | trading |
| 0221 | kis-prevclose-priority (commit-label only, fast-iteration) | trading |
| 0231 | krx-master-symbol-resolver-ssot (commit-label only, fast-iteration) | trading |
| 0234 | yahoo-meta-symbol-validation (commit-label only, fast-iteration) | trading |
| 0235 | yahoo-close-timestamps-stale (commit-label only, fast-iteration) | trading |
| 0237 | volumeclock-blocked-empty-scan (commit-label only, fast-iteration) | orchestrator |
| 0241 | yahoo-sanity-aware-fallback (commit-label only, fast-iteration) | trading |
| 0242 | stockmaster-auto-enrichment (commit-label only, fast-iteration) | data |
| 0245 | stockmaster-integrity-check (commit-label only, fast-iteration) | data |
| 0248 | watchlist-diversity-monitor (commit-label only, fast-iteration) | learning |
| 0249 | global-yahoo-symbol-ssot-api (commit-label only, fast-iteration) | trading |
| 0250 | user-diagnostic-hints-ledger (commit-label only, fast-iteration) | learning |
| 0251 | krx-off-hours-counter-isolation (commit-label only, fast-iteration) | clients |
| 0252 | krx-business-day-grace-extension (commit-label only, fast-iteration) | utils |
| 0255 | yahoo-freshness-ledger (commit-label only, fast-iteration) | persistence |
| 0256 | krx-time-window-gating (commit-label only, fast-iteration) | clients |
| 0258 | health-full-diagnostic-command (commit-label only, fast-iteration) | telegram |
| 0259 | krx-cooldown-probe-mode (commit-label only, fast-iteration) | clients |
| 0260 | defect-evolution-ledger (commit-label only, fast-iteration) | learning |
| 0323 | gate-pass-rate-sla | learning |
| 0324 | gate-contribution-analyzer | learning |
| 0325 | gate-threshold-auto-tuning | learning |
| 0329 | persona-balance-ledger | learning |
| 0341 | krx-trading-calendar-wiring | clients |
| 0342 | krx-empty-response-auto-retry | clients |
| 0343 | sector-energy-cache-fallback | clients |
| 0364 | sector-energy-yahoo-etf-fallback | clients |
| 0370 | sector-energy-hardening-phase-1 | clients |
| 0387 | condition-eval-status-data-unavailable | quant/conditions |
| 0388 | condition-eval-status-error-isolation | quant/conditions |
| 0389 | evaluator-status-migration-and-gate-audit-extension | quant/conditions |
| 0390 | five-evaluator-status-migration | quant/conditions |
| 0391 | p0a-mode-observability | telegram |
| 0392 | p0b-trading-mode-ssot | trading |
| 0393 | p1-execution-mode-and-shadow-ledger | state |
| 0394 | p1.5-execution-terminology-ssot (commit-label only, fast-iteration) | types |
| 0395 | p2-persistent-execution-mode-override | persistence |
| 0396 | sector-energy-dataquality-decomposition | clients |
| 0397 | sector-energy-yahoo-etf-fallback-wiring | clients |
| 0398 | sector-energy-strong-buy-confidence-gate | trading |
| 0399 | sector-energy-source-restoration | clients |
| 0400 | wire-sector-energy-strong-buy-gate | trading |
| 0401 | r3-sanity-violation-state-machine | trading |
| 0411 | evaluator-provider-degraded-and-kis-recovery | trading |
| 0412 | frozen-quote-detector-and-holiday-r3-streak-guard | trading |
| 0413 | stock-master-evening-cron | scheduler |
| 0415 | sector-energy-stale-partial-volume-strong-buy-gate | trading |
| 0414 | price-integrity-correction-overlay-readonly | trading |
| 0416 | evaluator-status-supply-earnings-data-unavailable | quant/conditions |
| 0417 | postmortem-action-taxonomy-split | orchestrator |
| 0418 | evaluator-data-availability-metadata-automation | quant/conditions |
| 0419 | r3-sanity-streak-excludes-sell-only-volume-clock | trading |

| 0420 | fresh-scan-blocker-attribution | trading |

| 0421 | investor-flow-semantic-availability | supply / quant/conditions |

| 0433 | counterfactual-universe-learning-preflight | learning / telegram |
| 0432 | shadow-learning-promotion-recommendations | learning / telegram |

| 0431 | counterfactual-shadow-performance-report | learning / telegram |

| 0430 | counterfactual-shadow-learning-under-sell-only | trading / persistence |

| 0429 | wire-provisional-shadow-price-provider | learning / telegram |

| 0428 | provisional-shadow-performance-report | learning / telegram |

| 0427 | wire-r3-provisional-shadow-ledger | persistence / trading |

| 0426 | r3-provisional-shadow-lane | trading |

| 0425 | gate-decision-router | trading |

| 0424 | sector-indexcode-provider-repair | clients |

| 0423 | sector-energy-data-truth-repair | clients / trading |

| 0422 | gate2-leadership-attribution | trading |

| 0489 | adr-merge-conflict-resolution-guard | governance |
| 0490 | program-trading-data-line | trading |
| 0491 | supply-snapshot-store-replay | trading |
| 0492 | adr-merge-conflict-resolution-branch | governance |
| 0493 | data-promotion-readiness-audit | trading |
| 0494 | fresh-data-promotion-audit-wiring | trading |
| 0495 | sector-index-master-seed-mapping-repair | trading |
| 0496 | investor-flow-sample-seed-semantic-netbuy-normalization | trading |
| 0497 | diagnostic-taxonomy-gate-failure-attribution-ssot | trading |
| 0498 | fresh-data-status-view-model-wiring | trading |
| 0499 | provider-health-market-signal-classifier-migration | trading |
| 0500 | empty-scan-root-cause-dashboard | diagnostics |
| 0501 | weekend-replay-gate-failure-cause | diagnostics |
| 0502 | krxclient-decomposition | refactor |
| 0503 | kis-official-supply-pack-until-krx-recovery | supply |
| 0504 | position-card-source-validation | telegram |
| 0505 | gate1-minimum-signal-forensic-audit | diagnostics |
| 0619 | shadow-only-entry-liberalization-gate1-gate3 | trading / learning |
| 0620 | provisional-shadow-entry-price-measurement-wiring | learning / persistence |
| 0621 | gate2-rs-benchmark-dualization-kosdaq | quant / gate2 |
| 0622 | universe-discovery-aggressiveness-topn-rs-percentile | policy / screener |
| 0623 | price-correction-stage2-shadow-activation | trading / diagnostics |
| 0624 | shadow-always-on-by-default-operator-decision-removal | policy / shadow / learning |
| 0625 | shakeout-stoploss-forward-outcome-labeler | learning / persistence |
| 0626 | shakeout-initial-loss-twobar-shadow | trading / exit |
| 0627 | gate1-rs-percentile-continuous-and-breakout-ohlcv-field-fix | trading / gate1-scoring |
| 0628 | intraday-leader-universe-freshness | screener / orchestrator |
| 0629 | intraday-mover-candidate-pool-wiring | signalScanner / candidate-pool |
| 0630 | buy-gate-canonical-regime-unification-and-r6-recovery-stuck-exit | regime / signalScanner |
| 0631 | shadow-to-live-promotion-readiness-diagnostic-and-safe-procedure | promotion-readiness / diagnostics |
| 0632 | counterfactual-snapshot-capture | learning / persistence+signalScanner |
| 0633 | self-validation-auto-activation-engine | trading / self-activation+diagnostics |
| 0634 | self-validation-auto-activation-runtime-wiring | scheduler / self-activation+persistence |
| 0635 | self-validation-registry-expansion-t1-measurement | trading / self-activation registry+criteria type |
| 0637 | provisional-shadow-intraday-horizon-observed-eligibility | learning |
| 0638 | leader-pipeline-funnel-observation | screener |
| 0639 | leader-universe-intraday-refresh | screener / scheduler |
| 0640 | gate1-denominator-normalization | trading / gate1-scoring |
| 0641 | gate-flag-lifecycle-governance | governance / flag-lifecycle (meta) |
| 0642 | dxy-cross-validation-contradicted-classification | alerts / macro-dxy |
| 0643 | gate1-positive-max-normalization-flag-split | trading / gate1-scoring |
| 0644 | gate1-safe-lever-default-on-flip | trading / gate1-scoring |
| 0645 | gate1-sector-rs-component-default-on-flip | trading / gate1-scoring |
| 0646 | gate1-volume-liquidity-wiring | trading / gate1-scoring |
| 0647 | gate1-volume-liquidity-wiring-default-on-flip | trading / gate1-scoring |
| 0648 | pullback-entry-lane-overheat-guard-rrr-first | trading / gate-entry-lane |
| 0649 | pullback-entry-lane-default-on-flip | trading / gate-entry-lane |
| 0650 | pullback-lane-forward-return-observation | learning / observation+persistence+telegram |
| 0651 | leader-ranking-404-root-fix | provider / kis-ranking+diagnostic+circuit-isolation |
| 0652 | leader-screener-ranking-endpoint-fix | provider / kis-ranking endpoint-string-fix |
| 0655 | gate2-financial-risk-penalty | gate2 / fundamental-quality score-cap (ICR<1·debtRatio>200%) |
| 0656 | gate2-financial-risk-penalty-default-on-flip | gate2 / fundamental-quality score-cap default OFF→ON flip |
| 0657 | intraday-mover-candidate-source-default-on-flip | candidate-pool / intraday-mover source default OFF→ON flip |
| 0658 | risk-designation-entry-exclusion | trading / risk-warning designation entry candidate exclusion |
| 0659 | fundamental-deep-junk-floor-entry-exclusion | trading / ROE deep-junk floor entry candidate exclusion |
| 0660 | rrr-collapse-min-profit-guard | trading / exit — RRR 붕괴 부분익절 최소 수익률 가드 |
| 0661 | gate3-entry-price-live-restamp | trading / gate3 — 재검증 fresh 현재가·priceAsOf 각인 (false-STALE 해소) |
| 0662 | dart-gate2-eval-fetch-unification | gate2 / dart-provider — 평가 경로 fetch 모듈 B 통일 + 단위 계약(ocfRatio%/ocfToNi배/icr배) + 배치 스로틀 |
| 0663 | regime-transition-notice-anti-oscillation | regime notification (구 0640 재발급 — main 병렬 발급 충돌 해소) |
| 0664 | regime-value-hysteresis | regime value stabilization (구 0641 재발급 — main 병렬 발급 충돌 해소) |
| 0665 | entry-sizing-single-path | 진입 수량·노출 계산 경로 통일 및 비활성 Kelly 호출 제거 |
| 0666 | shadow-first-experiments | 레짐·Kelly·Gate·승인 제약 없는 기본 Shadow 기준 실험 |
| 0667 | news-trend-shadow-strategy | 기준 실험 성과로 조건부 Shadow 진입과 사전 고정 예약 종가 청산 실행 |
| 0668 | archived-data-shadow-research | 저장 가격·뉴스 보존, 과거 재현과 후반 검증, Shadow 초기 근거 연결 |
| 0669 | shadow-feature-research | OHLCV·시장 지수로 7개 조건 독립 연구, 후반 대조군 비교, 총점·레짐 제한 없음 |
| 0670 | shadow-workspace-ui | 5개 화면으로 탐색 통합, 요약 API·상세 지연 로딩·활성 화면 조회, 브라우저 캐시 직렬화 제거 |
| 0671 | shadow-telegram-bot | 중복 정기 보고 제거, 새 Shadow 요약·변화 알림, 전송 원장·재시도·현재 봇 메뉴 |
| 0672 | shadow-signal-learning-channels | Shadow 진입·청산 시그널 유지, 고정 학습 근거·성과와 4채널 연결, 목적지별 재시도 |
| 0673 | retire-runtime-regime | LIVE/PAPER 레짐·Kelly 제거·원자료·시그널·학습 보존 |

**최대 발급 0664 · 다음 발급 0665** — `node scripts/check_adr_index.js --json` 기준 (2026-07-13 실측·validate:adrIndex). 카운트 SSOT = `validate:adrIndex`, 충돌·누락 분류는 위 §"알려진 충돌"·§"누락".

## 후속 PR — 자동 충돌 검사 정적 스크립트

본 인덱스 갱신 누락 차단을 위해 후속 PR 에서 `scripts/check_adr_index.js` 신규 — `docs/adr/*.md` 파일 시스템 vs INDEX.md §"전체 인덱스" 표 정합 검증 + `validate:all` 통합. 본 PR 은 인프라 수동 작성만, 자동 검사는 별도 PR 분리 (회귀 위험 격리).
