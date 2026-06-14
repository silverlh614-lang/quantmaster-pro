# ADR-0610: counterfactualOutcomeBoard format-layer extraction

@responsibility refactor — counterfactualOutcomeBoard.ts 표시(format) 함수·표시 전용 헬퍼를 counterfactualOutcomeBoardFormat.ts 로 이동, 본체는 build(집계)+타입 잔류 + re-export (byte-equivalent)

## Status

Accepted

## Context

`server/learning/counterfactualOutcomeBoard.ts` 는 현재 **1,499~1,500줄**로 절대 규칙 #6 의 1,500줄 ACMA
한계(`scripts/check_complexity.js`, `src.split('\n').length > 1500` 차단)에 **도달**했다. 2026-06-12 Track A
R1 패치가 net-0(가시화 라인 추가 ↔ 다른 라인 제거)으로 겨우 한계 안에 들였고, 이전 패치들도 본 파일을
"무접촉"으로 우회해 왔다. 다음 변경(예: 새 format 라인 1줄 추가)이 ACMA 에 막힌다.

모듈 책임은 "read-only counterfactual outcome board 진단 렌더링" — **learning board 표시 레이어**이며 LIVE
매매와 무관하다(executionImpact=NONE). 현재 본체에는 두 가지 성격의 코드가 섞여 SRP 가 깨져 있다:

1. **build(집계)** (~1,260줄): 원시 ledger 3소스(GATE1 dry-run / counterfactual ledger / legacy)→정규화 행
   변환(`rowFromGate1`/`rowFromCounterfactualLedger`/`rowFromLegacyCounterfactual`)·포함/제외 분류
   (`splitCounterfactualRows`/`exclusionReasonFor`)·밴드·요약·debug 집계(`buildBandOutcome`/
   `buildOutcomeSummary`/`buildDebugSummary` 등)·최종 조립(`buildCounterfactualOutcomeBoard`) + 타입 정의 전부.
2. **format(표시)** (~237줄): `formatCounterfactual*`(SafetyChecks/BoardSummary/Gate1/Gate2/Gate3/Missed/
   Today/Review/Debug/CommandReply) + 표시 전용 헬퍼(`pct`/`num`/`safetyLine`/`distributionLine`/
   `formatBandRows`) + `CounterfactualCommandMode` 타입 + `resolveCounterfactualCommandMode`.

`grep` 으로 표시 전용 헬퍼(`pct`/`num`/`safetyLine`/`distributionLine`/`formatBandRows`) 사용처를 전수
확인한 결과, 5개 헬퍼 전부 **format 함수 내부에서만** 호출되고 build 함수는 단 한 번도 호출하지 않는다
(build 는 별도 헬퍼 `finite`/`positive`/`text`/`round2`/`avg`/`rate`/`blockerTokens` 등 사용). format 함수는
완성된 `CounterfactualOutcomeBoard` 데이터 객체만 읽으므로 build → format 값 의존이 없고, format → build
은 **타입만** 필요하다 = 단방향 분리가 깨끗하게 성립한다.

## Decision

신규 `server/learning/counterfactualOutcomeBoardFormat.ts` 를 만들고 format 함수 + format 전용 헬퍼 +
`CounterfactualCommandMode`/`resolveCounterfactualCommandMode`/`formatCounterfactualCommandReply` 를
**순수 이동**(함수 본문 0변경)한다. 본체는 build 함수 + 타입 정의를 잔류시키고, 추출한 format 심볼을
`export { ... } from './counterfactualOutcomeBoardFormat.js'` 로 **re-export** 하여 **호출처 import 경로를
무변경**으로 유지한다(byte-equivalent 핵심).

