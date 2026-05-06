# ADR-0395: P2 — 영속 ExecutionMode override (`data/execution_mode_override.json`)

**Status**: Accepted (P2 — 영속 layer 도입, RUNTIME → persistent → env 우선순위 체인 통합)
**Date**: 2026-05-06

## 배경

ADR-0393 (P1 ExecutionMode SSOT) 가 `RUNTIME_EXECUTION_MODE` 메모리 변수와 env 해석을 도입했지만 *영속 layer 부재* 결함:

- **재배포 시 강등 손실** — Railway 자동 재배포 / 컨테이너 재시작 시 `RUNTIME_EXECUTION_MODE` 메모리가 사라져 운영자 강등(Kill Switch / `/exec_mode_off` 같은 명령) 결과가 휘발. env 의 `EXECUTION_MODE=LIVE` 그대로 복원.
- **운영자 의사결정 영속화 부재** — 1주 이상 SHADOW 검증 시 매번 재배포 후 운영자가 다시 강등 명령 입력해야.
- **메타 모델 정합 부재** — P0-A/B/P1/P1.5 시리즈는 *관측 → SSOT → 타입 → 용어* 순으로 진행됐으나 *영속* layer 가 마지막 미완. 14-layer 결함 사슬 통합 패치 5단계의 마지막 조각.

사용자 명시 메타 모델: *"방향은 OFF/PAPER/LIVE + shadowLedger always-on, 순서는 관측 → SSOT → 타입 → 용어 → **영속**, 모든 패치는 측정 가능한 효과를 가진다"*. 본 ADR 이 영속 layer 를 채워 P0-A → P2 5단계 시리즈를 완주.

## 결정

### 1. 영속 SSOT 모듈 — `server/persistence/executionModeOverrideRepo.ts`

`data/execution_mode_override.json` 단일 영속 파일 SSOT.

**Schema**:
```typescript
{
  mode: 'OFF' | 'PAPER' | 'LIVE',
  reason?: string,    // 강등 사유 (사람이 읽을 수 있는 문구)
  setBy?: string,     // 'operator' | 'kill-switch' | 'system' | 'test'
  setAt: string       // ISO 8601 — 자동 생성
}
```

**API 5종**:
- `loadPersistentExecutionMode(): ExecutionModeOverrideRecord | null` — read SSOT (파일 부재 / 손상 JSON / 잘못된 mode → null fallback)
- `savePersistentExecutionMode({mode, reason?, setBy?, setAt?}): void` — atomic write (tmp → rename), race 시 이전 정상 본 보존
- `clearPersistentExecutionMode(): void` — unlink (idempotent ENOENT silent)
- `__resetPersistentExecutionModeForTests(): void` — 테스트 전용 cleanup
- 타입 export: `PersistentExecutionMode` (3-state union, state.ts 와 동일 — 순환 import 차단을 위한 자체 사본) + `ExecutionModeOverrideRecord`

**호출자 격리**: `state.ts` 단일 호출자만 (SSOT 위반 차단). 다른 모듈은 `setPersistentExecutionMode` / `clearPersistentExecutionMode` / `getPersistentExecutionModeRecord` (state.ts export) 만 사용.

### 2. `state.ts` 우선순위 체인 격상

**`getExecutionMode()` 3 layer 우선순위 SSOT**:

1. **RUNTIME_EXECUTION_MODE** (메모리 — Kill Switch 즉시 강등) — 휘발성, 재시작 시 사라짐
2. **영속 override** (디스크 — 운영자 영속 강등) — Railway 재배포 후에도 유지
3. **env** (`EXECUTION_MODE` / `AUTO_TRADE_MODE`) — 운영 default

```typescript
export const getExecutionMode = (): ExecutionMode => {
  if (RUNTIME_EXECUTION_MODE !== null) return RUNTIME_EXECUTION_MODE;
  if (process.env.EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED !== 'true') {
    try {
      const persisted = loadPersistentExecutionMode();
      if (persisted) return persisted.mode;
    } catch {
      // 디스크 read 결함 fallback — env 로 정상 동작 유지.
    }
  }
  return readEnvExecutionMode();
};
```

### 3. 신규 wrapper 3종 (state.ts export)

- **`setPersistentExecutionMode(mode, meta?)`** — 영속 강등 (디스크 + RUNTIME 동시 갱신, 즉시 효과). 운영자 명령 / Kill Switch escalation / 자동 강등 정책 호출자.
- **`clearPersistentExecutionMode()`** — 영속 강등 해제 (RUNTIME 도 초기화하여 env default 즉시 회복).
- **`getPersistentExecutionModeRecord()`** — 진단·UI 용 (메모리 RUNTIME 과 별개 raw record). `/mode_consistency` 같은 명령에서 RUNTIME vs persistent vs env 3-way 비교 가능.

### 4. ENV 우회 — `EXECUTION_MODE_PERSISTENT_OVERRIDE_DISABLED`

운영자 명시 활성화 시 `=true` 정확 비교 (ADR-0157 정합) → 영속 layer 완전 skip → ADR-0393 P1 동작 100% 복원. 회귀 위험 격리 안전망.

### 5. `__resetExecutionModeForTests()` 격상

영속 파일까지 함께 cleanup — 테스트 격리 보장. 운영 코드 호출 금지.

## 안전 invariant

