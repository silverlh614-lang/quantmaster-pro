# PR-1 Implementation Plan (architect → engine-dev)

**Scope:** #7 동시호가 Full 가드 · #10 Shadow 집계·뱃지 · #4 Yahoo ADR 비활성 · #5 Gap 기준가 교체
**Branch:** `claude/sync-watchlist-api-CnA89`
**Driving ADR:** `docs/adr/0004-yahoo-adr-deprecation.md`

---

## 절대 규칙 재확인

1. `@responsibility` 태그: 모든 새 파일 상단 20줄 내 25단어 이내.
2. KIS 호출은 `server/clients/kisClient.ts` 만.
3. 실주문은 `server/trading/autoTradeEngine` / orchestrator 단일 통로.
4. 파일당 1,500줄 한계. (`webhookHandler.ts` 는 1,700줄 — 이번 PR 에서 분해 금지, 수술적 수정만.)
5. 커밋 전 `npm run precommit` 필수.

---

## 태스크 #7 — 동시호가 Full 가드

**File:** `server/orchestrator/tradingOrchestrator.ts`

### Change 1 (`preMarketOrderPrep` 함수 진입부)
- `loadShadowTrades().filter(isOpenShadowStatus).length` 로 `activeCount` 계산 (기존).
- `regimeConfig.maxPositions` 를 읽어오는 경로 확인 (probably `server/trading/regimeBridge.ts` or similar).
- **진입부 즉시 가드**: `if (activeCount >= maxPositions) { log + return; }`
- 워치리스트 루프 안에서도 `if (activeCount + orderedCount >= maxPositions) break;`

### Change 2 (LIVE KIS 주문 직전)
- `assertSafeOrder` 를 `server/trading/preOrderGuard.ts` 에서 import.
- 기존 `if (isLive && process.env.KIS_APP_KEY)` 블록 내에서 `kisPost` 직전에 호출:
  ```ts
  const guard = await assertSafeOrder({ stockCode, quantity, side: 'BUY', estimatedCost, context: 'preMarket' });
  if (!guard.ok) { log + continue; }
  ```
- 가드 실패 이유를 텔레그램 알림에 포함.

### Test
- `server/trading/preOrderGuard.test.ts` 가 이미 있으면 preMarket 케이스만 추가.
- 없으면 `server/orchestrator/__tests__/tradingOrchestrator.test.ts` 신규 (vitest).

---

## 태스크 #10 — Shadow 집계·표시

### Change 1 — 집계 함수 신규
**File:** `server/persistence/shadowTradeRepo.ts` (기존 1,000줄 미만, 확장 OK)

```ts
export interface ShadowMonthlyStats {
  month: string;              // 'YYYY-MM'
  totalClosed: number;        // fills 상 closed (HIT_TARGET/HIT_STOP/MANUAL_EXIT)
  wins: number;
  losses: number;
  winRate: number;            // 0~100
  avgReturnPct: number;       // 단순평균 netPct
  compoundReturnPct: number;  // ∏(1+r) - 1
  profitFactor: number | null;
  strongBuyWinRate: number;   // signalType === STRONG_BUY 만
  sampleSufficient: boolean;  // total >= 5
  openPositions: number;      // 현재 보유 종목 수 (fills 기반)
}

export function computeShadowMonthlyStats(monthISO?: string): ShadowMonthlyStats;
```

- 구현: `loadShadowTrades()` → 당월 closed 만 필터 → fills 기반 `netPct` 계산
  (기존 `getWeightedPnlPct` 또는 `computeNetPnL` 재사용).
- `openPositions` = `loadShadowTrades().filter(isOpenShadowStatus).length`.

### Change 2 — `/shadow` 핸들러 교체
**File:** `server/telegram/webhookHandler.ts:741-751`

- `getMonthlyStats()` → `computeShadowMonthlyStats()` 로 교체.
- 메시지 포맷 변경 — **반드시 `[SHADOW]` 뱃지 유지**:

```
🎭 <b>[SHADOW] 성과 현황</b>
{month} — 종결 {totalClosed}건 | 미결 {openPositions}건
WIN률: {winRate}% | 평균수익: {avgReturnPct}% | 복리: {compoundReturnPct}%
PF: {profitFactor ?? 'N/A'} | STRONG_BUY WIN: {strongBuyWinRate}%
{!sampleSufficient ? '⚠️ 표본 부족 (5건 미만) — 통계 신뢰도 낮음' : ''}
미체결 모니터링: {pending.length}건
⚠️ SHADOW 모드 — 실계좌 잔고 아님
```

### Change 3 — `[SHADOW]` 뱃지 강제화
**File:** `server/telegram/webhookHandler.ts` · `server/persistence/shadowTradeRepo.ts`

- Shadow 체결/매수/매도/원금보호/익절 텔레그램 템플릿을 전수 검토.
- 이미 `🎭 [SHADOW ...]` 사용 중인 부분은 유지.
- Shadow 잔고·포지션을 표시하는 모든 메시지에 `[SHADOW]` 프리픽스 + 하단에
  `⚠️ SHADOW 모드 — 실계좌 잔고 아님` 한 줄 suffix 추가.
- 검색 키: `shadow`, `Shadow`, `SHADOW`, `가상 체결`, `잔여:` — 이 중 실계좌 경로와
  혼동 가능한 메시지만 대상.

### 수량 표시 SSOT 강제
- `/pos` 외 모든 잔여 수량 표시는 `getRemainingQty(trade)` 경유.
- `trade.quantity` 를 직접 문자열 포매팅하는 곳 전수 치환.
- grep: `trade\.quantity` 또는 `s\.quantity` 문자열 보간 패턴.

