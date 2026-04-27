# ADR 0029 — Counterfactual Twin Portfolio (PR-M)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0007 (학습 폐쇄루프), ADR-0028 (Rejection Tracker, PR-L)

## 배경

페어 A (Anti-Counterfactual SSOT) 의 두 번째 절반. PR-L 이 "거절된 종목 사후
추적" 으로 거짓 부정을 측정한다면, PR-M 은 "다른 진입 정책이었다면 어땠을까"
를 평행 포트폴리오로 자동 측정.

기존 인프라:
- `ledgerSimulator.ts` (3 Universe A/B/C) — 같은 신호의 다른 Kelly/TP/SL 시뮬레이션.
  **본 PR 과 다른 차원** — 같은 모집단 안에서 다른 매도 정책.
- `counterfactualShadow.ts` — 진입한 trade 의 다른 매도 시점 시뮬레이션.

부재한 것: **다른 진입 임계 자체** 의 평행 포트폴리오. 사용자 아이디어 #9.

## 결정

### 1. Twin 3종 정의

```ts
type TwinKey = 'AGGRESSIVE' | 'DISCIPLINED' | 'EQUAL_WEIGHT';

interface TwinPolicy {
  key: TwinKey;
  label: string;
  /** 본 Twin 이 채택할 최소 Gate Score (현재 LIVE 임계 18) */
  minGateScore: number;
  /** 사이즈 결정 방식 */
  sizingMode: 'KELLY' | 'EQUAL';
}
```

- **AGGRESSIVE**: Gate ≥ 14 모두 진입 (현재 LIVE 보다 4점 완화)
- **DISCIPLINED**: Gate ≥ 22 만 진입 (현재보다 4점 보수적)
- **EQUAL_WEIGHT**: Gate ≥ 18 (LIVE 동일) + Kelly 무시하고 동일 비중

### 2. 신규 영속

- `data/twin-portfolio.json`
- paths.ts +`TWIN_PORTFOLIO_FILE`
- 1500 entry FIFO trim

### 3. 신규 모듈 `server/learning/counterfactualTwinPortfolio.ts`

```ts
interface TwinEntry {
  id: string;
  twin: TwinKey;
  stockCode: string;
  stockName: string;
  signalDate: string;                 // YYYY-MM-DD KST
  signalGateScore: number;            // 신호 발생 시점의 Gate Score
  entryPrice: number;
  /** Twin 정책에 따른 가상 사이즈 (0~1, 0.1 = 10%) */
  positionWeight: number;
  /** 30일 horizon 후 자동 종결 */
  trackUntil: string;
  currentReturnPct?: number;
  status: 'OPEN' | 'CLOSED';
  exitPrice?: number;
  exitDate?: string;
}
```

핵심 함수:
- `recordTwinEntries(candidate)` — 신호 1건이 들어오면 각 Twin 정책 평가 후
  통과한 Twin 만 entry 영속. 멱등 (동일 stockCode + signalDate + twin 중복 무시).
- `refreshTwinPortfolio(opts)` — 활성 entry currentReturnPct 갱신 + 30일 만료 종결.
- `compareTwinsVsReal(realCumReturn, weeks?)` — 주간 비교 통계 +
  4주 연속 Twin 우월 판정.

### 4. 비교 통계

```ts
interface TwinComparisonResult {
  perTwin: Record<TwinKey, {
    activeCount: number;
    closedCount: number;
    avgReturnPct: number;
    cumReturnPct: number;       // ∏(1 + r/100) - 1
    weeklySharpeProxy: number;  // avg / stddev (단순 proxy)
  }>;
  realCumReturnPct: number;
  /** 각 Twin 이 real 보다 우월하게 N주 연속 — promotion 트리거 */
  consecutiveWeeksWinning: Record<TwinKey, number>;
  /** 4주 연속 우월 시 true → 임계 조정 알림 후보 */
  promotionTriggered: TwinKey | null;
}
```

### 5. wiring 본 PR scope 밖

`signalScanner` 의 candidate 평가 시점에 `recordTwinEntries` 호출하는 wiring 은
후속 PR (Phase B 완주 후). 본 PR 은 모듈 + 영속 + 테스트만.

### 6. 자기학습 폐쇄 루프 결합

`promotionTriggered=AGGRESSIVE` 4주 지속 → 운영자가 검토 후 Gate 임계 14~17
완화 (PR-L Rejection Tracker 의 falseNegativeRate 와 교차 검증).
`promotionTriggered=DISCIPLINED` → 임계 22 강화 검토.

## 비결정 (out of scope)

- 자동 임계 조정 → 영원히 운영자 수동 (절대 규칙 #4 보호)
- signalScanner wiring → Phase B 완주 후
- UI Twin 비교 패널 → 별도 PR

## 회귀 위험

- LIVE 자동매매 무영향 (signalScanner / kisClient / orchestrator 무수정).
- 신규 영속 파일 충돌 없음.
- ledgerSimulator 와 같은 영속 파일 사용 안 함 (다른 차원이므로 분리).

## 검증

- `npm run lint`
- `npm run validate:all`
- `npm run precommit`
- 회귀 테스트 ≥ 12 케이스:
  - Twin 정책 매핑 + minGateScore 분기 (AGGRESSIVE/DISCIPLINED/EQUAL_WEIGHT)
  - recordTwinEntries: Gate 12 (모두 reject) / 16 (AGGRESSIVE만) / 20 (AGGR+EQUAL) / 24 (모두 채택)
  - 멱등 — 동일 (code+signalDate+twin) 중복 무시
  - refreshTwinPortfolio: 가격 갱신 / 만료 종결 / 가격 부재 skip
  - compareTwinsVsReal: 주간 비교 통계 + 4주 우월 트리거
  - 빈 데이터 fallback
