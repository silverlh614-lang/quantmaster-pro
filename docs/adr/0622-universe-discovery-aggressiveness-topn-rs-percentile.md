# ADR-0622 — Universe Discovery Aggressiveness: Stage1 Top-N Expansion + RS Percentile Priority

**Status:** Proposed (Phase 0 — 경계·타입·ADR. 양 flag default OFF byte-identical. 구현은 engine-dev 인계.)
**Date:** 2026-06-17
**Branch:** `claude/gate2-growth-snapshot-rzifv0`
**계보:** 0616 / 0617 / 0618 / 0612 / 0550 / 0614 / 0599 / 0561 / 0558 / 0157 / 0445 / 0146

---

## Context

운영 실측(2026-06-17): 자동 발굴 스캔 후보 21~22개가 **전부 KOSPI laggard**
(`avgRelativeReturn20d ≈ −10~−13%`), STRONG/shadow 진입 0건. 즉 발굴이 낙폭반등
laggard(소형주·평균회귀)에 구조적으로 편향(ADR-0612/0616 진단의 연장).

운영자가 발굴 적극성 3축 모두 선택:
- ① **품질**: 외인·기관·시총 주도주 발굴 강화
- ② **수량**: Stage1 후보 절대수 확대
- ③ **방향**: 발굴 RS 게이트 — KOSPI 대비 양수/상위 percentile 우선 편입, laggard 편향 축소

**Audit 결과(중복 재구축 방지):**

- **① 품질 = 신규 코드 0.** ADR-0617(`LEADER_UNIVERSE_INJECTION_ENABLED` — carry +
  union 보존 + 관측 ledger, universeScanner:399~458 **배선 완료**) + ADR-0618
  (`LEADER_DAILY_REFRESH_ENABLED` — `runLeaderUniverseDailyRefresh` 실구현 + cron
  `leader_universe_daily_refresh` KST 08:10, screenerJobs:67 **배선 완료**)가 외인·기관·시총
  주도주 발굴을 **완전 구축**. 단 두 flag 가 default OFF 이며 `.env.example` 미기재.
  → **본 ADR 범위 밖**(flag ON 권고 + `.env.example` 4종 문서화 = patch type, ADR 발급 0).

- **② 수량 = 진짜 갭(top-N 컷 하드코딩).** `universeScanner.ts` 의 두 컷이 60 하드코딩:
  (i) `kisRows.slice(0, 60)`(:356, KIS 랭킹 raw 컷, Stage1 필터 전) (ii)
  `applyLeaderPreservation(candidates, 60, …)`(:441, Stage1 통과 후 점수컷 limit).
  scanUniverse 는 **이미** `krxFullMaster(~2700) > expanded ? full : expanded`(:396~398) =
  항상 full master 전수 → "scanUniverse 확대"는 효과 미미(이미 최대). 수량 레버의 본질은
  **top-N 컷 상향**.

- **③ 방향 = 진짜 갭(percentile 정렬 부재).** 기존 RS 자산 3종 모두 발굴 top-N 정렬에
  percentile 우선·laggard 디모트를 적용하지 않음:
  - `calcStage1Score` RS 0-floor 보너스(`UNIVERSE_RS_GATE_ENABLED`, pipelineHelpers:632~637)
    = **절대 가점**(clamp 0~3·risk-on 분기만) — 랭크 변별 약함(평시 눌림목 우대 우세).
  - `quantitativeCandidateGenerator` RS 필터(`UNIVERSE_RS_GATE_ENABLED`, :314~318)
    = `momentum20d ≥ benchmark` hard filter, **MOMENTUM 모드 전용**(universeScanner 경로 미적용).
  - ADR-0616 leader/laggard 관측(`universeCompositionBiasObservationAdr0616.ts`)
    = `RS = quote.return20d − kospi20dReturn` 산출 + topLaggardCodes — **관측 전용·미배선**.
  → 갭 = universeScanner Stage1 top-N 컷에 **RS percentile 우선 정렬 + laggard 디모트**.
  ADR-0616 RS 정의 재사용(**두 번째 RS 공식 신설 금지**).

②③ 는 같은 모듈(universeScanner top-N 컷)을 함께 만지고 강결합(정렬 우선순위 ↔ 컷 크기)
→ **단일 ADR 로 묶음**(targetDomain server/screener 1개 — Patch Scope Guard 3-도메인 한계 내).

---

## Decision

신규 순수 모듈 **`server/screener/universeDiscoveryAggressivenessAdr0622.ts`**
(로직 집약, universeScanner 1210줄 보호)에 ②③ 레버 + dry-run 관측을 집약. universeScanner
는 wiring 만(컷 크기·정렬 비교자·stamp).

### D1 — ② Stage1 Top-N 컷 상향 (flag-gated)

