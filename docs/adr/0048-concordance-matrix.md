# ADR-0048 — Quant × Qual Concordance Matrix

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related PRs**: PR-Z6 (Phase 3-2 of UI 재설계)
- **Related ADRs**: ADR-0006 (Composite Key), ADR-0020 (Source-Weighted Learning), ADR-0035 (Attribution + Correlation)

## 1. 배경

페르소나 철학 7 ("정량 + 정성 통합 신뢰도") — Gemini 가 내린 정성 판단(주도주/관망/후행성 우려 등)과 4-Gate 시스템의 정량 판단이 *일치할 때* 신호가 강하다. 이 가설을 코드 레벨에서 검증할 자산이 부재했다.

코드베이스의 자산:
- ADR-0020 PR-C 가 27 조건을 `REAL_DATA_CONDITIONS` (9개, COMPUTED) + `AI_ESTIMATE_CONDITIONS` (18개, AI) 분류
- `attributionRepo` 가 매 거래의 conditionScores 영속 저장
- 두 카테고리 평균 score 의 교차분석 매트릭스가 부재

본 PR 은 그 매트릭스를 구축. 추가 Gemini 호출 0건 — 이미 저장된 라벨만 재활용.

## 2. 결정

`/api/attribution/concordance` 신규 엔드포인트 + RecommendationHistoryPage 에 5×5 heatmap 임베드. 서버 합성 SSOT, 클라이언트 시각화.

### 2.1 5×5 매트릭스 SSOT

**X축 (Quant Tier)**: `REAL_DATA_CONDITIONS` (9개) 평균 score → 5 bucket
**Y축 (Qual Tier)**: `AI_ESTIMATE_CONDITIONS` (18개) 평균 score → 5 bucket

**Bucket 분류 (점수 0~10 기준):**

| Bucket | 임계값 |
|--------|--------|
| EXCELLENT | ≥ 8 |
| GOOD | ≥ 6 (< 8) |
| NEUTRAL | ≥ 4 (< 6) |
| WEAK | ≥ 2 (< 4) |
| POOR | < 2 |

**경계값 정책**: ≥ 임계값 (>=) 우선. `score === 8` → EXCELLENT (GOOD 아님). NaN/Infinity → POOR (보수적). 평균 분모 0 (해당 카테고리 조건 score 미설정) → POOR.

### 2.2 서버↔클라이언트 SSOT 정합

| 자산 | 클라이언트 SSOT | 서버 동기 사본 |
|------|----------------|----------------|
| REAL_DATA_CONDITIONS | `src/services/quant/evolutionEngine.ts` | `server/learning/conditionSourceMap.ts` (신규) |
| AI_ESTIMATE_CONDITIONS | 동일 | 동일 |
| Bucket 임계값 | (본 ADR §2.1) | (서버 동기 사본에 const) |

**드리프트 차단**: 회귀 테스트가 서버 sync 사본의 9 + 18 = 27 ID 가 클라 SSOT 와 정확히 일치하는지 검증. 변경 시 양쪽 동시 수정 의무.

### 2.3 Concordance 응답 SSOT

```ts
type ConcordanceTier = 'EXCELLENT' | 'GOOD' | 'NEUTRAL' | 'WEAK' | 'POOR';

interface ConcordanceCell {
  quantTier: ConcordanceTier;
  qualTier: ConcordanceTier;
  sampleCount: number;
  wins: number;
  losses: number;
  winRate: number | null;          // null = sampleCount=0
  avgReturnPct: number | null;
}

interface ConcordanceStats {
  sampleCount: number;
  winRate: number | null;
  avgReturnPct: number | null;
}

interface ConcordanceMatrix {
  cells: ConcordanceCell[];        // 정확히 25 (5×5)
  diagonalStats: ConcordanceStats;  // qualTier === quantTier
  offDiagonalStats: ConcordanceStats;
  totalSamples: number;
  capturedAt: string;
}
```

### 2.4 메타 룰 검증

