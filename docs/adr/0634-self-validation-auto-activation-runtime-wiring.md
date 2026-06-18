# ADR-0634 — Shadow 자가 검증 자동 활성 엔진(ADR-0633) 런타임 wiring

@responsibility ADR-0633 순수 엔진의 런타임 호출 site pin — 일일 cron 측정 cadence + 영속 streak(anti-flap) + CH4 통지. master OFF=cron no-op byte-identical. 신규 ENV 0(0633 master flag 재사용).

- **Status:** Proposed (Phase 0 — architect: ADR·영속 타입/스켈레톤·engine helper 추출 계약·INDEX. cron 본문·repo 본문·helper 추출 engine-dev 인계.)
- **Date:** 2026-06-18
- **Type:** ADR (신규 경계 — 스케줄러 cron + 영속 streak + 텔레그램 통지 seam)
- **Extends:** ADR-0633(자가 활성 *엔진* — 순수 evaluator + audit ledger + master flag + LEVER_REGISTRY). 본 ADR 은 그 엔진에 **런타임 호출 site** 를 부여한다. ADR-0631(PromotionReadinessBoard 판정공식)·ADR-0476(Gate1ThresholdEvidenceSummary 증거) 산출을 *재사용*(재계산 0). ADR-0157(`=== 'true'`)·ADR-0530(Patch Scope Guard)·ADR-0043(ScheduleClass cron 가드)·ADR-0445(ledger 물리 분리)·ADR-0607(SHADOW→CH4 격리) 준수.
- **executionImpact:** master OFF=NONE(cron no-op·byte-identical) / master ON=LIVE_SAFE shadow·diagnostic 게이트 자동 ON 만(LIVE 실주문 본체 0줄·kisClient/autoTradeEngine/order 0줄·requiredScore=70 무변경).

---

## 1. Context

ADR-0633 이 자가 활성 *엔진*(순수 evaluator + audit ledger + master flag `SELF_VALIDATION_AUTO_ACTIVATION_ENABLED` default OFF + LIVE_SAFE/EXCLUDED LEVER_REGISTRY)을 머지했다. 그러나 **런타임 호출 site 가 없다** — `evaluateAutoActivation()` 을 부르는 cron 도, anti-flap streak 을 추적하는 영속도, ACTIVATE 결과를 통지하는 seam 도 없다. 즉 master flag 를 켜도 *아무 일도 일어나지 않는다*. 엔진은 잠재력만 있고 작동하지 않는다.

운영자 장기 지침(2026-06-18, PLAN.md ①②③): "운영자 결정에 의존하지 말 것 · 때가 되면 결과를 측정하고 기능을 자동으로 켜라." ADR-0633 이 "어떻게 안전하게 자동으로 켤지"를 정의했다면, 본 ADR-0634 는 "**언제 측정하고, 어떻게 streak 을 누적하고, 켜졌을 때 어떻게 알리는지**"를 정의한다 — 엔진을 살아 있는 런타임 루프에 연결한다.

### 1.1 본 ADR 이 새로 만드는 것 / 만들지 않는 것

- **만든다:** (a) 일일 cron job `self_validation_auto_activation`(`server/scheduler/learningJobs.ts`) — 측정 cadence. (b) 영속 streak repo `server/persistence/autoActivationStreakRepo.ts` + 공유 타입 `src/types/autoActivationStreak.ts` — anti-flap hysteresis 상태 다리. (c) ACTIVATE 통지 CH4 seam. (d) ADR-0633 엔진 내 순수 predicate `evaluateLeverReadiness` 추출(streak 갱신과 evaluator 가 **동일 criteria** 를 쓰도록).
- **만들지 않는다:** 두 번째 측정 공식(ADR-0631 빌더 4종 그대로 재사용). 두 번째 판정 공식(ADR-0633 evaluator 그대로 재사용). 신규 데이터 fetch(기존 ledger row 만 read). 신규 ENV(0633 master flag 재사용). LIVE 실주문 경로 변경. Gate 채점 변경. EXCLUDED lever 의 자가 활성(영구 금지 유지).