- flag `UNIVERSE_STAGE1_TOPN_EXPANSION_ENABLED === 'true'` default OFF(ADR-0157 정확비교).
- SSOT `isUniverseStage1TopNExpansionEnabled()`.
- 상수 `STAGE1_TOPN_BASE = 60`(현행) · `STAGE1_TOPN_EXPANDED = 90`(초기값·counterfactual 튜닝 대상).
- `resolveStage1TopN()` = enabled ? EXPANDED : BASE.
- 적용 2곳(engine-dev wiring): universeScanner:356 `kisRows.slice(0, resolveStage1TopN())`
  + universeScanner:441 `applyLeaderPreservation(candidates, resolveStage1TopN(), …)`.
- **OFF → 60 byte-identical.**
- **quota(ADR-0561/0558)**: kisTop60→90 = KIS quote fetch **+30/스캔**(랭킹 raw 컷). 점수컷(441)은
  이미 fetch 완료된 candidates 의 slice 크기 변경뿐(fetch 증가 0). **budget lazy 경계 존중** —
  컷 후 fetch 유지(eager 전수 fetch 금지). KRX/Yahoo quota 0.
- **후보 품질 희석 리스크**: 컷 상향 = stage1Score 60~90위 저점수 후보 유입. Stage2/Gate 후속
  필터링하나 평균 후보 품질 하락 가능 → **D2(RS percentile)와 병행 권고**(저품질 유입을 RS 우선 상쇄).
- scanUniverse 확대는 불요(이미 krxFullMaster 전수) → 명시 기각.

### D2 — ③ RS Percentile 우선 정렬 + Laggard 디모트 (flag-gated)

- flag `UNIVERSE_RS_PERCENTILE_RANK_ENABLED === 'true'` default OFF(ADR-0157).
- SSOT `isUniverseRsPercentileRankEnabled()`.
- **RS 정의 재사용(두 번째 공식 0)**: `rs = candidate.quote.return20d − benchmarkReturn20d`
  (둘 다 %, `benchmarkReturn20d = macroState.kospi20dReturn` — universeScanner `stage1BenchmarkReturn20d`
  스코프 재사용). ADR-0616 `UNIVERSE_RS_LEADER_THRESHOLD = 0` 경계 재사용(rs≥0 leader / rs<0 laggard).
