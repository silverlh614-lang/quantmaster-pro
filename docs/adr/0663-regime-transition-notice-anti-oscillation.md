# ADR-0663 (구 0640 재발급) — 레짐 전환 알림 정합화: 진동 억제 + 정직한 전환 사유 + 무변화 라벨

@responsibility 레짐 전환 Telegram 알림(표시 전용·실행권한 0)의 flip-flop 진동 억제·transitionReason 노출·설정 무변화 시 오라벨 제거 설계·ENV·불변식 SSOT.

- **Status**: Accepted (구현 완료 — 신규 순수 모듈 `regimeTransitionNotice.ts` + `regimeBridge.base.ts` 알림 경로. 표시 전용, executionImpact=NONE.)
- **Date**: 2026-06-19
- **Domain**: regime notification layer (`server/trading/regime/regimeTransitionNotice.ts` 신규 · `regimeBridge.base.ts:checkAndNotifyRegimeChange`)
- **Execution adjacency**: 없음 — `checkAndNotifyRegimeChange` / `channelRegimeChange` / `renderPlaybook` 은 전부 Telegram 표시 경로. SourceSnapshot·Gate 채점·Kelly·autoTradeEngine·kisClient **0줄**. executionImpact=NONE.
- **계보**: 0074 / 0032 / 0037 / 0593 / 0630 / 0157 / 0530

---

## 0. 운영자 보고 (수용)

> "레짐 변화가 뒤죽박죽이다." (Telegram 캡처 3장)

캡처 증거 (2026-06-19, ~14:36~15:15):
- `R5_CAUTION → R6_DEFENSE → R5_CAUTION → R3_EARLY` 가 ~40분 내 왕복(flip-flop).
- `R6_DEFENSE → R5_CAUTION` 알림: `MHS 63 → 63 (+0pt)`, `VKOSPI 80.3 → 80.3 (+0.0)` — **입력 변화 0인데 전환 발화**.
- 같은 알림이 **"변경사항 (공격 전환): Kelly ×0.3 → ×0.3, 신규 진입 한도 3 → 3"** — 실질 변화 0인데 "공격 전환" 단언.
- `[재발송 — 미확인 T1 경보]` — 잘못된 다운그레이드가 CRITICAL 로 30분 미확인 재발송까지 증폭.

---

## 1. Context — 코드 검증된 3대 결함

### 1.1 진동(flip-flop) — 히스테리시스/디바운스 부재
`checkAndNotifyRegimeChange`(regimeBridge.base.ts)는 tick 간 `effectiveRegime` 이 다르기만 하면 무조건 알림한다.
최소 체류시간(dwell)·확정 tick·쿨다운이 없다. 게다가 `dedupeKey` 를 up/down 으로 분리(PR-4 B)해 둬서
`R6→R5`(up 키)·`R5→R6`(down 키)가 서로 다른 키 → dedupe 가 핑퐁을 막지 못한다.
`effectiveRegime` 자체는 R6 복구 상태기계(latch decay·recoveryConfirmations·triggerFreshness·forced downgrade)로
바뀌므로 거시 지표가 평평해도 진동할 수 있다.

### 1.2 거짓 근거 — MHS/VKOSPI 델타만 표시
메시지는 MHS/VKOSPI 변화량만 찍는다. 그러나 실제 전환 드라이버는 `diagnostics.transitionReason` /
`r6RecoveryStatus`(상태기계·latch)다. 캡처처럼 지표 델타 0이면 운영자는 "지표 변화 0인데 레짐만 튐"으로
읽는다 — 실제 사유가 메시지에서 **누락**됐기 때문.

### 1.3 무변화 오라벨 — 설정 동일인데 "공격 전환"
`dirLabel` 은 순수 REGIME_ORDER 인덱스 기준(`currIdx>prevIdx → '공격 전환'`).
그러나 `R6_DEFENSE`·`R5_CAUTION` 은 `REGIME_CONFIGS` 상 **kellyMultiplier 0.3 / maxPositions 3 동일**.
인덱스만 다를 뿐 정책 변화가 0인데 "공격 전환 + Kelly ×0.3→×0.3" 을 단언한다.

---

## 2. Decision