`diagonalStats.winRate - offDiagonalStats.winRate` 가 양수이면 사용자 가설 ("두 시스템 일치 = 강한 신호") 검증. 표본이 < 30 이면 "표본 부족" 경고 — 통계적 신뢰도 부재.

### 2.5 신규 모듈

| 파일 | LoC 상한 | 책임 |
|------|---------|------|
| `server/learning/conditionSourceMap.ts` | ≤ 40 | REAL_DATA(9) + AI_ESTIMATE(18) 동기 사본 + classifyTier 헬퍼 |
| `server/routes/attributionRouter.ts` (확장) | +120 LoC | `GET /concordance` 추가 — 5×5 매트릭스 + 합성 통계 |
| `src/api/concordanceClient.ts` | ≤ 80 | 타입 동기 사본 + fetchAttributionConcordance |
| `src/components/analysis/ConcordanceMatrix.tsx` | ≤ 220 | 5×5 grid + winRate 색상 + diagonal ring + 메타 룰 통계 |

수정: `src/pages/RecommendationHistoryPage.tsx` (+1 import + 1줄 임베드).

### 2.6 데이터 흐름

```
ConcordanceMatrix
  └─ useQuery(['attribution-concordance'])
       ↓ GET /api/attribution/concordance
       ↓ ConcordanceMatrix 응답
     렌더 — 외부 호출 0건 (server 측 attributionRepo memory read 만)
```

서버: `loadCurrentSchemaRecords()` 만 read. KIS/KRX/Yahoo/Gemini 호출 0건.

## 3. 검증

### 3.1 자동 검증 (≥ 18 케이스)

- `conditionSourceMap` (≥ 3): 9 COMPUTED + 18 AI = 27개 / 클라 SSOT 일치 / classifyTier 경계값
- `/concordance` 엔드포인트 (≥ 6): 빈 records / 단일 trade / diagonal vs off-diagonal / sample=0 cell null / 5×5 25 cell 보장 / 500 fallback
- `ConcordanceMatrix` (≥ 5): 5×5 grid 렌더 / winRate 색상 분기 / 표본 부족 경고 / diagonal ring / fetch 실패 graceful
- bucket classifier (≥ 4): 5 bucket 분기 + 경계값 (8/6/4/2)

### 3.2 시각 검증 (DoD)

- RecommendationHistoryPage 진입 시 5×5 heatmap 노출
- 셀별 winRate 색상 (≥60% 녹 / ≥40% 황 / <40% 적 / sample=0 회색)
- diagonal 셀 ring 강조
- 하단 메타 룰: "일치 시 N% (M건) vs 불일치 시 N% (M건)"

## 4. 영향

### 4.1 영향받는 파일

- 신규: `server/learning/conditionSourceMap.ts` + `src/api/concordanceClient.ts` + `src/components/analysis/ConcordanceMatrix.tsx` + 테스트 파일들 + ADR
- 수정: `server/routes/attributionRouter.ts` (+/concordance), `src/pages/RecommendationHistoryPage.tsx` (+1줄)
- 무수정: `attributionRepo.ts` / `evolutionEngine.ts` (클라 SSOT 원본)

### 4.2 외부 호출 예산

- 신규 outbound 0건. attributionRepo 메모리 read 만.
- 클라이언트 폴링: 5분 staleTime (attribution 누적 데이터는 자주 갱신 안 됨).
- KIS/KRX/Yahoo/Gemini 자동매매 quota 0 침범.

## 5. 결정의 결과

- 사용자 가설 ("두 시스템 일치 = 강한 신호") 데이터 검증 가능
- 추가 Gemini 호출 0건으로 비용 0 가치 창출 (사용자 메모: 비용 절감 효과)
- attribution 데이터의 활용도 격상 — 27 조건이 단순 가중치 학습뿐 아니라 *교차 합치도* 학습에도 입력
- 후속 PR (메타 룰 학습) 가 본 매트릭스 위에 자연 확장 — 일치 시그널이 통계적으로 유의미하면 evolutionEngine 가중치에 부스트
