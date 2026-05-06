# ADR-0391: P0-A — Mode 관측 계측 (14 layer 결함 사슬 통합 패치)

**Status**: Accepted (P0-A — 동작 영향 0%)
**Date**: 2026-05-06

## 배경

15회 외부 분석을 거친 *14 layer 결함 사슬 디버깅* 의 최종 합의안. P0-A 는 *관측 계측* 단계 — 시스템 동작은 변경하지 않고 **현재 상태와 행동의 괴리를 가시화** 만 추가.

페르소나 원칙 정합:
- 원칙 1 (자기 학습) — shadowLedger always-on 정의 (P1 wiring 직전 단계)
- 원칙 5 (체계적 알파) — 관측 → SSOT → 타입 → 용어 → 영속 점진 마이그레이션
- 원칙 9 (확신 편향 경계) — *기대 vs 실제* 괴리 자동 진단

사용자 명시 *"방향은 OFF/PAPER/LIVE + shadowLedger always-on, 순서는 관측 → SSOT → 타입 → 용어 → 영속, 모든 패치는 측정 가능한 효과를 가진다"* — P0-A 는 이 메타 지침의 첫 번째 단계.

## 결정 — P0-A 5 항목

### A-1. `/mode_consistency` 텔레그램 명령 신규
`server/state.ts` 의 `getTradingMode()` + `getKillSwitchLast()` SSOT read-only. env vs runtime 비교 + KIS_IS_REAL 플래그 + Live order 가능 여부 합성. 일관성 분류 3분기 (CONSISTENT / INTENDED_OVERRIDE / UNINTENDED_DIVERGENCE).

### A-2. `/exec_matrix` 텔레그램 명령 신규
모드별 *Expected vs Actual 7d* 결과 행렬. **자동 진단 텍스트 생성** — 4 패턴:
- `evaluated > 0 && shadowRecorded === 0` → 🚨 shadowLedger not always-on
- LIVE 모드 + `liveOrderSent === 0 && liveBlocked > 0` → ⚠️ Kill switch / Gate 결함
- `ghost > shadowRecorded × 2` → ⚠️ 워치리스트 거래 단계 차단
- 그 외 → ✅ 일치

### A-3. `/exec_paths` 텔레그램 명령 신규
`process.env.AUTO_TRADE_MODE` 직접 참조 위치 정적 표시. 카탈로그 SSOT — Allowed 4 (state.ts/index.ts/diagnostics/bootManifest) vs Needs Migration 7 (orchestrator/trancheExecutor/dryRunScanner/preflight/bootReconcile/gateAudit/healthCheckJob). 사용자 명시 6곳 + audit 검출 healthCheckJob 1곳.

### A-4. `/gate_audit` 표시 개선
"거시 게이트 상태" 섹션에 envMode + runtimeMode + killSwitchReason + modeConsistency 4 라인 추가. `process.env.AUTO_TRADE_MODE` 직접 참조 *제거 안 함* (ADR-0262 P0-B 작업).

### A-5. `executionStatsSsot` 5분류 통계 헬퍼 SSOT
`server/persistence/executionStatsSsot.ts` — `compute7dExecutionStats(now?)` 단일 진입점. 5분류 분리:
- `shadowRecorded` — 모든 ServerShadowTrade (모든 모드 always-on)
- `paperBuyRecorded` — `mode === 'PAPER'` 또는 `mode === 'VTS'` (현재 영속 schema 부재 — P1 ExecutionMode 도입 시 활성화 placeholder)
- `liveOrderSent` — `mode === 'LIVE'`
- `liveBlocked` — LIVE 모드 한정 차단 (placeholder, P1 wiring 후 활성화)
- `ghost` — `loadGhostPortfolio()` (워치리스트 → 거래 미연결)

P0-A 단계 한정 — 영속 스키마 변경 0 (P1 작업).

## 안전 invariant

- **동작 영향 0%** — env 직접 참조 제거 안 함 (P0-B 작업 분리)
- **ExecutionMode 도입 금지** — P1 작업
- **영속 override 금지** — P2 작업
- 기존 4-state (LIVE/PAPER/SHADOW/MANUAL) 타입 유지
- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4 — kisClient/orchestrator/autoTradeEngine 본체 무수정)
- LIVE 매매 본체 0줄 변경
- @responsibility 태그 모든 신규 파일

## 잘못된 해결 방법 영구 차단

1. **P0-A 에 ExecutionMode 도입** — P1 분리 의무. 한 번에 구현 시 회귀 위험 큼.
2. **P0-A 에 env 참조 제거** — P0-B 분리. /exec_paths 가 *측정 가능한 효과* 검증 도구.
3. **/exec_matrix 통계 ServerShadowTrade.mode 직접 영속 변경** — P1 ShadowDecisionRecord 도입 시점.
4. **/exec_paths 카탈로그를 정적 코드 분석으로 자동 산출** — 본 P0-A 는 manual SSOT, 동적 분석은 후속 PR.
5. **사용자 명시 ADR-0501** — INDEX.md 권한 (ADR-0148) 따라 0261 발급. 0501 ~ 0505 는 향후 P0-B/P1/P1.5/P2 가 도달할 시점에 INDEX.md 가 발급.

## 후속 ADR (사용자 명시 안전 가드레일)

| 단계 | 일정 | 작업 |
|---|---|---|
| **P0-B** | 1주 baseline 후 | env 직접 참조 7곳 → `getTradingMode()` 통일 |
| **P1** | 3일 회귀 검증 후 | `ExecutionMode = OFF \| PAPER \| LIVE` 도입 + shadowLedger always-on wiring |
| **P1.5** | 1주 SHADOW 검증 후 | 용어 정리 (shadow buy → shadowDecisionRecorded 등) |
| **P2** | 7일 PAPER 검증 후 | 영속 override (data/execution_mode_override.json) |

각 단계는 *측정 가능한 효과* 의무 — `/exec_paths` 의 Needs Migration 카운트 변화 / `/exec_matrix` 의 shadowRecorded 변화 / `/mode_consistency` 의 일관성 상태 변화로 검증.

## 회귀 테스트

- `modeConsistency.cmd.test.ts` — 일관성 3 분기 + KILL_SWITCH 시나리오 + KIS_IS_REAL 분기
- `execMatrix.cmd.test.ts` — Expected vs Actual 산출 + 자동 진단 4 패턴
- `execPaths.cmd.test.ts` — Allowed/Needs Migration 카운트 + 진단 텍스트
- `executionStatsSsot.test.ts` — 5분류 산출 + 7d 윈도우 + ghost 통합
- `gateAudit.cmd.test.ts +N` — 거시 게이트 상태 4 라인 추가 검증

## 검증 — 측정 가능한 효과

P0-A 머지 후 1주일 운영:
1. `/mode_consistency` 호출 시 환경 일관성 즉시 확인 (이전 진단 도구 부재)
2. `/exec_matrix` 의 shadowRecorded 카운트 = 현재 운영 baseline 측정
3. `/exec_paths` Needs Migration 카운트 = 7 (P0-B 진행 후 0 으로 수렴)
4. `/gate_audit` 메시지에 envMode/runtimeMode 동시 표시 — 운영자 확인 절차 자동화

P0-A 머지 후 baseline 측정 7일 → P0-B 진입 결정.
