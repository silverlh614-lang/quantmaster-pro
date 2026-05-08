# ADR-0451 — Empty Scan Must Not Force SELL_ONLY During Regular Market

**Status**: Accepted
**Date**: 2026-05-08
**Predecessors**: ADR-0448 (Trading Engine Liveness First — Auxiliary Data Must Not Hard-Block Execution), ADR-0449 (Pre-Breakout WAIT Liveness Policy), ADR-0450 (KIS-WS Priority Routing for Pre-Breakout Retry Candidates), ADR-0157 (ENV exact comparison).
**Successors**: thresholdSearchLoop tuning / pathological block postmortem 정밀화 (운영 데이터 누적 후) — out of scope.

---

## 1. Problem

**운영 증상 (2026-05-08 14:30 KST)**:

```text
[Orchestrator] 스캔 실행: 오후 재개장 | R2_BULL(x1) | 빈스캔×3→SELL_ONLY | 포지션 0/6
[AutoTrade] SELL_ONLY 모드 — 포지션 모니터링 전용
```

14:30 은 점심시간 아님. 시스템도 *"오후 재개장"* 정상 인식. 그런데 `emptyScanStreak >= 3` 때문에 SELL_ONLY 로 전환 → 신규 매수 중단.

### 결함 위치 — `server/orchestrator/adaptiveScanScheduler.ts:283`

```typescript
priority: (forceSellOnly || emptyBackoff > 1) ? 'SELL_ONLY' : 'FULL',
```

`emptyBackoff > 1` (즉 `consecutiveEmptyScans >= EMPTY_SCAN_BACKOFF_THRESHOLD`) 가 단독으로 `priority='SELL_ONLY'` 강제. ADR-0448 원칙 (Trading Engine 은 살아 있어야 한다, 보조 데이터 / 진단 / 공백은 엔진 종료가 아니라 confidence 하락·가중치 축소·모드 전환으로 처리) 정면 위반.

---

## 2. 핵심 진단 — 빈스캔은 실패가 아니다

### 빈스캔 4 종류 (사용자 §2 — 절대 변경 금지)

1. **TRUE_NO_CANDIDATE** — 정말 시장에 매수 후보 없음.
2. **DATA_UNAVAILABLE_EMPTY** — 데이터 공급자 문제로 후보 없음.
3. **GATE_TOO_STRICT_EMPTY** — Gate / entry / recheck 가 너무 많이 후보를 걸러냄.
4. **TEMPORARY_SESSION_EMPTY** — 장전 / 점심 / 장후 / 오후 재개장 직후 등 일시 공백.

이 중 어느 것도 단독으로 SELL_ONLY 강제 금지.

### SELL_ONLY 가 가능한 경우만

- 운영자 수동 설정
- emergencyStop
- market closed / lunch break / after-hours policy
- R6_DEFENSE
- FOMC / risk-off hard block
- order safety / cash / position risk
- true systemic risk mode

### 빈스캔은 SELL_ONLY 가 아니라

- scan interval 확대
- OBSERVE_ONLY
- DEGRADED
- RETRY_LATER
- Shadow / counterfactual learning
- KIS-WS 재배치

로 처리.

---

## 3. Decision

신규 SSOT `server/trading/signalScanner/emptyScanLivenessPolicy.ts` (~280 LoC):
- **`EmptyScanCause`** 6-value union (TRUE_NO_CANDIDATE / DATA_UNAVAILABLE_EMPTY / GATE_TOO_STRICT_EMPTY / TEMPORARY_SESSION_EMPTY / AUXILIARY_DATA_EMPTY / UNKNOWN).
- **`EmptyScanLivenessAction`** 6-value union (KEEP_ENGINE_ALIVE / RETRY_NEXT_SCAN / EXPAND_SCAN_INTERVAL / OBSERVE_ONLY_TEMPORARY / KEEP_SHADOW_LEARNING / ALLOW_SELL_ONLY_EXISTING_REASON).
- **`EmptyScanMarketSession`** 6-value union (REGULAR / OPEN_AUCTION / LUNCH_BREAK / AFTER_HOURS / CLOSED / UNKNOWN).
- **`EmptyScanLivenessDecision`** schema — literal type 강제 (`engineShouldContinue: true` / `shadowLearningAllowed: true` / `counterfactualLearningAllowed: true` 모두 항상 true, TypeScript 컴파일 타임 강제).
- **`evaluateEmptyScanLiveness(input)`** 결정 트리 SSOT (사용자 §5 정합).
- **`isEmptyScanLivenessPolicyDisabled()`** ENV gate (default OFF, ADR-0157 정확 비교).
- **`formatEmptyScanLivenessSection(decision, streak)`** /scan_blockers 출력 SSOT (사용자 §7 정합 — Telegram HTML raw 태그 금지, plain text).

