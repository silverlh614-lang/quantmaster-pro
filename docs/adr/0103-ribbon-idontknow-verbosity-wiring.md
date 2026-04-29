# ADR-0103 — DataQualityRibbon + IDontKnow verbosity wiring (PR-Verbose-Wiring-3)

**상태**: Accepted (PR-Z16 / Phase Verbose 후속)
**작성일**: 2026-04-29
**관련**: ADR-0096 (IDontKnow 4-variant + Ribbon), ADR-0099 (UIVerbosity SSOT), ADR-0101/0102 (VerdictCard / ConfluenceMeter wiring)

## 배경

PR #427 (VerdictCard) + #428 (ConfluenceMeter) wiring 후속 — **사용처 0건 컴포넌트 일괄 wiring** (회귀 위험 0). 두 컴포넌트 모두 Phase B (ADR-0096) 도입 컴포넌트라 단일 PR 통합:

- **DataQualityRibbon** (verbose 한정) — `shouldShow('data-quality-ribbon')` 매트릭스: minimal ❌ / balanced ❌ / verbose ✅
- **IDontKnow 4-variant** (balanced 이상) — `shouldShow('idontknow')` 매트릭스: minimal ❌ / balanced ✅ / verbose ✅

## 결정

ADR-0101/0102 패턴 차용 — `forceShow` 옵셔널 prop + null 반환.

### DataQualityRibbon

```tsx
export function DataQualityRibbon({ counts, ..., forceShow }: ...): ReactElement | null {
  const v = useUIVerbosity();
  const shouldRender = forceShow !== undefined ? forceShow : v.shouldShow('data-quality-ribbon');
  if (!shouldRender) return null;
  // ... 기존 렌더
}
```

### IDontKnow (compound 4-variant)

`makeVariant(emptyKey)` factory 가 각 sub-component 에 verbosity 분기 주입:

```tsx
function makeVariant(emptyKey: ...) {
  return function VariantComponent({ message, action, className, compact, forceShow }: VariantProps): ReactElement | null {
    const v = useUIVerbosity();
    const shouldRender = forceShow !== undefined ? forceShow : v.shouldShow('idontknow');
    if (!shouldRender) return null;
    // ... 기존 렌더 (Delayed / Insufficient / Stale / Conflicted 4 variant 동일 분기)
  };
}
```

4 variant 모두 동일 매트릭스 (idontknow 키) — minimal 시 모두 미렌더, balanced/verbose 시 모두 렌더.

## 회귀 테스트

### 신규 테스트 23 케이스

1. **`DataQualityRibbon.verbosity.test.tsx`** — 7 케이스
   - verbose 렌더 / balanced 미렌더 / minimal 미렌더
   - forceShow=true balanced 렌더 / forceShow=false verbose 강제 차단
   - 빈 counts: verbose 시 placeholder, balanced 시 미렌더 (verbosity 우선)
2. **`IDontKnow.verbosity.test.tsx`** — 16 케이스
   - 4 variant 각 balanced 렌더 (4) + verbose 렌더 (1 통합)
   - 4 variant 각 minimal 미렌더 (4)
   - forceShow override 4 (true minimal 강제 / true 다른 variant / false balanced 강제 / false verbose 강제)
   - compact 모드 verbosity 분기 동일 적용 (2)
   - message override 작동 검증 (verbosity 통과 후) (1)

### 기존 테스트 38 케이스 무영향

- `DataQualityRibbon.test.tsx` — `beforeEach(() => setUIVerbosity('verbose'))` 한 줄 추가 (verbose 한정 컴포넌트 본체 검증)
- `IDontKnow.test.tsx` — default 'balanced' 가 idontknow=true 라 무영향, 기존 그대로 통과

총 **61 케이스** (23 신규 + 38 기존) pass.

## 비결과 (out-of-scope)

- **DataQualityBadge wiring**: 기존 사용처 WatchlistCard 영향 평가 필요 → 별도 PR (PR-Verbose-Wiring-4)
- **GateStatusCard wiring**: 기존 사용처 WatchlistCard 영향 평가 → 별도 PR (PR-Verbose-Wiring-5)
- **GateMiniIndicator**: 모든 verbosity 에서 ✅ → wiring 자체 불필요 (매트릭스 결정)
- **Ribbon / IDontKnow 사용처 임베드**: 두 컴포넌트 사용처 0건 — 시범 임베드는 후속 PR

## 운영 효과

- **사용자 즉시 효과**: Settings → 정보 밀도 변경 시 (사용처 임베드 후) Ribbon / IDontKnow 자동 분기
- **wiring 표준 정착**: ADR-0101/0102 forceShow override 패턴이 4번째 wiring PR (DataQualityRibbon) + 5번째 wiring PR (IDontKnow 4 sub-variant) 모두 일관 적용
- **사용처 0건이라 회귀 위험 0**: 단지 컴포넌트 자기 분기만 추가, 외부 호출자 영향 없음
- **이중 차단 안전성** (IDontKnow): 사용처가 IDontKnow.Conflicted 등 신호 충돌 표시할 때, minimal 모드 사용자에게 자동 미노출 — 시각 부담 ↓

## 회귀 위험 평가

- **자동매매 본체 0줄 변경** — UI 분기만 (절대 규칙 #2/#3/#4 미위반)
- **단방향 결합 보존** — DataQualityRibbon / IDontKnow 모두 외부 의존성 0 (props 만)
- **사용처 0건** — 외부 호출자 영향 0 (가장 안전한 wiring)
- **회귀 가드** — 신규 23 + 기존 38 = 61/61 pass
- **롤백 안전** — useUIVerbosity import 2개 + 분기 5곳 (Ribbon 1 + IDontKnow makeVariant 1) + forceShow 옵셔널 prop 추가만

## 후속 PR

- **PR-Verbose-Wiring-4**: DataQualityBadge 자기 가시성 분기 (기존 사용처 WatchlistCard 영향 평가)
- **PR-Verbose-Wiring-5**: GateStatusCard 자기 가시성 분기 (기존 사용처 WatchlistCard 영향 평가)
- **PR-Phase-D-2**: VerdictCard.Evidence 안 ConfluenceMeter 시범 임베드 (DiscoverWatchlistPage Top 3)
- **PR-MarketOverviewHeader-Embed**: DataQualityRibbon + IDontKnow 페이지 상단 임베드

## 메모

- ADR-0099 → 0100 → 0101 → 0102 → **0103** 자연 의존 사슬
- ADR-0101/0102 의 forceShow override + null 반환 패턴 표준 정착 — 4 컴포넌트 일관
- byte-equivalent 패턴 (사용처 0건이라 외부 영향 없음)
