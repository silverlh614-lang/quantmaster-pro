# ADR 0028 — Rejection Universe Tracker (PR-L)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0018 ~ ADR-0027 (자기학습 5계층 시리즈 PR-A~K)

## 배경

자기학습 시리즈 PR-A~K 는 클라이언트 측 학습 데이터 무결성 (1~5계층 기반) 을
구축. 그러나 **거짓 부정** (놓친 알파) 은 측정되지 않고 있다.

- `server/screener/stockScreener.ts` 의 `rejectionLog` 는 거절 이유만 in-memory
  기록 — 사후 추적 없음.
- 기존 `server/learning/ghostPortfolioTracker.ts` 는 Watch/BUY 신호가 났는데
  매수 안 한 종목을 30일 추적 — 신호 발생 종목만 대상이라 **임계 미달로
  거절된 near-miss 종목** 은 추적 범위 밖.

알파 누수의 절반은 "거의 통과할 뻔한 거절" 에 있다. Gate Score 14~17 (임계 18
미만 4점 이내) 거절 종목의 사후 5영업일 수익률 분포를 추적하면:
- 평균 수익률 ≥ +N% 면 임계가 너무 보수적 → 자기학습 PR-I 귀인 분석에
  "FALSE_NEGATIVE" 입력 추가 가능
- 분포가 정규 또는 음수면 현재 임계 정합성 확인

## 결정

### 1. 신규 영속 레이어

- 파일: `data/rejection-shadow.json` (신규)
- paths.ts 에 `REJECTION_SHADOW_FILE` export
- 기존 reflectionRepo 패턴 (atomic write + 500건 hard cap) 동일

### 2. 신규 모듈 `server/learning/rejectionShadowTracker.ts`

```ts
export interface RejectionShadowEntry {
  id: string;                         // 'rej-shadow-<timestamp>-<code>'
  stockCode: string;
  stockName: string;
  signalDate: string;                 // YYYY-MM-DD KST
  signalPriceKrw: number;
  /** Gate Score (14~17 near-miss 만 본 트래커 추적) */
  gateScore: number;
  /** Gate 임계 (18 기본) 와의 거리 — scoreDelta = threshold - gateScore */
  scoreDelta: number;
  rejectionReason: string;
  /** 5 영업일 후 만료 — KST 평일만 카운트 */
  trackUntil: string;                 // YYYY-MM-DD
  /** 마지막 가격 갱신 시 수익률 (%) */
  currentReturnPct?: number;
  lastUpdatedAt?: string;
  closed?: boolean;
}

export const REJECTION_NEAR_MISS_MIN = 14;
export const REJECTION_NEAR_MISS_MAX = 17;
export const TRACK_BUSINESS_DAYS = 5;
```

### 3. 핵심 함수

- `recordRejection(input)` — Gate Score 14~17 만 영속. 그 외는 silent skip.
- `refreshRejectionShadow(opts)` — 활성 entry 의 currentReturnPct 갱신 + trackUntil 만료 종결. 기존 ghostPortfolioTracker 와 동일 패턴.
- `summarizeRejectionShadow()` — 만료된 entry 의 수익률 분포 (avg / median / 분위수 / 카운트) 통계.
- `__resetRejectionShadowForTests()` — 테스트용 reset.

### 4. 영업일 계산 (5 business days)

KST 기준 토/일 제외하고 5 영업일 후를 trackUntil 로 설정. 한국 공휴일은 본 PR scope 밖 (단순 토/일 제외만 — 후속 PR 에서 한국거래소 휴장일 calendar 통합 가능).

### 5. wiring 은 본 PR scope 밖

`signalScanner` 또는 `stockScreener` 에서 `recordRejection()` 을 호출하는 wiring 은 **별도 PR 로 분리**한다. 이유:
- signalScanner 는 절대 규칙 #4 (autoTradeEngine 단일 통로) 보호 대상.
- signalScanner Phase B (CLAUDE.md 기존 복잡도 위반 P0) 분해 진행 중이라 본체 수정 시 회귀 위험 ↑.
- PR-L 은 모듈 + 테스트만 — 사용자가 다음 PR 에서 wiring 추가 가능.

### 6. 자기학습 시리즈 결합

- summarizeRejectionShadow() 결과의 `falseNegativeRate` (만료 entry 중 +5%↑ 비율) 가 임계값 ≥ 30% 면 텔레그램 경보 → 운영자가 Gate 임계 검토.
- 향후 PR-I `classifyConditionAttribution` 의 입력에 rejection shadow data 결합 가능 (해당 조건이 거절 측에서도 +수익률을 자주 만들면 ALPHA_DRIVER 로 재분류).

## 비결정 (out of scope)

- signalScanner / stockScreener wiring — 별도 PR (PR-M)
- 한국거래소 휴장일 calendar 통합 — 별도 PR
- 텔레그램 경보 전송 — wiring 후 운영자 검토하며 점진 추가
- UI 표시 — 본 PR 은 서버 측 데이터만

## 회귀 위험

- LIVE 자동매매 무영향 (signalScanner / kisClient / orchestrator 무수정).
- 신규 영속 파일이라 기존 데이터 충돌 없음.
- KIS 호출은 `refreshRejectionShadow` 가 야간 reflection 사이클에서 priceFetcher 주입 받아 실행 — quota 영향은 5 영업일 × 평균 N개 entry × 1회/일 = 매우 작음.

## 검증

- `npm run lint`
- `npm run validate:all`
- `npm run precommit`
- 회귀 테스트 ≥ 12 케이스:
  - recordRejection: near-miss 통과 / 외 범위 skip / 중복 dedupe
  - 영업일 계산: 평일 / 금요일 / 주말 진입 / 5일 후 trackUntil
  - refreshRejectionShadow: 가격 갱신 / 만료 종결 / 가격 부재 skip
  - summarizeRejectionShadow: 분포 통계 + falseNegativeRate
  - 빈 데이터 안전 fallback
