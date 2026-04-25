# ADR 0001 — `server/trading/signalScanner.ts` 분해 (P0)

- **상태**: Proposed (개정 2026-04-25 — 5모듈 → 7모듈)
- **제안일**: 2026-04-23
- **개정일**: 2026-04-25
- **적용 스킬**: `.claude/skills/server-refactor-orchestrator`
- **관련 파일**: `server/trading/signalScanner.ts` (1,848줄, 2026-04-25 기준)

## Context

`signalScanner.ts`는 현재 CLAUDE.md의 "기존 복잡도 위반" 표에서 P0(1,820줄 → 1,848줄)로
분류된다. 이미 일부 로직은 하위 모듈로 분해되어 있다 (`entryEngine`, `exitEngine`,
`buyPipeline`, `watchlistManager` 등). 그럼에도 파일이 비대한 이유는 단일 함수
`runAutoSignalScan`이 약 1,500줄에 달하기 때문이다. 이 함수는 다음 책임을 한 몸에 갖고 있다:

1. **사전 가드** — KIS 키 체크, UI 수동 가드, watchlist 로드
2. **후보 선정** — 섹션 분류(SWING/CATALYST/MOMENTUM), Intraday 병합, Shadow Portfolio 확장
3. **매크로 게이팅** — regime/VIX/R6_DEFENSE/FOMC/sellOnlyException 판정
4. **종목별 평가 루프** — gate/RRR/liveGate/failure pattern/corrGate/sizing/cooldown 검증
5. **매수 승인 큐 집계** — LIVE/Shadow 병렬 승인 요청 → 일괄 처리
6. **실 KIS 주문 발송** — operation_id 멱등성, autoTradeEngine 게이트, channelBuySignalEmitted
7. **스캔 진단 영속화** — ScanSummary, entryFailCount, scan traces 기록

현재 구조는 단일 함수에 전역 상태(`_scanYahooFails`, `_scanGateMisses`, `_pendingTraces`)가
섞여 있어 테스트·유지보수·재호출이 모두 어렵다.

## Decision (개정 2026-04-25)

`signalScanner.ts`를 다음 **7개 파일**로 분해한다. 본 개정은 직전 결정의 5모듈
(preflight / candidateSelect / perSymbolEvaluation / approvalQueue / scanDiagnostics) 에
**`orderDispatch.ts` 를 분리 추가**하고 `index.ts` 를 명시적으로 분리한 것이다.

### 개정 사유 — 왜 5모듈이 아닌 7모듈인가

스캔과 주문이 같은 파일에 오래 붙어 있으면 자동매매 사고 가능성이 커진다. 개정 전 5모듈
구조는 `approvalQueue.ts` 가 **승인 큐 집계**(LiveBuyTask 빌드/Promise.allSettled 플러시) 와
**실 KIS 주문 발송**(`onApproved` 콜백 내부의 `channelBuySignalEmitted` /
`recordUniverseEntries` / `trancheExecutor.scheduleTranches` / orderableCash 차감) 을 한 모듈에
함께 갖게 된다. 이는 다음 위험을 만든다:

- 멱등성 키(operation_id) 관리 코드가 LIVE 주문 경로에서 격리되지 않아, 큐 집계 로직
  변경이 KIS POST 의 idempotency 와 채널 송출 횟수에 의도치 않은 부작용을 만들 수 있다.
- 자동매매 사고 회고(post-mortem) 시 "주문 발송 직전 파일" 단일 SSOT 가 없다.
- `AUTO_TRADE_ENABLED=true` LIVE 게이트와 Shadow 모드 분기, channelBuySignalEmitted 의
  단일 송출 보장이 큐 집계 로직과 같은 인지 부하를 가진 채 리뷰된다.

따라서 `approvalQueue.ts` (승인 큐 집계 + 매수 승인 일괄 처리) 와
`orderDispatch.ts` (실 KIS 주문 발송 + 멱등성 + channel 송출 + tranche 스케줄링) 를
**물리적으로 분리**한다.

```
server/trading/signalScanner/
├── index.ts                 # runAutoSignalScan 6단계 조율 (최종 진입점, 200줄 이내 목표)
├── preflight.ts             # KIS key/manual guard/regime/VIX/R6/FOMC/sellOnly/data-starvation
├── candidateSelect.ts       # computeFocusCodes/assignSection/buyList/intradayBuyList 구성
├── perSymbolEvaluation.ts   # 종목 단위 진입 검증 — Gate/RRR/liveGate/failure/corr/sizing
├── approvalQueue.ts         # 매수 승인 큐 집계 + LIVE/Shadow 병렬 발송 + 일괄 처리
├── orderDispatch.ts         # 실 KIS 주문 발송 (operation_id, autoTradeEngine 게이트, channel 송출)
└── scanDiagnostics.ts       # ScanSummary, _consecutiveZeroScans, scan traces 기록
```

