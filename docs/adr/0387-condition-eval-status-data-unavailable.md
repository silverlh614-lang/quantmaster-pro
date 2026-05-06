# ADR-0387: ConditionEvalStatus 도입 — DATA_UNAVAILABLE vs THRESHOLD_NOT_MET 분리

**Status**: Accepted (P0-1 ~ P0-4, perEvaluator + stockScreener wiring 완료)
**Date**: 2026-05-06

## 배경

지난 11 layer 결함 사슬 추적 결과, **공통 메타 결함** 1건 식별:

> 데이터 부재(DATA_UNAVAILABLE) 와 진짜 임계 미달(THRESHOLD_NOT_MET) 을 같은 `failed` 로 카운트.

`registry.ts:66` `if (!out) continue` 와 `gateAuditRepo.ts:55-69` `passedSet.has(key) ? passed++ : failed++` 결합 시:

```
perEvaluator → return null (per=0/999)
↓
registry.run → if (!out) continue
↓
conditionKeys 에 'per' 미포함
↓
recordGateAudit(conditionKeys) → failed++
↓
포스트모템: "per 100% 실패"
```

운영자가 "PER 임계가 너무 엄격하다" 로 오판 → 다음 패치 효과 측정 불능 → confirmation bias 연쇄.

## 결정

### P0-1 (types.ts) — ConditionEvalStatus 4 분류 SSOT

```typescript
export type ConditionEvalStatus =
  | 'FIRED'              // 점수 부여 (임계 통과)
  | 'DATA_UNAVAILABLE'   // 입력 데이터 부재 (PER 없음, Yahoo stale, KIS 500 등)
  | 'THRESHOLD_NOT_MET'  // 데이터 정상 + 임계 미달 (진짜 종목 결함)
  | 'SANITY_REJECTED';   // 데이터 비정상 영역 (drift 데드존 — layer 8 정합)
```

`ConditionEvalOutput.status?` 옵셔널 필드 추가 (기존 evaluator 무수정 후방호환).

### P0-2 (gateAuditRepo.ts) — recordGateAuditByStatus 신규

```typescript
export interface GateConditionStats {
  passed: number;
  failed: number;
  unavailable?: number;  // ADR-0387 신규 (옵셔널 — 기존 영속 파일 후방호환)
}

recordGateAuditByStatus(outputs):
  FIRED              → passed++
  DATA_UNAVAILABLE   → unavailable++
  SANITY_REJECTED    → unavailable++
  THRESHOLD_NOT_MET  → failed++
  legacy null/score  → 후방호환 (passed/failed)
```

기존 영속 `gate-audit.json` 의 `unavailable` 부재 시 `?? 0` 로 자동 채움.

### P0-3 (perEvaluator) — status 분리 + 다단 점수

```typescript
PER 부재 (0/-/Infinity/NaN/999) → DATA_UNAVAILABLE + score=0
PER 15 미만 → FIRED + 1.2× weight (저평가)
PER 25 미만 → FIRED + 1.0× weight (적정)
PER 35 미만 → FIRED + 0.5× weight (성장주 허용권)
PER 35 이상 → THRESHOLD_NOT_MET + score=0 (고평가)
```

ENV `PER_EVALUATOR_LEGACY=true` (default OFF) → 구 단일 버킷 (PER<20 flat) 동작 복원.

### P0-4 (emptyScanPostmortem) — failRate vs unavailableRate 분리 보고

`findTopBlocker` 반환 schema 확장:
- `key` / `failRate` (THRESHOLD_NOT_MET — 진짜 임계 미달, 기존)
- `unavailableKey` / `unavailableRate` (DATA_UNAVAILABLE/SANITY_REJECTED, 신규)

`PostmortemReport` 옵셔널 필드 추가:
- `topBlockerUnavailableRate?: number`
- `topUnavailableCondition?: string | null`

게이트 타이트 분기 reason 메시지에 unavailableRate ≥ 30% 시 ⚠️ 마커 추가.

### Caller wiring (stockScreener.ts:509)

```typescript
if (gate.outputs && gate.outputs.length > 0) {
  recordGateAuditByStatus(gate.outputs);  // ADR-0387 정밀
} else {
  recordGateAudit(gate.conditionKeys);     // legacy backward compat
}
```

`ServerGateResult.outputs?` 옵셔널 필드 추가 → `evaluateServerGate` 가 `run.outputs` 그대로 propagate.

## 안전 invariant

- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4)
- LIVE 매매 본체 — perEvaluator 로직 변경 (default 다단 점수, ENV legacy 우회 가능)
- 기존 evaluator 13개 무수정 (status 옵셔널 → 자동 fallback 으로 status 미명시)
- 기존 영속 `gate-audit.json` 후방호환 (`?? 0` 자동 채움)
- `recordGateAudit` (legacy) export 보존 — 다른 호출자 회귀 위험 0
- ENV 1줄 즉시 롤백 — `PER_EVALUATOR_LEGACY=true`

## 페르소나 원칙 정합

원칙 9 (확신 편향 경계) 의 시스템 메타 적용:

> 시스템이 자기 자신의 결함을 정확히 진단할 수 없는 상태에서 결함을 고치려는 시도는 confirmation bias 의 연쇄를 만든다.

진단 도구 정확도가 결함 가설 신뢰도의 상한. 본 ADR 은 진단 도구 정확도를 격상한다.

## 잘못된 해결 방법 영구 차단

1. **모든 evaluator 일괄 status 적용** — 한 PR 에 16 evaluator 동시 변경 시 회귀 16배. perEvaluator 만 P0, 나머지는 P1 점진 적용.
2. **null 의미 재정의 (DATA_UNAVAILABLE = null)** — 의미 모호 + 호출자 전수 변경 부담. status 명시가 SSOT.
3. **gate_audit.json migration script** — `?? 0` defensive 가 더 안전 + 비용 0.
4. **registry.ts run() 의 null 필터링 변경** — 다른 호출자 회귀 위험. outputs 배열은 이미 null 포함이라 신규 caller 만 활용.
5. **perEvaluator 다단 점수 ENV legacy 부재** — LIVE 점수 분포 변경이라 운영자 즉시 롤백 경로 의무.

## 후속 PR (P1+)

- **P1**: 다른 evaluator (volume / momentum / vcp / sector / dart 5종 등) status 분리 점진 적용
- **P1**: Yahoo quoteSummary opportunistic enrichment (PER 데이터 부재 자체 해소)
- **P2**: ROE / PEG evaluator 신규 (status 적용)
- **P2**: dataAvailability ledger (시계열 추적)
- **P3**: DART TTM PER (가장 신중)

## 회귀 테스트

- `perEvaluatorAdr0387.test.ts` — Status SSOT 1 + recordGateAuditByStatus 9 (FIRED/DATA_UNAV/SANITY/THRESHOLD/legacy null/legacy score>0/legacy score=0/backward compat/다중 누적) + recordGateAudit legacy 1 + perEvaluator 13 (DATA_UNAV 5 분기 + FIRED 4 분기 + THRESHOLD 1 + boundary 3 + ENV legacy 3) = **27 케이스**
- `emptyScanPostmortemAdr0387.test.ts` — findTopBlocker 7 (failRate vs unavailableRate 분리 / legacy gate_audit / reason 메시지 ⚠️ 마커 / 표본 임계 / failed=0+unavailable / schema 옵셔널 필드) = **7 케이스**

총 +34 회귀 케이스 신규.
