# ADR-0118: 매수 차단 사유 진단 인프라 + `/scan_blockers` 텔레그램 명령

## 상태
승인 (2026-04-30)

## 배경

### 사용자 보고
> "FOMC 다음날인데 매수가 하나도 발생 안 함 (코스피가 하락 중이지만). 근본적으로 문제가 있음."

ADR-0057 (FOMC v4) POST_1 부스트 ×1.30 + ADR-0076 (Kelly 결합) FOMC 우선 정책이
정상 작동해야 매수 발생. 그러나 매수 0 — *어느 게이트가 차단하는지* 운영자가
알 수 없는 상태.

### 가능한 차단 게이트 카탈로그 (13종)
1. emergencyStop (비상정지)
2. R6_DEFENSE 레짐 → kellyMultiplier=0
3. VIX 게이팅
4. bearDefenseMode
5. MHS<30 매크로 헬스 임계
6. data-starvation gate
7. 시간대 게이트 (preMarket / 점심 SELL_ONLY / 마감 후)
8. 워치리스트 0건
9. entryFailCount 임계 누적 자동 제거
10. ADR-0117 DATA_HOLD 누적 (sanity 위반 격리)
11. Gate 재검증 미달
12. pre-breakout WAIT (ADR-0115)
13. AUTO_TRADE_ENABLED=false

### 현재 진단 한계
`ScanCounters` 가 yahooFails/gateMisses/rrrMisses/entries 4종만 카운트.
**WAIT 사유별 분포 부재** — DATA_HOLD/Pre-breakout/Sizing BLOCKED 등 분류 부재.
`getLastScanSummary()` 도 거시 게이트 상태(emergencyStop/regime/FOMC/VIX/SELL_ONLY)
미포함.

## 결정

### 1. ScanCounters 확장 — WAIT 사유별 카운터

`server/trading/signalScanner/scanDiagnostics.ts`:

```typescript
export interface ScanCounters {
  // 기존 (보존)
  yahooFails: number;
  gateMisses: number;
  rrrMisses: number;
  entries: number;
  counterfactualRecordedToday: number;
  pendingTraces: ScanTrace[];

  // ADR-0118 신규 — WAIT 사유 분포
  waitDataHold: number;          // ADR-0117 DATA_HOLD 분기
  waitPreBreakout: number;       // pre-breakout 미도달 (ADR-0115)
  waitGateFail: number;          // Gate 재검증 미달
  waitSizingBlocked: number;     // sizingTier BLOCKED
  waitDriftRemove: number;       // entryPrice drift +10% AUTO 제거
  waitDriftCorpAction: number;   // CORPORATE_ACTION 분기
  waitVolumeDrop: number;        // 거래량 급감 reject
  waitOther: number;
}
```

### 2. ScanSummary 확장 — waitDistribution + macroGateState

```typescript
export interface MacroGateState {
  emergencyStop: boolean;
  autoTradeEnabled: boolean;
  regime: string;                  // R1~R6 / NORMAL
  kellyMultiplierFromRegime: number;
  fomcPhase: string;               // NORMAL / PRE_3 / PRE_2 / PRE_1 / DAY / POST_1 / POST_2
  fomcKellyMultiplier: number;
  finalKellyMultiplier: number;    // combineRegimeAndFomcKelly 결과
  vixGatingActive: boolean;
  bearDefenseMode: boolean;
  mhsBelow30: boolean;
  watchlistEmpty: boolean;
  sellOnlyMode: boolean;
}

export interface WaitDistribution {
  dataHold: number;
  preBreakout: number;
  gateFail: number;
  sizingBlocked: number;
  driftRemove: number;
  corpAction: number;
  volumeDrop: number;
  other: number;
}

export interface ScanSummary {
  // 기존 필드 보존
  // ...

  // ADR-0118 신규 (옵셔널 — 후방호환)
  waitDistribution?: WaitDistribution;
  macroGateState?: MacroGateState;
}
```

### 3. perSymbolEvaluation wiring — 기존 분기에서 카운터 증가

기존 4 분기에 카운터 분리:

| 분기 | 기존 카운터 | 신규 추가 |
|------|------------|-----------|
| pre-breakout 미도달 | (없음, failCount 만) | `waitPreBreakout++` |
| Gate 재검증 미달 (entryRevalidationStep) | `gateMisses++` | `waitGateFail++` |
| applyEntryPriceDrift = REMOVE | (없음, watchlistMutated 만) | `waitDriftRemove++` |
| applyEntryPriceDrift = CORPORATE_ACTION | (없음) | `waitDriftCorpAction++` |
| applyEntryPriceDrift = DATA_HOLD (ADR-0117) | (없음) | `waitDataHold++` |
| sizingTier BLOCKED | (없음) | `waitSizingBlocked++` |

기존 `gateMisses` 는 보존 (후방호환).

### 4. `buildMacroGateState` SSOT

```typescript
export function buildMacroGateState(input: {
  emergencyStop: boolean;
  autoTradeEnabled: boolean;
  regime: string;
  regimeKelly: number;
  fomcPhase: string;
  fomcKelly: number;
  finalKelly: number;
  vixGatingActive: boolean;
  bearDefenseMode: boolean;
  mhsBelow30: boolean;
  watchlistEmpty: boolean;
  sellOnlyMode: boolean;
}): MacroGateState;
```

### 5. `formatScanBlockersMessage` SSOT

```typescript
export function formatScanBlockersMessage(summary: ScanSummary | null): string;
```

`getLastScanSummary` 결과를 텔레그램 메시지로 포맷. 진단 추정 (`💡 추정 원인:`)
포함 — emergencyStop / R6 / SELL_ONLY / 워치리스트 0 / DATA_HOLD 다수 등 분기.

### 6. `/scan_blockers` 텔레그램 명령

`server/telegram/commands/system/scanBlockers.cmd.ts` 신규:
- name=`/scan_blockers`, alias=`/blockers`, `/why_no_buy`
- category=SYS, riskLevel=0, visibility=ADMIN
- `getLastScanSummary()` + `formatScanBlockersMessage` 사용

## 영향 범위

| 영역 | 변경 |
|------|------|
| `scanDiagnostics.ts` | ScanCounters/Summary 확장 + buildMacroGateState + formatScanBlockersMessage |
| `perSymbolEvaluation.ts` | 분기별 카운터 증가 6 위치 wiring |
| `scanBlockers.cmd.ts` 신규 | 텔레그램 명령 |
| `system/index.ts` | barrel +1 |
| LIVE 매매 본체 | 0줄 변경 (진단 인프라만) |
| KIS/KRX quota | 0건 |

## 후속 PR

1. **audit 결과 수정** — `/scan_blockers` 운영 데이터 누적 후 *진짜 차단 게이트* 식별 → fix
2. **PR-A Yahoo 강등 정책** (`PRICE_SOURCE_POLICY` SSOT)
3. orchestrator/autoTradeEngine 최종 결정 직전 `shouldBlockTradingByDataQuality` wiring

## 참조
- ADR-0057 FOMC v4 POST_1 부스트
- ADR-0076 Kelly 결합 정책 FOMC 우선
- ADR-0115/0116/0117 entryPrice/RAW/DataQuality
- 사용자 18단계 §15 "DATA_HOLD 상태"
