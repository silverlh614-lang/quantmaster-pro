# 07 · Learning Engine (Shadow Learning·학습 라벨·attribution)

**Read this file only when working on:**
- Shadow Learning 표본 수집/판단 경로 · Shadow lifecycle 6-state · virtual(paper) fills
- LearningLabel · Counterfactual(반사실) · Ghost Portfolio
- attribution(조건별 기여도) · nightlyReflection · feedbackLoopEngine(F2W)
- regimeLearningBank / Backfill · 조건 lifecycle(승격/강등) · shadow model 가중치

**Do not read this file for:**
- 실거래 차단 vs Shadow 차단의 엔진 측 게이팅(allowRealOrder) → `02-trading-engine-rules.md`
- Gate 조건 가중치 · requiredScore 의 매매 측 임계 → `04-gate-system.md`
- 학습 진단 명령(`/learning_*`)의 Telegram 출력 형식 → `06-telegram-policy.md`

---

## Shadow Learning 불멈춤 (불변식 #2)

**Shadow Learning 은 어떤 상황에서도 멈추면 안 된다.** 실거래가 차단(SELL_ONLY/R6/VIX/FOMC/
비상정지)돼도 학습 표본 수집은 계속된다 (불변식 #8 과 분리).

- 차단된 날은 `runShadowLearningOnlyScan({ allowRealOrder: false })` 별도 lane 으로 실행.
  `allowRealOrder: false` literal type + runtime throw 2중 강제 — 실주문 API 호출 0건 (paper fill).
- provider 장애·DATA_UNAVAILABLE 도 학습 표본으로 보존 (`CASE_KIS_REALDATA_500` 등 learningTag).
  provider 장애를 bearish 로 변환하지 않고 "데이터 결손 사례" 로 학습 (불변식 #6 정합).
- **Shadow lifecycle 6-state SSOT** (본 문서가 canonical): SHADOW_PAPER_FILLED → POSITION_OPENED →
  MONITOR → SELL_SIGNAL → SELL_PAPER_FILLED → POSITION_CLOSED. 엔진 측 실행 lane 분리(allowRealOrder
  false)는 → `docs/ai/02-trading-engine-rules.md`.

---

## 학습 라벨 · Counterfactual · Ghost Portfolio

상태(R6/SELL_ONLY/HOLIDAY/장전장후/providerIssue)는 SourceSnapshot 을 바꾸지 않고
**LearningLabel 만 바꾼다** (불변식 #5). 같은 데이터라도 라벨로 학습 맥락을 분리한다.

- **LearningLabel** — live fill 표본과 shadow paper fill 표본을 라벨로 구분 — 혼합 집계 금지.
  매매 차단 상황의 Shadow 표본은 "이 환경에서 진입했다면" 맥락 라벨 부착.
- **Counterfactual (반사실)** — 진입/미진입·가중치 변경 시 결과를 추정해 학습에 반영
  (`dynamicWeightFeedback.ts` / `suggestedWeightAction` / `factorContributionScore`).
  counterfactual metadata(entry/target/stop price)는 표본별로 보존·repair (`/learning_pulse` 진단).
- **Ghost Portfolio** — 실제 미진입 Shadow 후보로 구성한 가상 포트폴리오. nightlyReflection·
  attributionBackfill 이 *진입했다면* 의 가상 성과를 추적 (`nightlyReflectionEngine.ts` /
  `attributionBackfillEngine.ts` / `regimeLearningBank.ts`). 실거래 표본과 분리 집계.

---

## Attribution (조건별 기여도)

**`attributionAnalyzer.ts` SSOT** — 청산된 트레이드의 손익을 27 조건별로 귀속.

- **composite key** (ADR-0006) — `{symbol}_{entryTimestamp}` 복합 키로 진입 시점 조건 스냅샷과
  청산 결과를 정확히 매칭. 같은 종목 재진입 시 표본 혼선 차단.
- **조건 데이터 출처 보정** (→ `docs/ai/04-gate-system.md`) — COMPUTED(9) ×1.0 / AI_INFERRED(18) ×0.4
  학습 multiplier (ADR-0149/0020). 추정값 조건이 결정적 조건과 동일 가중치를 갖지 못하게 차단.
- `CONDITION_NAMES`(27 ID) + `CONDITION_TO_SERVER_KEY` 매핑 SSOT — 클라이언트
  `evolutionEngine.ALL_CONDITIONS` 와 정합 의무.

---

## nightlyReflection (야간 회고)

- **nightlyReflection** (ADR-0007) — 일 1회 청산 트레이드 집계 → 조건별 승률/기대값 갱신.
  CH4(JOURNAL) 채널로 자기비판 리포트 발송 (→ `docs/ai/06-telegram-policy.md`).
- **회고 멱등성** (ADR-0130) — 같은 날 중복 실행 시 재집계 방지 (날짜 키 dedup). 재부팅·cron 중복 안전.

---

## feedbackLoopEngine (F2W: Feedback-to-Weight)

- **feedbackLoopEngine** — attribution 결과를 조건 가중치 조정 제안으로 변환 (Feedback → Weight).
  자동 반영 금지 — 제안은 운영자 승인 또는 ENV gate 후 적용 (절대 보존 임계 보호).
- requiredScore=70 / CONDITION_PASS_THRESHOLD=5 / STRONG_BUY 임계는 F2W 자동 변경 대상 아님
  (→ `docs/ai/04-gate-system.md` 절대 보존).

---

## regimeLearningBank / Backfill

- **regimeLearningBank** — 레짐(R1~R6)별 학습 표본 분리 저장. 같은 조건이 레짐에 따라 다른
  기대값을 갖는 것을 반영 (강세장 모멘텀 vs 약세장 모멘텀 분리).
- **Backfill** — 과거 청산 트레이드를 레짐 라벨로 소급 적재. 신규 레짐 축 도입 시 표본 0 에서 시작 방지.

---

## 조건 lifecycle (승격/강등)

- **조건 lifecycle** (ADR-0084) — 조건은 EXPERIMENTAL → ACTIVE → DEPRECATED 단계 관리.
  지속 음(-) 기여 조건은 강등 후보, 검증된 신규 조건은 승격. 27 조건 union 변경은 ADR 의무.

---

## shadow model (가중치 모델)

- **shadow model** (ADR-0027) — live 가중치와 분리된 실험 가중치 모델. shadow lane 에서만 적용,
  검증 통과 후 live 승격. live 매매 본체 0줄 변경 (byte-equivalent 원칙, → `CLAUDE.md` §5).

---

## 학습 진단 명령

| 명령 | 용도 |
|------|------|
| `/learning_status` | 조건별 승률/기대값 + 표본 수 현황 |
| `/learning_history` | 최근 회고 리포트 이력 |
| `/learning_loop_health` | F2W 루프·nightlyReflection·attribution 파이프 헬스 |

9대 불변식 → `docs/ai/00-project-charter.md` · Trading Engine liveness → `docs/ai/02-trading-engine-rules.md`
Gate 조건 가중치 → `docs/ai/04-gate-system.md` · Telegram CH4 회고 → `docs/ai/06-telegram-policy.md`