신규 순수 SSOT `server/trading/regime/regimeTransitionNotice.ts`(provider/store/now/fetch 직접 호출 0 —
입력 주입형 순수 함수)로 알림 판정·문구를 분리하고, `checkAndNotifyRegimeChange` 가 이를 소비한다.

- **D1 (① 진동 억제)** — 모듈 상태 `_recentDepartures`(떠난 레짐+timestamp ring)로 oscillation 감지.
  `isOscillationReversal`: dwell 창 안에서 떠났던 레짐으로 되돌아오면 **알림 생략**(상태는 갱신·`console.warn` 로그).
  되돌림이 CRITICAL T1 으로 가지 않으므로 **30분 미확인 재발송 에스컬레이션도 차단**된다.
  ENV `REGIME_NOTIFY_MIN_DWELL_MIN`(분, 기본 10 · **0=억제 비활성=legacy** · 상한 120 · 음수/NaN→기본).
- **D2 (② 정직한 사유)** — `buildRegimeTransitionMessage` 가 `전환 사유: <transitionReason>`(+ `복구상태: <r6RecoveryStatus>`,
  NONE 이면 생략)을 항상 노출하고, MHS·VKOSPI 델타가 모두 0/null 이면 `(거시 지표 변화 없음 — 상태/latch 기반 전환)` 명시.
- **D3 (③ 무변화 라벨)** — `classifyRegimeTransition` 가 prevCfg/currCfg 의 Kelly·maxPositions 비교.
  동일하면 `RELABEL_NO_CHANGE`(라벨 "정책 무변경(표시 단계만)", 중립 ⚪, "정책 변경 없음" 단일 라인).
  실질 변화가 있을 때만 `UPGRADE`("공격 전환" 🟢) / `DOWNGRADE`("방어 강화" 🔴).

### 2.1 알림 티어 차등(증폭 차단)
- `DOWNGRADE`(material) → T1 CRITICAL(+미확인 재발송 대상) — 진짜 방어 강화만.
- `UPGRADE`(material) → T2 REPORT(HIGH).
- `RELABEL_NO_CHANGE` → T2 REPORT(HIGH) — **CRITICAL 아님 → 재발송 에스컬레이션 비대상**.

dedupeKey 방향 분리(up/down/relabel)는 유지(PR-4 B 의도 — 교차 dedupe 누락 방지). 진동 자체는 D1 가드가 차단한다.

### 2.2 D2 (장외 churn 차단) — 후속 보고 "장 마감 후도 뒤죽박죽"

추가 캡처(2026-06-19 15:30~15:54): `R4_NEUTRAL ↔ R3_EARLY` 가 **장 마감(15:30) 후에도** 3분 간격으로
왕복(Kelly ×0.5↔×0.7, 한도 4↔6 실질 변화). MHS 63 / VKOSPI 80.3 은 **여전히 완전 동결**.

**근본 원인:** `scheduleCatalog.ts:150` `market_regime_refresh_intraday_ttl` 이 **"상시" 3분마다** 돌며
(라벨은 "장중"·`silentWhen: 내부 캐시 갱신만 — Telegram 송출 없음`), `marketDataRefresh.ts:311` 에서
`checkAndNotifyRegimeChange` 를 호출해 **장외에도 전환 알림을 송출**한다(자기 계약 위반). 장외에서는
`resolveRiskOnFastUpgradeInputs` 의 `isFetchFresh(kospiIntradayFetchedAt, now, ttl)`(regimeBridge.base.ts:145)
가 refresh 마다 TTL 경계를 넘나들며 `riskOnFastUpgradeEligible` 을 true↔false 로 flap → `classifyRegime`
R3 fast-upgrade 분기(regimeEngine.ts:295)가 켜졌다 꺼졌다 → R3↔R4 진동.

D1 알림 억제(dwell)는 **되돌림**만 막아 첫 전환은 3분마다 계속 새 나간다 → 장외에선 부족.

