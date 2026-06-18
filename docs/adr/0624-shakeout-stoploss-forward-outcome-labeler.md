# ADR-0624 — Shakeout Stop-Loss Forward Outcome Labeler (관측 전용)

- **Status**: Proposed (Phase 0 — 경계·타입·ADR. ENV default OFF byte-equivalent. 구현 engine-dev.)
- **Date**: 2026-06-18
- **Authors**: engine-dev (architect 설계 SSOT `_workspace/2026-06-18_shakeout-DA-package/architect/design.md` §1 직접 반영)
- **Series**: 진단 `_workspace/2026-06-18_shakeout-stoploss-diagnosis/diagnosis.md` 옵션 D. `futureReturnResolver`(ADR-0175) priceFetcher 주입 패턴 계승.

## 핵심 문장

> *"실행 포지션이 HIT_STOP 으로 청산된 뒤 종목이 급등(=셰이크아웃)했는지를 KIS 일봉(L1, read-only) 으로 추적·라벨링한다. shadow-trades.json 무수정·별도 ledger 영속. 매매 본체 0줄. 기본 OFF."*

## 배경

실행 포지션이 HIT_STOP 으로 청산된 뒤 종목이 급등(=셰이크아웃)했는지를 시스템이 정량 학습하지 못한다 (진단 Q4·근본원인 #6). 기존 `futureReturnResolver`(ADR-0175)는 대상이 **shadow-learning-only signal**(미실행 학습 신호)이라 실행 청산 포지션에 안 닿는다. `gate3ForwardReturnCron` 도 대상이 Gate3 outcome seed 이지 청산 포지션이 아니다. "이런 종목이 너무 많음"을 데이터로 확인할 경로가 부재했다.

## 결정

1. **신규 관측 모듈** `server/learning/shakeoutStopForwardLabeler.ts` 신설.
   - 대상: `loadShadowTrades()` 중 `status==='HIT_STOP'` && `exitTime` 존재 && `exitOutcome!=='BE'` (BE=PROFIT_PROTECTION 본절은 셰이크아웃 관심사 아님 — ADR-0112). `exitPrice` positive-finite 추가 가드.
   - horizon: **1/3/5/10 영업일** (청산일 `exitTime` KST 기준 + N 영업일).
   - 각 horizon 종가 추적 → 청산가 대비 최대 회복률(`maxRecoveryPct`) 산출.
2. **priceFetcher 주입 seam** — 외부 fetch 는 **KIS 일봉 L1 read-only 만**. 기존 `fetchHistoricalClosePrice(symbol, asOf)`(KIS primary + Yahoo fallback, ADR-0561 준수)를 cron 호출자가 주입. 미전달 시 전건 `errors++` + warn 1회 (KIS quota 0 침범 안전 default).
3. **영속 repo 신규** `server/persistence/shakeoutStopOutcomeRepo.ts` — atomic write(tmp→rename) + load(손상 JSON → `[]` fallback) + `upsertLabel`(tradeId 키 last-write-wins·RESOLVED 불변성 skip) + `loadLabels`. 원본 `shadow-trades.json` **무수정** (ADR-0445 물리 분리). `paths.ts` 1줄: `SHAKEOUT_STOP_OUTCOME_LEDGER_FILE`.
4. **셰이크아웃 판정 산식 (additive label)**:
   - `forwardClose{1,3,5,10}d` = 청산일+N영업일 종가 (KIS 일봉).
   - `forwardReturn{N}d = (forwardClose{N}d − exitPrice)/exitPrice × 100`.
   - `maxRecoveryPct` = horizon 종가 회복률의 최댓값.
   - **`isShakeout`** = `maxRecoveryPct >= SHAKEOUT_RECOVERY_THRESHOLD_PCT`(상수 **+5.0%**, 본문 SSOT·하드코딩 금지·모듈 export).
   - 미성숙(전 horizon 미충족) → `maturity:'PENDING'`. 전 horizon 종가 채워지면 `'RESOLVED'` + 그 시점 `isShakeout` 확정.
5. **cron 등록** `server/scheduler/learningJobs.ts` — `shakeout_stop_forward_labeling`. KST **16:50** (UTC `50 7 * * 1-5`) — `gate3_forward_return_update`(16:35)·`shadow_live_delta`(16:45) 이후 stagger. `TRADING_DAY_ONLY`(ADR-0045 휴장일 silent skip). 콜백 진입 시 `isShakeoutStopForwardLabelerEnabled()` 단락(ENV OFF→fetch 0·repo 미변경). priceFetcher = `(s,a) => fetchHistoricalClosePrice(s,a)`.
6. **ENV SSOT** `isShakeoutStopForwardLabelerEnabled()` = `process.env.SHAKEOUT_STOP_FORWARD_LABELER_ENABLED === 'true'` 정확 비교(ADR-0157), **default OFF**.

## 안전 invariant 7종

1. **LIVE 매매 본체 0줄 변경** — `git diff` signalScanner/entryEngine/exitEngine/kisClient/orchestrator/autoTradeEngine = 0줄.
2. **KIS 주문 함수 import 0건** — `placeKis*Order`/`cancelKisOrder` 정적 grep 가드 회귀.
3. **KIS 호출 read-only 만** — `fetcher`(일봉) 주입, 미전달 시 전건 `errors++` (quota 0).
4. **ENV default OFF** — `=== 'true'` 정확 비교.
5. **호출자 1건(cron)** — `runShakeoutStopForwardLabeler` grep = 모듈+테스트+cron 만.
6. **원본 불변성** — `shadow-trades.json` 무수정, 라벨은 별도 repo. RESOLVED 라벨 재방문 차단(repo + 모듈 이중 방어).
7. **providerIssue ≠ marketSignal** — 종가 결손은 해당 horizon skip·다음 cron 재시도, 약세 신호 변환 0 (9대 불변식 #6).

## byte-equivalent 매트릭스

| 상태 | 동작 | execution / provider / shadow Impact |
|------|------|--------------------------------------|
| ENV OFF (default) | cron 콜백 진입 직후 단락 — fetch 0·repo 미변경 | NONE / fetch 0 / 무영향 |
| ENV ON | 라벨 산출 + repo append (별도 파일) | NONE (관측 전용) / KIS 일봉 read-only / 무영향 |

LIVE 매매 경로(entryEngine/exitEngine/autoTradeEngine/kisClient 주문) 0줄 무접촉 — ON/OFF 무관 동일.

## 타입 (server-local additive)

`src/types/` 추가 없음 — 라벨 타입은 server-local(관측 전용·클라이언트 미러 불요). 추후 대시보드 노출 시 `src/types/` 승격 + 양측 import(별도 PR). 상수 SSOT: `SHAKEOUT_RECOVERY_THRESHOLD_PCT = 5.0` (모듈 export·드리프트 차단).

## Alternatives

- (a) `futureReturnResolver` 대상 확장 기각 — 대상 도메인 상이(미실행 학습 신호 ≠ 실행 청산 포지션)·불변성 키 상이. 신규 모듈이 SRP.
- (b) `shadow-trades.json` 본체에 라벨 필드 추가 기각 — ADR-0445 물리 분리·원본 불변성 위반.
- (c) default ON 기각 — opt-in·운영자 명시 활성화.
- (d) Yahoo primary 기각 — ADR-0561 KIS Primary Absolute.

계보 0175 / 0445 / 0561 / 0157 / 0112 / 0045 / 0146.