각 파일 @responsibility 초안 (모두 25단어 이내, 접속사 금지):

- **index.ts**: "자동 신호 스캔 오케스트레이터 — preflight→후보→평가→주문→승인→진단 6단계 조율"
- **preflight.ts**: "스캔 직전 매크로·시스템 게이트 — KIS·manual·regime·VIX·R6·FOMC·sellOnly 판정"
- **candidateSelect.ts**: "워치리스트를 SWING/CATALYST/MOMENTUM 섹션으로 분류 — buyList·intradayBuyList 구성"
- **perSymbolEvaluation.ts**: "종목 단위 진입 검증 — Gate·RRR·liveGate·failure·corr·sizing·cooldown 평가"
- **approvalQueue.ts**: "매수 승인 큐 집계 — LIVE/Shadow 병렬 발송 + 일괄 처리"
- **orderDispatch.ts**: "실 KIS 주문 발송 — operation_id 멱등성·autoTradeEngine 게이트·channelBuySignalEmitted"
- **scanDiagnostics.ts**: "스캔 진단 — ScanSummary·연속 제로 카운트·scan traces 영속화"

### 외부 공개 API 유지 원칙

`signalScanner.ts` 파일 자체는 **barrel** 로 축소 유지하고, 아래 export 는 기존 경로로
계속 제공한다. 9개 외부 importer 의 import 경로는 **절대 변경하지 않는다**:

| 파일 | 사용 심볼 |
|------|-----------|
| `server/orchestrator/tradingOrchestrator.ts` | `runAutoSignalScan` |
| `server/scheduler/healthCheckJob.ts` | `getLastBuySignalAt`, `getLastScanSummary` |
| `server/scheduler/screenerJobs.ts` | `runAutoSignalScan` |
| `server/telegram/webhookHandler.ts` | `runAutoSignalScan`, `isOpenShadowStatus`, `getLastBuySignalAt`, `getLastScanSummary` |
| `server/alerts/reportGenerator.ts` | `getRemainingQty`, `isOpenShadowStatus` |
| `server/alerts/scanReviewReport.ts` | `getRemainingQty`, `isOpenShadowStatus` |
| `server/routes/autoTrade/screenerRouter.ts` | (re-export 경유) |
| `server/routes/autoTrade/engineRouter.ts` | `getLastBuySignalAt` |
| `server/routes/systemRouter.ts` | `getLastBuySignalAt`, `getLastScanSummary` |

```ts
// server/trading/signalScanner.ts  (refactor 완료 후 — barrel)
export { runAutoSignalScan } from './signalScanner/index.js';
export {
  getLastBuySignalAt, getLastScanSummary, getConsecutiveZeroScans,
} from './signalScanner/scanDiagnostics.js';
export type { ScanSummary } from './signalScanner/scanDiagnostics.js';
// 호환성 re-export — 기존 importer 가 signalScanner 경유로 가져가는 심볼
export {
  EXIT_RULE_PRIORITY_TABLE,
  isOpenShadowStatus,
  buildStopLossPlan,
  calculateOrderQuantity,
  reconcileDayOpen,
  evaluateEntryRevalidation,
  regimeToStopRegime,
} from './entryEngine.js';
export type { StopLossPlan, PositionSizingInput } from './entryEngine.js';
export { getRemainingQty } from '../persistence/shadowTradeRepo.js';
```

## Consequences

### 긍정
- `runAutoSignalScan` 이 200줄 이내 조율 코드로 축소 → 리뷰·테스트 용이
- 각 단계가 순수 함수로 분리되어 단위 테스트 추가 가능
- 전역 상태(`_scanYahooFails` 등)가 `scanDiagnostics` 내부로 캡슐화
- **`orderDispatch.ts` 단일 SSOT** — 실 KIS 주문 발송과 channelBuySignalEmitted 의
  멱등성·단일 송출 보장이 한 파일에 격리되어 사고 회고 시 추적 용이
- `CLAUDE.md` 복잡도 위반 P0 해소 → P1·P2 후속 분해의 정합성 확보

### 부정
- 중간 단계에서 임포트 경로 혼란 가능 (barrel로 완화)
- 테스트 coverage baseline 이 기존 `signalScanner.test.ts` 하나에 집중되어 있어, 분해 후
  각 모듈별 테스트를 점진적으로 추가해야 하는 부채 발생
- 7모듈은 5모듈보다 폴더 구조가 복잡하지만, 절대 규칙 #4 (autoTradeEngine 단일 통로)
  관점에서 주문 경로 격리 가치가 더 크다고 판단

### 위험 관리
- `AUTO_TRADE_MODE=LIVE` 환경에서 회귀 발생 시 파급이 크다 → **반드시 Shadow 모드에서
  최소 2주 회귀 검증 후 LIVE 재오픈** (incident-playbook.md Phase 5 재개 체크리스트 준수).
