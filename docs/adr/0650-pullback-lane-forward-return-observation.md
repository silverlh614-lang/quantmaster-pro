<!--
@responsibility ADR-0650 눌림목 레인 forward-return 관측 라인 — 영속·성숙 cron·entryLane carry·/gate_audit 비교 결정. 관측 전용·executionImpact=NONE.
-->

# ADR-0650 — Pullback Lane Forward-Return Observation Line (눌림목 레인 forward-return 관측 라인)

- **Status**: Accepted (운영자 silverlh614 "전체 배선" 승인 — D1 영속·D2 성숙 cron·D3 carry·D4 /gate_audit 비교 4단계 전부).
- **Date**: 2026-06-23
- **Authors**: architect (Phase 0 — 경계·타입계약·스켈레톤·HANDOFF. repo 본문·cron 로직·carry·display 본문·테스트는 engine-dev/learning 인계.)
- **Series**: `_workspace/2026-06-23_pullback-forward-observation/architect/`. ADR-0625(셰이크아웃 forward-outcome labeler·KIS 일봉 read-only 선례) priceFetcher 주입 패턴·물리분리 ledger 직접 계승.
- **Type**: ADR (신규 관측 경계·sourceType·flag).

## 핵심 문장

> *"ADR-0649 default-ON flip 의 효과(눌림목 레인 B vs 추격 레인 C 의 forward 1D/3D/5D return·진입 RRR 우월성)를 데이터로 검증하는 관측 라인을 배선한다. 스캔-시점 force-ON hypothetical stamp 를 영속 row 로 굳히고(D1), KIS 일봉(L1, read-only)으로 forward 1D/3D/5D 를 성숙시키며(D2), entryLane='PULLBACK' 태그를 forward-outcome 경로로 carry 하고(D3), /gate_audit 에 눌림목 vs 추격 비교표를 표시한다(D4). LIVE 매매 본체 0줄·executionImpact=NONE·진입 selection 무변경 — 관측 행에만 기록."*

## 배경

ADR-0648 이 눌림목 진입 레인(레인 B)+과열 가드+RRR-우선을 `breakout_momentum` 추가 레인으로 도입, ADR-0649 가 운영자 승인으로 default ON flip 했다. 이제 flip 효과를 데이터로 검증할 관측 라인이 필요한데, 현 코드베이스에 3가지 갭으로 forward-return 데이터가 쌓이지 않는다.

1. **write site 0** — `server/quant/conditions/pullbackLaneShadowObservationAdr0648.ts` 의 `PullbackLaneShadowStamp.pullbackLaneForwardReturn1d/3d/5d` 필드는 *선언만* 존재하고("cron 사후 채움" 주석만) 어떤 영속 행으로도 쓰이지 않는다. 스캔-시점 stamp 는 `summaryDraft.pullbackLaneShadowAdr0648`(집계)에만 carry 되고 per-candidate row 영속이 없어, 성숙 cron 이 채울 대상 행 자체가 없다.
2. **entryLane carry 단절** — `entryLane='PULLBACK'` 태그가 `server/persistence/watchlistRepo.ts` 의 후보(`WatchlistEntry.entryLane?: 'PULLBACK'`)에만 존재하고, paper observational / counterfactual / forward-outcome 행으로 전파되지 않아 forward-return 을 레인별로 가를 수 없다.
3. **sourceType 부재** — `server/learning/unifiedForwardOutcomeLabeler.ts` 의 `UnifiedForwardOutcomeSourceType`(GATE3/GATE1_DRY_RUN/NEAR_MISS/COUNTERFACTUAL/PAPER_OBSERVATIONAL/…)에 PULLBACK 레인 관측을 위한 항목이 없다.

결과적으로 "눌림목 레인이 추격 레인보다 forward return·진입 RRR 이 우월한가"라는 ADR-0648/0649 의 핵심 가설을 N≥30 표본으로 판정할 데이터 라인이 비어 있다.

## 결정 — 4단계 배선

