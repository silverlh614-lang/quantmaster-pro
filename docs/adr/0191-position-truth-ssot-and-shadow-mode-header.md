# ADR-0191 — Position Truth SSOT + SHADOW MODE 헤더 + 자기 보유 가드 + Position Truth Divergence health

@responsibility 보유 포지션 진실 단일 출처 + SHADOW 모드 헤더 가시화 + 동일 종목 12회 매수(물타기) 시스템 차단 + 영속 SSOT drift 자동 검출.

## 컨텍스트

사용자 5/6 SHADOW 모드 운영 보고 — 리노공업 12회 가짜 매수 표기 (실제로는 미체결).
첨부 이미지 분석 결과 두 결함 동시 발생:

1. **AUTO_TRADE_MODE=SHADOW 헤더 부재** — Morning Card 가 `📊 보유 포지션`
   고정 라벨로 표기 → 사용자가 *현재 모드가 SHADOW 임을 카드로 인지 못함* →
   "왜 안 사졌지?" 같은 잘못된 자가 진단으로 이어짐. 페르소나 10번 ("과장된
   확신 회피, 조건부 판단 함께 제시") 의 UI 구현체가 부재.

2. **동일 종목 다중 매수 (물타기)** — 12회 SHADOW 매수가 동일 종목에 누적.
   `buyListLoop.ts:921` 의 `alreadyTraded` 가드가 있지만 belt-and-suspenders
   2중 안전망 부재. 페르소나 9번 ("보유 효과를 경계한다") 의 정반대 결함 —
   동일 종목을 12회 사고 평균을 낮추는 행위 (물타기) 가 통과.

3. **3 영속 SSOT 분산** — 보유 포지션 카운트가 3 경로에서 다른 답:
   - `(a) loadShadowTrades().filter(isOpen)` — diagnostics.ts:218 (단순 status 필터)
   - `(b) aggregateAllPositions().filter(stage!=CLOSED)` — positionsRouter.ts + Morning Card (이벤트 스트림 집계)
   - `(c) computePositionStats()` — 통계 모듈 내부

   12 vs 1 같은 drift 발생 시 *어디가 거짓말 하는지* 자동 검출 부재 →
   사용자 직접 발견 (운영자 실수 시 영구 누락 가능).

## 결정

### 결정 1 — `server/persistence/positionTruth.ts` SSOT 신설

`loadOpenPositions()` 단일 헬퍼 export:

```typescript
export interface OpenPositionView {
  positionId: string;       // shadow.id
  stockCode: string;
  stockName: string;
  status: ServerShadowTrade['status'];
  remainingQty: number;
  signalTime: string;
  mode: 'LIVE' | 'SHADOW';
}

export function loadOpenPositions(): OpenPositionView[];
export function countOpenByStockCode(positions: OpenPositionView[]): Map<string, number>;
export function detectPositionTruthDivergence(): PositionTruthDivergenceReport;
```

3 경로 (a/b/c) 가 모두 본 SSOT 호출 → drift 영구 차단.

### 결정 2 — Morning Card SHADOW MODE 헤더 분기

`positionMorningCard.ts:137-141` 의 `channelHeader` 호출에 mode 분기 추가:

```typescript
const isShadowMode = (process.env.AUTO_TRADE_MODE ?? 'SHADOW') === 'SHADOW';
const header = channelHeader({
  icon: isShadowMode ? '🟡' : '📊',
  title: isShadowMode ? '[SHADOW MODE] 보유 포지션 Morning Card' : '보유 포지션 Morning Card',
  suffix: '09:05 KST',
});
```

ENV `MORNING_CARD_SHADOW_HEADER_DISABLED=true` 우회 (default OFF).

### 결정 3 — buyListLoop 자기 보유 가드 (belt-and-suspenders)

L1232 의 `corrGate` 통과 *후*, `kellyBudgetDecider` 호출 *전* 위치에 추가:

```typescript
// ADR-0191: 자기 보유 가드 — 동일 종목 12회 매수 (물타기) 시스템 차단.
// L921 의 alreadyTraded 가드 위에 belt-and-suspenders 2중 안전망 (positionTruth SSOT 사용).
if (!isMomentumShadow) {
  const openPositions = loadOpenPositions();
  const alreadyHeld = openPositions.some(p => p.stockCode === stock.code);
  if (alreadyHeld) {
    console.log(`[AutoTrade/SelfHoldingGuard] ${stock.name}(${stock.code}) 이미 보유 중 — 물타기 차단 (ADR-0191)`);
    appendShadowLog({
      event: 'BLOCKED_SELF_HOLDING',
      code: stock.code,
    });
    continue;
  }
}
```

ENV `BUY_LIST_SELF_HOLDING_GUARD_DISABLED=true` 우회 (default OFF).

### 결정 4 — diagnostics Position Truth Divergence 체크포인트

`HealthSnapshot` +2 옵셔널 필드 + `collectHealthSnapshot()` 내부 검출:

```typescript
positionTruthDivergence?: {
  shadowOpenCount: number;       // (a) loadShadowTrades().filter(isOpen).length
  aggregateActiveCount: number;  // (b) aggregateAllPositions().filter(stage!=CLOSED).length
  divergent: boolean;            // !== 시 true
  divergentStockCodes: string[]; // (a) ∩ (b) 갈라진 종목
};
```

`/health` 메시지에 분기 1줄 추가:
- divergent=false → 표시 안 함 (정상은 침묵)
- divergent=true → `❌ Position Truth Divergence: shadow=N vs aggregate=M (codes: ...)`

ENV `POSITION_TRUTH_DIVERGENCE_CHECK_DISABLED=true` 우회 (default OFF).

후속 PR — divergent=true 시 CRITICAL Telegram 자동 발송 (본 PR scope 외, 운영
데이터 누적 후 임계 결정).

## 안전 invariant 6종 (절대 규칙)

1. **LIVE 매매 본체 0줄 변경** — 4 항목 모두 *진단·메시지·belt-and-suspenders 가드*
   레이어. `signalScanner.ts` / `signalScanner/preflight.ts` / `entryEngine.ts` /
   `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` 모두
   0줄 변경. buyListLoop 자기 보유 가드는 *기존 alreadyTraded L921 가드 위* 추가.
2. **KIS/KRX 자동매매 quota 0 침범** — 절대 규칙 #2/#3/#4 — kisClient/orchestrator/
   autoTradeEngine 본체 무수정. positionTruth SSOT 는 영속 read-only.
3. **ENV default OFF** — `MORNING_CARD_SHADOW_HEADER_DISABLED` /
   `BUY_LIST_SELF_HOLDING_GUARD_DISABLED` / `POSITION_TRUTH_DIVERGENCE_CHECK_DISABLED`
   3종 모두 default OFF + ADR-0157 정확 비교 의무 (`=== 'true'`). 단 SHADOW MODE 헤더 와
   divergence 체크는 *default 활성* (사용자 인지 격상이 자체 가치). buyListLoop
   가드는 *default 활성* (물타기 차단이 본 PR 핵심 목적).
4. **try/catch 격리** — Position Truth Divergence 검출 throw → 매매/Morning Card 흐름
   차단 안 함. positionTruth SSOT load 실패 → 빈 배열 fallback (안전).
5. **Belt-and-suspenders 패턴** — buyListLoop L921 의 기존 `alreadyTraded` 가드는
   유지. 본 PR 의 자기 보유 가드는 *추가* 안전망 (positionTruth SSOT 사용,
   ADR-0117 sanity guard 패턴 정합).
6. **호출자 점진 마이그레이션** — 기존 `loadShadowTrades().filter(isOpen)` /
   `aggregateAllPositions().filter(stage!=CLOSED)` 직접 호출자 본 PR 즉시 교체 0건.
   positionTruth SSOT 는 *신규 호출자* (Morning Card 헤더 / buyListLoop 자기 가드 /
   diagnostics divergence) 만 사용. 기존 3 호출자 (positionsRouter / Morning Card
   기존 본문 / diagnostics activePositions) 점진 마이그레이션은 후속 PR (회귀
   위험 격리).

## 잘못된 해결 방법 영구 차단 6종

1. **Morning Card 본문 활성 카운트를 positionTruth SSOT 로 즉시 교체** — 호출자
   3개 동시 변경 → 회귀 위험 ↑. 본 PR 은 *헤더만* 변경 + 신규 호출자만 SSOT
   사용. 기존 호출자 점진 마이그레이션은 후속 PR.
2. **buyListLoop L921 `alreadyTraded` 가드 제거** — 기존 가드는 *동일 날짜 매수*
   까지 차단 (날짜 무관 보유 + 같은 날 신호 두 분기). 본 PR 은 belt-and-suspenders
   추가만, 기존 가드 유지.
3. **divergence 발견 시 매매 자동 차단** — 영속 SSOT 결함을 *매매 차단* 으로
   확장하면 전체 매매 정지 위험. 본 PR 은 *진단·알림* 만, 운영자 수동 결정 의무.
4. **positionAggregator.ts 본체 변경 (이벤트 집계 로직)** — 진실 출처가 이벤트
   스트림 (shadow-log.json) 이라는 정책 보존 (ADR 정합). positionTruth SSOT
   는 *집계 결과 view* 만 노출.
5. **buyListLoop 자기 가드를 EntryGate Phase B chain 으로 격상** — chain SSOT
   변경은 회귀 위험 큼. 본 PR 은 inline 가드 (L921 패턴 정합) + 후속 PR 에서
   chain 격상 검토.
6. **3 SSOT 즉시 통합 (a/b/c 모두 positionTruth 로 교체)** — 회귀 위험 ↑ +
   영속 schema 호환성 검증 부담. 본 PR 은 SSOT *신설* 만, 기존 3 경로 호출자
   점진 마이그레이션 (PENDING_WIRING 등재).

## 회귀 테스트 ≥30 케이스

- `positionTruth.test.ts` — `loadOpenPositions` (빈 영속 / PENDING / ACTIVE /
  HIT_TARGET 제외 / HIT_STOP 제외 / REJECTED 제외 / mode 정확 / remainingQty 산출)
  + `countOpenByStockCode` (단일 종목 / 다중 / 빈) + `detectPositionTruthDivergence`
  (정합 / 불일치 / aggregateAllPositions throw 안전 / ENV 우회).
- `positionMorningCardShadowHeader.test.ts` — SHADOW 기본 / LIVE / 미설정 default
  SHADOW / ENV 우회.
- `buyListLoopSelfHoldingGuard.test.ts` — 정적 grep 가드 (loadOpenPositions
  import / 자기 보유 발견 시 continue / appendShadowLog BLOCKED_SELF_HOLDING /
  isMomentumShadow false 시 적용 / ENV 우회 / corrGate 통과 후 위치 정합).
- `diagnosticsPositionTruthDivergence.test.ts` — divergence 부재 / 발견 / 갈라진
  stockCode 표시 / ENV 우회 / collectHealthSnapshot 통합 / formatHealthMessage
  divergent=false 시 라인 미노출 / divergent=true 시 ❌ 라인.

목표 ≥30, heuristic ≥5 케이스/100 LoC.

## 운영자 활성화 절차

본 PR 머지 직후 자동 활성화 (3 항목 default ON). 회귀 발견 시 ENV 1줄 즉시 롤백:

- Morning Card SHADOW 헤더 회귀 → `MORNING_CARD_SHADOW_HEADER_DISABLED=true`
- buyListLoop 자기 보유 가드 회귀 → `BUY_LIST_SELF_HOLDING_GUARD_DISABLED=true`
- diagnostics divergence 체크 회귀 → `POSITION_TRUTH_DIVERGENCE_CHECK_DISABLED=true`

## 결과

1. 사용자가 Morning Card 1초 인지로 *현재 모드가 SHADOW 임을* 자가 판단 →
   "왜 안 사졌지?" 같은 잘못된 질문 영구 차단.
2. 동일 종목 12회 매수 (물타기) 시스템 차단 — buyListLoop 자기 보유 가드 +
   기존 L921 alreadyTraded = 2중 안전망.
3. 영속 SSOT drift (12 vs 1) 자동 검출 → /health 1회로 운영자 인지 + 향후
   CRITICAL Telegram 자동 알림 (후속 PR).
4. positionTruth SSOT 신설 — 신규 호출자 single source of truth + 기존 3 호출자
   점진 마이그레이션 인프라.
