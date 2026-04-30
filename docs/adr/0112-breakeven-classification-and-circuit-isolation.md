# ADR-0112: BREAKEVEN 분류 + 서킷 카운트 분리

## 상태
승인 (2026-04-30)

## 배경

### 사용자 4/30 운영 보고 — 1차 로그 P0-1 의 진짜 정체

2026-04-30 KST 09:10~09:45 시점 SHADOW 모드에서 **3 종목 연속 "손절"**(코스맥스
192820, 한국콜마 161890, 에코프로HN 383310) → 09:45 **🛑 서킷브레이커 발동** →
**2 시간 동안 비상 정지 무한 루프** → 11:30·11:35 **재발동** → SIGTERM 재배포.

3 종목의 실제 등락률은 -0.30% / -0.18% / -0.45% — 모두 **`stopLossExitType =
'PROFIT_PROTECTION'`** 분기에서 청산. ADR-0079 BEP Glide 의 PROFIT_PROTECTION
은 *진입 후 +5% 도달 후 손익분기 보호용 트레일링 스톱* 으로 의도된 설계지만,
청산 결과를 시스템이 **`status = 'HIT_STOP'`** 로 영속하면서 일반 손절(LOSS)과
동일하게 카운트.

### 결과
`server/scheduler/shadowResolverJob.ts` 의 `countRecentConsecutiveLosses` 가
**`status === 'HIT_STOP'`** 모두 카운트 → 본절(BE) 영역 청산 3 건이 연속 손실
3 건으로 인식 → 서킷 발동 → ADR-0111 hotfix 가 baseline 리셋해도 *동일 3 건*
이 4 시간 윈도우에 여전히 잔존하면 즉시 재발동.

### 사용자 트레이딩 철학 분석
> "본절은 *방향 실패* 가 아니라 *타이밍 실패*. 손절은 아이디어가 틀린 것이고
> 본절은 방향은 맞았지만 모멘텀이 약하거나 타이밍이 빨랐던 것. 통계상 손절에는
> 포함하지 말고, 실전 리스크 관리에는 소손실로 반영."

→ WIN/LOSS/**BREAKEVEN** 3 분류로 격상. 서킷 카운트는 LOSS 만, 통계는 BE 별도
표기 (Scratch Rate). BE 빈도 자체는 시장 질(Market Quality) 선행 지표 — 본 ADR
범위 외 (후속 PR 에서 RANGE_BOUND/UNCERTAIN 레짐 격상 입력으로 활용).

## 결정

### 1. ServerShadowTrade.exitOutcome? 옵셔널 필드 추가 (옵션 A 채택)

기존 `status` union 무수정 — 후방 호환 100%. 신규 옵셔널 필드 1 종.

```typescript
interface ServerShadowTrade {
  // ... 기존 필드 ...
  /**
   * 청산 결과 분류 (ADR-0112).
   * - WIN: returnPct ≥ +1.0% 또는 TARGET_EXIT/EUPHORIA_PARTIAL 류
   * - LOSS: returnPct < -0.5% (방향 실패)
   * - BE:   -0.5% ≤ returnPct ≤ +0.5% AND PROFIT_PROTECTION 또는 entry circuit
   *
   * status='HIT_STOP' 이라도 exitOutcome='BE' 인 경우 서킷 카운트 제외.
   * 미설정/undefined 는 LOSS 로 간주(후방 호환).
   */
  exitOutcome?: 'WIN' | 'LOSS' | 'BE';
}
```

### 2. classifyExitOutcome SSOT 헬퍼

`server/trading/exitOutcomeClassifier.ts` 신규 (≤120 LoC, @responsibility SRP).

```typescript
export type ExitOutcome = 'WIN' | 'LOSS' | 'BE';

export const EXIT_OUTCOME_THRESHOLDS = {
  WIN_PCT_MIN: 1.0,    // +1.0% 이상 WIN
  LOSS_PCT_MAX: -0.5,  // -0.5% 이하 LOSS
  BE_PCT_MIN: -0.5,
  BE_PCT_MAX: +0.5,
} as const;

export function classifyExitOutcome(
  returnPct: number,
  exitRuleTag?: string,
  stopLossExitType?: string,
): ExitOutcome;

