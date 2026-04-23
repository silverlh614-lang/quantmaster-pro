# ADR 0001 — `server/trading/signalScanner.ts` 분해 (P0)

- **상태**: Proposed
- **제안일**: 2026-04-23
- **적용 스킬**: `.claude/skills/server-refactor-orchestrator`
- **관련 파일**: `server/trading/signalScanner.ts` (1,820줄)

## Context

`signalScanner.ts`는 현재 CLAUDE.md의 "기존 복잡도 위반" 표에서 P0(1,820줄)로 분류된다.
이미 일부 로직은 하위 모듈로 분해되어 있다 (`entryEngine`, `exitEngine`, `buyPipeline`,
`watchlistManager` 등). 그럼에도 파일이 비대한 이유는 단일 함수 `runAutoSignalScan`이
약 1,500줄에 달하기 때문이다. 이 함수는 다음 5가지 책임을 한 몸에 갖고 있다:

1. **사전 가드** — KIS 키 체크, UI 수동 가드, watchlist 로드
2. **후보 선정** — 섹션 분류(SWING/CATALYST/MOMENTUM), Intraday 병합, Shadow Portfolio 확장
3. **매크로 게이팅** — regime/VIX/R6_DEFENSE/FOMC/sellOnlyException 판정
4. **종목별 평가 루프** — gate/RRR/liveGate/failure pattern/corrGate/sizing/cooldown 검증
5. **매수 승인 큐 집계** — LIVE/Shadow 병렬 승인 요청 → 일괄 처리
6. **스캔 진단 영속화** — ScanSummary, entryFailCount, scan traces 기록

현재 구조는 단일 함수에 전역 상태(`_scanYahooFails`, `_scanGateMisses`, `_pendingTraces`)가
섞여 있어 테스트·유지보수·재호출이 모두 어렵다.

## Decision

`signalScanner.ts`를 다음 5개 파일로 분해한다. 기존 사용자 원안의 4모듈(marketScan /
conditionEval / orderDispatch / index)보다 1개 많은 5모듈 구조가 실제 코드 구조에
더 잘 맞는다 (pre-flight 게이트가 후보 선정과 독립된 macro 판단이라서).

```
server/trading/signalScanner/
├── index.ts                 # runAutoSignalScan 조율 (최종 진입점, 200줄 이내 목표)
├── preflight.ts             # KIS key/manual guard/regime/VIX/R6/FOMC/sellOnlyException
├── candidateSelect.ts       # computeFocusCodes/assignSection/buyList/intradayBuyList 구성
├── perSymbolEvaluation.ts   # 루프 내 종목별 gate/RRR/liveGate/failure/corrGate/sizing
├── approvalQueue.ts         # 매수 승인 큐 집계 + 병렬 요청 + 일괄 처리
└── scanDiagnostics.ts       # ScanSummary, _consecutiveZeroScans, scan traces 기록
```

각 파일 @responsibility 초안:

- **index.ts**: "자동 신호 스캔 오케스트레이터 — preflight/후보/평가/승인/진단 5단계 조율"
- **preflight.ts**: "스캔 직전 매크로·시스템 게이트 — KIS/regime/VIX/R6/FOMC/sellOnly 판정"
- **candidateSelect.ts**: "워치리스트를 SWING/CATALYST/MOMENTUM 섹션으로 분류하고 매수 후보 결정"
- **perSymbolEvaluation.ts**: "종목 단위 진입 검증 — Gate/RRR/liveGate/failure/corr/sizing 평가"
- **approvalQueue.ts**: "매수 승인 큐 — LIVE/Shadow 병렬 발송 및 일괄 처리"
- **scanDiagnostics.ts**: "스캔 진단 — ScanSummary, 연속 제로 카운트, scan traces 영속화"

### 외부 공개 API 유지 원칙

`signalScanner.ts` 파일 자체는 barrel로 축소 유지하고, 아래 export 는 기존 경로로 계속 제공:

```ts
// server/trading/signalScanner.ts  (refactor 완료 후)
export { runAutoSignalScan, getLastBuySignalAt, getLastScanSummary,
         getConsecutiveZeroScans } from './signalScanner/index.js';
export type { ScanSummary } from './signalScanner/scanDiagnostics.js';
// entryEngine/exitEngine re-export 는 현재 그대로 유지
```