---

## 2. Decision

### 2.1 일일 cron (측정 cadence)

`server/scheduler/learningJobs.ts` 의 `registerLearningJobs()` 에 신규 등록:

```
scheduledJob('0 8 * * 1-5', 'TRADING_DAY_ONLY', 'self_validation_auto_activation', fn, { timezone: 'UTC' });
```

- **시각:** UTC 08:00 = KST ~17:00. 기존 KST 16:30~16:50 resolver(future_return_resolve·gate3_forward_return_update·shakeout_stop_forward_labeling) **이후**라 forward-outcome evidence 가 신선한 상태에서 측정한다.
- **ScheduleClass `TRADING_DAY_ONLY`:** KRX 휴장일 자동 skip(ADR-0043). cron `1-5` 평일 가드는 1차 방어선.
- **첫 줄 master 가드:** cron fn 의 **첫 실행 줄**은
  ```ts
  if (!isSelfValidationAutoActivationEnabled()) return;
  ```
  master OFF = **완전 no-op** = 영속(streak repo)·`process.env`·텔레그램 **무접촉** = byte-identical. SSOT reader 만 사용(inline ENV 검사 금지, ADR-0157).
- **불변식 #1 liveness:** cron 본문의 어떤 throw 도 `scheduledJob` 래퍼가 catch+로그한다(상위 스케줄러 무중단). 본 job 의 throw 가 다른 cron·Trading Engine 을 멈추지 않는다.

### 2.2 cron 본문 단계 (engine-dev 구현)

master ON 일 때만 실행:

**(a) 측정 — `/promotion_readiness` 와 동일 빌더 재사용 (두 번째 측정 공식 0):**

```ts
const rows = await listGate1DryRunObservationRows();
const evidence = rows.length > 0 ? buildGate1ThresholdEvidenceSummary(rows) : undefined;
const counterfactual = await buildCounterfactualOutcomeBoard({ gate1Rows: rows });
const board = buildPromotionReadinessBoard({ evidence, counterfactual });
```

`server/telegram/commands/system/promotionReadiness.cmd.ts` 와 **동일 순서·동일 빌더**. 새 측정 공식 발명 0 — 기존 ADR-0631/0476 산출 재사용.

**(b) 영속 streak 갱신 (anti-flap):**

각 LIVE_SAFE lever 의 "오늘 READY(streak **제외** 기준 충족)" 여부로 일별 streak 갱신.
- 판정: `evaluateLeverReadiness(lever, input).readyExclStreak` (§2.4 helper — evaluator 와 동일 criteria).
- 기록: `recordLeverReadiness(leverId, readyToday, dateKey)`.
  - 오늘 첫 평가 + ready → streak += 1.
  - 오늘 첫 평가 + not-ready → streak = 0.
  - 같은 dateKey 재실행 → **멱등**(증가 0).
- `dateKey` = KST 거래일 `YYYY-MM-DD`(호출자 생성).

**(c) 평가 — ADR-0633 evaluator 호출 (두 번째 판정 공식 0):**

```ts
const report = evaluateAutoActivation({
  now,
  promotionReadiness: board,
  evidence,
  counterfactual,
  consecutiveReadyDaysByLever, // loadAutoActivationStreaks() → leverId→streak
});
```

evaluator 가 LIVE_SAFE + criteria 충족 + 미활성 → `process.env[envName]='true'` set + ledger append. EXCLUDED → 항상 EXCLUDED·`process.env` 무접촉.

**(d) 통지 + 로그:**

- `report.activatedLeverIds.length > 0` 이면 **CH4(JOURNAL/SYSTEM)** 통지(§2.3). 비어 있으면 통지 0.
- **항상** Railway 로그(`console.info`)로 verdict 요약(masterEnabled·activatedLeverIds·decision 수). 통지 발송 여부와 무관하게 진단 보존(06-telegram-policy.md §진단 보존).

