# ADR-0419: R3 Sanity Streak Excludes SELL_ONLY / VolumeClock Closed Windows

## Status
Accepted — 2026-05-07

## Context
ADR-0401 (R3 Violation State Machine) + ADR-0412 (Frozen Quote + Holiday-Aware Streak Guard) 가
streak 누적과 SHADOW_ONLY pre-scan 차단 로직을 도입했지만, 사용자 보고:
**SELL_ONLY 모드 / VolumeClock closed (점심·장외) / 운영자 수동 가드 / R6_DEFENSE / VIX·FOMC 게이팅 /
데이터 빈곤 시점에서 GATE1_PASS_ZERO 가 누적되어 SHADOW_ONLY pre-scan 이 부적절하게 trigger** 되는
회귀 패턴 식별.

근본 원인 — `signalScanner/preflight.ts` 의 SHADOW_ONLY pre-scan 분기가 *SELL_ONLY / R6 / VIX / FOMC /
data-starved / volumeClock check 보다 먼저* 위치. 이로 인해 sell-only 점심 시간대에 GATE1_PASS_ZERO
streak 가 SHADOW_ONLY 임계를 넘으면 운영자에게 "신규 진입 차단" 알림이 발송되지만, 실제로는 정책상
이미 매수 차단된 시점이라 정보 가치가 0 + 알림 노이즈 + 사용자 혼란.

핵심 불변식 (사용자 명시 절대 변경 금지):
- *"streak hard block latch 격상은 *정상 거래일에 GATE1_PASS_ZERO 가 누적될 때만* 의미가 있다."*
- *"휴장일 / SELL_ONLY / R6 / VIX / FOMC / 데이터 빈곤 / VolumeClock closed 시점의 GATE1_PASS_ZERO 는
  시스템 결함이 아니므로 SHADOW_ONLY pre-scan 자체를 trigger 하지 않아야 한다."*

## Decision

### 1. `r3StreakSkipPolicy.ts` SSOT 확장
- `StreakSkipReason` union 5종 → 11종 격상:
  - 기존: `KRX_NON_TRADING_DAY` / `VOLUME_CLOCK_CLOSED` / `SELL_ONLY_MODE` / `BLOCKED_DAY_SCAN` / `FROZEN_QUOTE_STALE`
  - 신규 (ADR-0419): `EMERGENCY_STOP` / `MANUAL_BLOCK_NEW_BUY` / `R6_DEFENSE_REGIME` / `VIX_BLOCK` / `FOMC_BLOCK` / `DATA_STARVED_SCAN`
- `StreakSkipContext` 옵셔널 필드 3종 추가: `emergencyStop?` / `dataStarvedScan?` (`manualBlockNewBuy/Only` 는 기존)
- `evaluateStreakIncrementAllowed` 우선순위 결정 트리 11분기 (위에서 아래 첫 매칭):
  1. `!isKrxTradingDay` → KRX_NON_TRADING_DAY
  2. `!volumeClockAllowsEntry` → VOLUME_CLOCK_CLOSED
  3. `emergencyStop` → EMERGENCY_STOP
  4. `manualBlockNewBuy || manualManageOnly` → MANUAL_BLOCK_NEW_BUY
  5. `sellOnlyMode` → SELL_ONLY_MODE
  6. `regime === 'R6_DEFENSE'` → R6_DEFENSE_REGIME
  7. `vixGatingActive` → VIX_BLOCK
  8. `fomcBlockActive` → FOMC_BLOCK
  9. `bearDefenseMode` → BLOCKED_DAY_SCAN
  10. `dataStarvedScan` → DATA_STARVED_SCAN
  11. `frozenQuoteDataQuality === 'STALE'` → FROZEN_QUOTE_STALE
  12. 그 외 → `allowed=true`

### 2. `evaluateR3CountableScan(ctx)` SSOT 신규
- `evaluateStreakIncrementAllowed` 와 동일 결정 트리를 호출자 측 의미론으로 wrap.
- 반환: `{ countable: boolean; skipReason?: StreakSkipReason }`.
- 두 함수가 항상 같은 결정을 내림 (`countable === allowed`, `skipReason === skipReason`).
- 호출자: preflight.ts SHADOW_ONLY pre-scan + persistScanResults streak +1 평가 두 위치 모두 같은 SSOT.

### 3. `preflight.ts` 호출 순서 재배치
- **이전**: SHADOW_ONLY pre-scan check 가 SELL_ONLY (라인 225) / R6 (236) / VIX (246) / FOMC (264) /
  data-starved (278) / volumeClock (340) check **이전** 위치 (라인 192-219).
- **이후**: SHADOW_ONLY pre-scan check 를 모든 매크로 게이트 (volumeClock 포함) 통과 **이후** 로 이동
  (라인 ~360, supplyHealthSnapshot 직전).
- 이 재배치만으로도 자연스럽게 SELL_ONLY / R6 / VIX / FOMC / data-starved / volumeClock_closed 시점에
  SHADOW_ONLY trigger 가 발생하지 않음 (모든 매크로 게이트가 먼저 early-return).
- **추가 belt-and-suspenders 가드** — 새 위치에서 `evaluateR3CountableScan(ctx)` 명시 호출.
  countable=false 시 (회귀로 매크로 게이트 early-return 누락된 경우) console.warn 진단 로그.