**처방(D2):** `shouldSuppressClosedMarketNotice({ marketOpen, isR6Entry })` — `isMarketOpen()`(server marketClock,
평일 09:00~15:30 KST) 가 false 면 전환 알림 억제(상태는 silent 갱신). **단 R6_DEFENSE 진입은 예외**로 항상 통과
(오버나잇/장전 블랙스완 경보 보존). ENV `REGIME_NOTIFY_WHEN_CLOSED=true` 로 legacy(장외 발송) 복원.
이는 카탈로그의 "Telegram 송출 없음" 계약과 실제 동작을 정합시킨다. 장외엔 라이브 세션이 없어 executionImpact=NONE.

---

## 3. 9대 불변식 정합

- **#1 Trading Engine liveness** — 알림 경로만 수정. 엔진/스캔 정지 0. oscillation 시에도 내부 상태는 갱신(throw 0).
- **#2 Shadow 정지 금지** — Shadow 학습 표본·라벨 무접촉(표시 전용).
- **#3/#9 SourceSnapshot 단일 통로** — diagnostics 는 기존 `getRegimeDiagnostics` 1회 호출 carry. provider 직접조회 0.
- **#4/#5 상태 ≠ 데이터** — SourceSnapshot 불변. Policy/Confidence/Permission/Label 무변경(메시지 문구만).
- **#6 providerIssue ≠ bearish** — 전환 사유 노출은 표시일 뿐 신호 변환 0.
- **#7 L4→LIVE 금지** — 무관(표시).
- **#8 실거래/Shadow 차단 분리** — autoTradeEngine·kisClient·order **0줄**. LIVE 매매 byte-identical.

---

## 4. Patch Scope Guard (ADR-530)

- **targetDomain**: regime-notification(1).
- **allowedFiles**: `server/trading/regime/regimeTransitionNotice.ts`(신규) · `regimeBridge.base.ts`(import + 알림 블록 + 모듈 상태/reset) ·
  `regimeTransitionNotice.test.ts`(신규) · 본 ADR · `INDEX.md`(0663→0664) · `10-patch-history-index.md`(1줄) · `.env.example`(ENV 1줄).
- **forbiddenFiles**: SourceSnapshot 생성기 · autoTradeEngine · kisClient · Gate0~3 채점 · requiredScore=70 ·
  `REGIME_CONFIGS` 값 · `getRegimeDiagnostics` 판정 로직 · `effectiveRegime` 파생 · `marketStateResolver` · src/**.
- **expectedBehaviorChange**: Telegram 레짐 전환 알림 — 진동 되돌림 생략 · 전환 사유/무변화 명시 · 오라벨 제거. 매매 동작 0.
- **sourceSnapshotImpact / executionImpact / shadowLearningImpact**: NONE.
- **telegramImpact**: 레짐 전환 메시지 문구·티어·발송 빈도(진동 억제) 변경.
- **providerImpact**: 없음(신규 fetch 0).
- **testsRequired**: classify(무변화/업/다운) · oscillation/prune · message(사유/무변화/material) · ENV clamp.
- **rollbackPlan**: `REGIME_NOTIFY_MIN_DWELL_MIN=0`(진동 억제 비활성) · `REGIME_NOTIFY_WHEN_CLOSED=true`(장외 발송 복원) 각 ENV 1줄 독립. 문구 개선은 revert 1커밋.

> **D2 추가 파일**: `regimeBridge.base.ts` 가 `server/utils/marketClock.ts:isMarketOpen` 1개 import(읽기 전용). marketClock 본체·스케줄러 0줄.

---

## 5. Alternatives (기각)

- **effectiveRegime 자체에 히스테리시스 부여** 기각 — 게이트/사이징 입력을 바꿔 execution-adjacent. 본 결함은 **알림 노이즈**라 표시 경로에서 해결(byte-identical LIVE).
- **dedupeKey 공통 키 복원** 기각 — PR-4 B 의 up↔down 교차 dedupe 누락 회귀. D1 oscillation 가드가 진동의 정본 해법.
- **무변화 전환 완전 무알림** 기각 — 레짐 라벨 변화는 운영자에게 맥락 정보. T2 REPORT 로 조용히 전달(CRITICAL 아님)로 충분.
- **default OFF flag** 기각 — 표시 전용 정합 수정(executionImpact=NONE)이라 기본 활성 + ENV 비활성 escape hatch 가 적정(ADR-0630 display-only 진단 라인 선례).