## Consequences

### 긍정
- `runAutoSignalScan` 이 200줄 이내 조율 코드로 축소 → 리뷰·테스트 용이
- 각 단계가 순수 함수로 분리되어 단위 테스트 추가 가능
- 전역 상태(`_scanYahooFails` 등)가 `scanDiagnostics` 내부로 캡슐화
- `CLAUDE.md` 복잡도 위반 P0 해소 → det|M| 기여

### 부정
- 중간 단계에서 임포트 경로 혼란 가능 (barrel로 완화)
- 테스트 coverage baseline 이 기존 `signalScanner.test.ts` 하나에 집중되어 있어, 분해 후
  각 모듈별 테스트를 점진적으로 추가해야 하는 부채 발생

### 위험 관리
- `AUTO_TRADE_MODE=LIVE` 환경에서 회귀 발생 시 파급이 크다 → **반드시 Shadow 모드에서
  최소 2주 회귀 검증 후 LIVE 재오픈** (incident-playbook.md Phase 5 재개 체크리스트 준수).
- 멱등성 핵심(operation_id) 경로가 `approvalQueue`에 있으므로 이동 전후 체크섬 로직 유지.

## Alternatives Considered

### A. 사용자 원안 4모듈 (marketScan / conditionEval / orderDispatch / index)
- 장점: 폴더 구조가 단순
- 단점: preflight 매크로 게이팅과 candidate 선정이 한 모듈에 묶이면 400~500줄로
  여전히 큰 덩어리가 됨. conditionEval 내부 루프와 섞이면 책임이 불명확.

### B. 함수만 분리하고 파일은 유지 (in-file refactor)
- 장점: 임포트 경로 변경 없음
- 단점: 파일 줄 수 축소 없음 → 복잡도 위반 유지. 검증 스크립트 실패 지속.

### C. 전면 재작성 (greenfield rewrite)
- 장점: 설계 이상향 달성 가능
- 단점: 기존 검증 커버리지·회귀 테스트 폐기. LIVE 영향 범위 예측 불가. **채택 불가**.

## Migration Plan

`server-refactor-orchestrator` 스킬의 6-Phase를 그대로 따르되, 본 ADR 기준으로
Phase 2~4를 구체화:

1. **Phase 2 (스캐폴딩)**: 5개 파일 생성, 각 파일에 `@responsibility` 태그 + 타입/시그니처
   서명만 작성. 구현은 빈 throw 또는 TODO.
2. **Phase 3 (순차 이동)** — 반드시 이 순서로:
   1. `scanDiagnostics.ts` ← 전역 상태 + ScanSummary + scan traces 영속화
   2. `preflight.ts` ← 매크로 게이트 (순수 함수, 외부 영향 없음)
   3. `candidateSelect.ts` ← 섹션 분류 유틸 (순수 함수)
   4. `perSymbolEvaluation.ts` ← 거대 루프 본체 (의존성 가장 많음, 마지막 직전)
   5. `approvalQueue.ts` ← 승인 큐 (매수 로직 핵심, 최후 이동)
   각 이동마다 `npm run lint` + `signalScanner.test.ts` 통과 확인 후 다음 단계.
3. **Phase 4 (정리)**: `signalScanner.ts` 를 barrel로 축소. 임포터 경로는 기존 그대로.

### 롤백 시그널

아래 중 하나라도 발생하면 즉시 직전 커밋으로 롤백:
- `signalScanner.test.ts` 실패
- `validate:complexity` 가 새 파일에서 재위반
- `validate:sds` WARN 카운트 증가
- Shadow 모드 1일 운용 중 `ScanSummary.entries=0` 연속 발생 (학습 파이프라인 침묵)

## References

- `CLAUDE.md` — "기존 복잡도 위반" 표의 P0 항목
- `ARCHITECTURE.md` — `server/trading/signalScanner.ts` 단일 책임 정의
- `docs/incident-playbook.md` — 재개 체크리스트 (Phase 5)
- `.claude/skills/server-refactor-orchestrator/SKILL.md` — 6-Phase 프로토콜
- `scripts/check_complexity.js` — 파일/함수 한계 기준
