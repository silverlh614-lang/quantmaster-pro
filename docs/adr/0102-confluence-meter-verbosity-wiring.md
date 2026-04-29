# ADR-0102 — ConfluenceMeter verbosity wiring (PR-Verbose-Wiring-2)

**상태**: Accepted (PR-Z15 / Phase Verbose 후속)
**작성일**: 2026-04-29
**관련**: ADR-0098 (ConfluenceMeter 4축), ADR-0099 (UIVerbosity SSOT), ADR-0101 (VerdictCard wiring)

## 배경

PR #427 (ADR-0101) 이 VerdictCard 의 EvidenceSlot/RiskSlot/TimeBand wiring 을 적용했지만 **ConfluenceMeter 자체가 verbosity 분기 미적용**. 사용자 분석 #12 매트릭스에 따르면 ConfluenceMeter 는 verbose 모드 전용 — minimal/balanced 시 미렌더해야 함.

`shouldShowAtVerbosity('confluence', verbosity)` 매트릭스:

| verbosity | confluence |
|-----------|:----------:|
| minimal   | ❌         |
| balanced  | ❌         |
| verbose   | ✅         |

본 PR 은 ConfluenceMeter 자체에 `useUIVerbosity().shouldShow('confluence')` 분기 적용 — verbose 한정 렌더.

## 결정

ConfluenceMeter 컴포넌트 자체에 wiring (단방향 결합 #10 보존):

```tsx
export function ConfluenceMeter({ axes, compact = false, className, forceShow }: ConfluenceMeterProps): ReactElement | null {
  // ADR-0102 PR-Verbose-Wiring-2: atLeast('verbose') 분기 — verbose 모드 한정 렌더
  const v = useUIVerbosity();
  const shouldRender = forceShow !== undefined ? forceShow : v.shouldShow('confluence');
  if (!shouldRender) return null;
  // ... 기존 렌더
}
```

- `forceShow` 옵셔널 prop — 명시 시 useUIVerbosity 무시 (특수 케이스, ADR-0101 패턴 차용)
- minimal/balanced 시 null 반환 → DOM 부재
- verbose 시 정상 렌더 (4 축 + 결손 사유 + 종합 등급)

### 단방향 결합 (#10) 보존

ConfluenceMeter 는 여전히 VerdictCard 를 *모름* — props 만 받음. VerdictCard.Evidence 안 자식으로 박혀도, 어디서든 단독 사용해도 동일 분기 적용. *이중 차단* 보장:

- VerdictCard.Evidence (shouldShow('evidence')) → minimal 시 미렌더
- 그 안 ConfluenceMeter (shouldShow('confluence')) → balanced 에서도 미렌더

## 회귀 테스트

### 신규 테스트 (`ConfluenceMeter.verbosity.test.tsx`) — 14 케이스

1. verbose 모드 → 렌더 (4 축 모두)
2. balanced 모드 → 미렌더 (null)
3. minimal 모드 → 미렌더
4. forceShow=true: balanced/minimal 모두 렌더 (override) — 2 케이스
5. forceShow=false: verbose 시에도 미렌더 (강제 차단)
6. compact 모드 verbosity 분기 동일 적용 — 2 케이스
7. **VerdictCard.Evidence 안 임베드 — 이중 분기 안전성 (3 케이스)**:
   - balanced → Evidence 자체는 렌더되지만 ConfluenceMeter 만 미렌더
   - verbose → Evidence + ConfluenceMeter 모두 렌더
   - minimal → Evidence + ConfluenceMeter 모두 미렌더 (이중 차단)
8. 단독 사용 + verbose — VerdictCard 마커 부재 (단방향 보존)
9. 빈 axes — verbose 시 placeholder, balanced 시 미렌더 (verbosity 우선)

### 기존 테스트 (`ConfluenceMeter.test.tsx`) — 36 케이스 무변

기존 테스트는 *컴포넌트 본체 검증* 이므로 `beforeEach(() => useSettingsStore.getState().setUIVerbosity('verbose'))` 추가하여 verbose 강제. verbosity 분기 자체는 새 테스트가 별도 검증.

총 89 케이스 (ConfluenceMeter 50 + VerdictCard 39) 모두 pass — 회귀 0.

## 비결과 (out-of-scope)

- **DataQualityBadge / Ribbon / IDontKnow / GateStatusCard / GateMiniIndicator wiring**: PR-Verbose-Wiring-3 (각 별도 PR — 회귀 위험 격리)
- **Screener / Backtest 페이지 단독 사용 시범 임베드**: 후속 PR
- **백엔드 4축 score wiring**: 후속 PR (`confluenceEngine.ts` 신설)

## 운영 효과

- **사용자 인지 부하 직접 제어 + ConfluenceMeter 적용**: verbose 모드에서만 4축 합치도 노출 → 신규/일반 사용자 화면 깔끔, 운영자만 상세 분석
- **이중 차단 안전성**: VerdictCard.Evidence (balanced+) AND ConfluenceMeter (verbose+) 양쪽 분기 — 의도적 노출 흐름 보장
- **단방향 결합 보존**: ConfluenceMeter 가 VerdictCard 를 모르므로 어디서든 단독 사용 가능 (Screener / Backtest)
- **wiring 패턴 정착**: forceShow override + shouldShow + null 반환 — PR-Verbose-Wiring-3 의 표준 차용

## 회귀 위험 평가

- **자동매매 본체 0줄 변경** — UI 분기만 (절대 규칙 #2/#3/#4 미위반)
- **단방향 결합 (#10) 보존** — 회귀 테스트 자동 검증
- **기존 36 ConfluenceMeter 케이스 무변** — beforeEach 한 줄 추가만
- **롤백 안전** — useUIVerbosity import 1개 + 분기 1곳 + forceShow 옵셔널 prop 추가만

## 후속 PR

- **PR-Verbose-Wiring-3**: DataQualityBadge / DataQualityRibbon / IDontKnow / GateStatusCard / GateMiniIndicator 각 별도 PR
- **PR-Phase-D-2**: VerdictCard.Evidence 안 ConfluenceMeter 시범 임베드 (DiscoverWatchlistPage Top 3, verbose 모드에서 효과 검증)
- **PR-Phase-D-3**: 백엔드 4축 score 산출 wiring (`confluenceEngine.ts` 신설)

## 메모

- ADR-0099 → ADR-0100 → ADR-0101 → **ADR-0102** 자연 의존 사슬
- ADR-0101 의 forceShow override 패턴 차용 — 후속 wiring PR 표준 정착
- byte-equivalent 패턴 (단방향 결합 #10 보존, 기존 36 케이스 verbose 강제만)
