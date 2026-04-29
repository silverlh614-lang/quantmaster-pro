# ADR-0109 — DataQualityBadge verbosity wiring (PR-Verbose-Wiring-4)

**상태**: Accepted (PR-Z17 / Phase Verbose 후속)
**작성일**: 2026-04-29
**관련**: ADR-0028 (DataQualityBadge 도입), ADR-0095 (5-tier 격상), ADR-0099 (UIVerbosity SSOT), ADR-0101/0102/0103 (wiring 1~3)

## 배경

PR #429 (Wiring-3) 후속 — **DataQualityBadge 자기 가시성 분기**. 기존 사용처 WatchlistCard 1곳 영향 평가 필요.

`shouldShow('data-quality', verbosity)` 매트릭스: minimal ❌ / balanced ✅ / verbose ✅.

default 'balanced' 라 기존 사용처 영향 0 (회귀 위험 격리).

## 결정

ADR-0101/0102/0103 패턴 차용:

```tsx
export function DataQualityBadge({ count, compact = true, className, forceShow }: DataQualityBadgeProps) {
  const verbosityState = useUIVerbosity();
  const shouldRender = forceShow !== undefined ? forceShow : verbosityState.shouldShow('data-quality');
  if (!shouldRender) return null;
  // ... 기존 렌더 (compact / 풀 모드 / "데이터 부족" placeholder)
}
```

- `forceShow` 옵셔널 prop override
- minimal 시 null 반환 → DOM 부재
- balanced/verbose 시 정상 렌더 (compact / 풀 모드 / placeholder)

## 회귀 테스트

### 신규 10 케이스 (`DataQualityBadge.verbosity.test.tsx`)

- balanced: compact / 풀 모드 렌더 (2)
- verbose: 모든 모드 렌더 (1)
- minimal: compact / 풀 미렌더 (2)
- forceShow=true minimal 강제 / forceShow=false balanced·verbose 강제 차단 (3)
- total=0 placeholder + balanced 표시 / minimal verbosity 우선 (2)

### 기존 14 케이스 (`DataQualityBadge.test.tsx`)

`beforeEach(() => setUIVerbosity('balanced'))` 한 줄 추가. default 'balanced' 라 무영향 — 14/14 그대로 통과.

### WatchlistCard 회귀 16 무영향

기존 사용처 default 'balanced' 라 DataQualityBadge 표시 보장. 16/16 통과.

총 **40/40 pass** (10 신규 + 14 기존 + 16 인접).

## 비결과 (out-of-scope)

- **GateStatusCard wiring**: PR-Verbose-Wiring-5 별도 (다음)
- **GateMiniIndicator** — 모든 verbosity ✅ 라 wiring 자체 불필요

## 운영 효과

- Settings 토글 → minimal 시 WatchlistCard 안 DataQualityBadge 미렌더 (시각 부담 ↓)
- balanced/verbose 시 정상 표시 (기존 동작 보존)
- forceShow override 패턴 표준 정착

## 회귀 위험 평가

- **자동매매 본체 0줄 변경** — UI 분기만
- **default 'balanced'** — WatchlistCard 무영향
- **회귀 가드** — 40/40 pass (신규 10 + 기존 14 + WatchlistCard 16)
- **롤백 안전** — useUIVerbosity import 1개 + 분기 1곳 + forceShow 옵셔널 prop 추가만

## 후속 PR

- **PR-Verbose-Wiring-5**: GateStatusCard wiring (마지막 wiring)

## 메모

- ADR-0099 → 0100 → 0101 → 0102 → 0103 → **0104** 자연 의존 사슬
- forceShow override 패턴 — 5번째 wiring PR 표준 정착
- byte-equivalent 패턴 (default 'balanced' 무영향)
