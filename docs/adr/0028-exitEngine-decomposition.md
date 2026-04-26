# ADR-0028 — exitEngine.ts decomposition (rules + helpers)

- **Status**: Accepted (2026-04-26)
- **Owner**: server-refactor-orchestrator (engine-dev + quality-guard)
- **Supersedes**: 부분적으로 ADR-0001(signalScanner) 의 분해 패턴을 차용

## Context

`server/trading/exitEngine.ts` 는 1,358 줄까지 비대해졌다. 이 중 `_updateShadowResultsImpl` 한 함수가 950 줄이며 다음 책임이 한 함수에 모두 섞여 있다:

1. PENDING→ACTIVE 승격 (SHADOW 모드)
2. fills 기반 잔량 동기화
3. **ATR 동적 손절 갱신** (BEP 보호 / 수익 Lock-in)
4. **R6 긴급 청산** (블랙스완 30%)
5. **MA60_DEATH_FORCE_EXIT** (역배열 5영업일 만료 시 전량)
6. **하드 스톱** (고정/레짐/Profit Protection)
7. **CASCADE_FINAL** (-25% 전량 / -30% 블랙리스트)
8. **L3-a 트레일링 고점 갱신**
9. **L3-b LIMIT 트랜치 분할 익절**
10. **L3-c 트레일링 스톱**
11. **TARGET_EXIT** (트랜치 미설정 구형 fallback)
12. **CASCADE_HALF_SELL** (-15% 50%)
13. **CASCADE_WARN_BLOCK** (-7% 추가매수 차단)
14. **RRR_COLLAPSE_PARTIAL** (잔여기대 < 1.0 이면 50%)
15. **DIVERGENCE_PARTIAL** (하락 다이버전스 30%)
16. **MA60_DEATH_WATCH** (역배열 최초 감지 → 5영업일 스케줄)
17. **STOP_APPROACH_ALERT** (3단계 손절 접근 경보)
18. **EUPHORIA_PARTIAL** (과열 50%)

각 블록은 시각적으로 `// ───` 주석으로 분리되어 있으나, 950 줄 한 함수 안에 있어:
- 단위 테스트 불가능 — 한 규칙만 검증하려면 전체 함수 + 외부 mock 필요
- 새 규칙 추가 시 거대 함수 끝에 또 한 블록을 추가하는 구조 — drift 위험
- `복잡도 한계` (1,500 줄/파일) 임계 80% 도달 — 다음 규칙 추가 시 위반

## Decision

`server/trading/exitEngine/` 디렉토리로 13 rules + 4 helpers + 1 orchestrator + 1 types 파일로 분해한다.

```
server/trading/exitEngine.ts                # 얇은 barrel re-export (PR-40 패턴)
server/trading/exitEngine/
├── index.ts                                # updateShadowResults + _exitRunning 뮤텍스 + 루프 오케스트레이션
├── types.ts                                # ExitContext, ExitRuleResult, FullCloseSnapshot
├── helpers/
│   ├── reserveSell.ts                      # 주문 접수 ≠ 체결 헬퍼
│   ├── rollbackFullClose.ts                # 전량 청산 실패 시 상태 롤백
│   ├── attribution.ts                      # emitPartialAttributionForSell (PR-42 M1)
│   ├── rsiSeries.ts                        # Wilder 평활화 RSI + detectBearishDivergence
│   ├── ma60.ts                             # isMA60Death + simpleMA + fetchMaFromCloses + kstBusinessDateStr
│   └── priceHistory.ts                     # fetchPriceAndRsiHistory + yahooSymbolCandidates
└── rules/
    ├── atrDynamicStop.ts                   # ATR 동적 손절 갱신 (BEP 보호 / Lock-in)
    ├── r6EmergencyExit.ts                  # R6 긴급 청산 30%
    ├── ma60DeathForceExit.ts               # MA60 역배열 강제 청산 (만료)
    ├── hardStopLoss.ts                     # 고정/레짐/Profit Protection 손절
    ├── cascadeFinal.ts                     # -25% 전량 / -30% 블랙리스트
    ├── trailingPeakUpdate.ts               # L3-a 트레일링 고점 갱신
    ├── trancheTakeProfitLimit.ts           # L3-b LIMIT 분할 익절
    ├── trailingStop.ts                     # L3-c 트레일링 스톱
    ├── legacyTakeProfit.ts                 # TARGET_EXIT (트랜치 미설정 fallback)
    ├── cascadeHalf.ts                      # -15% 50% 반매도
    ├── cascadeWarn.ts                      # -7% 추가매수 차단
    ├── rrrCollapseExit.ts                  # 잔여 RRR < 1.0 → 50%
    ├── bearishDivergenceExit.ts            # 하락 다이버전스 30%
    ├── ma60DeathWatch.ts                   # MA60 역배열 최초 감지
    ├── stopApproachAlert.ts                # 손절 접근 3단계 경보
    └── euphoriaPartialExit.ts              # 과열 50%
```

### Rule signature

각 rule 은 다음 시그니처의 함수다 (사용자 원안의 "ExitDecision 반환" 형은 부수효과 격리가 필요해 후속 PR 로 분리; 본 PR 은 **byte-equivalent 추출** 우선):