### Test
- `server/persistence/shadowTradeRepo.test.ts` 에 `computeShadowMonthlyStats` 테스트 추가.
  - 당월 closed WIN/LOSS 혼합, 미결 포함, 표본 부족 케이스.

---

## 태스크 #4 — Yahoo ADR 비활성

### Change 1 — `server/alerts/adrGapCalculator.ts` stub 화

- 파일 상단 주석: `/** @deprecated ADR-0004 — Yahoo ADR 역산 폐기. preMarketGapProbe 참조. */`
- 모든 export 함수 내부:
  ```ts
  export function computeAdrGap(...): null {
    // @deprecated ADR-0004
    return null;
  }
  ```
- 시그니처·타입은 유지(호출처 런타임 보호).
- Yahoo 호출 로직·import 제거 (lint 깨끗).

### Change 2 — `fetchKisPrevClose` 추가
**File:** `server/clients/kisClient.ts`

- KIS 전일종가는 보통 `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`
  또는 `inquire-daily-price` 로 조회. 기존 클라이언트에 비슷한 함수 있으면 재사용.

```ts
export interface PrevClose {
  stockCode: string;
  prevClose: number;
  tradingDate: string;      // 'YYYY-MM-DD' (KRX 영업일)
  fetchedAt: string;        // ISO
}

export async function fetchKisPrevClose(stockCode: string): Promise<PrevClose | null>;
```

- 이미 유사한 함수(`fetchDailyBars`, `fetchCurrentPrice`, `fetchDailyQuote`)가 있다면
  그것을 재사용해 일별 시세 1건만 취득.
- 실패 시 null, 로그만. 서킷 오픈 전용 카운터는 나중.

---

## 태스크 #5 — Gap 기준가 교체 + preMarketGapProbe 신규

### Change 1 — `server/trading/preMarketGapProbe.ts` 신규

```ts
/**
 * @responsibility KIS 전일종가 기반 장전 갭 추정 - 2%·30% 임계로 스킵 사유 분류
 */
export interface GapProbeInput {
  stockCode: string;
  entryPrice: number;
}
export interface GapProbeResult {
  stockCode: string;
  prevClose: number | null;
  gapPct: number | null;          // (entryPrice - prevClose) / prevClose * 100
  decision: 'PROCEED' | 'WARN' | 'SKIP_DATA_ERROR' | 'SKIP_STALE' | 'SKIP_NO_DATA';
  reason?: string;
}
export async function probePreMarketGap(input: GapProbeInput): Promise<GapProbeResult>;
```

결정 로직:
- `fetchKisPrevClose` 실패 → `SKIP_NO_DATA`.
- `tradingDate` 가 2영업일 이상 과거 → `SKIP_STALE`.
- `|gapPct| >= 30` → `SKIP_DATA_ERROR`.
- `|gapPct| >= 2` → `WARN` (진행).
- 그 외 `PROCEED`.

### Change 2 — `tradingOrchestrator.ts` 갭 계산 교체

- 기존 66-71행의 Yahoo 기반 갭 계산 삭제.
- `probePreMarketGap` 호출 → 결과에 따라 분기.
- `WARN` 은 진행하되 텔레그램 메시지에 `⚠️ Gap {X}%` 표기.
- `SKIP_DATA_ERROR` / `SKIP_STALE` / `SKIP_NO_DATA` 는 continue + skipReason 워치리스트 메타에 기록.
- Yahoo 호출(`fetchYahooQuote`) 은 preMarket 경로에서 제거. quote 정보가 Gate
  재평가에 필요하다면 별도 probe 추가 또는 해당 Gate 경로 점검 필요.

### 워치리스트 skipReason 기록
- `server/persistence/watchlistRepo.ts` 의 `WatchlistEntry` 에 `lastSkipReason?: string`
  + `lastSkipAt?: string` 필드 추가 (옵셔널, 하위 호환).
- `saveWatchlist` 호출 시 해당 필드가 새로 채워지도록 preMarket 루프에서 업데이트.

### Test
- `server/trading/preMarketGapProbe.test.ts` 신규: 각 decision 분기 케이스.

---

## ARCHITECTURE.md 업데이트

다음 한 줄 추가 (Module Boundaries 테이블 하단):

```
| `server/trading/preMarketGapProbe.ts` | Compute pre-market gap from KIS previous close; classify as proceed/warn/skip by threshold |
```

`server/alerts/adrGapCalculator.ts` 는 표에 없으므로 그대로 둠.

---

## 완료 조건 (engine-dev DoD)

- `npm run lint` 통과 (tsc --noEmit 클라/서버 양쪽).
- 새 파일 전부 `@responsibility` 태그.
- `server/persistence/shadowTradeRepo.test.ts`, `server/trading/preMarketGapProbe.test.ts`
  포함 새 테스트 vitest 로 통과.
- 관련 기존 테스트(`preOrderGuard.test.ts`, `signalScanner.test.ts`) 회귀 없음.
- Phase 4 에서 `quality-guard` 가 `npm run validate:all` + 경계 체크 + precommit 통과시킬 것.

---

## 호환성 메모

- `adrGapCalculator` 를 stub 화하면 호출처(장전 브리핑 generator 등)가 null 을
  받게 됨. 호출처는 이미 "Yahoo 응답 실패" fallback 이 있을 가능성이 높으나,
  **engine-dev 는 반드시 각 호출처를 확인하고 null-safe 하게 처리**할 것.
- `webhookHandler.ts` 의 P1 분해는 이번 PR 범위 밖. 수술적 수정만.
