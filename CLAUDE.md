# QuantMaster Pro

## 프로젝트 개요

AI 기반 한국 주식 퀀트 트레이딩 시스템. 27개 조건 + 4단계 Gate 필터를 통과한
종목에만 신호를 출력하며, KIS API로 실제 주문을 집행한다.

핵심 참조 문서:
- 요구사항·도메인: `README.md`
- 모듈 경계: `ARCHITECTURE.md`
- 운영·인시던트: `docs/incident-playbook.md`
- 환경/비밀 분리: `.env.example`
- 품질 게이트: `npm run validate:all`, `npm run precommit`

디렉토리 구조 요지:
- `src/` — 프론트엔드 + 공유 타입·서비스 (Vite + React 19 + Zustand + TanStack Query)
- `server/` — Express 기반 백엔드 (KIS 클라이언트, 트레이딩 엔진, 스크리너, 텔레그램)
- `scripts/` — 자체 검증 파이프라인 (complexity/responsibility/exposure/sds/gemini)
- `docs/` — 인시던트 플레이북, ADR

## 하네스: QuantMaster Harness

**트리거:** 매매 엔진 / 퀀트 필터(Gate 0~3) / 대시보드 / 변곡점 모듈(THS/VDA/FSS/IPS) /
서버 리팩토링 관련 작업 요청 시 `.claude/skills/quantmaster-orchestrator` 스킬을 사용하라.

추가 전용 스킬:
- `.claude/skills/server-refactor-orchestrator` — 1,000줄 이상 서버 파일 분해 전용
- `.claude/skills/incident-responder` — Telegram/로그 인시던트 진단 전용

**단순 질문은 직접 응답 가능.** (예: "이 함수가 뭐야?", "타입 오류 한 줄 수정")
**복잡 작업은 하네스 필수.** (예: "새 Gate 조건 추가", "signalScanner 분해", "webhookHandler 재설계")

## 에이전트 팀 (4인)

| 역할 | 담당 영역 | DoD |
|------|-----------|------|
| `architect` | `ARCHITECTURE.md` 경계 설계, `src/types/`, ADR 작성 | `npm run validate:responsibility` 통과 |
| `engine-dev` | `server/trading/*`, `server/clients/kisClient.ts`, `server/quant*`, `src/services/quant*` | `npm run lint` + 해당 `*.test.ts` 통과 |
| `dashboard-dev` | `src/pages/*`, `src/components/*`, `src/hooks/*`, Zustand 스토어 | `npm run validate:complexity` 통과 |
| `quality-guard` | QA + 보안 + 경계면 교차 비교 | `npm run validate:all` 전체 통과 |

보안/이상감지는 `scripts/scan_exposure.js`, `scripts/silent_degradation_sentinel.js`가 이미
기계 에이전트로 동작 중이므로 AI 에이전트는 조율·해석·수정 위임에 집중한다.

## 절대 규칙

1. **@responsibility 태그 의무**: 모든 새 파일은 상단 20줄 내 25단어 이내 책임 명시
   (`scripts/check_responsibility.js`로 강제).
2. **kisClient 단일 통로**: KIS API 호출은 `server/clients/kisClient.ts` 경유만 허용.
   다른 모듈은 raw KIS REST 호출 금지.
3. **stockService 단일 통로**: 외부 데이터(Yahoo/DART/Gemini/KIS 프록시) 페칭은
   `src/services/stockService.ts`에서만 시작한다.
4. **autoTradeEngine 단일 통로**: `AUTO_TRADE_ENABLED=true` 상태에서 실주문은
   서버 측 `autoTradeEngine`만 집행한다. 클라이언트는 실주문 금지.
5. **ARCHITECTURE.md 경계 준수**: 수정 전 해당 모듈의 Single Responsibility 재확인.
6. **복잡도 한계**: 파일당 1,500줄, 함수당 한계는 `scripts/check_complexity.js` 기준.
   초과 시 즉시 분할.
7. **커밋 전**: `npm run precommit` 필수 통과. 훅 우회(`--no-verify`) 금지.

