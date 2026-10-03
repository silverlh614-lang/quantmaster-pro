# 07 · Learning Engine (Shadow Learning·학습 라벨·attribution)

> ADR-0673: LIVE·PAPER·SHADOW의 레짐·Kelly 분류·사이징·전이·경고·정책 갱신을 폐기한다. 아래 R1~R6 설명은 과거 구현·원장 해석용이며 새 모델의 운영 조건으로 복원하지 않는다. 실제 가격 수집, 성과 보완, 주문 안전 경계는 유지한다.

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

## 현행 Shadow 관측·학습 (ADR-0666~0688)

현행 경로는 `scanDispatcher → paperExperimentRunner`이며 독립 스케줄에서도 실행된다. 사용자 운영 기준(2026-10-03)은 Shadow를 실제 운용처럼 매수·보유·매도 사인을 내면서 기록·학습·개선하는 단계로 사용하는 것이다. 실전 시작 후에도 이 가상 연구는 계속하고 검증된 동일 신호 로직을 주문 실행 계층에 연결한다. 아래의 옛 Gate·레짐별 학습·F2W 규칙은 기존 구현 유지보수 참고이며, 새 Shadow의 필수 조건으로 적용하지 않는다.

- `paperExperimentPolicy`: 장중 유효 가격과 관측 시각이 있으면 종목·거래일별 1주 기본 관측을 만든다. 뉴스 부재·20일선 아래·추세 정보 부재·전략 표본 부족은 기본 관측을 막지 않는다. 실제 종가로 D1·D3·D5를 누적하며, 가격을 얻지 못한 기록은 결손으로 표시한다.
- `paperAdaptiveSelection/IndicatorDiscovery`: 기본 관측에 고정한 지표와 생성 수식을 시간순 학습·검증하고 성과에 따라 매수 연결·해제·재채택·연구 종료를 판단한다. 검증 규칙과 검증 전 탐색 규칙을 분리하며 각각 독립적인 진입 대안이다. 구 뉴스·20일선 전략은 신규 진입 경로에서 폐기했고 당시 원장은 보존한다.
- `paperStrategyPolicy/AdaptiveExit`: 유효한 장중 관측에서 BUY/WAIT/HOLD/EXIT를 결정한다. 새 거래는 진입 시 고정한 손실 제한·수익 반납·진입 근거 약화 규칙으로 매도하며 실제 청산 이후에도 D5 대조 관측을 이어간다. 세 매도 기준의 동일 거래 비교와 후속 검증을 거쳐 이후 신규 거래의 정책을 고른다. 기존 예약 청산 거래는 당시 규칙을 유지한다.
- `paperExperimentRunner`: 기본 관측 저장 뒤 전략을 처리한다. 전략 원장 오류가 기본 관측을 버리지 않으며, 과거 자료 연구는 현재 시장 데이터 수집보다 먼저 갱신한다. 사용자가 명시적으로 일시정지한 동안에는 스케줄을 멈추며, 이는 자동 매매 조건에 의한 차단과 구분한다.
- `paper-strategy` 청산 성과는 별도 기록하고 진입 당시 근거와 연결해 검증한다. 전략 손익을 기본 관측에 섞거나 7개 조건 연구를 자동 매매 규칙으로 승격하지 않는다.
- 현황은 `/paper`, 연구는 `/paper_research`, 시그널·근거의 채널 전송은 `/paper_bot`에서 확인한다. 조건 누적 방지 원칙은 [AGENTS.md](../../AGENTS.md)의 새 Shadow 모델 지시를 따른다.
- `paperObservationFeatures`: 완료 일봉·현재가·별도 갱신 재무 캐시로 원지표를 계산해 관측 시 고정한다. ADR-0688 기준 32개 원지표와 1,488개 조합 후보를 연구하며 목록은 확장 가능하다. 재무 결산기간·연결/별도·확인 시각을 보존하고 과거 관측에 새 값을 소급 보충하지 않는다. 모든 추가 항목을 필수 진입 조건으로 누적하지 않는다.
- `paperTradeMeasurements`와 전략 원장은 진입·보유 관측·매도 판단·비용·결과를 연결한다. CH1은 매수·매도 변화, CH2는 08:30 추천과 판단 근거·청산 복기, CH4는 연구 변화를 보고한다. 검증 전 탐색과 학습 검증 통과 상태를 구분한다.
- 현재 관측 스케줄은 실행 모드와 별개이며 명시적 일시정지에는 따르지만, `paperBot` 발송은 SHADOW 모드에 한정돼 있다. 새 Shadow 판단의 실주문 전달 및 실전 체결과 가상 판단의 대조 연결은 후속 구현이다. 실전 연결 시 검증된 정책 버전·신호 원본을 추적하고 실제 주문·체결·거절·미체결을 가상 성과와 분리한다. 이 운영 방향만으로 LIVE를 켜거나 주문을 보내지 않는다.

## 기존 학습 구현 참고

이하 lifecycle·attribution·F2W·레짐·가중치 설명은 기존 구현에 한정한다.

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
