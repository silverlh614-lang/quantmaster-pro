# ADR-0393: P1 Stage A — `ExecutionMode = OFF | PAPER | LIVE` SSOT 도입

**Status**: Accepted (P1 Stage A — 타입 + SSOT 진입점만, 매수 흐름 wiring 은 P1-Wiring 후속 PR)
**Date**: 2026-05-06

## 배경

ADR-0391/0392 (P0-A/B) 가 *4-state TradingMode* 를 `getTradingMode()` SSOT 로 통일했지만, 사용자 명시 메타 모델 *"방향은 OFF/PAPER/LIVE + shadowLedger always-on, SHADOW 는 학습 layer"* 정합 부재. SHADOW 가 *실행 모드* 로 분류되어 학습 ledger 가 *모든 모드에서 always-on* 이라는 의도가 코드 레벨에 표현 안 됨.

P1 은 두 단계로 분리:
- **Stage A (본 PR)**: `ExecutionMode = OFF | PAPER | LIVE` 타입 + SSOT 진입점 도입. 매수 흐름 wiring 0 — *동작 영향 0%*.
- **Stage B (P1-Wiring 후속 PR)**: 매수 발사 로직에 `getExecutionMode()` 사용 + `ShadowDecisionRecord` 영속 schema 도입 + `ServerShadowTrade.mode` union 확장.

## 결정

### Stage A — `state.ts` ExecutionMode SSOT

**신규 export**:
- `ExecutionMode` type 3-state union (`'OFF' | 'PAPER' | 'LIVE'`)
- `getExecutionMode()` — RUNTIME override + env 해석 SSOT
- `setExecutionMode(mode)` — RUNTIME override 설정
- `readEnvExecutionMode()` — env 해석 SSOT (테스트·진단용)
- `__resetExecutionModeForTests()` — 테스트 격리

**env 해석 우선순위 SSOT**:
1. `EXECUTION_MODE` env 명시 → 그대로 사용 (LIVE/PAPER/OFF)
2. `AUTO_TRADE_MODE` env 호환 매핑:
   - `LIVE` → `LIVE`
   - `PAPER` / `VTS` → `PAPER`
   - `SHADOW` / `MANUAL` / 그 외 → `OFF` (학습 layer 만 작동)

### `getTradingMode` deprecated wrapper 격상

기존 `getTradingMode()` 는 `RUNTIME_MODE ?? readEnvMode()` 단순 조회. 본 PR 에서:
- `RUNTIME_MODE` 우선 (기존 `setTradingMode('SHADOW')` 호출자 동작 보존)
- 둘 다 미설정 시 `getExecutionMode()` 에서 derive — `LIVE`/`PAPER` 그대로, `OFF` → `SHADOW`

**MANUAL 반환 케이스 사라짐** — 기존 `readEnvMode` 가 unrecognized env fallback 으로 'MANUAL' 반환했지만 호출자 0건 (audit 검증). `setTradingMode`/`getTradingMode` 호출자 모두 'LIVE' / 'PAPER' / 'SHADOW' 만 사용.

### `setTradingMode` 동기화 wrapper

`setTradingMode(mode)` 호출 시 `RUNTIME_MODE` + `RUNTIME_EXECUTION_MODE` 동시 갱신. 매핑:
- `'LIVE'` → `'LIVE'`
- `'PAPER'` → `'PAPER'`
- `'SHADOW'` / `'MANUAL'` → `'OFF'`

기존 호출자 (engineSnapshotRepo:99, killSwitch:152) — 모두 `setTradingMode('SHADOW')` → ExecutionMode `'OFF'` 자동 매핑. 동작 보존.

## 안전 invariant

- **byte-equivalent 동작 보존** — `getTradingMode()` 가 ExecutionMode SSOT derive 하지만 RUNTIME_MODE 우선이라 기존 setter 호출자 동작 동일. env 해석도 SHADOW → 'SHADOW' 동일.
- **호출자 0줄 변경** — Stage A 는 *타입 + 함수 진입점만* 추가. 기존 코드는 `getTradingMode()` 그대로 호출 → 동작 동일.
- ExecutionMode 영속 schema 변경 0 (Stage B 작업)
- `ServerShadowTrade.mode` union 변경 0 (Stage B 작업)
- 매수 흐름 wiring 0 (Stage B 작업)
- KIS/KRX 자동매매 quota 0 침범
- LIVE 매매 본체 0줄 변경

## 잘못된 해결 방법 영구 차단

1. **Stage A 에 매수 흐름 wiring 통합** — *동작 영향 0%* 약속 위반. Stage B 별도 PR 의무.
2. **`setTradingMode` 제거** — 2 호출자 (engineSnapshotRepo / killSwitch) 회귀 위험. deprecated wrapper 로 호환 유지.
3. **`MANUAL` 케이스 보존** — 호출자 0건 + ExecutionMode 3-state 단순화 정합. ADR-0393 SSOT 일원화.
4. **RUNTIME_MODE 와 RUNTIME_EXECUTION_MODE 분리 운영** — drift 위험. setTradingMode 가 양쪽 동시 갱신 의무.
5. **EXECUTION_MODE env 가 AUTO_TRADE_MODE 우선 안 함** — 명시적 우선순위 SSOT — EXECUTION_MODE 명시 시 그대로, 미설정 시 AUTO_TRADE_MODE 호환 매핑.

## 회귀 테스트

`server/state.executionMode.test.ts` 20 케이스:
- `readEnvExecutionMode` 12 (env 해석 우선순위 + 호환 매핑 + boundary)
- `getExecutionMode` + `setExecutionMode` 3 (RUNTIME override + reset)
- `getTradingMode` deprecated wrapper 5 (ExecutionMode → TradingMode 매핑)

영향 영역 무회귀 (server/orchestrator + server/trading + server/telegram + server/scheduler) — 15 사전 baseline fail 본 PR 무관, 신규 회귀 0.

## 측정 가능한 효과

- `ExecutionMode` 신규 export 1건 + 5 함수 (`getExecutionMode` / `setExecutionMode` / `readEnvExecutionMode` / `__resetExecutionModeForTests` + `setTradingMode` 동기화 격상)
- 신규 회귀 테스트 20/20 pass
- 기존 호출자 동작 byte-equivalent (15 사전 baseline 무회귀)

## 후속 PR

| 단계 | 작업 |
|---|---|
| **P1-Wiring** (별도 PR) | 매수 흐름 (`buyPipeline.ts` / `trancheExecutor.ts`) 가 `getExecutionMode()` 사용 + `ShadowDecisionRecord` 영속 + `ServerShadowTrade.mode` union 확장 ('LIVE' | 'PAPER' | 'SHADOW') |
| **P1.5** (ADR-0394) | 용어 정리 (shadow buy → shadowDecisionRecorded 등) |
| **P2** (ADR-0395) | 영속 override (`data/execution_mode_override.json`) |
