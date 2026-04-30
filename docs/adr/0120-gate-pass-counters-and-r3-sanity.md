# ADR-0120: Gate 1/2/3 통과 카운터 분리 + R3 Sanity Check

**상태:** 채택 (PR-B, 2026-04-30)
**시리즈:** 옵션 B PR-A → **PR-B** → PR-C 의 두 번째 단계

## 컨텍스트

ADR-0119 (PR-A) 가 빈스캔 원인 7값 SSOT 를 도입했지만 NO_LEADERSHIP 분기는 *비활성* 상태. 사용자 9번 §5 의 분류 규칙:

```
- gate1PassCount > 0 && gate2PassCount == 0 → NO_LEADERSHIP
- gate2PassCount > 0 && gate3PassCount == 0 → NO_TIMING
- gate3PassCount > 0 && lastTriggerPassCount == 0 → NO_TIMING
```

는 ScanCounters 에 Gate 1/2/3 별 통과 카운터 부재로 활성 불가능했다. 또한 사용자 9번 §6 의 R3 Sanity Check 부재:

> if regime == 'R3':
>   if gate1PassCount == 0:
>     raise SanityViolation: 'R3_EMPTY_SCAN_SUSPECT'
>   "R3 레짐인데 후보군이 비정상적으로 부족합니다. 시장 문제가 아니라 데이터/필터/파이프라인 문제일 수 있습니다."

## 결정

### 1. `GatePassDistribution` 인터페이스 신설

`scanDiagnostics.ts`:

```typescript
export interface GatePassDistribution {
  gate1Pass: number;       // Gate 1 (생존 필터) 통과 종목 수
  gate2Pass: number;       // Gate 2 (성장 검증) 통과 종목 수
  gate3Pass: number;       // Gate 3 (정밀 타이밍) 통과 종목 수
  lastTriggerPass: number; // lastTrigger 발동 종목 수
}
```

### 2. `ScanCounters` 4 카운터 추가

`gate1Pass` / `gate2Pass` / `gate3Pass` / `lastTriggerPass` 추가. `createScanCounters` 가 0 초기화.

### 3. `ScanSummary.gatePassDistribution?` 옵셔널 영속

`persistScanResults` 가 `buildGatePassDistribution(counters)` 으로 자동 영속. 후방호환 옵셔널.

### 4. `perSymbolEvaluation` Gate 통과 카운터 wiring

candidate 평가 진입 직후 (`stageLog.price = 'PASS'` 다음) `stock.gateEvaluation.gate1Passed/gate2Passed/gate3Passed` boolean 을 카운터에 누적. WatchlistEntry 영속 schema 변경 회피 위해 inline type cast 사용. try/catch 격리.

### 5. `emptyScanClassifier` NO_LEADERSHIP / NO_TIMING 활성

분류 우선순위 트리 6~8 단계 추가 (DATA_INVALID 다음, TOO_STRICT 이전):

```
6. gate1Pass>0 && gate2Pass=0 → NO_LEADERSHIP (생존했으나 성장주 부재)
7. gate2Pass>0 && gate3Pass=0 → NO_TIMING (성장은 있으나 타이밍 부재)
8. gate3Pass>0 && lastTriggerPass=0 → NO_TIMING (정밀 타이밍은 있으나 트리거 부재)
```

GatePassDistribution 부재 시 자동 skip — PR-A 의 6값 분류로 fallback.

### 6. R3 Sanity Check 신설

`server/trading/signalScanner/r3SanityCheck.ts` 신규 SSOT:

```typescript
export type R3SanityViolationType =
  | 'NONE'
  | 'GATE1_PASS_ZERO'        // R3 + Gate 1 통과 0개 (사용자 §6 핵심)
  | 'GATE_PASS_DATA_MISSING' // GatePassDistribution 미수집
  | 'CANDIDATES_ZERO';       // R3 + candidates 0
```

분기 SSOT:
- R3 아닌 레짐 → NONE
- R3 + entries > 0 → NONE (정상 매수)
- R3 + candidates 0 → CANDIDATES_ZERO (universe/워치리스트 결함)
- R3 + GPD 미수집 → GATE_PASS_DATA_MISSING (wiring 미완)
- R3 + Gate 1 통과 0 + candidates>0 → GATE1_PASS_ZERO (시스템 결함 의심 — 5 분기 안내)

`persistScanResults` 가 매 스캔 종료 시 자동 호출 → SanityViolation 발생 시 텔레그램 HIGH 알림 (24h dedupeKey, KST 일자별 1회).

## 결과

### 변경 파일

- `server/trading/signalScanner/scanDiagnostics.ts` (GatePassDistribution + ScanCounters 4 카운터 + persistScanResults wiring + R3 Sanity import)
- `server/trading/signalScanner/emptyScanClassifier.ts` (NO_LEADERSHIP / NO_TIMING 활성)
- `server/trading/signalScanner/perSymbolEvaluation.ts` (Gate 통과 카운터 wiring)
- `server/trading/signalScanner/r3SanityCheck.ts` (신규 SSOT)
- `server/trading/signalScanner/r3SanityCheck.test.ts` (신규 12 케이스)
- `server/trading/signalScanner/emptyScanClassifier.test.ts` (PR-B 분기 6 케이스 추가)

### 검증

- vitest 314/314 pass (PR-A 46 + PR-B r3SanityCheck 12 + PR-B 분류기 6 + 인접 무회귀 250)
- lint(client + server tsc) 0 에러
- KIS/KRX 자동매매 quota 0 침범
- LIVE 매매 본체 0줄 변경 (진단 전용 카운터 + 옵셔널 영속 + R3 Sanity 알림)

### 운영 효과

1. **R3 sanity violation 자동 감지** — R3 레짐 + Gate 1 통과 0 시 텔레그램 HIGH 알림 → 운영자가 *시장 문제 vs 시스템 결함* 구분 가능
2. **NO_LEADERSHIP / NO_TIMING 정밀 분류** — Gate 단계별 통과 수로 *어디서 멈췄는지* 즉시 진단
3. **Gate threshold 과도 진단** — sanity violation 메시지에 EXECUTION_RELAXATION_ENABLED + Yahoo stale base + 27조건 점수 산출 5 분기 자동 안내

### 후속 PR

- **PR-C**: Price Source Policy SSOT (KIS canonicalPrice 승격) + DataQuarantine 별도 격리