### 2.3 통지 채널 — CH4(JOURNAL) 전용 (CH2 절대 금지)

ACTIVATE 통지는 **메타 자기관리**(executionImpact NONE)다 — LIVE 매매 신호가 아니다.
- **채널:** CH4(JOURNAL/SYSTEM). 06-telegram-policy.md §라우팅 — `JOURNAL` = CH4 메타 학습/회고. 기본 라우팅(`routeTelegramEvent`)이 미분류 이벤트를 `JOURNAL` 로 보낸다.
- **금지:** CH2(SIGNAL)는 LIVE 매매 신호 전용(ADR-0607). 자가 활성 통지를 CH2 로 보내면 안 된다.
- **구현 seam:** engine-dev 는 `report.activatedLeverIds` + `formatAutoActivationReport(report)` 를 CH4 로 전송. 기존 CH4 패턴(`sendTelegramAlert(message, { category, priority:'NORMAL', dedupeKey, cooldownMs, executionImpact:'NONE' })` — 기본 JOURNAL 라우팅, `gateThresholdReadinessAlert.ts` 동형) 또는 `sendChannelAlert` 를 사용한다. 본 엔진(`selfValidationAutoActivationAdr0633.ts`)은 텔레그램을 직접 import 하지 않는다(순수성 — 통지는 cron wiring 책임).

### 2.4 engine helper 추출 — `evaluateLeverReadiness` (두 번째 판정 공식 금지)

streak 갱신(§2.2 b)이 evaluator(§2.2 c)와 **정확히 동일한 criteria** 를 쓰도록, ADR-0633 `selfValidationAutoActivationAdr0633.ts` 에서 순수 predicate 를 추출한다:

```ts
export function evaluateLeverReadiness(
  lever: AutoActivationLever,
  input: AutoActivationEvaluateInput,
): { matureOk: boolean; reviewOk: boolean; perfOk: boolean; readyExclStreak: boolean };
```

- `readyExclStreak = matureOk && reviewOk && perfOk` (consecutive-READY **제외**한 기준 — streak 입력 자체이므로 순환 차단).
- `evaluateAutoActivation` 내부도 이 helper 를 재사용하도록 리팩토링(기존 inline `matureOk/reviewOk/perfOk` 계산을 helper 호출로 교체). **동작 무변경 리팩토링** — 기존 export 타입·LEVER_REGISTRY·verdict 동작·15 테스트 전부 보존.
- 두 곳(streak 갱신 + evaluator)이 같은 helper 를 쓰므로 criteria 가 영원히 한 군데서 정의된다(SSOT). 두 번째 판정 공식 발명 금지.

### 2.5 영속 streak repo

`server/persistence/autoActivationStreakRepo.ts`(architect 스켈레톤 — engine-dev 본문) + `src/types/autoActivationStreak.ts`(저장형 공유 타입).

- **저장형:** `Record<leverId, { streak: number; lastDateKey: string }>`(`AutoActivationStreakStore`). data/ JSON, 다른 ledger 와 **물리 분리**(ADR-0445) — 권장 파일 `data/auto-activation-streak-adr0634.json`.
- **함수:** `loadAutoActivationStreaks()` · `recordLeverReadiness(leverId, readyToday, dateKey)`(멱등·streak 반환) · `getConsecutiveReadyDays(leverId)`.
- **atomic write:** tmp→rename(shakeoutStopOutcomeRepo.ts 동형). race·부분쓰기 안전.
- **self-heal:** data/ 휘발(Railway Volume 미마운트) 또는 손상 JSON → 빈 `{}` → streak=0 시작. 자가 활성이 **늦춰질 뿐**(보수적·안전 측). streak 손실은 LIVE 영향 0(LIVE_SAFE lever 전용·다시 N일 충족하면 ACTIVATE).

---

## 3. 불변식 준수 (9대 + 단일 통로)

