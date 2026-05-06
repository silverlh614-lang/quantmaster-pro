# ADR-0323: 게이트별 통과율 SLA SSOT (Phase 1 — 상수 + 계산 헬퍼)

**Status**: Accepted (Phase 1 — pure SSOT only, cron wiring 후속 PR)
**Date**: 2026-05-06
**PR**: claude/fix-gate-evaluation-fallback-mDmdZ

## 배경

사용자 5/6 명시 — 각 entryGate 의 통과율 목표 범위를 SLA로 정의하고 위반 시 경보. 매일 cron 으로 7일 윈도우 통과율을 측정해 "과보수 (OVER_CONSERVATIVE)" / "과개방 (OVER_PERMISSIVE)" 자동 검출.

기존 인프라:
- `scanTracer.ts` (`appendScanTraces` / `loadScanTraces` / `loadTodayScanTraces`) 이미 일자별 영속.
- `ScanTrace.stages: Record<string, string>` 에 단계별 PASS/FAIL/BLOCK 정보 영속.

## 결정

### Phase 1 (본 PR scope) — 상수 + 계산 헬퍼만

**적용**:
1. `server/constants/gateSLA.ts` SSOT 신규
2. `GATE_PASS_RATE_SLA` 상수 매트릭스 — 실제 scanTrace stages 키 기준
3. `calculateGatePassRate(stageKey, traces)` 순수 함수
4. `evaluateGateSLA(stageKey, traces)` SLA 분류 (5 status)
5. `evaluateAllGateSLA(traces)` 매트릭스 일괄 평가
6. ENV `GATE_SLA_DISABLED=true` 우회 (ADR-0157 정확 비교)

**보류 (후속 PR)**:
- `detectGateSLAViolations` cron + 텔레그램 알림 wiring
- 사용자 spec 의 가공 키 (`cooldownGate` / `blacklistGate` / `kelly` / `supplyHealth`) 추가
  → 해당 게이트들이 stageLog 에 영속되지 않음. stageLog 추가 wiring 자체가 LIVE 영향이라 별도 PR 분리.

### SLA 매트릭스 (실제 측정 가능 키만)

| stageKey | min | max | 의미 |
|---|---|---|---|
| `price` | 0.95 | 1.00 | 가격 fetch 안정성 |
| `drift` | 0.70 | 1.00 | entryPrice drift 정상 비율 |
| `rrr` | 0.60 | 0.95 | RRR ≥ 임계 통과율 |
| `portfolioRisk` | 0.80 | 1.00 | 포트폴리오 리스크 통과율 |
| `sectorGuard` | 0.70 | 1.00 | 섹터 사전 가드 |
| `timeframeConfluence` | 0.50 | 0.90 | 다중 타임프레임 합치도 (보수) |
| `gate` | 0.40 | 0.80 | entryRevalidation (가장 보수) |

### 분류 우선순위 SSOT (5 status)

1. **ENV DISABLED** → `NO_SLA` (전체 우회)
2. SLA 매트릭스 미등재 → `NO_SLA`
3. 표본 < `GATE_SLA_MIN_SAMPLE` (10) → `INSUFFICIENT_SAMPLE`
4. passRate < min → `OVER_CONSERVATIVE`
5. passRate > max → `OVER_PERMISSIVE`
6. 그 외 → `OK`

## 안전 invariant

- LIVE 매매 본체 0줄 변경 (read-only 분석 SSOT 만).
- KIS/KRX 자동매매 quota 0 침범.
- ENV `GATE_SLA_DISABLED=true` 1줄 즉시 롤백.
- `pass = stage value === 'PASS'` 정의 — FAIL/BLOCK/DATA_HOLD/REMOVE 모두 미통과.
- stage 키 부재 trace 는 카운트 제외 (조기 차단 시나리오에서 다른 게이트 노이즈 차단).

## 잘못된 해결 방법 영구 차단

1. **사용자 spec 가공 키 (cooldownGate/kelly/supplyHealth) 매트릭스 추가** — 해당 게이트들이 stageLog 영속 안 함, stageLog 추가는 LIVE buyListLoop 변경이라 회귀 위험 큼. 별도 PR 분리.
2. **cron 본 PR 통합** — Phase 1 = 순수 SSOT 만, 회귀 위험 격리 정책.
3. **PASS 외 (BLOCK/DATA_HOLD 등) 도 통과로 간주** — pass 정의 단일화, "PASS 만 통과".
4. **SLA 임계 ENV 노출** — Phase 1 은 정적 SSOT 만. 자동 조정은 ADR-0325 (Threshold Auto-Tuning) scope.
5. **표본 < 10 도 SLA 평가 적용** — 통계 신뢰도 부족, INSUFFICIENT_SAMPLE 보류.

## 후속 PR (deferred)

- **ADR-0323-Cron**: `detectGateSLAViolations` 일일 cron + 텔레그램 알림 (회귀 위험 격리 후 진행)
- **stageLog 확장**: 사용자 spec 의 cooldownGate/kelly/supplyHealth 측정 가능하도록 stageLog 추가 (LIVE wiring)
- **ADR-0324** 와 결합 — SLA + Contribution 통합 진단 보고서

## 회귀 테스트

`gateSLA.test.ts` — SSOT 상수 검증 + ENV gate + calculateGatePassRate 6 분기 + evaluateGateSLA 6 분기 + evaluateAllGateSLA 통합 3건 = 20+ 케이스.