### D1 — 영속화 (per-candidate observation row)

신규 관측 전용 repo `server/persistence/pullbackLaneObservationRepo.ts` 신설 (ADR-0625 `shakeoutStopOutcomeRepo` 동형: atomic write tmp→rename·손상 JSON `[]` fallback·멱등 upsert·물리분리 ledger).

- 영속 대상: 스캔-시점 `persistScanResultsMidBlocks.ts:898-914`(ADR-0648 W5 블록)에서 이미 산출하는 per-candidate `PullbackLaneShadowStamp`. 동 블록은 `scanCandidateSnapshots` 를 순회하며 stamp 를 만든다 — 동일 루프에서 영속 row 로 굳힌다.
- 굳힐 필드: `scanId`/`symbol`/`asOf`/`pullbackLaneHypotheticalFired`/`breakoutChaseLaneFired`/`overheatGuardTriggered`/`posVsHigh20d`/`volRatio`/`aboveMa20`/진입시점 `entryRrr`(가용 시)/`entryLane`(가용 시) + `forwardReturn1d/3d/5d`(사후, 초기 undefined) + `maturedAt`(사후).
- 멱등 키: `pullbackLaneObservationKey = `${scanId}:${symbol}`` (한 스캔당 한 종목 1행). 이미 `RESOLVED` 행은 재기입 skip (불변성).
- 영속 게이트: 기존 force-ON stamp 산출(ADR-0476 패턴)은 그대로 force-ON 유지하되, **row 영속화는 신규 flag 게이트**(D2-flag) `=== 'true'` default OFF — 운영자 명시 활성화 의무. flag OFF 시 row append 0 → byte-equivalent(기존 집계 stamp 만·LIVE 본체 0줄). (※ stamp *집계 산출* 자체는 flag 무관 force-ON 유지 — 관측 stamp force-ON ADR-0476 패턴 보존.)

### D2 — 성숙 cron + PULLBACK_LANE sourceType