- **#1 Trading Engine 무중단:** cron throw 는 `scheduledJob` 래퍼가 catch(상위 스케줄러·엔진 무중단). master OFF=cron no-op. evaluator·repo 는 엔진 경로 밖.
- **#2 Shadow Learning 무중단:** 자가 활성은 shadow 를 *여는* 방향(LIVE_SAFE shadow 게이트 ON). 정지 0.
- **#3/#9 SourceSnapshot 단일 통로:** cron 은 provider 직접 조회 0 — 기존 ledger row(`listGate1DryRunObservationRows`)만 read. SourceSnapshot 미접촉.
- **#7 AI_ESTIMATED(L4) live 금지:** EXCLUDED(LIVE_MONEY/required-score flip/learning→LIVE 가중치)는 cron 이 켜도 evaluator 가 항상 EXCLUDED — `process.env` 절대 무접촉.
- **#8 실거래 차단 ≠ shadow 차단:** cron 은 LIVE_SAFE 만 자동 ON(shadow/diagnostic). LIVE 실주문 경로 byte-identical. 두 차단 분리 유지.
- **절대 보존 임계:** requiredScore=70·CONDITION_PASS_THRESHOLD=5·STRONG_BUY 는 `ABSOLUTE_PRESERVATION_EXCLUDED` — cron 이 절대 변경하지 않는다.
- **단일 통로:** kisClient/autoTradeEngine/aiUniverseService 미접촉. 통지는 CH4(JOURNAL) seam — CH2 금지(ADR-0607).

---

## 4. Patch Scope Guard (ADR-530)

- **targetDomain:** Scheduler-cron(신규 job) + Self-activation-persistence(신규 streak repo) + Telegram-notify(CH4 seam). (3 이하.)
- **allowedFiles:**
  - 신규 `server/persistence/autoActivationStreakRepo.ts`(architect 스켈레톤 → engine-dev 본문)
  - 신규 `src/types/autoActivationStreak.ts`(architect 확정 — 저장형 타입)
  - 수정 `server/scheduler/learningJobs.ts`(신규 cron 1개 등록 — engine-dev)
  - 수정 `server/trading/selfValidationAutoActivationAdr0633.ts`(`evaluateLeverReadiness` 추출 + 내부 재사용 — engine-dev. 동작 무변경 리팩토링)
  - 수정 `server/persistence/paths.ts`(streak 파일 상수 1줄 — engine-dev)
  - 신규 테스트 `autoActivationStreakRepo.test.ts`(멱등·self-heal) + `selfValidationAutoActivationAdr0633.test.ts` 추가(helper) — quality-guard 검토 후 engine-dev
  - 본 ADR 문서 · `docs/adr/INDEX.md`(0634→0635) · `docs/ai/10-patch-history-index.md`(1줄) · `ARCHITECTURE.md`(신규 repo 경계 1줄)