---

## 4. Decision Tree (사용자 §5 — 절대 변경 금지)

위에서 아래 첫 매칭:

1. **emergencyStop / r6Defense / riskHardBlock** → `ALLOW_SELL_ONLY_EXISTING_REASON` (Core Execution Signal — ADR-0448 정합)
2. **LUNCH_BREAK / AFTER_HOURS / CLOSED + sellOnlyAlreadyActive** → `preserveExistingSellOnly=true` (시장 정책 보존)
3. **REGULAR + emptyScanStreak >= 3** → 핵심 분기 (사용자 §5):
   - sub-cause 결정 — `shadowObservableCount > 0` 우선 → `KEEP_SHADOW_LEARNING`
   - `dataUnavailableCount > 0 \|\| providerDegradedCount > 0` → `RETRY_NEXT_SCAN`
   - Gate fail ratio ≥ 0.7 → `GATE_TOO_STRICT_EMPTY` + `EXPAND_SCAN_INTERVAL`
   - 그 외 → `TRUE_NO_CANDIDATE` + `EXPAND_SCAN_INTERVAL`
   - **`allowSellOnlyTransition=false` 항상**, `scanIntervalMayExpand=true`
4. **REGULAR + emptyScanStreak < 3** → `KEEP_ENGINE_ALIVE` 정상 운영
5. **OPEN_AUCTION** → `TEMPORARY_SESSION_EMPTY` + `RETRY_NEXT_SCAN`
6. **UNKNOWN session** → `KEEP_ENGINE_ALIVE` 보수 fallback

### 절대 규칙 (사용자 §5 마지막)

```text
Regular session + emptyScanStreak only → SELL_ONLY 금지
```

---

## 5. AdaptiveScheduler Wiring

### 5.1 결함 차단 — `adaptiveScanScheduler.ts`

기존 코드 (line 283):
```typescript
priority: (forceSellOnly || emptyBackoff > 1) ? 'SELL_ONLY' : 'FULL',
```

변경 후:
```typescript
let livenessDecision: EmptyScanLivenessDecision | undefined;
let emptyScanForcesSellOnly = emptyBackoff > 1; // legacy fallback (ENV DISABLED 시)
if (!isEmptyScanLivenessPolicyDisabled()) {
  const marketSession = deriveMarketSessionFromKstMinutes(t, useLegacy);
  livenessDecision = evaluateEmptyScanLiveness({
    marketSession,
    emptyScanStreak: consecutiveEmptyScans,
    sellOnlyAlreadyActive: forceSellOnly,
  });
  // 핵심 — REGULAR session + emptyScanStreak 만으로 SELL_ONLY 강제 금지.
  // forceSellOnly (phase-based) 는 그대로 유지.
  emptyScanForcesSellOnly = false;
}

return {
  // ...
  priority: (forceSellOnly || emptyScanForcesSellOnly) ? 'SELL_ONLY' : 'FULL',
  emptyScanLivenessDecision: livenessDecision,
};
```

### 5.2 진단 로그 변경

기존:
```text
빈스캔×3→SELL_ONLY
```

변경 후:
```text
빈스캔×3→RETRY/DEGRADED · engine alive
```

ENV `EMPTY_SCAN_LIVENESS_POLICY_DISABLED=true` 시 legacy `→SELL_ONLY` 표현 그대로 유지.

### 5.3 KST 분 → marketSession 매핑 SSOT

신규 헬퍼 `deriveMarketSessionFromKstMinutes(t, useLegacy)` — adaptiveScanScheduler 의 phase 결정과 정합한 매핑:
- `< 930` → OPEN_AUCTION
- `< 1200` → REGULAR (오전)
- `< 1300` → LUNCH_BREAK
- `< 1500` → REGULAR (오후)
- `< 1530` → AFTER_HOURS
- `>= 1530` → CLOSED