```
server/learning/
├── counterfactualOutcomeBoard.ts            # 본체 — 타입 정의 + build 집계 함수
│                                            #   (buildCounterfactualOutcomeBoard/buildBandOutcome/buildDebugSummary/
│                                            #    rowFrom*/splitCounterfactualRows/exclusionReasonFor/gate1BandFor 등)
│                                            #   + format 심볼 re-export. 1500 → ~1279줄
└── counterfactualOutcomeBoardFormat.ts      # 신규 ~244줄 — formatCounterfactual*(9종) + CommandReply +
                                             #   pct/num/safetyLine/distributionLine/formatBandRows +
                                             #   CounterfactualCommandMode/resolveCounterfactualCommandMode
```

신규 파일 `@responsibility`: `Format read-only counterfactual outcome board sections into Telegram diagnostic text.`

설계 근거:

- **단방향 의존 + 순환 회피**: `counterfactualOutcomeBoardFormat.ts` 는 본체에서
  `CounterfactualOutcomeBoard`/`CounterfactualBandOutcome` 타입만 **`import type`** 으로 가져온다. type-only
  import 는 ESM 에서 컴파일 시 제거되므로 런타임 import 그래프에 엣지가 생기지 않는다 → 본체의 값 re-export
  (format → board.ts 런타임 의존 0, board.ts → format.ts 값 re-export 1방향)와 결합해도 런타임 순환 0.
- **공유 값 헬퍼 없음**: build/format 이 함수(값)를 양방향 공유하지 않음을 grep 으로 확정 → 제3 util 파일
  (`counterfactualOutcomeBoardShared.ts`) 불필요. format 전용 5헬퍼는 통째로 format.ts 로 이동.
- **re-export facade**: 직접 import 경로 변경(소비처 3곳 수정)이 아니라 본체 re-export 를 택한 이유는
  byte-equivalent — 기존 테스트(`counterfactualOutcomeBoard.test.ts`·`counterfactualGate1BandPipeline.test.ts`)와
  텔레그램 명령(`counterfactual.cmd.ts`)이 `./counterfactualOutcomeBoard.js` 경로 그대로 green 유지.

## Consequences

- `counterfactualOutcomeBoard.ts` 1,500 → **1,279줄**(ACMA `split('\n').length`, 한계 대비 ~221줄 여유).
  `counterfactualOutcomeBoardFormat.ts` 244줄. 두 파일 모두 1,500 한계 내. executionImpact=**NONE** —
  learning board 표시층 순수 이동, 런타임 byte-equivalent.
- **외부 importer 경로 변경 0건** (3개 소비처):
  - `server/learning/counterfactualOutcomeBoard.test.ts` — build + format 9종 + `resolveCounterfactualCommandMode`
  - `server/learning/counterfactualGate1BandPipeline.test.ts` — `buildCounterfactualOutcomeBoard`/`formatCounterfactualGate1`
  - `server/telegram/commands/learning/counterfactual.cmd.ts` — `buildCounterfactualOutcomeBoard`/
    `formatCounterfactualCommandReply`/`resolveCounterfactualCommandMode`

  본체 public 표면 보존: build 함수·타입은 본체 정의 그대로, format 심볼은
  `export { formatCounterfactualSafetyChecks, ..., formatCounterfactualCommandReply } from
  './counterfactualOutcomeBoardFormat.js'` + `export type { CounterfactualCommandMode }`.
- 9대 불변식: #1 Trading Engine 무접촉(표시층), #2 Shadow Learning 무접촉(집계/표시만, 학습 파이프 0줄),
  R1(legacyScale70Plus/excludedByReason 가시화) 라인 byte 그대로 이동(`formatCounterfactualGate1` 본문 0변경),
  ADR-0609 stamp 무영향. provider 직접 조회 0(format 은 board 객체만 read).
- 회귀 기준: `lint`(client + server tsc) EXIT=0 · `validate:complexity` OK · `validate:responsibility` OK ·
  `validate:sds`(swallowed catch 증가 0 — 본 PR 신규 try/catch 0) · 위 3 테스트 파일 green · `precommit` 통과.

