# ADR-0119: 빈스캔 원인 7값 분류 SSOT

**상태:** 채택 (PR-A, 2026-04-30)
**시리즈:** 옵션 B PR-A → PR-B → PR-C 의 첫 단계

## 컨텍스트

사용자 4/30 진단:

> 매수 없음 = 시스템이 보수적으로 잘 작동 중? **아닙니다.** 지금은 다음 둘이 구분되지 않습니다.
> - 매수 없음 = 진짜 살 종목이 없음
> - 매수 없음 = 데이터/필터/주문 파이프라인이 막힘

ADR-0118 (PR-Z18) 가 진단 *인프라* (`/scan_blockers` 텔레그램 명령 + WaitDistribution + MacroGateState) 만 신설하고, *원인 코드화* + *영속* 은 빠진 상태. `formatScanBlockersMessage` 의 추정 원인 분기는 String 분기로만 구현되어 있어:

1. 운영자가 *진짜 원인* 을 운영 데이터로 누적 분석 불가
2. 분류 로직이 텔레그램 메시지 빌더에 종속 (단위 테스트 어려움)
3. 향후 UI 노출 / 자동 진단 리포트 / R3 Sanity Violation 등 후속 PR 의 SSOT 부재

## 결정

### 1. `EmptyScanReason` 7값 union SSOT 신설

`server/trading/signalScanner/emptyScanClassifier.ts`:

```typescript
export type EmptyScanReason =
  | 'MARKET_WEAK'        // 레짐 Risk-Off / R6_DEFENSE / Bear / VIX / FOMC DAY
  | 'NO_LEADERSHIP'      // Gate1>0 && Gate2=0 (PR-B 카운터 분리 후 활성)
  | 'NO_TIMING'          // Pre-breakout 미발동 50%+
  | 'TOO_STRICT'         // Gate 재검증 미달 50%+ — 임계 과도
  | 'DATA_INVALID'       // dataHold + corpAction 30%+ — sanity 위반 다수
  | 'PIPELINE_ERROR'     // candidates 0 — 스캔 자체 망가짐
  | 'ORDER_BLOCKED'      // emergencyStop / !autoTrade / sellOnly / watchlist 0 / 사이징 차단
  | 'UNKNOWN';           // 분류 불가 fallback
```

### 2. `classifyEmptyScanReason(summary)` 분류 우선순위 SSOT

```
1. entries > 0 → null (분류 대상 아님)
2. candidates === 0 + macro 미수집 → PIPELINE_ERROR
3. macro 차단 (R6/Bear/MHS<30/VIX/FOMC DAY) → MARKET_WEAK
4. order 차단 (emergencyStop/!autoTrade/sellOnly/watchlistEmpty/sizingBlocked) → ORDER_BLOCKED
5. dataHold + corpAction ≥ 30% → DATA_INVALID
6. gateFail ≥ 50% → TOO_STRICT
7. preBreakout ≥ 50% → NO_TIMING
8. 그 외 → UNKNOWN
```

`NO_LEADERSHIP` 은 PR-B 에서 `gate1PassCount` / `gate2PassCount` 분리 후 활성. 본 PR-A 는 현재 ScanCounters 로 분류 가능한 6값 + UNKNOWN fallback 만 작동.

### 3. `ScanSummary.emptyScanReason?` 옵셔널 영속

`scanDiagnostics.ts persistScanResults` 가 매 스캔 종료 시 자동 분류 호출 — `entries > 0` 시 미부여 (분류 대상 아님). 후방호환 옵셔널 패턴.

### 4. `describeEmptyScanReason(reason)` 한국어 라벨 + advice SSOT

7값 모두 `{ label, advice }` 반환. `formatScanBlockersMessage` 가 String 분기 대신 SSOT 사용 — 단위 테스트 가능.

### 5. 분류 임계 SSOT 상수

`EMPTY_SCAN_CLASSIFIER_THRESHOLDS`: DATA_INVALID 0.3 / TOO_STRICT 0.5 / NO_TIMING 0.5. ENV 우회는 PR-B 에서 운영 데이터 누적 후 도입 검토.

## 결과

### 변경 파일

- `server/trading/signalScanner/emptyScanClassifier.ts` (신규 SSOT)
- `server/trading/signalScanner/emptyScanClassifier.test.ts` (신규 46 케이스)
- `server/trading/signalScanner/scanDiagnostics.ts` (ScanSummary +emptyScanReason? + persistScanResults wiring + formatScanBlockersMessage 격상)

### 검증

- vitest 46/46 신규 + 인접 무회귀
- LIVE 매매 본체 0줄 변경 (분류 SSOT + 영속 옵셔널 필드 + 메시지 포맷 격상만)
- KIS/KRX 자동매매 quota 0 침범

### 운영 효과

운영자가 텔레그램 `/scan_blockers` 입력 시 `💡 빈스캔 원인 (ADR-0119): TOO_STRICT` 형식으로 *분류 코드* + *advice* 자동 노출. 1~2주 운영 데이터 누적 후 *진짜 원인* 분포 확정 → PR-B (gate0/1/2/3 카운터 분리 + R3 Sanity Violation) + PR-C (Price Source Policy / Yahoo 강등) 의사결정 데이터 마련.

### 후속 PR

- **PR-B**: ScanCounters 에 gate0/1/2/3PassCount + lastTriggerPassCount 추가 → NO_LEADERSHIP 활성 + R3 Sanity Check (gate1PassCount=0 시 SanityViolation)
- **PR-C**: Price Source Policy SSOT (canonicalPrice = KIS 우선) + DataQuarantine 별도 격리 (DATA_HOLD WAIT 와 분리)
