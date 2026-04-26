# ADR-0033 — 후보군 파이프라인 시각화 (PR-F)

- **Status**: Accepted (2026-04-26)
- **Scope**: 사용자 P1-1 (가장 우선) — "AI가 아무 종목이나 찍었다" 인상을 지우는 단계별 funnel.
- **Related**: ADR-0028 (P0-A), ADR-0031 (P1-D), ADR-0032 (P1-E).

---

## Context

사용자 페르소나 자료(`14.추가보완.txt`):
> 2,500개 종목 전체를 AI가 직접 고르는 방식은 커버리지 한계가 있고, 먼저 정량 필터로 후보군을
> 압축한 뒤 AI가 2차 분석하는 구조가 더 강하다.
> UI에서는 이걸 파이프라인 시각화로 보여줘야 한다.

```
[전체시장]      2,487
   ↓ 유동성/시총 필터
[거래가능]        412
   ↓ RS / 신고가 / VCP
[모멘텀 후보]      58
   ↓ Gate 1
[생존 후보]        21
   ↓ Gate 2~3
[매수 후보]         5
```

서버는 이미 `ScanSummary` 에 단계별 카운트 보유 (`candidates / yahooFails / gateMisses /
rrrMisses / entries`). UI 노출 경로 부재.

---

## Decision

### 1. /api/screener/pipeline-summary HTTP 엔드포인트

신규 라우터 `server/routes/screenerPipelineRouter.ts`:

```
GET /api/screener/pipeline-summary
→ {
    lastScanTime: string | null;
    stages: [
      { id, label, count, droppedAtThisStep?, dropReason? }
    ];
    totals: {
      universeSize?: number;
      candidates: number;
      entries: number;
      conversionRate: number;  // entries / candidates
    };
  }
```

stages 매핑 (사용자 원안 5단계):
- `UNIVERSE`: 전체 시장 — 워치리스트 + 후보군 모집단 (현재 SSOT 부재 시 ScanSummary.candidates 의 5배 추정 또는 null)
- `CANDIDATES`: 워치리스트·후보군 진입 (= ScanSummary.candidates)
- `MOMENTUM_PASS`: candidates − yahooFails (Yahoo OHLCV 데이터 가용)
- `GATE1_PASS`: 위 단계 − gateMisses (Gate 1 통과)
- `RRR_PASS`: 위 단계 − rrrMisses (Gate 2~3 + RRR 통과)
- `ENTRIES`: 실제 진입 (= ScanSummary.entries)

**입력 가드**:
- ScanSummary null → 전 stages count=0, lastScanTime=null
- 음수 회피 (Math.max(0, …))

### 2. CandidatePipelinePanel 컴포넌트

`src/components/screener/CandidatePipelinePanel.tsx`:

- 5단계 funnel 시각화: 각 단계 박스 + 카운트 + 다음 단계까지 dropped 카운트 + drop 사유.
- TanStack Query useQuery (`['screener', 'pipeline-summary']`, 60초 staleTime, retry 2).
- 데이터 로드 중/실패/null 시 placeholder 표시.

### 3. 위치

`DiscoverWatchlistPage` 의 워치리스트 표 위에 새 섹션 (collapsible).
사용자 페이지 진입 시 시각적으로 "이 5종이 어떻게 압축됐는지" 즉시 인지.

---

## Consequences

### Positive

1. 사용자 P1-1 충족 — "AI 가 아무 종목이나 찍었다" 인상 차단.
2. 매번 새 스캔이 돌 때마다 최신 카운트 자동 갱신 (60초 staleTime + 강제 refresh 가능).
3. 운영자가 단계별 탈락률을 한눈에 파악 → 필터 조정 의사결정 데이터.

### Negative

1. UNIVERSE 단계의 정확한 카운트는 별도 인프라 필요 — 본 PR 은 추정/null fallback.
2. ScanSummary 가 SHADOW/LIVE 분리 통계 없음 — 미래 PR 에서 분리 가능.

### Neutral

- ScanSummary 본체 무수정 (read-only 노출).
- 라우터는 외부 API 호출 0건 — pure server-state read.

---

## Implementation Plan (PR-F)

1. `server/routes/screenerPipelineRouter.ts` 신규 + 단위 테스트.
2. `server/index.ts` 마운트 (`/api/screener`).
3. `src/api/screenerPipelineClient.ts` 신규 — fetch 헬퍼.
4. `src/components/screener/CandidatePipelinePanel.tsx` 신규 + 테스트.
5. `src/pages/DiscoverWatchlistPage.tsx` 임베드 (또는 대안 — 헤더 stack).
6. quality-guard + commit + push.

---

## Out of Scope

- UNIVERSE 카운트 정확 인프라 (stockMaster 합계 + 자격 필터) — 후속 PR.
- 단계별 종목 리스트 드릴다운 — 후속 PR.
- 시계열 추이 차트 (어제 vs 오늘) — P2 별도.
