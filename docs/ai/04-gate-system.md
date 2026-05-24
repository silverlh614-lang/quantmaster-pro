# 04 · Gate System (27 조건·Gate 0/1/2/3·진단)

> **Read this file only when working on:** 새 Gate 조건을 추가하거나 기존 조건 가중치를 바꿀 때,
> Gate 0/1/2/3 통과 판정 로직을 수정할 때, requiredScore·STRONG_BUY 임계를 다룰 때,
> Gate 차단 사유 진단(`/scan_blockers`)을 분석할 때, 또는 minimum signal score 를 다룰 때.

---

## 27 조건 + 4단계 Gate

QuantMaster Pro 는 **27개 조건 + 4단계 Gate(0/1/2/3)** 를 통과한 종목에만 신호를 출력한다.

- **Gate 0** — 시장 레짐 분류 (R1_TURBO ~ R6_DEFENSE). 매크로 게이트 (FOMC·VIX·SELL_ONLY·R6).
- **Gate 1** — 최소 신호 점수 (minimum signal score). requiredScore=70 (절대 변경 금지).
- **Gate 2** — 주도주/리더십 (leadership) + 수급/섹터 confluence.
- **Gate 3** — 진입 정밀 검증 (entry revalidation) + RRR + 손절 정책.

상세 체크리스트:
- Gate 1 완료 기준 → `docs/gate1-completion-checklist-010.md`
- Gate 3 + Gate 1/2/3 통합 → `docs/gate3-completion-and-gate123-integration-checklist-010.md`

---

## 절대 보존 (Gate 임계·가중치)

다음은 데이터 기반 검증 없이 임의 변경 금지 — 변경 시 ADR 발급 + 회귀 테스트 의무.

- **requiredScore = 70** (Gate 1 minimum signal score 통과 임계)
- **UNKNOWN penalty 수치** (supply/investor-flow 미확인 시 감점)
- **STRONG_BUY 조건** (Gate Score ≥ 9 + RRR ≥ 3 + 강세 레짐)
- **condition weight** (27 조건별 가중치)
- **CONDITION_PASS_THRESHOLD = 5** (조건 통과 기준 점수)

---

## 조건 데이터 출처 분류 (3 tier)

27 조건은 신뢰도 등급이 다르다 (학습 가중치 보정에 사용 — ADR-0149/0020).

- **COMPUTED (9개)** — 가격/지표 결정적 데이터 (일목·MACD·볼린저·VCP·거래량·모멘텀·RS). 학습 multiplier ×1.0.
- **API (DART)** — ROE/부채/OCF/이자보상/EPS성장 등 외부 API 수신. Gate 2 입력.
- **AI_INFERRED (18개)** — Gemini 해석 추정값 (사이클·Risk-On·리더·정책·심리·엘리엇·촉매). 학습 multiplier ×0.4.

서버 매핑 SSOT 는 `attributionAnalyzer.ts:CONDITION_NAMES`(27 ID) + `CONDITION_TO_SERVER_KEY`(ADR-0149).
클라이언트 SSOT (`evolutionEngine.ALL_CONDITIONS` + `CHECKLIST_TO_CONDITION_ID`) 와 정합 의무.

---

## Gate 차단 사유 진단 (forensic attribution)

빈 스캔(entries=0) 원인을 종목별·조건별로 분해. 운영자가 *왜 매수 0건인지* `/scan_blockers` 로 인지.

- **Gate1 minimum signal forensic** (ADR-0505) — 종목별 컴포넌트 부검:
  POSITIVE_SCORE_STARVATION / SUPPLY_PROVIDER_UNKNOWN_PENALTY / SECTOR_ENERGY_DIAGNOSTIC_PENALTY /
  SCORE_CEILING_BELOW_THRESHOLD / MIXED. supply scope audit (KIS_FLOW_SYMBOL_MISSING/MISMATCH 등).
  collector wiring (ADR-0507) — `gate1ForensicInputs` 자동 합성 → ScanSummary 영속.
- **Gate1 fresh scan blocker attribution** (ADR-0420) — TRUE_GATE1_REJECTION / DATA_UNAVAILABLE_DOMINANT /
  EVALUATOR_ERROR_DOMINANT / MIXED. fresh (직전 스캔) vs 7d audit (`/gate_audit`) 분리.
- **Gate2 leadership attribution** (ADR-0422) — TRUE_NO_LEADERSHIP / SECTOR_DATA_STALE_DOMINANT /
  DATA_UNAVAILABLE_DOMINANT / PRE_BREAKOUT_WAIT_DOMINANT 등 9-value. stale ≠ true no-leadership 분리.
- **Empty Scan Root Cause Dashboard** (ADR-0500) — GateFailureCause 기반 빈스캔 원인 집계.
- **Preflight blocked scan** (ADR-0367 marker) — buyListLoop 진입 전 차단(SELL_ONLY/R6/VIX/FOMC) 시점에도
  `preflightBlockedScanSummary` 영속 → "진단 데이터 없음" 대신 "preflight blocked scan" 표시.

### 진단 출력 정책

- `/scan_blockers` (요약, ADR-0478 compact) — ≤4096 char Telegram 한도. priority registry 로 섹션 압축.
  초과 시 pagination (Patch-SUPPLY-DIAG-ACCURACY). `/scan_blockers full` 로 전체 + pagination.
- `/scan_blockers gate` (ADR-0507 compact) — Gate1/ADR-0505 핵심 30~40줄. `gate full` 로 ADR 마커 필터링 장문.
- **DATA_UNAVAILABLE 은 failed 가 아니다** (ADR-0416) — 평가 불가이지 임계 미달이 아님. unavailable++ 만.
  postmortem 권고는 `REVIEW_GATE_THRESHOLD` (LOOSEN_GATE 폐기) — trueFailRate>0.95 AND unavailableRate≤0.5 시만 (ADR-0417).

---

## Gate Score 입력 (보조 신호)

- **섹터 가산점** (ADR-0075/0400) — LEADING +2 / LAGGING -1 (Bear·Caution 만). SectorEnergy STRONG_BUY 게이트
  (ADR-0398/0415): confidence<0.6 / DEGRADED / FAILED / YAHOO_ETF / STALE / PARTIAL_VOLUME → STRONG_BUY 차단,
  **일반 BUY 는 차단 안 함** (불변식 #1 정합). `unifiedGateScoreKernel` (ADR-0509) — Shadow rawGate vs Live minSignal 비교.

SourceSnapshot SSOT → `docs/ai/03-source-snapshot-ssot.md` · Provider 정책 → `docs/ai/05-provider-policy.md`
학습 가중치 → `docs/ai/07-learning-engine.md`