- 멱등성 핵심(operation_id) 경로가 `orderDispatch`에 격리되므로 이동 전후 체크섬 로직 유지.
- channelBuySignalEmitted 가 APPROVE 당 정확히 1회 호출되는 회귀 가드 필수.

## Alternatives Considered

### A. 사용자 원안 4모듈 (marketScan / conditionEval / orderDispatch / index)
- 장점: 폴더 구조가 단순
- 단점: preflight 매크로 게이팅과 candidate 선정이 한 모듈에 묶이면 400~500줄로
  여전히 큰 덩어리가 됨. conditionEval 내부 루프와 섞이면 책임이 불명확.

### B. 직전 결정 5모듈 (orderDispatch 미분리)
- 장점: 폴더 구조가 단순
- 단점: 본 개정 사유에 명시 — 승인 큐 집계와 실 주문 발송이 한 파일에 함께 있어
  자동매매 사고 회고 시 SSOT 가 없고, 멱등성 변경의 부작용 격리가 어렵다.

### C. 함수만 분리하고 파일은 유지 (in-file refactor)
- 장점: 임포트 경로 변경 없음
- 단점: 파일 줄 수 축소 없음 → 복잡도 위반 유지. 검증 스크립트 실패 지속.

### D. 전면 재작성 (greenfield rewrite)
- 장점: 설계 이상향 달성 가능
- 단점: 기존 검증 커버리지·회귀 테스트 폐기. LIVE 영향 범위 예측 불가. **채택 불가**.

## Migration Plan

`server-refactor-orchestrator` 스킬의 6-Phase를 그대로 따르되, 본 ADR 개정 기준으로
Phase 2~4를 구체화 (개정: Phase 3 순서를 5단계 → **6단계** 로 갱신):

1. **Phase 2 (스캐폴딩)**: 7개 파일 생성, 각 파일에 `@responsibility` 태그 + 타입/시그니처
   서명만 작성. 구현은 빈 throw 또는 TODO. **본 PR scope**.
   - 기존 `signalScanner.ts` 는 건드리지 않음 (빌드 무회귀 보장).
   - 외부 importer 9개 변경 금지.
   - 새 7개 파일 모두 `npm run validate:responsibility` 통과 + lint 무회귀.

2. **Phase 3 (순차 이동)** — 반드시 이 순서로 (개정: 5단계 → 6단계):
   1. `scanDiagnostics.ts` ← 전역 상태 + ScanSummary + scan traces 영속화
   2. `preflight.ts` ← 매크로 게이트 (순수 함수, 외부 영향 없음)
   3. `candidateSelect.ts` ← 섹션 분류 유틸 (순수 함수)
   4. `perSymbolEvaluation.ts` ← 거대 루프 본체 (의존성 가장 많음)
   5. `orderDispatch.ts` ← 실 KIS 주문 발송 (멱등성·channel 송출, 큐 플러시 직전 분리)
   6. `approvalQueue.ts` ← 승인 큐 (LIVE/Shadow 병렬 발송 + 일괄 처리, 최후 이동)

   각 이동마다 `npm run lint` + `signalScanner.test.ts` 통과 확인 후 다음 단계.

3. **Phase 4 (정리)**: `signalScanner.ts` 를 barrel로 축소. 임포터 경로는 기존 그대로.
   ARCHITECTURE.md 의 signalScanner 단일 책임 명세 갱신 (별도 PR — 본 PR scope 밖).

### 모듈별 테스트 영향

- **본 PR scope 밖**: 새 모듈별 단위 테스트는 후속 PR 로 추가.
- 기존 회귀 baseline 보호: `server/trading/signalScanner.test.ts`,
  `server/trading/signalScannerSellOnly.test.ts` 등은 **절대 손대지 않는다**.
- Phase 3 각 단계 종료 시 위 회귀 테스트가 동일 결과를 내야 한다.

### 롤백 시그널

아래 중 하나라도 발생하면 즉시 직전 커밋으로 롤백:
- `signalScanner.test.ts` 또는 `signalScannerSellOnly.test.ts` 실패
- `validate:complexity` 가 새 파일에서 재위반
- `validate:sds` WARN 카운트 증가
- Shadow 모드 1일 운용 중 `ScanSummary.entries=0` 연속 발생 (학습 파이프라인 침묵)
- `channelBuySignalEmitted` 가 APPROVE 당 1회를 초과 호출 (orderDispatch 회귀)

## References

- `CLAUDE.md` — "기존 복잡도 위반" 표의 P0 항목, 절대 규칙 #2/#4
- `ARCHITECTURE.md` — `server/trading/signalScanner.ts` 단일 책임 정의
- `docs/incident-playbook.md` — 재개 체크리스트 (Phase 5)
- `.claude/skills/server-refactor-orchestrator/SKILL.md` — 6-Phase 프로토콜
- `scripts/check_complexity.js` — 파일/함수 한계 기준
- `scripts/check_responsibility.js` — @responsibility 태그 규약 (25단어, 접속사 금지)
