# ADR-0032 — 섹터 로테이션 히트맵 (PR-E)

- **Status**: Accepted (2026-04-26)
- **Scope**: 사용자 P1-2 (섹터 로테이션 히트맵).
- **Related**: ADR-0028 (P0-A), ADR-0031 (P1-D).

---

## Context

사용자 페르소나 자료 — 데이터 사이클 자료에 따르면 *섹터 로테이션* 은 매수 이전 단계에서
"지금 시장이 무엇을 사고 있는가" 를 보여주는 1차 신호. 현재 `useGlobalIntelStore.sectorEnergyResult`
가 이미 계산되어 있으나 (returnContrib + volumeContrib + foreignContrib + seasonal multiplier)
UI 노출 경로가 빈약.

`SectorEnergyResult` 가 이미 보유한 데이터:
- `scores: SectorEnergyScore[]` — 섹터별 정규화 0~100 점수
- `leadingSectors` / `neutralSectors` / `laggingSectors` — 3분류
- `currentSeason` — 계절성 컨텍스트

본 PR-E 는 이 데이터를 **컴팩트 히트맵** 으로 표시. 풀 분석은 별도 페이지로 분리 가능하지만
일단 페이지 헤더 stack 으로 작은 시각화부터.

---

## Decision

### 1. SectorRotationHeatmap 컴포넌트

`src/components/sector/SectorRotationHeatmap.tsx` 신규.

**Props**:
```typescript
interface SectorRotationHeatmapProps {
  result: SectorEnergyResult | null;
}
```

**렌더 형식**:
- 데이터 부재 → null (미렌더)
- 컴팩트 한 줄: `🔥 LEADING [반도체 92] [이차전지 85] [조선 78] · ⚖️ NEUTRAL [3종] · 🧊 LAGGING [통신 28] [유틸 32]`
- 클릭 시 펼치기 → 전 섹터 점수 막대 그래프
- 색상: score ≥ 70 → 적/오렌지 (Hot), 50~70 → 황 (Warm), 30~50 → 회 (Cool), < 30 → 청 (Cold)

### 2. 위치

`src/layout/MarketOverviewHeader.tsx` stack 에 추가:
```
[StickyMiniHeader]
[StatusBanner]
[MarketModeBanner]      ← PR-A
[MarketRegimeBanner]    ← 기존 alert 전용
[SectorRotationHeatmap] ← PR-E 신규
[MarketNeutralPanel]
[MarketTicker]
```

데이터 부재 (`sectorEnergyResult=null`) 시 `<SectorRotationHeatmap />` 자체가 null 반환 — 빈 공간 미발생.

### 3. 색상 규칙 (순수 함수)

`src/utils/sectorHeatColor.ts`:

```typescript
export type SectorHeatTone = 'HOT' | 'WARM' | 'COOL' | 'COLD';

export function classifySectorHeat(score: number): SectorHeatTone {
  if (score >= 70) return 'HOT';
  if (score >= 50) return 'WARM';
  if (score >= 30) return 'COOL';
  return 'COLD';
}
```

CSS 매핑:
- HOT: `bg-red-500/30 border-red-500/40 text-red-200`
- WARM: `bg-amber-500/30 border-amber-500/40 text-amber-200`
- COOL: `bg-cyan-500/20 border-cyan-500/30 text-cyan-200`
- COLD: `bg-blue-500/20 border-blue-500/30 text-blue-200`

---

## Consequences

### Positive

1. 사용자가 페이지 진입 직후 시장 자금이 향하는 섹터를 1줄로 인지.
2. Leading 섹터 종목이 워치리스트에 있으면 "섹터 정합" 즉시 판단.
3. 기존 `sectorEnergyResult` 가 store 에 있으나 미노출이던 자산 활용.

### Negative

1. MarketOverviewHeader 의 stack 항목이 늘어남 (1행) — 모바일 첫 화면 가독성 영향.
2. 펼친 풀 히트맵은 본 PR scope 밖 (P2 후속).

### Neutral

- `sectorEnergyResult=null` 일 때 자동 미렌더 — 데이터 부재 환경 무영향.

---

## Implementation Plan (PR-E)

1. `src/utils/sectorHeatColor.ts` 신규 + 테스트 (4 분기).
2. `src/components/sector/SectorRotationHeatmap.tsx` 신규.
3. `src/layout/MarketOverviewHeader.tsx` stack 추가.
4. quality-guard + commit + push.

---

## Out of Scope

- 풀 히트맵 페이지 (모든 섹터 그리드 + 시계열 추이) — P2 별도.
- 섹터별 종목 리스트 드릴다운 — P2 별도.
- 섹터 RS 시계열 차트 — P2 별도.