## 기존 복잡도 위반 (리팩토링 우선순위)

하네스 도입 시점 기준 1,000줄 초과 서버 파일:

| 파일 | 줄 수 | 우선순위 |
|------|------:|----------|
| `server/trading/signalScanner.ts` | 1,820 | P0 — 변동성 최대 지점 |
| `server/telegram/webhookHandler.ts` | 1,700 | P1 |
| `server/screener/stockScreener.ts` | 1,571 | P1 |
| `server/trading/exitEngine.ts` | 1,233 | P2 |

분해 설계는 `docs/adr/` 에 ADR로 선행 기록 후 `server-refactor-orchestrator` 스킬로 진행한다.

## 검증 파이프라인 요약

| 스크립트 | 검사 항목 |
|----------|-----------|
| `npm run validate:gemini` | Gemini 호출 규약 위반 탐지 |
| `npm run validate:complexity` | 파일·함수 복잡도 임계 초과 탐지 |
| `npm run validate:sds` | Silent Degradation(조용한 성능 저하) 패턴 탐지 |
| `npm run validate:exposure` | 비밀·토큰 노출 스캔 |
| `npm run validate:responsibility` | `@responsibility` 태그 존재·길이 검사 |
| `npm run lint` | `tsc --noEmit` (클라 + 서버 tsconfig 각각) |
| `npm run precommit` | 배포창 + 노출(증분) + 복잡도 + 책임(변경분) + Gemini + lint |

## 하네스 사용 워크플로 (요약)

1. 사용자 요청 → 본 문서의 "트리거" 판정
2. 해당 스킬 호출 → `_workspace/{YYYY-MM-DD}_{task}/` 생성
3. `architect` → (`engine-dev` ∥ `dashboard-dev`) → `quality-guard` 순서로 위임
4. 통합 검증(Phase 4): `npm run lint` → `npm run validate:all` → 해당 테스트 → 교차 비교 → `npm run precommit`
5. Phase 5: CLAUDE.md 하단 "변경 이력"에 한 줄 추가 → 의미 있는 커밋 메시지 작성

상세는 `.claude/skills/quantmaster-orchestrator/SKILL.md` 참조.

## 변경 이력

| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-04-23 | 하네스 신규 구축 (CLAUDE.md + agents/skills) | `.claude/`, `CLAUDE.md` | AI 조율 레이어 도입 |
| 2026-04-23 | ADR 0001~0003 + ARCHITECTURE.md 분해 예고 | `docs/adr/`, `ARCHITECTURE.md` | 대형 파일 분해 설계·테스트 co-location·WARN 백로그 정책 |
| 2026-04-23 | learningJobs.ts @responsibility 27→24단어 축약 | `server/scheduler/learningJobs.ts` | ADR-0003 P0 즉시 해소 |
| 2026-04-24 | PR-1 자금·장부 안전 가드 (#7 동시호가 Full 가드, #10 Shadow 집계 SSOT + [SHADOW] 뱃지, #4 Yahoo ADR 비활성 + ADR-0004, #5 KIS 전일종가 기반 preMarketGapProbe) | `server/orchestrator/tradingOrchestrator.ts`, `server/persistence/shadowTradeRepo.ts`, `server/telegram/webhookHandler.ts`, `server/alerts/adrGapCalculator.ts` (stub), `server/clients/kisClient.ts` (+fetchKisPrevClose), `server/trading/preMarketGapProbe.ts` (신규), `docs/adr/0004-yahoo-adr-deprecation.md` (신규) | 동시호가 Full 오발주·Shadow 0건 버그·Yahoo OTC 이론시가 괴리 해소 |
| 2026-04-24 | PR-2 관심종목 서버 동기화 + UI API 회복력 (#1 user-watchlist CRUD, #2 TanStack retry/onError + ScreenerPage useQuery 전환) | `server/persistence/userWatchlistRepo.ts` (신규), `server/routes/userWatchlistRouter.ts` (신규), `src/hooks/useWatchlistSync.ts` (신규), `src/components/common/QueryProvider.tsx`, `src/api/autoTradeClient.ts` | 기기 간 관심종목 일치 + API 실패 시 UI 깨짐 방지 |
| 2026-04-24 | PR-3 운영·효율 (#8 섹션 하드캡 trim, #9 /reconcile push + 16:05 KST 드라이런 브로드캐스트, #6 Gemini 재시도 2→3·백오프 상향, #3 canonical 캐시키) | `server/persistence/watchlistRepo.ts`, `server/scheduler/maintenanceJobs.ts`, `server/telegram/webhookHandler.ts`, `server/clients/geminiClient.ts`, `server/persistence/aiCacheRepo.ts` | watchlist 91개 폭증·수동 /reconcile 누락·Gemini fallback 반복·캐시 미스 해소 |
| 2026-04-24 | PR-4 경계 위생 (A emergency.ts raw fetch 제거 → kisGet/kisPost, B regime-change dedupeKey up/down 분리, C Yahoo KOSPI 호출 재분류 및 ADR-0004 scope 명시) | `server/emergency.ts`, `server/trading/regimeBridge.ts`, `docs/adr/0004-yahoo-adr-deprecation.md` | kisClient 단일 통로 규칙 준수, up/down 알림 덮어쓰기 방지, 후속 과제 경계 명문화 |
| 2026-04-24 | PR-5 Shadow 계좌 독립 원장 분리 (#11 signalScanner · preMarketOrderPrep 가 SHADOW 모드에서는 computeShadowAccount 사용, LIVE 모드에서만 fetchAccountBalance) | `server/trading/signalScanner.ts`, `server/orchestrator/tradingOrchestrator.ts`, `server/persistence/shadowAccountRepo.test.ts` (신규) | SHADOW 로그·사이징·자산표기가 실계좌 잔고와 섞이던 문제 해소 |
| 2026-04-24 | PR-6 exitEngine 동시 실행 가드 (#12 orchestratorJobs vs shadowResolverJob 5분 overlap 시 `updateShadowResults` 중복 진입 차단 mutex) | `server/trading/exitEngine.ts`, `server/trading/exitEngineMutex.test.ts` (신규) | L3 분할 익절·원금보호 알림이 텔레그램에 2번 송출되며 "잔여: 60주" 가 두 번 보이던 문제 해소 |
| 2026-04-24 | PR-7 SHADOW BUY fill 기록 (#13 PENDING→ACTIVE 전환 시 `appendFill(BUY)`; 기존 trade 부팅·tick 시작부 idempotent 백필) | `server/persistence/shadowTradeRepo.ts` (+`backfillShadowBuyFills`), `server/trading/exitEngine.ts`, `server/index.ts`, `server/persistence/shadowBuyFillBackfill.test.ts` (신규) | SHADOW 부분 매도 후 잔량이 갱신되지 않던 고질 원인(BUY fill 부재로 인한 `syncPositionCache` no-op) 해소 |
| 2026-04-24 | PR-8 /pnl realized+unrealized 분리 표시 (부분매도 누적 실현손익 + 잔량 평가손익 + 총 수익률 동시 표시) | `server/telegram/webhookHandler.ts` | 기존 /pnl 이 unrealized 만 표시해 부분매도 누적 수익이 안 보이던 혼란 해소 |
| 2026-04-24 | PR-9 텔레그램 거래 요약 정상화 (① 리포트 P&L `returnPct→getWeightedPnlPct` fills SSOT 전환 + KST 일자 필터, ② 12:30 정오 점검 섹션 헤더 하드코딩 시간 제거 → unifiedBriefing 단일 타임스탬프, ③ `TELEGRAM_CHANNEL_ID→TELEGRAM_CHAT_ID` 단일 변수 통합 + 브로드캐스트 중복 송신 제거) | `server/alerts/reportGenerator.ts`, `server/alerts/telegramClient.ts`, `server/alerts/alertRouter.ts`, `server/alerts/channelPipeline.ts`, `server/alerts/scanReviewReport.ts`, `server/telegram/webhookHandler.ts` | 일일/정오/장마감 리포트가 신호·결산·P&L 0 으로 표시되던 버그, 한 메시지에 11:30/12:00 시간대 중복 표기, 단일 chat 환경에서 TELEGRAM_CHANNEL_ID 미설정으로 채널 알림 스킵되던 문제 해소 |
| 2026-04-24 | PR-10 DxyIntraday Yahoo 실패 해소 (① `fetchYahooIntradayBars` DXY 호출 range `1d→5d` 로 US 비장중/주말 빈 봉 방어, ② `fetchAvSyntheticDxy` Promise.all→순차 12초 간격 + `ALPHA_VANTAGE_API_KEY` 미설정 시 네트워크 호출 없이 null, ③ `runDxyIntradayMonitor` "모두 실패" 로그를 AV 미설정 시 warn→info 로 다운그레이드, ④ cron 시간대 의도 주석 정리) | `server/alerts/dxyIntradayClient.ts`, `server/alerts/dxyMonitor.ts`, `server/scheduler/alertJobs.ts` | KST 점심(UTC 00~05) cron 에서 Yahoo 1일봉 부족 + AV 동시 6콜 rate-limit 겹쳐 매 5분마다 빨간 "데이터 소스 모두 실패" WARN 이 찍히던 문제 해소 |
| 2026-04-24 | PR-11 장중 매수 경로 반응속도 개선 (① `requestImmediateRescan()` 훅 신설 + `exitEngine` HIT_TARGET/HIT_STOP 전이 시 호출 → 청산 즉시 다음 tick 재스캔, ② `decideScan` 의 maxPositions 를 `signalScanner` 와 동일한 `min(MAX_CONVICTION_POSITIONS, regimeConfig.maxPositions)` 로 정합 + INTRADAY·PRE_BREAKOUT 제외 카운트 일치, ③ `positionAdj` 양방향 보상: ≤50% 점유 시 -1분 가속, ④ 13:00 점심 차단 해제 감지 후 1회 강제 스캔) | `server/orchestrator/adaptiveScanScheduler.ts`, `server/trading/exitEngine.ts` | 익절·손절 직후 빈 슬롯이 최대 10분 방치되던 지연, 스케줄러와 스캐너의 슬롯 한도 불일치, 슬롯 여유 구간에서 재스캔 주기가 관성 유지, 13:00 재개 직후 5분 대기 문제 해소 |
| 2026-04-24 | PR-12 AI 추천·SHADOW STRONG_BUY·Telegram trim 정비 (ADR-0005: ① `generatePreMortem` 응답 sanitize 추가 — Gemini 페르소나 서문 제거 + 번호항목 3개 추출 + 600자 상한, ② `stopLossTransparencyReport` `extractPreMortemLines` 로 번호/하이픈 필터 적용, ③ `CHANNEL_SEPARATOR` 20→16 자 축소로 모바일 wrap 해소, ④ `computeShadowMonthlyStats` 에 STRONG_BUY fallback — profileType A/B + RRR≥3 + R1/R2/R3 강세 레짐 조건으로 레거시 trade 복원, ⑤ `momentumRecommendations` 프롬프트의 STRONG_BUY 기준을 서버 Gate Score≥9/RRR≥3/강세 레짐으로 명시 정렬) | `server/alerts/channelFormatter.ts` + 26개 separator 일괄, `server/alerts/stopLossTransparencyReport.ts`, `server/trading/entryEngine.ts`, `server/trading/sanitizePreMortem.test.ts` (신규), `server/persistence/shadowTradeRepo.ts` (+`isStrongBuyTrade`), `server/persistence/shadowTradeRepo.test.ts` (+ADR-0005 케이스), `src/services/stock/momentumRecommendations.ts`, `docs/adr/0005-strong-buy-and-telegram-trim.md` (신규) | 손절 투명 리포트 Pre-Mortem 본문 "Gate 2" 뒤 잘림·구분선 모바일 2줄 wrap·[SHADOW] STRONG_BUY WIN 0.0% 고착·AI 추천 경로가 자동매매 Gate 기준과 동기화 안 되던 문제 해소 |
