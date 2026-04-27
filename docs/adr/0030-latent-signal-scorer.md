# ADR 0030 — Latent Signal Scorer (페어 D, PR-N)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0028 (Rejection Tracker, PR-L), ADR-0029 (Twin Portfolio, PR-M)

## 배경

페어 A (PR-L+M) 가 사후 측정 (거짓 부정 + 가지 않은 길) 이라면, 페어 D 는
**사전 신호 정량화** — 공시/돌파 직전 미세 패턴을 점수화. 사용자 10개 결합
아이디어 분석에서 두 가지 (#10 Latent Catalyst + #6 VCP Hunter) 가 z-score
기반 + 같은 OHLCV/수급 입력 + 같은 사전 신호 컨셉으로 통합 가능.

### 기존 자산
- `preBreakoutAccumulationDetector.ts` — 거래대금 점진 증가 + 매집 패턴 검출
  (이미 운영 중). 본 모듈과 다른 차원 — 매집 vs 변동성 압축.
- `quantFilter.ts` 의 ATR 비율 비교 (quote.atr < atr20avg * 0.7) — 변동성 압축
  단일 시점만. VCP 의 단조감소 패턴은 미반영.

### 부재한 것
1. **VCP Score**: Mark Minervini 식 5주/3주/1주 ATR 단조감소 + 거래량 단조감소
   + RS ≥ 80 + MA200 위 4조건 정량화.
2. **Latent Catalyst Score**: 공시 발표 전 5~10일 외국인+기관 동반 순매수 +
   거래량 점진 증가 + 변동성 감소 패턴. 페르소나 분석의 "ROE+수급 연쇄 작용"
   leading indicator.

## 결정

신규 모듈 `server/screener/latentSignalScorer.ts` — 두 점수 통합 SSOT.
순수 함수만, 외부 데이터 호출 없음, 영속 없음.

### 1. VCP Score 산출

```ts
interface VcpInput {
  /** 5주/3주/1주 평균 ATR (단위 무관, 동일 단위) */
  atr5w: number;
  atr3w: number;
  atr1w: number;
  /** 5주/3주/1주 평균 거래량 */
  vol5w: number;
  vol3w: number;
  vol1w: number;
  /** 상대강도 0~100 (KOSPI 대비 분위) */
  relativeStrength: number;
  /** 종가 / 200일 이동평균 — 1.0 초과 = 위 */
  priceMa200Ratio: number;
}

interface VcpScoreResult {
  /** 0~100, 4 sub-criteria 각 25점 */
  score: number;
  /** ATR 단조감소 (atr5w > atr3w > atr1w) */
  atrContracting: boolean;
  /** 거래량 단조감소 */
  volumeDrying: boolean;
  /** RS ≥ 80 */
  strongRs: boolean;
  /** MA200 위 */
  aboveMa200: boolean;
  /** 4조건 모두 충족 시 'A', 3 = 'B', 2 = 'C', 그 외 'NONE' */
  grade: 'A' | 'B' | 'C' | 'NONE';
}
```

### 2. Latent Catalyst Score 산출

```ts
interface LatentCatalystInput {
  /** 외국인 5일 누적 순매수 z-score (≥ +1 = 강한 유입) */
  foreignNetBuy5dZ: number;
  /** 기관 5일 누적 순매수 z-score */
  institutionalNetBuy5dZ: number;
  /** 거래량 5/10/20일 단조증가 점수 0~10 */
  volumeProgression: number;
  /** 5일 변동성 z-score (음수 = 정상화) */
  volatility5dZ: number;
}

interface LatentCatalystResult {
  /** -3 ~ +5 합성 점수 */
  score: number;
  /** ≥ +1.5 = 'LATENT_CATALYST' 태그 후보 */
  tag: 'LATENT_CATALYST' | 'WEAK_SIGNAL' | 'NONE';
  /** sub-component 분해 */
  components: {
    foreignContribution: number;
    institutionalContribution: number;
    volumeContribution: number;
    volatilityContribution: number;
  };
}
```

공식: `score = (foreignNetBuy5dZ + institutionalNetBuy5dZ + volumeProgression/10*2 - volatility5dZ) / 4`.

### 3. 통합 헬퍼 — combinedSignalGrade()

```ts
combinedSignalGrade(vcp: VcpScoreResult, latent: LatentCatalystResult): {
  /** VCP A + Latent ≥ +1.5 = 'STRONG_PRE_BREAKOUT' (양 신호 결합) */
  combined: 'STRONG_PRE_BREAKOUT' | 'PRE_BREAKOUT' | 'WATCH' | 'NONE';
}
```

### 4. wiring 본 PR scope 밖

`watchlistManager` 의 tag 추가, `stockScreener` 통합, `WatchlistSection`
타입의 `'VCP_HUNTER'` 추가 등 wiring 은 후속 PR. 본 PR 은 점수 산출 함수 +
테스트만.

### 5. 외부 호출 0

순수 함수 — 모든 입력은 호출자 책임. KIS / KRX / Yahoo 호출 없음. ADR-0009/0010
외부 호출 예산 무영향.

## 비결정 (out of scope)

- 자동 watchlist 등록 wiring → 별도 PR
- VCP_HUNTER 섹션 신설 (slot 추가) → 별도 PR
- 공시 도착 시 LATENT → CATALYST 자동 승격 → 별도 PR
- KIS `fetchKisInvestorFlow` 의 5일 누적 z-score 계산 헬퍼 → 별도 PR (입력 가공 단계)

## 회귀 위험

- LIVE 자동매매 무영향 (signalScanner / kisClient / orchestrator 무수정).
- 영속 없음 — 부작용 0.
- preBreakoutAccumulationDetector 와 별도 모듈 (매집 vs 변동성 압축 다른 차원).

## 검증

- `npm run lint`
- `npm run validate:all`
- `npm run precommit`
- 회귀 테스트 ≥ 14 케이스:
  - VCP: A/B/C/NONE 등급 분기 + 단조감소 검증 + RS 경계 + MA200 경계
  - Latent: ≥ +1.5 boundary + sub-component 합산 + NaN/Infinity fallback
  - combinedSignalGrade: 4 등급 분기
  - 빈 입력 안전 fallback