legacy `TRADE_WINDOW_LEGACY_HOURS` 도 동일 매핑 (점심 11:30~13:00 → LUNCH_BREAK).

---

## 6. /scan_blockers Output

ADR-0448 SectorEnergy execution impact line *다음* 에 ADR-0451 liveness section 자동 첨부:

```text
🫀 Trading Engine Liveness (ADR-0451)
  • emptyScan×3: SELL_ONLY not forced
  • cause: TRUE_NO_CANDIDATE
  • action: EXPAND_SCAN_INTERVAL
  • engine: alive
  • shadow/counterfactual: kept
```

기존 SELL_ONLY 가 다른 이유로 켜져 있다면:
```text
🫀 Trading Engine Liveness (ADR-0451)
  • SELL_ONLY preserved by existing reason
  • emptyScan did not create SELL_ONLY
```

**Telegram HTML raw `<b>` 태그 금지** (사용자 §7 — plain text 우선). try/catch 격리 — 정책 throw 가 base 메시지 차단 안 함.

---

## 7. 절대 불변식 (21종)

1. **LIVE 매매 본체 0줄 변경** — `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` / `orchestrator/tradingOrchestrator.ts` / `autoTradeEngine*` / `trancheExecutor.ts` / `buyPipeline.ts` 모두 0줄.
2. **KIS 주문 함수 5종 import 0건** (정적 grep 가드).
3. **autoTradeEngine / orderExecutor / trancheExecutor import 0건**.
4. **외부 API 신규 호출 0건** (KIS REST / KRX / Yahoo / Naver) — 본 SSOT 는 순수 함수.
5. **Gate threshold 변경 0건**.
6. **STRONG_BUY 조건 변경 0건**.
7. **진입가 기준 완화 0건**.
8. **SELL_ONLY 개념 자체 보존** — 운영자 수동 / market closed / R6 / emergencyStop 모두 유지.
9. **emergencyStop hard-block 유지** — Core Execution Signal (ADR-0448 정합).
10. **R6 defense hard-block 유지**.
11. **true risk hard-block 유지**.
12. **market closed / lunch / after-hours 정책 유지**.
13. **REGULAR session 에서 emptyScanStreak 만으로 SELL_ONLY 전환 금지** (핵심).
14. **emptyScan 은 scan interval 조절 가능** (`scanIntervalMayExpand=true`).
15. **emptyScan 은 engine liveness 차단 금지** (`engineShouldContinue: true` literal 강제).
16. **Shadow / counterfactual learning 차단 금지** (literal `: true` 강제).
17. **DATA_UNAVAILABLE 을 failed 로 계산하지 않음** (ADR-0416 정합).
18. **외부 API 신규 호출 0건** + raw payload 영속 0건.
19. **ENV 정확 비교만 사용** (`=== 'true'`, ADR-0157 정합).
20. **ADR-0448 liveness 원칙 훼손 금지**.
21. **ADR-0449 pre-breakout failCount 보호 + ADR-0450 KIS-WS routing 범위와 충돌 금지**.

---

## 8. Rollback ENV (긴급용)

```bash
EMPTY_SCAN_LIVENESS_POLICY_DISABLED=true
```

(default OFF, ADR-0157 정확 비교 — `'1'` / `'TRUE'` / `'yes'` 모두 거부)

활성 시 호출자 측 fallback 으로 이양 — adaptiveScanScheduler 가 legacy `emptyBackoff > 1 → SELL_ONLY` 동작 100% 복원.

**장기적으로 사용 비권장** — 본 ENV 는 긴급 rollback 용이며, 정상 운영에서는 default OFF 유지. PR 본문에 명시.

---

## 9. Out of Scope (이번 PR 에서 하지 말 것 — 사용자 §9)

- Gate threshold 완화
- STRONG_BUY 조건 완화
- 진입가 조건 완화
- SectorEnergy 보수
- 수급 provider 보수
- Yahoo stale 보수
- KIS-WS priority routing 변경 (ADR-0450)
- Live / Paper promotion
- 자동 주문 추가
- SELL_ONLY 자체 삭제
- emergencyStop / R6 / risk hard-block 완화
- 시장 폐장 / 점심시간 SELL_ONLY 정책 제거
- thresholdSearchLoop 본체 변경