- `unifiedForwardOutcomeLabeler.ts` 의 `UnifiedForwardOutcomeSourceType` union 에 `'PULLBACK_LANE'` 추가 + 레지스트리 1행 등재(`diagnosticOnly:true`·`includeInExecutablePnL:false`·`includeInForwardEvidence:true`·`executionImpact:'NONE'`).
- 신규 `pullbackRow(row, now)` 정규화 함수 추가 — `PullbackLaneObservationRow` → `UnifiedForwardOutcomeRow`(D1/D3/D5 지원·D10 UNSUPPORTED·`marketSignal:false`·`liveExecutionAllowedAtCreation:false`).
- 성숙: 기존 forward-return 산출 헬퍼(`addBusinessDaysFromKstDate`·`fetchHistoricalClosePrice` 주입 priceFetcher·`priceFromReturn`) **재사용** — 신규 forward-return 공식 0. KIS 일봉(L1) read-only 만 (ADR-0561·0625 선례). 종가 결손 시 horizon skip·다음 cron 재시도 (providerIssue ≠ bearish, 불변식 #6).
- write-back: 성숙된 `forwardReturn{1,3,5}d`/`maturedAt` 를 `pullbackLaneObservationRepo.upsertObservation` 으로 영속(RESOLVED 불변성). 두 번째 forward-return 공식 0.
- cron: 별도 신규 cron 신설하지 않고 **기존 `runUnifiedForwardOutcomeLabeler` 호출 경로에 PULLBACK_LANE source 를 합류**(레지스트리 enabled+flag 게이트). 신규 cron slot 0.

### D3 — entryLane carry

`entryLane='PULLBACK'` 태그를 forward-outcome 경로로 전파한다.

- carry 지점: D1 row 영속 시 `scanCandidateSnapshots[i].entryLane`(가용 시) 또는 stamp 의 `pullbackLaneHypotheticalFired`(force-ON 가정)를 `PullbackLaneObservationRow.entryLane` 으로 기록 → 정규화 시 `UnifiedForwardOutcomeRow.decisionType='PULLBACK_LANE'`·`policyView='OBSERVATIONAL_ONLY'` 로 carry.
- 대조군 식별: `breakoutChaseLaneFired` 도 row 에 carry → D4 비교에서 눌림목(레인 B) vs 추격(레인 C) 분리 기준.
- forbiddenFiles 경계: watchlist→paper/counterfactual 본체 carry 는 본 ADR 범위 아님(별건). 본 ADR 의 carry 는 관측 row 의 entryLane/breakoutChaseLaneFired 필드 한정 — 진입 selection·watchlist 본체 0줄.

### D4 — /gate_audit 비교 표시

`server/telegram/commands/system/gateAudit.cmd.ts` 에 눌림목 vs 추격 비교 섹션 1개 추가 (read-only).

- 입력: `pullbackLaneObservationRepo.loadObservations()` 의 RESOLVED 행 집계 (외부 API 0건 — 기존 /gate_audit read-only 계약 보존).
- 표시: 눌림목(entryLane=PULLBACK) avg forwardReturn 1D/3D/5D + 평균 진입 RRR vs 추격(breakoutChaseLaneFired) avg 1D/3D/5D, 각 n.
- 판정 힌트(SSOT 상수): `D5 표본 N≥30 && 눌림목 avg 5D ≥ 추격 avg 5D → "유지(눌림목 우월 확인)" / else "데이터 부족 또는 추격 우월 — 롤백 검토"`. 힌트는 표시 전용 — 자동 flag 변경 0(thresholdAutoChanged=false).

## flag-lifecycle 검토

- **신규 flag** `PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED` = `process.env.… === 'true'`(정확 비교·ADR-0157)·**default OFF**. SSOT `isPullbackLaneForwardObservationEnabled()` (gateConfig.ts 또는 모듈 로컬 — engine-dev 결정, 단 단일 통로). 게이트 대상: D1 row 영속 + D2 PULLBACK_LANE 레지스트리 enabled. OFF=byte-equivalent(row 0·sourceRows 0).
- `scripts/gate_flag_lifecycle.json` 신규 1행 등재(status `SHADOW_OFF`·`reviewBy 2026-09-21`·ADR-0641 D1 거버넌스 의무): activationCriteria=눌림목 우월성 N≥30 forward 성숙 확인·운영자 승인 / nextAction=관측 누적 → /gate_audit 비교 판정 → 유지/롤백.
- **stamp 집계 force-ON 유지** — ADR-0648/0476 의 force-ON hypothetical *집계* stamp(`pullbackLaneShadowAdr0648` /scan_blockers 라인)는 flag 무관 그대로. 본 flag 는 *영속 row + 성숙 source* 만 게이트.

## 안전 invariant

1. **LIVE 매매 본체 0줄** — autoTradeEngine/buyPipeline/kisClient 본문/SourceSnapshot 생성기/entryEngine/exitEngine git diff 0줄.
2. **executionImpact=NONE** — flag OFF=byte-equivalent / ON=관측 row 영속만(진입 selection·Gate 판정·sizing 무변경·현 SHADOW_ONLY live 0).
3. **KIS L1 read-only 만** — 성숙 fetch 는 주입된 `fetchHistoricalClosePrice`(KIS 일봉 primary·ADR-0561) 재사용. raw KIS 금지·Yahoo-first 금지·AI_ESTIMATED(L4) 미사용·신규 fetch 최소(이미 unifiedLabeler cron 이 호출하는 priceFetcher 합류).
4. **9대 불변식 무접촉** — #1(cron try/catch 격리·labeler 무정지)·#2(Shadow 정지 0·additive source)·#6(종가 결손=horizon skip·providerIssue≠bearish)·#7(KIS L1 일봉 read-only)·#8(shadow≠live·관측 row≠주문)·#3/#9(SourceSnapshot 우회 0·provider 직접조회 0·이미 산출된 stamp/snapshot 입력만 소비).
5. **requiredScore=70 리터럴 무접촉**·**ADR-0471 weighted curve FREEZE 무접촉**·**Gate1/Gate2/Gate3 판정 로직 본문 0줄**·**breakoutMomentumEvaluator 레인 임계 0줄**·**rrrGate 산식 0줄**·**minimumSignalScoreTrace 판정라인 0줄**.
6. **멱등·원본 불변성** — row 멱등 키 `scanId:symbol`·RESOLVED 재기입 skip·기존 `pullbackLaneShadowObservationAdr0648.ts` 순수 stamp 함수 본문 0줄(필드 추가만, 사후 채움 필드는 이미 선언됨).

## Patch Scope Guard (ADR-530) — 11필드

- **targetDomain**: learning-observation (1) — pullback-lane forward-return 관측 라인.
- **allowedFiles**:
  - 신규: `server/persistence/pullbackLaneObservationRepo.ts`(+test) [engine-dev]
  - 신규 row 타입 export: `server/learning/pullbackLaneObservationTypes.ts` *또는* repo 모듈 내 export(engine-dev 결정·단일 SSOT) [architect 계약 pin]
  - `server/learning/unifiedForwardOutcomeLabeler.ts`(PULLBACK_LANE sourceType·레지스트리 1행·pullbackRow 정규화·성숙 합류)(+test) [learning]
  - `server/trading/signalScanner/scanDiagnostics/persistScanResultsMidBlocks.ts`(W5 블록 내 row 영속 1지점·기존 try/catch 안)(+test) [engine-dev]
  - `server/persistence/paths.ts`(`PULLBACK_LANE_OBSERVATION_LEDGER_FILE` 1줄) [engine-dev]
  - `server/telegram/commands/system/gateAudit.cmd.ts`(비교 섹션 1개·판정 힌트)(+test) [engine-dev]
  - gateConfig flag SSOT(`isPullbackLaneForwardObservationEnabled`)(+test) [engine-dev]
  - `.env.example`(flag 1줄)·`scripts/gate_flag_lifecycle.json`(신규 1행)·`ARCHITECTURE.md`(경계 1줄)·본 ADR·`INDEX.md` 0650→0651·`docs/ai/10-patch-history-index.md` 1줄
- **forbiddenFiles**: `autoTradeEngine`·`buyPipeline`·`kisClient`(본문)·SourceSnapshot 생성기·`breakoutMomentumEvaluator` 레인 임계·`rrrGate` 산식·`minimumSignalScoreTrace` 판정라인·requiredScore=70 calibration SSOT·ADR-0471 weighted curve·Gate1/2/3 판정 본문·`watchlistRepo` entry 본체(carry 는 관측 row 한정)·`src/**`.
- **expectedBehaviorChange**: flag OFF=무변화. flag ON=신규 관측 row 영속 + 성숙 cron 이 forward 1D/3D/5D 채움 + /gate_audit 에 비교 섹션 노출. 진입/주문/Gate 판정 무변화.
- **sourceSnapshotImpact**: NONE — SourceSnapshot 생성/변경 0. 이미 산출된 candidate snapshot/stamp 입력만 read.
- **executionImpact**: NONE — flag OFF byte-equivalent / ON 관측 row 영속만·현 SHADOW_ONLY live 0줄.
- **shadowLearningImpact**: additive (신규 PULLBACK_LANE forward-evidence source). Shadow 정지 0·기존 source 무변경.
- **telegramImpact**: /gate_audit 에 read-only 비교 섹션 1개 추가(외부 API 0). 다른 명령·채널 라우팅·dedup 무변경.
- **providerImpact**: 성숙 cron KIS 일봉(L1) read-only — 기존 unifiedLabeler priceFetcher 합류(신규 호출자 0). Yahoo-first 0·결손 graceful(불변식 #6).
- **testsRequired**: repo 멱등/RESOLVED 불변성·atomic·손상 fallback / pullbackRow 정규화(D1/D3/D5·D10 UNSUPPORTED·marketSignal=false) / persist seam flag OFF byte-equivalent(row 0) / gateAudit 비교 빌더·판정 힌트 경계(N=29 vs N=30·avg 동률) / flag SSOT default OFF.
- **rollbackPlan**: ENV `PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED` 미설정/삭제 1줄 → row 영속 0·source 0·byte-equivalent baseline. 잔존 관측 ledger 무해(주문/Gate 무영향).

## Alternatives Considered

1. **신규 독립 cron 신설** — 기각. 기존 `runUnifiedForwardOutcomeLabeler` 가 동일 priceFetcher·동일 성숙 패턴·동일 KIS L1 read-only 를 이미 운용 → source 합류가 cron slot/quota/유지보수 모두 우월. ADR-0625 는 독립 cron 이었으나 그건 대상(HIT_STOP 청산)이 unifiedLabeler source 가 아니어서였음 — 본 관측은 forward-return source 라 합류가 정합.
2. **stamp 집계만으로 판정** — 기각. 현 `pullbackLaneShadowAdr0648` 집계는 FIRED 카운트만·forward-return 없음 → 우월성 판정 불가. per-candidate row 영속 필수.
3. **row 영속도 force-ON** — 기각. 영속 ledger 증식은 운영 리소스 변화 → 운영자 명시 활성(default OFF) 거버넌스 필요(ADR-0641). stamp 집계 force-ON 은 유지(리소스 무증식).
4. **새 forward-return 공식 추가** — 기각. `addBusinessDaysFromKstDate`+`priceFromReturn`+`fetchHistoricalClosePrice` 단일 통로 재사용 — 두 번째 공식 SRP 위반·드리프트 위험.
5. **watchlist→paper carry 본체 수정으로 entryLane 전파** — 기각(본 ADR 범위). 진입 selection 인접 본체 변경 위험 → 관측 row 의 entryLane/breakoutChaseLaneFired 필드 carry 로 한정. 본체 carry 는 필요 시 별건 ADR.
6. **/scan_blockers 에 비교 표시** — 기각(보완 가능). /gate_audit 가 7일 누적·ghost/buy 추이 맥락이라 forward-return 우월성 비교의 자연 거주지. /scan_blockers 는 fresh 스냅샷이라 누적 비교 부적합.

## Consequences

- (+) ADR-0648/0649 의 "눌림목 ≥ 추격" 가설을 N≥30 forward 1D/3D/5D + 진입 RRR 로 판정할 데이터 라인 확보 → engineMode live 승격 전 운영자 근거.
- (+) ADR-0625 패턴 재사용으로 신규 표면적 최소(repo 1·sourceType 1·persist seam 1·display 1).
- (−) 영속 ledger 증식(flag ON 시) — FIFO/maturity-priority trim(MAX 12,000)으로 제어.
- (−) entryLane 본체 carry 미포함 → 레인 분류는 stamp force-ON 가정 + breakoutChaseLaneFired 대조군 기준(실 watchlist entryLane carry 는 별건).

## References

- ADR-0648 (눌림목 진입 레인+과열 가드+RRR-우선) — 본 관측의 대상 레인.
- ADR-0649 (default-ON flip) — 본 관측이 검증할 flip.
- ADR-0625 (셰이크아웃 forward-outcome labeler) — repo 물리분리·KIS 일봉 read-only·priceFetcher 주입 직접 선례.
- ADR-0476 (Gate1 near-miss dry-run 관측 ledger) — force-ON 관측 stamp 패턴.
- ADR-0471 (Gate1 weighted curve FREEZE) — 무접촉 경계.
- ADR-0561 (KIS Primary Absolute) — 성숙 fetch KIS L1 read-only.
- ADR-0157 (ENV opt-IN `=== 'true'` default OFF) — flag 패턴.
- ADR-0641 (gate-flag-lifecycle governance) — flag 등재 의무.
- ADR-0146 (PR 자가 review 5 카테고리)·ADR-0530 (Patch Scope Guard).
