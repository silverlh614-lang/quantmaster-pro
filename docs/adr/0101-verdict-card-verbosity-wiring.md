# ADR-0101 — VerdictCard verbosity wiring (PR-Verbose-Wiring-1)

**상태**: Accepted (PR-Z14 / Phase Verbose 후속)
**작성일**: 2026-04-29
**관련**: ADR-0097 (VerdictCard V-E-R), ADR-0099 (UIVerbosity SSOT), ADR-0100 (UIVerbosityToggle 임베드)

## 배경

PR #420~426 이 UI Phase A~D 컴포넌트 도입 + UIVerbosity 토글 SSOT + Settings 모달 임베드 완료. 그러나 **VerdictCard 자체가 verbosity 분기를 적용 안 함** — 사용자가 토글을 변경해도 V-E-R 카드는 변화 없음.

본 PR 은 VerdictCard 의 EvidenceSlot / RiskSlot / TimeBand 가 `useUIVerbosity().shouldShow(...)` 분기 적용 — 토글 변경 시 *즉시* 시각 변화.

## 결정

3 위치 wiring (variant='verdict' 모드 한정):

### 1. EvidenceSlot

```tsx
function EvidenceSlot({ children, className, forceShow }: EvidenceSlotProps): ReactElement | null {
  const v = useUIVerbosity();
  const shouldRender = forceShow !== undefined ? forceShow : v.shouldShow('evidence');
  if (!shouldRender) return null;
  // ... 기존 렌더
}
```

- `forceShow` 옵셔널 prop — 명시 시 useUIVerbosity 무시 (특수 케이스 / 테스트)
- minimal 시 null 반환 → DOM 부재
- balanced/verbose 시 정상 렌더

### 2. RiskSlot

동일 패턴 — `shouldShow('risk')` 분기 + `forceShow` override.

### 3. VerdictCard root (TimeBand 분기)

```tsx
const v = useUIVerbosity();
const showTimeBand =
  createdAt !== undefined && expiresAt !== undefined && v.shouldShow('time-band');
```

기존 조건 (`createdAt && expiresAt`) AND `shouldShow('time-band')` 추가.

### 4. variant='default' 모드 — verbosity 무영향

VerdictCard root 의 default 분기는 **수정 안 함** — 기존 사용처 (50+ 카드) 무영향. Migration Gate 정합 보장.

### 5. VerdictSlot — 모든 verbosity 에서 항상 렌더

minimal 모드에서도 verdict 라벨은 노출 (사용자 결정 핵심). shouldShow('verdict') 매트릭스가 모든 모드 ✅.

## 회귀 테스트

`src/components/common/VerdictCard.verbosity.test.tsx` — jsdom 회귀 9 케이스:

1. balanced + V-E-R 3 슬롯 + TimeBand 모두 렌더 (기본 동작 보존)
2. minimal — Verdict slot 만, Evidence/Risk/TimeBand 미렌더
3. minimal — Verdict 라벨 표시 검증 ("강매수 후보")
4. verbose — balanced 와 동일 (모든 슬롯)
5. variant='default' + minimal — verbosity 무영향 (Migration Gate)
6. variant 부재 + balanced — 기존 동작 100% 보존
7. forceShow=true override — minimal 시에도 EvidenceSlot 렌더
8. forceShow=false override — balanced 시에도 RiskSlot 미렌더
9. Slot 단독 사용 — useUIVerbosity 분기 작동 (Evidence/Risk/TimeBand)

기존 30 케이스 (`VerdictCard.test.tsx`) 모두 default 'balanced' 라 무영향 — 39/39 pass.

## 비결과 (out-of-scope)

- **다른 컴포넌트 wiring**: ConfluenceMeter / DataQualityBadge / DataQualityRibbon / IDontKnow / GateStatusCard / GateMiniIndicator — 후속 PR (각 별도, 회귀 위험 격리)
- **WatchlistCard 임베드**: VerdictCard 를 WatchlistCard 안 시범 임베드는 후속 PR (PR-Phase-C-2)
- **RecommendationSnapshot.createdAt/expiresAt wiring**: 백엔드가 자동 주입 — 후속 PR (PR-Phase-C-4)
- **expired Verdict slot 자동 전환**: ADR-0097 의 `injectExpiredIntoVerdict` React.cloneElement 패턴은 별도 PR

## 운영 효과

- **토글 변경 즉시 시각 변화**: 사용자가 Settings → 정보 밀도 → 간결 클릭 시 모든 VerdictCard (variant='verdict') 가 Verdict slot 만 표시
- **Migration Gate 회귀 격리**: variant='default' 카드 영향 0 — 50+ 기존 카드 무수정
- **forceShow override**: 특수 케이스 (테스트 / 강제 노출 / 디버깅) 안전 우회 경로 보존
- **wiring 후속 PR 패턴 정착**: 다른 컴포넌트 wiring 시 본 PR 패턴 (forceShow + shouldShow) 차용

## 회귀 위험 평가

- **자동매매 본체 0줄 변경** — UI 분기만 (절대 규칙 #2/#3/#4 미위반)
- **Migration Gate 정합** — variant='default' 무수정 (회귀 테스트 자동 검증)
- **default verbosity='balanced'** — 모든 슬롯 표시 보장 (기존 사용처 무영향)
- **회귀 가드** — 9 신규 케이스 + 30 기존 케이스 모두 pass
- **롤백 안전** — useUIVerbosity import 1개 + 분기 3곳 + forceShow 옵셔널 prop 추가만

## 후속 PR

- **PR-Verbose-Wiring-2**: ConfluenceMeter atLeast('verbose') 분기
- **PR-Verbose-Wiring-3**: IDontKnow / DataQualityBadge / DataQualityRibbon / GateStatusCard / GateMiniIndicator (각 별도 PR)
- **PR-Phase-C-2**: VerdictCard 를 WatchlistCard 안 시범 임베드 (DiscoverWatchlistPage Top 3)
- **PR-Phase-C-4**: RecommendationSnapshot.createdAt/expiresAt wiring (TimeBand 자동 주입)

## 메모

- ADR-0099 (Verbosity SSOT) → ADR-0100 (사용자 노출) → **ADR-0101 (첫 wiring)** 자연 의존 사슬
- byte-equivalent 패턴 (variant='default' 무수정) — Migration Gate 정합
- forceShow override 패턴 — 후속 wiring PR 들의 표준 (특수 케이스 안전망)