이번 PR 은 오직 *"emptyScanStreak 가 regular session 에서 SELL_ONLY 를 강제하는 것을 막는 것"* 에 집중.

---

## 10. Test Plan (사용자 §11 — 최소 40 케이스)

본 PR 은 **59 신규 회귀** (목표 ≥40 의 1.48배). Group A~N 14 그룹.

| Group | Cases | Coverage |
|-------|------:|----------|
| A. ENV gate | 6 | default OFF / `'true'` / `'1'`·`'TRUE'`·`'yes'` 거부 / `'false'` |
| B. REGULAR + streak ≥3 핵심 (사용자 §11 #1~#6) | 9 | streak 3·10 / engineShouldContinue / shadow / counterfactual / scanInterval / boundary 3 |
| C. 분류 분기 (사용자 §11 #7~#11) | 6 | shadow > 0 / data unavailable / provider degraded / gate too strict / hardRiskBlock false / threshold |
| D. Core risk hard-block (사용자 §11 #12~#14) | 4 | emergencyStop / r6Defense / riskHardBlock / shadow learning 보존 |
| E. 시장 정책 (사용자 §11 #15~#17) | 4 | LUNCH_BREAK / AFTER_HOURS / CLOSED / sellOnlyAlreadyActive=false |
| F. sellOnly emptyScan 유래 (사용자 §11 #18) | 1 | clear 권고 |
| G. ENV rollback (사용자 §11 #19~#20) | 2 | DISABLED=true / "TRUE"·"1"·"yes" 거부 |
| H. AdaptiveScheduler wiring (사용자 §11 #21~#23) | 4 | 정적 grep — import / priority 분기 / 로그 / decision propagate |
| I. /scan_blockers wiring (사용자 §11 #24~#25) | 3 | 정적 grep — import / parts.push / HTML raw 금지 |
| J. 정적 grep 가드 (사용자 §11 #26~#29) | 5 | KIS 5종 / autoTradeEngine / fetch / Gate threshold / ENV 정확 비교 |
| K. SELL_ONLY 보존 (사용자 §11 #30~#33) | 4 | ENV / market closed / R6 / emergencyStop |
| L. format compact line | 4 | null / "not forced" / "preserved" / ADR-0451 마커 |
| M. ADR cross-references | 5 | ADR-0448 / ADR-0157 / literal type 모든 분기 / core risk 우선 / sellOnlyReason propagate |
| N. 사용자 §1 운영 시나리오 14:30 KST | 2 | 사용자 보고 정확 시나리오 / operatorMessage |

### 인접 무회귀

- **server/trading/signalScanner + server/orchestrator/adaptiveScanScheduler 1071/1071 PASS** (ADR-0437/0448/0449/0450 모두 무회귀).

---

## 11. ADR-0146 PR Self-Review (5 categories — all PASS)

- **A. LIVE 매매 안전성**: KIS/KRX quota 0 침범 + ENV 롤백 1줄 + 회귀 59 + 21 보호 invariants
- **B. wiring 완료 vs 인프라만**: SSOT + adaptiveScheduler + scan_blockers 3 wiring 완료
- **C. ADR 발급 무결성**: INDEX.md 다음 발급 0451 → 0452 + 0451 등재
- **D. 회귀 테스트 적정성**: 59 신규 (heuristic ~21/100 LoC, ≥5 충족)
- **E. 정책 위반**: validate:all baseline 무회귀

---

## 12. References

- ADR-0448 (Trading Engine Liveness First — Auxiliary Data Must Not Hard-Block Execution) — Core vs Auxiliary 분리 원칙.
- ADR-0449 (Pre-Breakout WAIT Liveness Policy) — `increaseFailCount: false` literal type 강제 패턴.
- ADR-0450 (KIS-WS Priority Routing) — out of scope, 보존.
- ADR-0157 (ENV exact comparison) — `=== 'true'` 의무.
- ADR-0146 (PR Pace Audit Rule) — PR 자가 review 5 카테고리.
- ADR-0173 (Shadow Learning Only Scan) — `shadowLearningAllowed=true` propagate.
