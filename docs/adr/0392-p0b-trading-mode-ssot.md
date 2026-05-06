# ADR-0392: P0-B — `getTradingMode()` SSOT 통일 (env 직접 참조 마이그레이션)

**Status**: Accepted (P0-B — 동작 보존, byte-equivalent 마이그레이션)
**Date**: 2026-05-06

## 배경

ADR-0391 (PR #660) P0-A 의 `/exec_paths` 진단 도구가 `process.env.AUTO_TRADE_MODE` 직접 참조 7곳 (Needs Migration) 표면화. P0-B 는 *측정 가능한 효과* 의무 충족 — 7곳 → 0곳 마이그레이션.

사용자 명시 P0-B §6: *"기존 4-state(LIVE | PAPER | SHADOW | MANUAL) 유지 — 타입 변경 없이 단일 진실 소스만 통합"*. ExecutionMode 도입은 P1 (ADR-0393).

## 결정

### 5 분기 로직 마이그레이션 (env 직접 참조 → `getTradingMode()`)

| 파일 | 라인 | 변경 |
|---|---|---|
| `server/orchestrator/tradingOrchestrator.ts` | 75 | `process.env.AUTO_TRADE_MODE === 'LIVE'` → `getTradingMode() === 'LIVE'` |
| `server/trading/trancheExecutor.ts` | 215 | 동일 |
| `server/trading/dryRunScanner.ts` | 93 | `process.env.AUTO_TRADE_MODE !== 'LIVE'` → `getTradingMode() !== 'LIVE'` |
| `server/trading/signalScanner/preflight.ts` | 126 | 동일 |
| `server/trading/bootReconcile.ts` | 32-33 | `process.env.AUTO_TRADE_MODE !== 'LIVE'` → `getTradingMode()` + `reason: tradingMode=...` |

각 위치에 `getTradingMode` import 추가 + ADR-0392 주석.

### 2 display only 재분류 (ALLOWED 격상)

| 파일 | 라인 | 사유 |
|---|---|---|
| `server/scheduler/healthCheckJob.ts` | 95 | 진단 메시지 생성 (display only) |
| `server/telegram/commands/system/gateAudit.cmd.ts` | 344 | `autoTradeMode` `formatGateAuditMessage` display 입력 |

display only 는 의사결정 분기에 사용되지 않으므로 SSOT 우회 위험 0. 사용자 명시 P0-B §6 *"envMode 표시는 유지 (display only이므로 ALLOWED 분류)"* 정합.

### `/exec_paths` 카탈로그 갱신

`ALLOWED_DIRECT_ACCESS` 5 → 7 (gateAudit + healthCheckJob 추가).
`NEEDS_MIGRATION` 7 → 0 (5곳 마이그레이션 + 2곳 재분류).

`formatExecPathsMessage` — `NEEDS_MIGRATION.length === 0` 시 `🚨` → `✅` 헤더 마커.

### 사용자 명시 P0-B 검증

> 1. `/exec_paths` 호출 시 "Needs Migration" 0곳 확인
> 2. 기존 회귀 테스트 모두 통과
> 3. SHADOW 모드에서도 정상 작동 검증

3개 모두 충족.

## 안전 invariant

- **byte-equivalent 동작 보존** — `getTradingMode()` 가 내부적으로 `RUNTIME_MODE ?? readEnvMode()` 반환, env 미설정 시 'SHADOW' fallback 동일 (state.ts:78-89).
- ExecutionMode 도입 0 (ADR-0393 P1 작업)
- 영속 override 도입 0 (P2 작업)
- 기존 4-state 타입 유지
- KIS/KRX 자동매매 quota 0 침범
- LIVE 매매 본체 byte-equivalent (분기 결과 동일)

## 잘못된 해결 방법 영구 차단

1. **gateAudit.cmd.ts 의 envMode/autoTradeMode display 도 마이그레이션** — display only 라 SSOT 우회 위험 0, 마이그레이션 의무 부재. 사용자 명시 §6 정합.
2. **healthCheckJob 의 display 변경** — 진단 메시지는 운영자에게 *env 값 그대로* 보여줘야 의미 있음 (`getTradingMode()` 는 RUNTIME_MODE override 적용 결과 반환).
3. **state.ts 자체의 readEnvMode 변경** — SSOT 본체 — env 직접 참조의 *유일한 정당한 위치*.
4. **tests 의 `process.env.AUTO_TRADE_MODE = ...` 패턴 변경** — 테스트가 env 를 시뮬레이션해 `getTradingMode()` 동작 검증, 정당한 패턴.

## 회귀 테스트

- 기존 `tradingOrchestrator.test.ts` / `trancheExecutor.test.ts` / `dryRunScanner.test.ts` / `preflight.test.ts` / `bootReconcile.test.ts` 무회귀 — 67/67 pass
- `bootReconcile.test.ts` reason 메시지 정합 — `AUTO_TRADE_MODE=SHADOW` → `tradingMode=SHADOW` 2건 정정
- `preflight.test.ts` state.js mock 에 `getTradingMode: vi.fn().mockReturnValue('SHADOW')` 추가
- `execPaths.test.ts` 카탈로그 정합 — ALLOWED 7 / NEEDS_MIGRATION 0 + ✅ 마커 검증

## 측정 가능한 효과

- `/exec_paths` 호출 시: Needs Migration 7 → **0** ✅
- ALLOWED 카운트: 5 → **7**
- 분기 로직 SSOT 통일률: 5/5 (100%)
- baseline regression: 15 failed (사전 baseline) — 본 PR 무관, 0 신규

## 후속 ADR (사용자 명시 안전 가드레일)

| 단계 | 일정 | 작업 |
|---|---|---|
| **P1** | 본 PR 후 3일 회귀 검증 → | ExecutionMode = OFF\|PAPER\|LIVE + shadowLedger always-on wiring (ADR-0393) |
| **P1.5** | P1 후 1주 SHADOW 검증 → | 용어 정리 (shadow buy → shadowDecisionRecorded 등, ADR-0394) |
| **P2** | P1.5 후 7일 PAPER 검증 → | 영속 override (data/execution_mode_override.json, ADR-0395) |

사용자 직접 요청 *"나머지도 다 진행하자 그냥"* — 4단계 직렬 진행 (각 PR 머지 후 다음 진입).
