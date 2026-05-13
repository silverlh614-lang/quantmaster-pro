# ADR-0507 — Gate1 Forensic Collector Wiring + Gate Mode Compact Split

> **Status**: Accepted — 2026-05-13
> **Predecessors**: ADR-0505 (Gate1 Minimum Signal Forensic Audit), ADR-0506 (scan_blockers compact mode + ADR-0505 emission verification)
> **Scope**: diagnostic / display only — `executionImpact='NONE'`, `liveExecutionAllowed=false`.

---

## 1. Context

ADR-0506 (PR #920, commit `52b52d1`) deployed a `/scan_blockers` 6-mode dispatcher and the 7-value ADR-0505 emission status SSOT. 운영 환경의 첫 진단 결과는 사용자 명시 **`FORENSIC_INPUTS_MISSING`** 분류였다 — `persistScanResults` 호출자가 `gate1ForensicInputs` 를 전달하지 않아 ADR-0505 forensic summary 자체가 ScanSummary 에 생성되지 않던 dead-code wiring 상태.

또한 `/scan_blockers gate` 출력은 ADR-0506 의 ADR 마커 필터링으로 인해 장문이 자주 발생, *Gate1 / ADR-0505 운영 핵심 판단* 만 빠르게 보고 싶은 운영자 요구가 발생.

---

## 2. Decision

**두 패치를 단일 ADR/PR 로 통합 (회귀 면 동일, scope 작음, 의존성 1방향)**:

### 2.1 Collector SSOT — `gate1ForensicInputsCollectorAdr0507.ts`

신규 SSOT `server/trading/signalScanner/gate1ForensicInputsCollectorAdr0507.ts`:

```ts
export function collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507(
  input: CollectGate1ForensicInputsInput,
): ReadonlyArray<BuildGate1MinimumSignalForensicInput>
```

- 입력: `EntryFilterDecomposition.gate1CandidateTraces` (`minSignalScoreTrace?` 포함) + 옵셔널 `supplyProviderHealth`.
- 동작: 각 `Gate1CandidateTrace` 에서 `minSignalScoreTrace` 가 있는 trace 만 추출하여 `BuildGate1MinimumSignalForensicInput` 배열로 변환. `minSignalScoreTrace` 부재 trace 는 silent skip.
- ENV `GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED=true` (default OFF, ADR-0157 정확 비교) — 활성 시 빈 배열 반환 → 외부 호출자가 명시 전달한 `gate1ForensicInputs` 만 사용 (회귀 격리).

### 2.2 persistScanResults 자동 합성

`server/trading/signalScanner/scanDiagnostics.ts` 의 `persistScanResults` ADR-0505 블록 진입부:

```ts
const effectiveForensicInputs =
  options.gate1ForensicInputs && options.gate1ForensicInputs.length > 0
    ? options.gate1ForensicInputs
    : collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
        gate1CandidateTraces: summaryDraft.entryFilterDecomposition?.gate1CandidateTraces,
        supplyProviderHealth: summaryDraft.entryFilterDecomposition?.supplyProviderHealth,
      });
```

호출자 측 collector 신규 코드 0건. `summaryDraft.entryFilterDecomposition` 은 이미 `persistScanResults` 안에서 `buildEntryFilterDecomposition` 으로 생성되는 SSOT 이므로 *추가 외부 호출 0*.

운영 결과: ADR-0506 의 `SUMMARY_FIELD_MISSING` 진단이 → `EMITTED` 자연 전환.

### 2.3 Gate Mode Compact Split — `parseScanBlockersMode` 확장

```ts
export type ScanBlockersGateSubMode = 'compact' | 'full';

export function parseScanBlockersMode(args): {
  mode: ScanBlockersMode;
  gateSubMode?: ScanBlockersGateSubMode;
  isUnknown: boolean;
  rawToken: string | null;
}
```

- `/scan_blockers gate` (default) → `mode='gate', gateSubMode='compact'`
- `/scan_blockers gate full` → `mode='gate', gateSubMode='full'`
- `/scan_blockers gate compact` → `mode='gate', gateSubMode='compact'` (명시)
- `/scan_blockers gate xyz` → `gateSubMode='compact'` (unknown sub silent fallback)

다른 mode (`full` / `supply` / `sector` / `runtime` / `compact`) 의 `gateSubMode` 는 항상 `undefined`.

### 2.4 Gate Compact Formatter SSOT — `formatScanBlockersGateCompactMessage`

`scanBlockersCompactAdr0506.ts` 에 신규 SSOT 추가 (30~40줄 권장):

출력 내용 (사용자 명시 §B 직접 반영):
1. 헤더 (KST 시각)
2. ADR-0505 emission 상태 (1줄 요약, EMITTED ✅ 또는 NOT_EMITTED ⚠️ + reason + action)
3. candidates / Gate1 survivors
4. requiredAvg / actualAvg / gap (3줄)
5. failed / total
6. dominant failure Top 3
7. missing positive Top 3
8. penalty Top 3
9. supply scope warnings (있을 때만)
10. SectorEnergy STRONG_BUY blocked count (>0 일 때만)
11. `impact: NONE` literal (절대 invariant 노출)
12. `/scan_blockers gate full | /scan_blockers full` 안내

### 2.5 Compact summary ADR-0505 라인 enhancement

기존 compact summary 의 `• MinScore` 라인을 forensic 의 정확 필드 (`actualScoreAvg` / `requiredScoreAvg`) 사용으로 정합화 + `• missing+: X (N)` + `• penalty: Y (M)` 두 줄 추가 — *avgScore / dominantFailure / missing positive top / penalty top* 모두 한 화면에 노출.

---

## 3. Invariants — 절대 변경 금지

ADR-0505 / ADR-0506 의 모든 invariant 보존 + 본 ADR 추가:

| # | invariant | 검증 방식 |
|---|----|---|
| 1 | `requiredScore=70` 변경 0 | 정적 grep + ADR-0505 회귀 |
| 2 | UNKNOWN penalty 수치 변경 0 | ADR-0505 회귀 |
| 3 | Gate1 / Gate2 / Gate3 판정 변경 0 | 정적 grep + ADR-0420/0422 |
| 4 | watchlist live wiring 0 | 정적 grep |
| 5 | SectorEnergy 승격 0 (STRONG_BUY 변경 금지) | ADR-0398/0400 회귀 |
| 6 | KIS / KRX / Yahoo / Naver outbound 추가 0 | 정적 grep `fetch|axios|node-fetch` |
| 7 | KIS 주문 함수 5종 import 0 | 정적 grep |
| 8 | autoTradeEngine / orderExecutor / trancheExecutor import 0 | 정적 grep |
| 9 | LIVE 매매 본체 0줄 변경 | git diff |
| 10 | `executionImpact='NONE'` literal | TypeScript 강제 |
| 11 | `liveExecutionAllowed=false` literal | TypeScript 강제 |
| 12 | ENV `=== 'true'` 정확 비교 (ADR-0157) | 정적 grep |
| 13 | console.log 직접 추가 0 — logger SSOT 위임 의무 | 정적 grep (logger 정책) |
| 14 | `minSignalScoreTrace` 부재 trace silent skip — null 강제 주입 0 | collector 회귀 |
| 15 | ScanSummary schema 변경 0 (옵셔널 후방호환) | tsc + 회귀 |
| 16 | 호출자 측 inline ENV 검사 0 — SSOT 헬퍼 위임 | 정적 grep |

---

## 4. 잘못된 해결 방법 영구 차단

| ❌ 잘못된 해결 | 사유 |
|---|---|
| 호출자 측에서 inline `process.env.GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED` 검사 | drift 위험 — SSOT 위임 의무 |
| `minSignalScoreTrace` 부재 trace 에 null 강제 주입 | ADR-0505 builder 가 trace 부재 시 throw → scan 흐름 차단 |
| `gate1ForensicInputs` 호출자 측 외부 fetch | 외부 API 호출 추가 금지 — `entryFilterDecomposition` 결과 read-only 만 |
| Gate compact formatter 가 LIVE 매매 의사결정 입력 | display only — forensic 결과로 score / threshold 변경 절대 금지 |
| `requiredScore` / threshold / Gate 판정 변경으로 emission 결손 우회 | 결손은 wiring 결함이지 점수 정책 결함 아님 |
| `formatScanBlockersGateCompactMessage` 의 30~40줄 한도 무시 | 운영자 인지 부하 폭증 — length budget 4000 자 / 50줄 가드 의무 |
| ADR-0505 forensic field 명을 임의로 가정 (`averageActualScore` 등) | ADR-0505 schema 정합 — `actualScoreAvg`/`requiredScoreAvg` 정확 사용 |

---

## 5. Rollback

회귀 발견 시 ENV 1줄로 즉시 ADR-0506 동작 100% 복원:

```bash
# scanDiagnostics auto-collector 비활성화 (ADR-0506 SUMMARY_FIELD_MISSING 동작 복원)
GATE1_FORENSIC_COLLECTOR_ADR_0507_DISABLED=true

# ADR-0505 본체 비활성화 (ADR-0506 DISABLED_BY_ENV 분기)
GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED=true
```

Gate compact sub-mode 는 ENV 가 없지만, `/scan_blockers gate full` 명시 호출로 항상 기존 ADR 마커 필터링 장문 출력 접근 가능.

---

## 6. 검증

- 회귀 38 신규 PASS (`scanBlockersGateCompactAdr0507.test.ts`)
- ADR-0506 36/36 무회귀
- scanDiagnostics 52/52 무회귀
- `tsc -p tsconfig.server.json --noEmit` EXIT=0 (변경 파일 0 errors)
- LIVE 매매 본체 0줄 변경 (`git diff --stat origin/main` — signalScanner/entryEngine/exitEngine/kisClient/orchestrator/autoTradeEngine/trancheExecutor/buyPipeline 모두 0)
- KIS/KRX/Yahoo/Naver outbound 0
- `console.log` 직접 추가 0건 (logger SSOT 정합, ADR-0506 정책 보존)

---

## 7. 후속 잠재 잔여

- ADR-0506 의 `FORENSIC_INPUTS_MISSING` 분류는 본 PR 적용 후 *호출자 측이 명시적으로* `gate1ForensicInputs: []` 빈 배열을 전달하는 경우에만 발생 (운영 환경에서는 거의 없음 — `entryFilterDecomposition` 결과가 자동 사용).
- Gate compact 의 30~40줄 길이는 SectorEnergy / Supply / Penalty 분포에 따라 변동. 50줄 초과 시 `applyScanBlockersLengthGuard` 가 'gate' budget 4000자 한도 안에서 자연 truncate (사용자 알림 + `/scan_blockers gate full` 안내 보존).
- 호출자 측이 `gate1ForensicInputs` 를 *명시적으로* 빈 배열로 전달하면 collector 자동 합성 우회 — 의도된 회귀 격리 패턴.
