# ADR-0325: 게이트 임계 자기 진화 분석기 (Phase 1 — pure ROC)

**Status**: Accepted (Phase 1 — pure analyzer, LIVE 임계 저장 후속 PR)
**Date**: 2026-05-06

## 배경

사용자 5/6 명시 — ADR-0008 Kelly Half-Life 와 같은 원리로 게이트 임계도 자가 진화. 학습 데이터 (WIN/LOSS 표본) 로 ROC 분석 → 권장 임계값 산출.

## 결정

### Phase 1 (본 PR scope) — pure analyzer만

**적용**:
1. `server/learning/gateThresholdAutoTuning.ts` SSOT 신규
2. `findOptimalThreshold(samples)` Youden's J 최대화 ROC 산출
3. `evaluateThresholdShift(currentThreshold, samples)` 4 분기 결정
4. ENV `GATE_THRESHOLD_AUTO_TUNING_DISABLED=true` 우회
5. **LIVE 임계 저장 미수행** — 사용자 spec 의 `saveLearnedThreshold` 는 후속 PR

**임계 SSOT**:
- `ROC_MIN_SAMPLE = 30` (통계 신뢰도)
- `ROC_MIN_SHIFT_PCT = 5` (변동 미미 시 hold)

**4 분기 결정**:
1. ENV DISABLED → `disabled`
2. 표본 < 30 → `insufficient_sample`
3. |shiftPct| < 5% → `hold`
4. 권장 > 현재 → `tighten`
5. 권장 < 현재 → `loosen`

### 안전 invariant

- LIVE 임계 변경 0줄 (분석 산출만, 저장 부재)
- 호출자 0건 (Phase 1 dead code)
- ENV `GATE_THRESHOLD_AUTO_TUNING_DISABLED=true` 1줄 즉시 롤백
- tie-break — Youden's J 동일 시 가장 *낮은* 임계 (보수적 진입 보존)

## 잘못된 해결 방법 영구 차단

1. **`saveLearnedThreshold` 본 PR 통합** — LIVE 영향 우려, 운영자 검토 후 후속 PR.
2. **호출자 직접 wiring (rrrGate 등)** — Phase 1 = pure analyzer, wiring 후속 분리.
3. **텔레그램 알림 본 PR** — cron + alert wiring 후속 PR.
4. **ROC_MIN_SAMPLE ENV 노출** — 정적 SSOT 로 통계 신뢰도 보존.
5. **WIN/LOSS 외 outcome 처리** — 본 분석기는 binary classification 만. PENDING/EXPIRED 는 호출자 측 필터링.