- **percentile**: cross-sectional(후보 집합 내) RS percentile. RS 산출 가능 후보 한정 — 결손
  (return20d 부재/비유한·benchmark 비유한) 후보는 percentile 미부여·디모트 안 함(**결손≠laggard**,
  불변식 #6).
- **정렬 우선순위(flag ON)**: top-N 컷 비교자를 `stage1Score` 단독 → `rsPriorityComparator`:
  - positive-RS(rs≥0) 종목 우선 편입(컷 밖으로 밀리지 않음).
  - laggard(rs<0)는 stage1Score 동률 시 후순위 디모트.
  - RS 결손 후보는 중립(stage1Score 순서 보존).
- **OFF → stage1Score 단독 정렬 = byte-identical**(현행 `applyLeaderPreservation` sort 비교자 그대로).
- ADR-0617 주도주 union 보존과 **직교**(독립 layer — 둘 다 컷 밖 종목을 끌어올림, 충돌 없음).
- **rsScoreFromExcess 구간·AXIS_WEIGHTS·requiredScore=70·STRONG 승격식 0줄** — 발굴(Stage1) 레이어만.
  Gate2 RS 축(ADR-0621)과 직교.

### D3 — 공통 dry-run 상시 관측 (flag 무관, ADR-0616/0599 선례)

- flag 무관 항상 산출 "적극 발굴이었다면 후보가 어떻게 달라졌을지":
  `wouldExpandTopNAddedCount`(60→90 추가 편입 수)·`wouldRsPromoteCount`(positive-RS 끌어올림)·
  `wouldLaggardDemoteCount`(laggard 밀림)·`currentLaggardShare`(현행 laggard 비율, 운영자 실측
  −10~−13% 추세 추적, ADR-0616 동일 RS).
- ledger: ADR-0614/0616 패턴(atomic tmp→rename + rolling FIFO 60스캔 + 손상 JSON fallback +
  scanDateKey upsert). `paths.ts UNIVERSE_DISCOVERY_AGGRESSIVENESS_LEDGER_FILE` 1줄(물리 분리 ADR-0445).
  **flag ON 만 append**(opt-in 영속 I/O), 산출은 flag 무관.
- stamp: universeScanner top-N 컷 직후 1회 aggregate(ADR-0617 ledger append 인접)·try/catch 격리(불변식 #1).
- ADR-0616 RS 산출식 import 재사용(두 번째 RS 공식 신설 회피). 0616(현행 구성 편향 관측)과 0622
  dry-run(적극 발굴 delta)은 직교.

### D4 — byte-equivalent / 롤백

- 양 flag OFF → universeScanner:356/:441 컷·정렬 100% 현행 보존(byte-identical).
- 두 flag 독립(②만 / ③만 / 둘 다 조합) · 각 ENV 1줄 롤백.

### D5 — 타입 (additive only)

- `UniverseDiscoveryAggressivenessObservation`(per-scan aggregate dry-run) + ledger row.
- 기존 `CandidateStock`·`rsScoreFromExcess` 구간·`AXIS_WEIGHTS`·`requiredScore=70`·calcStage1Score
  RS 정의·`UNIVERSE_RS_LEADER_THRESHOLD` 불변(재사용만).

---

## Consequences

- **executionImpact**: 양 flag OFF = NONE byte-identical(KIS/KRX quota 0). ② ON =
  execution-adjacent(후보 풀 확대 + KIS fetch +30/스캔). ③ ON = execution-adjacent(정렬 변경·fetch 0).
  현 SHADOW_ONLY 출하 안전 · default OFF · ENV 1줄 롤백.
- **shadowLearningImpact**: 후보 풀/정렬 변경(의도) → shadow 진입 표본 확대(현행 0 → positive-RS 주도주 유입).
- **providerImpact**: ② ON KIS quote +30/스캔(랭킹 raw 컷·budget lazy 유지). 신설 모듈 fetch 0(영속/스코프 read).
- **telegramImpact**: 없음(관측 ledger 무음).
- **sourceSnapshotImpact**: 0(발굴 레이어·SourceSnapshot 우회 0·macro source carry 재사용, 불변식 #3).
- 9대 불변식 #1(ledger 실패 격리)·#3·#6(RS/benchmark 결손 시 정렬 무변경)·#7(주도주 source 매매 직접
  결정 0·품질 필터 유지)·#9(kisClient 단일 통로·신규 raw 0) 보존.
- 복잡도: universeScanner 1210줄(+wiring ~40·1500 여유). 신규 로직 별도 모듈 집약.

### Patch Scope Guard

- `targetDomain`: server/screener (1 도메인).
- `allowedFiles`: `universeDiscoveryAggressivenessAdr0622.ts`(신규)·`universeScanner.ts`(:356/:441 컷
  wiring + 정렬 비교자 + dry-run stamp)·`persistence/paths.ts`(1줄)·`.env.example`(③ 2 flag + ① 4 flag
  문서화)·`*.test.ts`.
- `forbiddenFiles`: autoTradeEngine · kisClient raw · buyPipeline 실주문 · SourceSnapshot ·
  calcStage1Score 점수식 본문 · gate2ConfluenceScore · rsScoreFromExcess 구간 · AXIS_WEIGHTS ·
  GATE2_PASS_*_MIN_SCORE · STRONG 승격식 · Gate1 requiredScore · 두 번째 RS 공식 ·
  leaderUniverseInjectionAdr0617 본문(직교·호출만).
- `testsRequired`: OFF byte-identical(컷 60·정렬 stage1Score) · ② ON 90+fetch+30 ·
  ③ ON positive-RS 우선/laggard 디모트/결손 중립/benchmark 결손 무변경 · 주도주 union 직교 ·
  dry-run flag 무관 산출 · ledger atomic/FIFO/upsert/손상 fallback.
- `rollbackPlan`: ENV 1줄(각 flag =false/삭제).

---

## Alternatives Considered

- (a) `calcStage1Score` RS 보너스 상한(`RS_BONUS_CAP=3`) 인상 기각 — 절대 가점은 랭크 변별 약함
  (평시 눌림목 우대 우세)·risk-on 분기만. percentile 정렬이 정직.
- (b) 두 번째 RS 공식 신설 기각 — ADR-0616/0612 컨벤션, calcStage1Score / 0616 RS 정의 재사용.
- (c) scanUniverse 확대(수량) 기각 — 이미 krxFullMaster(~2700) 전수.
- (d) ②③ 별도 ADR 기각 — 같은 모듈(top-N 컷)·강결합. 단일 ADR-0622.
- (e) ① 신규 ADR 발급 기각 — 0617/0618 이미 발급·완비. flag ON + `.env.example` 문서화(patch).
- (f) default ON 기각 — opt-in(ADR-0157)·dry-run 관측 후 운영자 flip.
- (g) Gate2/STRONG 승격식 손대기 기각 — 발굴 레이어만(ADR-0621 직교).
- (h) eager 전수 fetch 기각 — budget lazy 경계(ADR-0558)·컷 후 fetch 유지.
- (i) laggard hard-filter(quantitativeCandidateGenerator 식 이식) 기각 — graceful 보장 약화·
  positive-RS 우선 정렬(soft)이 후보 0 위험 없이 편향 교정(불변식 #6).

---

## References

- ADR-0617 leader-universe-stage1-preservation (carry + union 보존 — ① 완비)
- ADR-0618 leader-universe-daily-refresh (일일 신선화 — ① 완비)
- ADR-0616 universe-composition-bias-observation (RS 정의 SSOT·leader/laggard 관측 — D2/D3 재사용)
- ADR-0612 universe-relative-strength-gate (RS 게이트 계보)
- ADR-0550 stage1-risk-on-regime-leader-capture (캡 완화 — ① 일부)
- ADR-0614 consecutive-netbuy-observation-ledger (ledger atomic/FIFO/upsert 패턴)
- ADR-0599 (dry-run wouldPass 동형 선례) · ADR-0561 (KIS Primary) · ADR-0558 (budget lazy)
- ADR-0445 (ledger 물리 분리) · ADR-0157 (flag 정확비교 default OFF) · ADR-0146 (PR 자가 review)
