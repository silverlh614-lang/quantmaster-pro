# ADR-0110 — GateStatusCard verbosity wiring (PR-Verbose-Wiring-5, **마지막 wiring**)

**상태**: Accepted (PR-Z18 / Phase Verbose 후속 — wiring 시리즈 완주)
**작성일**: 2026-04-29
**관련**: ADR-0028 (GateStatusCard 도입), ADR-0099 (UIVerbosity SSOT), ADR-0101~0103, ADR-0109 (wiring 1~4)

## 배경

PR #436 (Wiring-4 DataQualityBadge) 후속 — **마지막 wiring**. GateStatusCard 자기 가시성 분기.

`shouldShow('gate-status')` 매트릭스: minimal ❌ / balanced ❌ / **verbose ✅** (verbose 한정).

## 결정

ADR-0101~0103, 0109 패턴 차용 (forceShow + null + shouldShow):

```tsx
export function GateStatusCard({ summary, onExpand, className, forceShow }: GateStatusCardProps) {
  const v = useUIVerbosity();
  const shouldRender = forceShow !== undefined ? forceShow : v.shouldShow('gate-status');
  if (!shouldRender) return null;
  // ... 기존 렌더
}
```

## WatchlistCard 사용처 영향

기존 사용처 WatchlistCard 안 GateStatusCard:
- **default 'balanced'** → 미렌더 (사용자 #12 매트릭스 정합 — balanced 카드 단순, verbose 만 풀 표시)
- 기존 사용자 영향: 카드에서 GateStatusCard 사라짐, **GateMiniIndicator 만 표시** (gate-mini 매트릭스: 모든 모드 ✅)
- 운영자가 verbose 토글 시 GateStatusCard 풀 노출
- **WatchlistCard 가 forceShow={true} 명시** 옵션 — 후속 PR 에서 WatchlistCard 사용처 정책 결정 (강제 노출 vs verbosity 분기)

## 회귀 테스트

`GateStatusCard.verbosity.test.tsx` 신규 6 케이스 — verbose 렌더 / balanced·minimal 미렌더 / forceShow override 양방향. 기존 `GateStatusCard.test.ts` 16 케이스 (순수 함수 buildGateCardSummary) 무영향.

## 12 아이디어 시리즈 — wiring **완주** ✅

| Wiring | 컴포넌트 | PR |
|---|---|---|
| 1 | VerdictCard | #427 |
| 2 | ConfluenceMeter | #428 |
| 3 | DataQualityRibbon + IDontKnow | #429 |
| 4 | DataQualityBadge | #436 |
| **5** | **GateStatusCard** | **본 PR (마지막)** |

GateMiniIndicator 는 모든 verbosity ✅ 라 wiring 자체 불필요. **5 wiring + Embed 1 = 6 PR**로 verbosity 시리즈 완주.

## 후속 PR (선택적, 사용자 결정)

- **PR-Phase-D-2**: VerdictCard.Evidence 안 ConfluenceMeter 시범 임베드
- **PR-Phase-C-2**: VerdictCard 를 WatchlistCard 안 시범 임베드
- **PR-MarketOverviewHeader-Embed**: Ribbon + IDontKnow 페이지 상단
- **PR-Phase-A-3**: --discover 모드 (#2)
- **PR-WatchlistCard-Verbosity-Policy**: WatchlistCard 가 GateStatusCard 를 forceShow 또는 verbosity 분기 사용할지 결정