export function isBreakEvenClassificationDisabled(): boolean;
```

**우선순위 SSOT 결정 트리**:
1. ENV `BE_CLASSIFICATION_DISABLED=true` → returnPct ≥ +1 WIN / 그 외 LOSS (기존 동작)
2. NaN/Infinity → LOSS 안전 fallback (서킷 보수적 작동)
3. `exitRuleTag === 'TARGET_EXIT'` 또는 `'EUPHORIA_PARTIAL'` → WIN
4. `stopLossExitType === 'PROFIT_PROTECTION'` AND -0.5 ≤ returnPct ≤ +0.5 → **BE**
5. `exitRuleTag === 'ENTRY_CIRCUIT_BREAKER'` AND -0.5 ≤ returnPct ≤ +0.5 → **BE**
6. returnPct ≥ +1.0 → WIN
7. -0.5 ≤ returnPct ≤ +0.5 → BE (휴리스틱 분기)
8. returnPct < -0.5 → LOSS
9. 그 외 (+0.5 < returnPct < +1.0) → LOSS 보수적 fallback (수익 영역이지만 표본 미달)

### 3. exitEngine 청산 규칙 wiring

각 청산 규칙(`exitEngine/rules/*.ts`)이 `updateShadow({ status: 'HIT_STOP', ... })`
호출 시 **`exitOutcome: classifyExitOutcome(returnPct, exitRuleTag, stopLossExitType)`**
동시 영속.

본 PR 본 wiring 대상 8 규칙:
- `hardStopLoss.ts` (PROFIT_PROTECTION → BE 핵심 경로)
- `cascadeFinal.ts` (-25%/-30% 명백 LOSS)
- `cascadeHalf.ts` (-15% 50% LOSS)
- `r6EmergencyExit.ts` (R6 30% LOSS)
- `ma60DeathForceExit.ts` (역배열 LOSS)
- `legacyTakeProfit.ts` (TARGET_EXIT WIN)
- `trailingStop.ts` (수익 보호 → returnPct 따라 분류)
- `entryCircuitBreaker.ts` (50% 청산 → BE 가능)

기존 본체 0줄 변경 — `updateShadow` 호출의 옵셔널 필드 1 개만 추가.

### 4. 서킷 카운트 BE 제외

`server/scheduler/shadowResolverJob.ts` `countRecentConsecutiveLosses`:

```typescript
for (const s of recentClosed) {
  // ADR-0112: BE_CLASSIFICATION_DISABLED ENV 우회 시 기존 동작 유지
  // 그 외에는 exitOutcome === 'BE' 청산을 서킷 카운트에서 제외
  const isRealLoss = s.status === 'HIT_STOP'
    && (isBreakEvenClassificationDisabled() || s.exitOutcome !== 'BE');
  if (isRealLoss) consec++;
  else break;
}
```

ADR-0111 baseline 리셋과 정합. 본절 청산은 carry 도 안 됨 — 본절 1건 + 진짜 손실 1건 시
연속 카운트 break 정합 유지(보수적).

### 5. aggregateFillStats 3-way 반환

`FillAggregateStats` 에 `beFills?: number` (옵셔널, 후방 호환) 추가:
- 기존 호출자는 winFills/lossFills 그대로 사용
- 신규 호출자는 winFills/lossFills/**beFills** 3-way + Win Rate = WIN / (WIN + LOSS) +
  Scratch Rate = BE / total

본 PR scope: 인터페이스만 확장 + aggregateFillStats 본체 분기. 호출자
(weeklyIntegrityReport / qualityScorecard / Twin 비교 / `/pnl` 텔레그램 응답) wiring
은 **본 PR scope 외 — 후속 PR 분리** (회귀 위험 격리).

다만 fill 집계에서 BE 분류는 `pnlPct` 기반 휴리스틱 사용:
- pnlPct >= +1.0 → win
- pnlPct < -0.5 → loss
- 그 외 → BE
(fill 단위에는 exitRuleTag 없음 — trade-level 과 약간 다른 기준)

### 6. ENV 롤백 — `BE_CLASSIFICATION_DISABLED=true`

긴급 회로 차단 — 1 초 내 ADR-0112 이전 동작 복원:
- `classifyExitOutcome` 가 returnPct ≥ +1 → WIN, 그 외 LOSS 단순 분기
- `countRecentConsecutiveLosses` 가 모든 HIT_STOP 카운트 (기존 동작)
- aggregateFillStats 의 `beFills` 는 0 으로 고정

## 효과

### 1차 로그 시뮬레이션
| 시각 | 종목 | returnPct | stopLossExitType | exitOutcome | 서킷 카운트 |
|------|------|-----------|------------------|-------------|------------|
| 09:10 | 코스맥스 192820 | -0.30% | PROFIT_PROTECTION | **BE** | 0 |
| 09:15 | 한국콜마 161890 | -0.18% | PROFIT_PROTECTION | **BE** | 0 |
| 09:45 | 에코프로HN 383310 | -0.45% | PROFIT_PROTECTION | **BE** | 0 |

→ **`consec=0` → 서킷 미발동 → 무한 루프 자체가 발생 안 함**.

ADR-0111 baseline reset 과 결합:
- ADR-0111: /reset 후 *이후* 손절만 카운트 (방어 1)
- ADR-0112: 본절 청산은 LOSS 카운트에서 제외 (방어 2)
- 두 hotfix 결합으로 같은 결함 영구 차단.

## 영향 범위

| 영역 | 변경 | 위험 |
|------|------|------|
| `ServerShadowTrade` schema | 옵셔널 1 필드 | 후방 호환 100% |
| `exitOutcomeClassifier.ts` | 신규 SSOT 모듈 | 외부 의존 0 |
| 8 청산 규칙 | `updateShadow` 호출에 옵셔널 1 필드 추가 | 청산 결정 본체 0줄 변경 |
| `countRecentConsecutiveLosses` | 1 줄 분기 추가 | ADR-0111 baseline 정합 보존 |
| `aggregateFillStats` | beFills 옵셔널 반환 추가 | 기존 호출자 무영향 |
| ENV `BE_CLASSIFICATION_DISABLED` | 즉시 롤백 가능 | — |
| LIVE 매매 본체 | 0줄 변경 | — |
| KIS/KRX quota | 0건 (분류 SSOT 만) | — |

## 후속 PR

1. **BE 빈도 → 레짐 격상 입력** (RANGE_BOUND/UNCERTAIN 자동 감지)
2. **호출자 wiring** — weeklyIntegrityReport / qualityScorecard / Twin / `/pnl` 의
   Scratch Rate 표기
3. **conditionAttributionShadow Over-Strict 분류 조정** — BE 비율 ≥ 30% 종목은
   Over-Strict 후보에서 제외 (사후 +25% 가 아닌 본절 회귀 패턴이라 다른 의미)

## 참조
- ADR-0079 (BEP Glide) — PROFIT_PROTECTION 분기 도입
- ADR-0111 (Circuit Breaker baseline reset) — 본 ADR 의 사전 hotfix
- ADR-0021 (Loss Reason Tagging) — STOP_TOO_TIGHT 와 BE 의 관계