- **외부에서 EXECUTION_MODE_OVERRIDE_FILE 직접 fs.writeFileSync 금지** — `state.ts` 단일 진입점 SSOT.
- **`executionModeOverrideRepo.ts` 외부 의존성 0** — 다른 영속 모듈 import 0건 (순환 차단).
- **외부 호출 0건** — KIS/KRX/Yahoo 와 무관.
- **try/catch 격리** — 디스크 read 결함이 매매 흐름 차단 안 함 (env fallback 으로 복원).
- **호출자 0건 (Phase 1 인프라)** — 운영자 명령 wiring (`/exec_mode_persist` 등) + Kill Switch escalation 은 후속 PR 분리.
- LIVE 매매 본체 0줄 변경 (state.ts getExecutionMode 분기 변경만).
- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4).

## 잘못된 해결 방법 영구 차단

1. **호출자 측에서 `executionModeOverrideRepo` 직접 import** — SSOT 위반 (state.ts 단일 진입점).
2. **`getExecutionMode()` 가 디스크 read 마다 호출** — race 위험 + 성능. RUNTIME 우선순위 + 디스크 read 는 RUNTIME 미설정 시 1회 한정.
3. **영속 파일에 평문 비밀번호 / API 키** — 본 파일은 `mode/reason/setBy/setAt` 4 필드만. KIS 토큰 등 다른 비밀과 무관.
4. **`fs.writeFileSync` 직접 사용** (atomic 미적용) — race 시 손상. tmp → rename 패턴 의무.
5. **본 PR 에 운영자 명령 wiring (`/exec_mode_persist OFF` 등) 통합** — 회귀 위험 격리 위해 후속 PR 분리.

## 회귀 테스트

`server/persistence/executionModeOverrideRepo.test.ts` 17 케이스 + `server/state.executionModePersistent.test.ts` 22 케이스 = **총 39 신규**.

- **executionModeOverrideRepo round-trip 7** — 부재/OFF/PAPER/LIVE/옵셔널/setAt override/자동 ISO
- **clearPersistentExecutionMode 3** — clear/idempotent/clear+save
- **안전 fallback 6** — 손상 JSON / 잘못된 mode / mode 누락 / null payload / array payload / non-string setAt
- **atomic write 1** — .tmp 파일 잔존 안 함
- **getExecutionMode 우선순위 7** — RUNTIME 우선 / RUNTIME > persistent / persistent > env / env LIVE / env PAPER / env default OFF / RUNTIME > 영속
- **setPersistentExecutionMode 3** — 메모리+디스크 동시 / __reset 후 env 복원 / Railway 재배포 시뮬
- **clearPersistentExecutionMode 2** — 해제 후 env / 부재 idempotent
- **ENV 우회 5** — true / false / "1" 거부 / "TRUE" 거부 / DISABLED 시 record null
- **영속 layer 시뮬 1** — 디스크 손상 → env fallback
- **getPersistentExecutionModeRecord 진단 2** — 부재 null / 정상 record

회귀 테스트 격리 패턴: `vi.resetModules()` + dynamic `import()` + `mkdtempSync` 별도 디렉토리 (코드베이스 정착 패턴 — `foreignerRatioRepo.test.ts` 등 차용).

## 측정 가능한 효과

- 신규 영속 SSOT 파일 1종 (`data/execution_mode_override.json`)
- 신규 모듈 1 (`server/persistence/executionModeOverrideRepo.ts`, ≤130 LoC, @responsibility SRP)
- state.ts 신규 export 3 (`setPersistentExecutionMode` / `clearPersistentExecutionMode` / `getPersistentExecutionModeRecord`)
- `getExecutionMode()` 우선순위 체인 2 layer → 3 layer 격상
- 회귀 테스트 39 신규 / 무회귀 보존
- 영속 호출자 0건 (Phase 1 인프라) — 운영자 명령 wiring 후속 PR

## 후속 PR

| 단계 | 작업 |
|---|---|
| **P2-Wiring-Telegram** | `/exec_mode_persist OFF/PAPER/LIVE` + `/exec_mode_clear` 텔레그램 명령 신설 — 운영자 영속 강등/해제 진입점. EMR riskLevel=2. |
| **P2-Wiring-KillSwitch** | `killSwitch.ts` 자동 강등 시 `setPersistentExecutionMode` 호출 — 운영자 개입 없이도 재배포 후 강등 보존. |
| **P2-Wiring-/mode_consistency** | `/mode_consistency` 명령에 영속 layer 표시 추가 — RUNTIME / persistent / env 3-way 비교 텔레그램 노출. |
| **P2-ESLint-Rule** | `executionModeOverrideRepo` 직접 import 차단 ESLint 규칙 — `state.ts` 외부에서 영속 layer 우회 영구 차단. |

## 14-layer 결함 사슬 통합 패치 시리즈 완주

| 단계 | ADR | 핵심 |
|---|---|---|
| P0-A | 0391 | 관측 계측 5 (`/mode_consistency` `/exec_matrix` `/exec_paths` + `/gate_audit` 표시 + executionStatsSsot) |
| P0-B | 0392 | env 직접 참조 7곳 → `getTradingMode()` SSOT 통일 |
| P1 | 0393 | ExecutionMode = OFF/PAPER/LIVE 3-state SSOT + `getTradingMode` deprecated wrapper |
| P1.5 | 0394 | 외부 노출 용어 SSOT (TERMINOLOGY_MAP + DISPLAY_LABELS + SHADOW_LEDGER_ENABLED) |
| **P2** | **0395 (본 ADR)** | **영속 override + RUNTIME → persistent → env 우선순위 체인 통합** |

5 ADR 시리즈 누적: 메타 모델 *"방향은 OFF/PAPER/LIVE + shadowLedger always-on, 관측 → SSOT → 타입 → 용어 → 영속"* 5 단계 모두 코드 레벨 정착.
