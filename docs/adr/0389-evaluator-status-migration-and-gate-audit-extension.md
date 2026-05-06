# ADR-0389: 3 evaluator status 마이그레이션 + /gate_audit conditionStatusRows + registry non-FIRED skip

**Status**: Accepted (P1 후속 — ADR-0387/0388 기반 점진 적용)
**Date**: 2026-05-06

## 배경

ADR-0387/0388 가 status SSOT + audit + perEvaluator 만 적용. 사용자 권장 점진 마이그레이션:
1. **/gate_audit 출력 확장** (read-only, 회귀 위험 최소)
2. **3 evaluator (vcp/momentum/volume_surge) 추가 status 적용** (사용자 권장 순서)
3. ~~호출자 측 context propagation~~ — LIVE wiring 별도 PR

또한 ADR-0387/0388 미해결 결함 1건 발견:
> registry.run 이 status='DATA_UNAVAILABLE'/'THRESHOLD_NOT_MET' 출력을 conditionKeys/details 에 합산 → Signal Calibrator 가 미통과 조건을 통과로 오인.

## 결정

### P1 — registry.run non-FIRED skip (선결 결함)

```typescript
if (out.status === 'ERROR') continue;
// ADR-0389: status 명시 + non-FIRED 시 score/details/conditionKeys 미합산.
if (out.status !== undefined && out.status !== 'FIRED') continue;
totalScore += out.score;
details.push(out.detail);
conditionKeys.push(out.conditionKey);
```

후방호환 — `status === undefined` (legacy) → 기존 score>0 동작 보존.

### P2 — `/gate_audit` conditionStatusRows 출력

`buildConditionStatusRows(audit, topN=8)` SSOT 신규 — 표본 ≥ 5 조건 중 worst status 기준 정렬:
- `error ≥ 10%` → ERROR (최우선)
- `unavailable ≥ 50%` → UNAVAILABLE
- `failed ≥ 70%` → FAILED
- 그 외 → OK

`formatGateAuditMessage` 6번째 섹션 (`📐 조건별 status`):
```
   per:          passed=4 failed=4 unavailable=232(96%) error=0(0%) ⚠️
   momentum:     passed=80 failed=20 unavailable=0(0%) error=0(0%)
   ❌=evaluator 결함 / ⚠️=데이터 부재 / 🚧=임계 미달
```

### P3 — 3 evaluator status 마이그레이션

**volume_surge**:
- `avgVolume <= 0` → DATA_UNAVAILABLE (5일 평균 산출 불가)
- `volume / changePct NaN` → DATA_UNAVAILABLE
- 임계 충족 → FIRED
- 임계 미달 → THRESHOLD_NOT_MET

**momentum**:
- `changePercent NaN` → DATA_UNAVAILABLE
- `rsi14/rsi5dAgo NaN` + `pct ≥ 0.5` → FIRED with `(RSI부재)` 마커, 점수 0.4× (가속 보너스 없음)
- 4 단계 점수 분기 → FIRED
- `pct < 0.5` → THRESHOLD_NOT_MET
- legacy ENV `MOMENTUM_STEP_SCORING_DISABLED=true` 동작 보존

**vcp**:
- 9 입력 필드 (`bbWidthCurrent/bbWidth20dAvg/vol5dAvg/vol20dAvg/atr5d/atr20avg/ma5/ma20/ma60`) 중 0/누락 → DATA_UNAVAILABLE
- Mode A (CS≥0.6/0.4) → FIRED
- Mode B (정배열 + ATR 안정) → FIRED (legacy ENV `VCP_MODE_B_DISABLED=true` 시 비활성)
- 그 외 → THRESHOLD_NOT_MET

**ADR-0387 결함 차단**: 기존 vcp 는 atr20avg=0 같은 데이터 부재 시 `cs<0.4` 분기 → THRESHOLD_NOT_MET 잘못 분류. ADR-0389 가 사전 검증으로 DATA_UNAVAILABLE 정확 분류.

## 안전 invariant

- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4)
- LIVE 매매 본체 — 3 evaluator 점수 산출 동일 (status 추가만, 정상 데이터 + 임계 통과 시 동일 score 반환)
- registry.run 변경 — non-FIRED status 명시된 경우만 skip (legacy null/score>0 동작 보존)
- `/gate_audit` UI-only 변경, 기존 5 섹션 무수정 + 6번째 옵셔널 추가
- 11 다른 evaluator 무수정 (status 옵셔널 자동 fallback)
- ENV 우회 — 기존 evaluator 별 ENV (`MOMENTUM_STEP_SCORING_DISABLED` / `VCP_MODE_B_DISABLED`) 보존

## 잘못된 해결 방법 영구 차단

1. **15 evaluator 일괄 status 마이그레이션** — 사용자 명시 회귀 위험 16배. 점진 적용 (이번 3 + 다음 PR 3).
2. **registry.run 의 score 합산도 status 분기** — score=0 이라 totalScore 영향 0, 분리 변경 회피.
3. **vcp Mode B 의 데이터 검증 누락** — atr20avg=0 사전 검증으로 NaN 분기 차단 (이전엔 cs=0 false 통과).
4. **momentum RSI 부재 시 점수 0** — 가속 보너스만 비활성, 약한 모멘텀 점수 자체는 보존 (사용자 자본 보호).
5. **`/gate_audit` 6번째 섹션 필수화** — 옵셔널, 데이터 부재 시 미노출.

## 회귀 테스트

`evaluatorsAdr0389.test.ts` 28 케이스:
- volume_surge 7 (DATA_UNAVAILABLE 3 + FIRED 1 + THRESHOLD_NOT_MET 2 + boundary 1)
- momentum 9 (DATA_UNAVAILABLE 1 + FIRED 4단계 + RSI 부재 PROVIDER_DEGRADED + THRESHOLD_NOT_MET + legacy ENV 3)
- vcp 5 (DATA_UNAVAILABLE 3 + Mode A FIRED + Mode B FIRED + THRESHOLD_NOT_MET + legacy ENV)
- registry non-FIRED skip 7 (FIRED 합산 + 4 status 별 미합산 + legacy null + legacy score>0 + outputs 등재)

`gateAuditAdr0389.test.ts` 14 케이스:
- buildConditionStatusRows 8 (빈 / 표본 부족 / 4 worstStatus 분기 + 정렬 + topN + legacy)
- formatGateAuditMessage 6 (옵셔널 미노출 / 빈 배열 / 4 status 마커 / 범례)

총 +42 회귀 (ADR-0387 +34 + ADR-0388 +28 + ADR-0389 +42 = **누적 +104**).

## 후속 PR

- 다른 evaluator 점진 적용 — ma_alignment / volume_breakout / turtle_high / relative_strength / breakout_momentum (다음 5종)
- 호출자 측 context 전달 — perSymbolEvaluation 가 hadRequiredData/skippedByPolicy propagate
- Yahoo quoteSummary opportunistic enrichment (PER/EPS 데이터 부재 자체 해소)