```typescript
export interface ExitContext {
  shadow: ServerShadowTrade;
  currentPrice: number;
  returnPct: number;
  currentRegime: RegimeLevel;
  initialStopLoss: number;
  regimeStopLoss: number;
  hardStopLoss: number;          // ATR 동적 갱신 후 값
  resolvedNow: Set<string>;      // L1 학습 훅 (orchestrator 가 mutate)
}

export interface ExitRuleResult {
  /** true 면 orchestrator 가 `continue` (이 shadow 의 후속 규칙 평가 중단) */
  skipRest: boolean;
  /** ATR 등이 hardStopLoss 를 갱신했을 때 후속 규칙으로 전파 */
  hardStopLossUpdate?: number;
}

export type ExitRule = (ctx: ExitContext) => Promise<ExitRuleResult>;
```

### Priority table (orchestrator 내 EXIT_RULES_IN_ORDER)

원본 함수의 평가 순서를 그대로 보존한다 (entryEngine.ts `EXIT_RULE_PRIORITY_TABLE` 과 정합):

```typescript
1. atrDynamicStop          (mutates hardStopLoss)
2. r6EmergencyExit
3. ma60DeathForceExit
4. hardStopLoss
5. cascadeFinal            (-25%/-30%)
6. trailingPeakUpdate      (mutates shadow.trailingHighWaterMark)
7. trancheTakeProfitLimit  (LIMIT 분할 익절)
8. trailingStop            (L3-c)
9. legacyTakeProfit        (TARGET_EXIT)
10. cascadeHalf            (-15%)
11. cascadeWarn            (-7%)
12. rrrCollapseExit
13. bearishDivergenceExit
14. ma60DeathWatch
15. stopApproachAlert
16. euphoriaPartialExit
```

## Consequences

- **외부 importer 무수정**: `server/trading/exitEngine.ts` 는 barrel 로 변환되어 `import { updateShadowResults, emitPartialAttributionForSell, detectBearishDivergence, isMA60Death, kstBusinessDateStr } from './exitEngine.js'` 가 그대로 동작.
- **테스트 무회귀**: `exitEngineMutex.test.ts` (PR-6) / `exitEngineAttribution.test.ts` (PR-42 M1) / `exitEngine.atrIntegration.test.ts` / `fullCloseRollback.test.ts` 가 import 경로 변경 없이 통과.
- **새 규칙 추가**: `rules/<newRule>.ts` 파일 1개 + `index.ts` `EXIT_RULES_IN_ORDER` 배열 1줄 추가.
- **단위 테스트 가능**: 각 rule 이 explicit ctx 를 받으므로 mock context 로 단위 테스트 가능 (후속 PR).
- **복잡도**: 모든 신규 파일 1,500 줄 임계 안. orchestrator `index.ts` 약 150 줄, 가장 큰 rule(`hardStopLoss`/`trancheTakeProfitLimit`) 약 100 줄 예상.

## Alternatives Considered

1. **순수 ExitDecision 반환 패턴** (사용자 원안) — 각 rule 이 `{ action, ratio, reason }` 만 반환하고 orchestrator 가 KIS 호출/텔레그램/attribution 을 일괄 실행. 더 깔끔하지만 메시지 형식·priority·dedupeKey·channelSellSignal reason 코드가 규칙별로 다 달라 일관 executor 작성에 추가 PR 필요. 본 PR 은 부수효과 패턴 유지로 byte-equivalent 추출에 집중. 후속 PR 에서 점진 전환 가능.
2. **분해 안 함 (현재 유지)** — 거부. 1,358 줄 → 다음 규칙 추가 시 1,500 줄 임계 위반 임박.
3. **`if` 블록을 함수로 추출하되 같은 파일 유지** — 거부. 1 파일 1,500 줄 임계는 해소하나 단위 테스트 가능성 미확보.

## Migration Plan

1. **Phase 1** (본 PR): ADR-0028 작성.
2. **Phase 2** (본 PR): `server/trading/exitEngine/types.ts` + `helpers/*` 신설. 기존 `exitEngine.ts` 의 helper export 는 helpers 에서 re-export.
3. **Phase 3** (본 PR): `rules/*.ts` 16 개 파일 생성. 각 파일은 원본 if 블록을 함수로 감싼 byte-equivalent 본체.
4. **Phase 4** (본 PR): `exitEngine/index.ts` 오케스트레이터 작성. `_updateShadowResultsImpl` 의 루프 본체를 `EXIT_RULES_IN_ORDER` 순회로 교체.
5. **Phase 5** (본 PR): `exitEngine.ts` 본체를 barrel re-export 로 축소.
6. **Phase 6** (본 PR): vitest server/trading 전체 통과 + validate:all + precommit.
7. **Phase 7** (후속 PR): 각 rule 단위 테스트 + ExitDecision 패턴 점진 전환.

## Boundary Rules

- **kisClient 단일 통로**: rule 파일들은 `placeKisSellOrder` / `fetchCurrentPrice` 만 직접 import. Raw KIS 호출 0건.
- **자동매매 단일 통로**: `AUTO_TRADE_ENABLED` 가드는 호출자(`runAutoSignalScan` / `shadowResolverJob`) 책임 (PR-52 audit 정합). exitEngine 본체는 SHADOW + LIVE 양쪽 잔고 모드를 분기 없이 처리 (현행 유지).
- **fills SSOT**: `appendFill` / `syncPositionCache` / `getRemainingQty` 호출 시점은 `reserveSell` helper 안에 캡슐화 (현행 유지).
- **mutex**: `_exitRunning` 플래그는 orchestrator `index.ts` 에 캡슐화. rule 파일은 mutex 인지 안 함.
- **LIVE 회귀 0**: 본 PR 의 모든 rule 함수는 원본 if 블록의 byte-equivalent 추출. 알고리즘/메시지/priority/dedupeKey 변경 0건.