### 4. HARD_BLOCK latch (영속, ADR-0120) 위치 무수정
- `loadR3SanityBlockState().active` 분기 (라인 173~189) 는 변경 0.
- 운영자 명시 acknowledge 만으로 해제 가능한 영속 latch — 매크로 게이트 활성 시점에도 지속 적용 의무.
- 절대 원칙 #11/12 (자동 해제 0) 정합 보존.

### 5. `scanDiagnostics.formatR3StreakSkipLine` 라벨 11종 격상
- 신규 6 reason 모두 한국어 라벨 매핑 추가.
- ADR 추적성 — `(ADR-0412/0419)` suffix.

## Consequences

### 운영 효과
- **사용자 노이즈 영구 차단** — sell-only 점심 시간대 / 휴일 직전 / R6 방어 / VIX 게이팅 / FOMC DAY /
  데이터 빈곤 시점에 SHADOW_ONLY 알림 0건 (해당 매크로 게이트 alert 만 발송).
- **streak 누적 의미 회복** — 정상 거래일 + 모든 매크로 게이트 통과 시점의 GATE1_PASS_ZERO 만 streak 가
  누적 → SHADOW_ONLY 임계 도달 시 *진짜* 시스템 결함 신호.
- **24h decay 자연 회복** — streak repo 의 ADR-0401 24h decay 정책 그대로 작동.

### 안전 invariant 7종
1. KIS/KRX 자동매매 quota 0 침범 (kisClient/orchestrator/autoTradeEngine 본체 무수정).
2. LIVE 매매 본체 0줄 변경 (의사결정/주문 로직 무관).
3. ADR-0401 R3 State Machine 본체 무수정 (호출 위치 이동만).
4. ADR-0120 HARD_BLOCK latch 위치 무수정 (영속 정책 보존).
5. ADR-0412 streak +1 평가 (`persistScanResults`) 동작 byte-equivalent — `evaluateStreakIncrementAllowed`
   가 새 reason 6종 추가했지만 정상 거래일은 모두 `allowed=true` 반환 (회귀 0).
6. SHADOW_ONLY pre-scan trigger 가 정상 거래일에서만 발화 — 사용자 명시 핵심 불변식.
7. 외부 의존성 0 (frozenQuoteDetector + krxTradingCalendar 만 import, KIS/Yahoo 호출 0건).

### ENV 우회
- 신규 ENV 0종. `R3_VIOLATION_STREAK_DECAY_HOURS` (ADR-0401) 만 그대로 유지.
- 회귀 발견 시 ADR-0401 ENV 1줄로 streak 자체 비활성 가능 (effective rollback).

### 잘못된 해결 방법 영구 차단
1. **`evaluateStreakIncrementAllowed` 결정 트리 우선순위 변경** — 호출자 측 SSOT 위반.
2. **`evaluateR3CountableScan` 와 `evaluateStreakIncrementAllowed` 분기 다르게 구현** — 두 함수 동등성 회귀.
3. **`StreakSkipReason` union 새 reason 추가 시 한국어 라벨 누락** — UI 표시 결함 (회귀 테스트 정적 가드).
4. **HARD_BLOCK latch (라인 173) 위치 함께 이동** — 영속 정책 위반 (절대 원칙 #11/12).
5. **새 reason ENV gate 추가** — 모든 매크로 게이트는 default 정책 적용, ENV 활성화 의무 부재.
6. **단일 PR 에서 streak repo 본체 변경** — 본 PR scope 외, 별도 후속 PR 분리 (회귀 위험 격리).

## Test Plan
회귀 테스트 31 케이스 신규 (`r3StreakSkipPolicyAdr0419.test.ts`):
- 시나리오 A~F (사용자 명시 핵심): SELL_ONLY / VolumeClock closed / R6/VIX/FOMC / 운영자 가드 /
  데이터 빈곤 / 정상 거래일 6 분기.
- 우선순위 결정 트리 12 케이스 (모든 인접 우선순위 boundary).
- evaluateR3CountableScan ↔ evaluateStreakIncrementAllowed 동등성 12 case 매트릭스.
- preflight.ts 정적 grep 가드 6 (import / SHADOW_ONLY 위치 / volumeClock check 보다 후행 / ctx 매핑).
- StreakSkipReason union 11종 정합 (모든 reason 도달 가능).

기존 `frozenQuoteDetector.test.ts` 2 케이스 정합 정정 — `manualBlockNewBuy/manualManageOnly`
→ MANUAL_BLOCK_NEW_BUY (기존 SELL_ONLY_MODE alias 폐기), `R6_DEFENSE` → R6_DEFENSE_REGIME,
`vixGatingActive` → VIX_BLOCK, `fomcBlockActive` → FOMC_BLOCK (기존 BLOCKED_DAY_SCAN alias 폐기).

## References
- ADR-0401 — R3 Violation State Machine (SHADOW_ONLY ephemeral + HARD_BLOCK latch)
- ADR-0412 — Frozen Quote Detector + Holiday-Aware Streak Guard
- ADR-0120 — R3 Sanity Block (영속 latch + 자동 해제 0)
- ADR-0157 — ENV 정확 비교 의무 (`=== 'true'` / `!== 'false'`)
- ADR-0146 — PR 자가 review 5 카테고리