- **forbiddenFiles:** `autoTradeEngine`·`buyPipeline`·`kisClient`·`SourceSnapshot` 생성기·`gateConfig.ts`·`gate1DryRunObservationLedgerAdr0476.ts` 본체·`counterfactualOutcomeBoard.ts` 본체·`promotionReadinessAdr0631.ts` 본체·EXCLUDED lever 의 reader 본체·`src/**`(types 외 전부)·기존 cron job 본문.
- **expectedBehaviorChange:** master ON + LIVE_SAFE lever criteria 충족(N일 연속) 시 일일 cron 이 해당 ENV 를 런타임 자동 ON + CH4 통지. master OFF 면 cron no-op·0 변경.
- **sourceSnapshotImpact:** NONE (provider 직접 조회 0·기존 ledger row read 만).
- **executionImpact:** master OFF=NONE(byte-identical) / ON=LIVE_SAFE shadow·diagnostic 게이트 자동 ON 만(LIVE 실주문 본체 0줄·kisClient/autoTradeEngine/order 0줄·requiredScore=70 무변경).
- **shadowLearningImpact:** shadow 를 여는 방향(불변식 #2 강화). 루프 무중단.
- **telegramImpact:** ACTIVATE 시 CH4(JOURNAL) 통지(executionImpact NONE·메타). CH2 절대 금지. activatedLeverIds 비면 통지 0.
- **providerImpact:** NONE (신규 fetch 0).
- **신규 ENV:** **없음** — ADR-0633 master flag `SELF_VALIDATION_AUTO_ACTIVATION_ENABLED` 재사용. `.env.example` 변경 0.
- **testsRequired:** master OFF→cron no-op(streak repo·process.env·telegram 무접촉·byte-identical) / streak 멱등(같은 dateKey 재실행 시 증가 0) / not-ready→streak 0 리셋 / self-heal(파일 부재→빈 상태·streak 0) / N일 연속 충족→evaluator ACTIVATE / ACTIVATE→CH4 통지 1회·activatedLeverIds 비면 통지 0 / `evaluateLeverReadiness` 추출 후 기존 15 테스트 무회귀(동작 무변경).
- **rollbackPlan:** master ENV 1줄(`SELF_VALIDATION_AUTO_ACTIVATION_ENABLED=false`) → cron no-op·byte-identical. 신규 파일 2개(repo·type) + cron 등록 + helper 추출 revert(1커밋). 자가 활성된 ENV 는 각 lever ENV 1줄로 추가 롤백(기존 default OFF 복귀). streak 파일은 삭제해도 self-heal(빈 상태 재시작).

---

## 5. Alternatives Considered

1. **수동 1회 트리거(텔레그램 명령)로만 자가 활성** — 운영자 결정 의존 잔존(지침 ① 위반). cron 자동 cadence 가 "때가 되면 자동으로" 를 충족. **기각**(단 `/promotion_readiness` 조회는 유지).
2. **streak 을 in-memory 로만 추적** — 재배포·재시작마다 streak 리셋 → anti-flap 영원히 미충족 → 자가 활성 불가. **기각** — 영속 필요(보수적 self-heal 로 안전).
3. **resolver 와 같은 cron(16:30)에 합치기** — evidence 가 아직 갱신 전이라 stale 측정. **기각** — resolver *이후*(KST 17:00) 별도 job.
4. **streak 갱신과 evaluator 가 각자 criteria 계산** — 두 판정 공식 = 드리프트 위험·SSOT 위반. **기각** — `evaluateLeverReadiness` 단일 helper 공유(§2.4).
5. **CH2(SIGNAL)로 통지** — 자가 활성은 매매 신호가 아닌 메타 자기관리(ADR-0607 CH2=LIVE 신호 전용). **기각** — CH4(JOURNAL).
6. **신규 cadence ENV 발급** — 추가 flag = 운영 표면 증가. **기각** — 0633 master flag 가 전체 on/off 단일 스위치로 충분(신규 ENV 0).

---

## 6. References

- ADR-0633 — Shadow 자가 검증 자동 활성 *엔진* (본 ADR 이 런타임 wiring)
- ADR-0631 — PromotionReadinessBoard 판정공식 (cron 측정 재사용)
- ADR-0476 — Gate1ThresholdEvidenceSummary 증거 SSOT (cron 측정 재사용)
- ADR-0610 — CounterfactualOutcomeBoard format (cron 측정 입력)
- ADR-0607 — LIVE 모드 SHADOW 신호 CH4 격리 (통지 채널 근거)
- ADR-0445 — ledger 물리 분리 원칙 (streak repo 분리)
- ADR-0043 — ScheduleClass cron 자동 가드 (TRADING_DAY_ONLY)
- ADR-0157 — ENV 정확 비교(`=== 'true'`)
- ADR-0530 — Patch Scope Guard
- CLAUDE.md §2.1 불변식 #1·#2·#7·#8 · §2.2 requiredScore=70 절대불변 · docs/ai/06-telegram-policy.md §라우팅(CH4 JOURNAL)