## Alternatives Considered

1. **분할하지 않음(현 net-0 유지)** — 기각. 본 파일은 1,499/1,500 에 고착되어 다음 변경이 ACMA 에 영구 차단된다.
   net-0 우회는 매 패치 가시화 라인을 다른 라인 삭제로 상쇄해야 해 지속 불가하고 SRP 위반(build+format 혼재)을
   방치한다.
2. **build(집계)를 추출하고 format 을 본체 잔류** — 기각. build 가 본 모듈의 본질 책임(원시 ledger→board
   집계)이고 타입 SSOT 가 build 입출력에 귀속되어, build 를 옮기면 타입을 함께 끌고 가거나 양방향 type import 가
   생긴다. format(표시)이 더 작고(~237줄) 의존이 단방향(board 타입만 읽음)이라 추출 비용·순환 위험이 낮다.
3. **re-export facade 대신 소비처 직접 import 경로 변경** — 기각. 소비처 3곳(테스트 2 + cmd 1)의 import 를
   `./counterfactualOutcomeBoardFormat.js` 로 바꾸면 byte-equivalent 가 깨지고(diff 확대), 본 작업 목표인
   "동작/경로 무변경 green 유지"에 어긋난다. re-export 가 호출처 0수정으로 동일 표면을 보존한다.
4. **공유 헬퍼를 제3 util 파일로 분리** — 기각. build/format 이 값(함수)을 공유하지 않음을 grep 으로 확정 —
   분리할 공유 헬퍼가 없어 제3 파일은 빈 추상화 비용만 추가한다.

## Migration Plan

> 전 단계 공통: 기능 추가 0 · behavior change 0 · 호출 그래프 불변 (이동 + re-export 만). PR 1건 원자 머지.
> 롤백 = PR revert 1회.

1. **(a) 신규 파일 생성** — `counterfactualOutcomeBoardFormat.ts` 에 format 9종 + CommandReply + format 전용
   5헬퍼 + `CounterfactualCommandMode`/`resolveCounterfactualCommandMode` 를 텍스트 그대로 move,
   `@responsibility` 태그(상단, 25단어 이내) + `import type { CounterfactualOutcomeBoard,
   CounterfactualBandOutcome }` 부여.
2. **(b) 본체 치환** — 본체에서 추출 블록(format 함수·헬퍼·command mode)을 삭제하고
   `export { ... } from './counterfactualOutcomeBoardFormat.js'` + `export type { CounterfactualCommandMode }`
   re-export 로 대체. build 함수·타입 정의는 무변경.
3. **(c) 검증** — `npx tsc --noEmit` + `npx tsc --noEmit -p tsconfig.server.json`(순환 의존 0 확인) ·
   `node scripts/check_complexity.js`(두 파일 ≤1500) · `node scripts/check_responsibility.js`(신규 파일 @태그) ·
   `node scripts/silent_degradation_sentinel.js`(swallow 증가 0) ·
   `npx vitest run server/learning/counterfactualOutcomeBoard.test.ts
   server/learning/counterfactualGate1BandPipeline.test.ts
   server/telegram/commands/learning/counterfactual.cmd.test.ts` green 의무.
4. **(d) INDEX/이력** — `docs/adr/INDEX.md` §"전체 인덱스" 0610 행 추가 + §"다음 발급" 0610→0611 갱신 +
   `docs/ai/10-patch-history-index.md` 한 줄 추가.

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.

## References

- ADR-0596 (minimumSignalScoreTrace component decomposition — 동형 re-export facade 분해 선례)
- ADR-0524 / ADR-0521 / ADR-0523 (types/leaf 추출 byte-equivalent 분해 선례)
- ADR-0609 (Gate1 eligibility shadow — board ledger stamp, 본 분해 무영향)
- `scripts/check_complexity.js` (ACMA 1500 한계), `docs/ai/09-refactor-rules.md`
