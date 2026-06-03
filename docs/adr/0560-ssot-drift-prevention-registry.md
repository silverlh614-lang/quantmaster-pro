# ADR-0560: SSOT Drift-Prevention Registry + 정적 가드 (동일개념 다중구현 사전 차단)

@responsibility governance — 동일 개념 다중 구현(drift)의 신규 재발을 커밋타임에 차단하기 위한 SSOT_REGISTRY 단일 출처 채택·정적 가드 사양·grandfather/burn-down 경계 확정 (문서/레지스트리/가드사양 전용, 런타임 구현은 후속 engine-dev)

## Status

Accepted (문서/레지스트리(`docs/SSOT_REGISTRY.md`)/가드 사양 전용 — 런타임 `.ts` 본체 0줄.
가드 스크립트 `scripts/check_ssot_drift_registry.js` 구현 + `package.json` 등재는 후속 engine-dev 단계.)

## Context

QuantMaster Pro 의 SSOT Single-Funnel 프로그램(ADR-0555 헌법 → 0556 factory → 0557 threading →
0558 non-funnel boundary → 0559 calendar 통합)은 **이미 발생한** 동일개념 다중구현을 *사후* 발견·통합해 왔다.
그 산 증거가 calendar drift다:

- `server/calendar/krxTradingCalendar.ts:isKrxHoliday` 와 `server/trading/krxHolidays.ts:isKrxHoliday`
  가 상호 독립인 두 휴장일 원장으로 존재 → **2027 평일 공휴일 8건 + 2026-12-31 의 LIVE 게이트 구멍**
  (golden master `calendarSsot.characterization.test.ts` 가 실효 불일치 9건 캡처, ADR-0559 가 통합).
- `addBusinessDays` 는 `nearMissOutcomeLedger:89`·`gate2OutcomeRepo:43`·`futureReturnResolver:127`·
  `pipelineHelpers:253`·`krxHolidays.addBusinessDaysFromKstDate` 로 **4~5중 인라인 구현**(catalog #2).

`docs/audits/2026-06-03-duplicate-concept-catalog.md` 가 16건의 중복 개념을 전수 분석했고,
오케스트레이터 검증 주석으로 *진짜 drift*(#1·#2)와 *정당한 분리*(#3·#4·#5 등)를 구분했다.

문제의 본질은 **탐지가 사후·운(運)에 의존**한다는 것이다. calendar 구멍은 golden master 가 *우연히*
2024~2027 전수 비교를 했기에 발견됐다. 다음 개념의 3번째 구현이 신규 PR 에서 추가되어도 *현재* 자동
차단 장치가 없다 — `check_ssot_single_funnel.js` 는 "provider 직접 import" 만 보고, "동일 심볼 중복
정의/export" 는 보지 않는다. 즉 **drift 의 재발을 컴파일타임/커밋타임에 막는 메커니즘이 비어 있다.**

이미 통합·정당 분리 판정이 끝난 개념들이 *다시 흩어지는 것*을 막으려면, 개념별 단일 소유 심볼을
명시한 레지스트리와, 그 레지스트리를 읽어 신규 중복만 차단하는 정적 가드가 필요하다.

## Decision

### D1. `docs/SSOT_REGISTRY.md` 를 drift-prevention 의 데이터 SSOT 로 채택

개념 → 단일 소유 모듈·심볼(`file:export`) → guarded 심볼명 → 정당 예외(LEGITIMATE) → 근거 ADR
의 5컬럼 표를 단일 출처로 둔다. KIS 엔드포인트 레지스트리(`kisOfficialEndpointRegistry.ts`)를
`check_kis_official_endpoint_registry.js` 가 텍스트로 읽어 강제하는 검증 모델을 *개념 중복*에 일반화한다.

레지스트리는 **새로운 SSOT 를 신설하지 않는다** — 기존 owner 모듈(krxHolidays, symbolDataCollector,
shadowPositionLedger 등)을 *기록*만 한다(ADR-0555 §0 "두 번째 SSOT 신설 금지" 계승).

### D2. 정적 가드로 신규 위반 차단 + 기존 baseline grandfather

가드 `scripts/check_ssot_drift_registry.js`(후속 engine-dev)는 레지스트리의 **guarded 심볼 집합**에
대해 `server/`+`src/` 에서 **2개 이상 모듈이 동일 심볼을 export/정의**하는지 검사한다.
레지스트리에 등재된 **정당 예외 쌍(owner + 허용 모듈)** 은 통과시키고, 그 외 신규 중복은 `EXIT 1`.
`check_ssot_single_funnel.js` 의 baseline allowlist grandfather 패턴을 그대로 계승한다.

### D3. 등록된 "guarded 개념"의 단일 소유 심볼을 다른 모듈이 중복 export/구현하면 fail

guarded 심볼별로 *정의/export 하는 모듈 집합*을 모아 `집합 ⊆ {owner} ∪ allowed` 이면 통과,
owner·allowed 외 모듈이 있으면 그 모듈만 신규 위반으로 보고한다. 검사 단위는 *export 선언* +
*함수/const/type 정의* 만(주석·`import type`·call site·import 제외) — false positive 최소화.

### D4. 원칙(ADR-0558 계승) — 진짜 drift 만 차단, 정당 분리는 명시 허용

무조건 단일화가 **아니다.** 다음은 레지스트리에 LEGITIMATE 로 명시 등재하여 통과시킨다:

- `krxTradingCalendar.isKrxHoliday` = owner(`krxHolidays`)의 **위임 re-export** (ADR-0559).
- `addWeekdaysApprox`(주말만 근사, UI) ≠ `addBusinessDaysFromKstDate`(휴일 인식) — **별도 개념**(catalog L3).
- `ssotPipeline.ts:UnifiedSourceSnapshot`(projection) ≠ server factory 타입 — **동명이인 분리**(ADR-0556).
- `getOpenPositions`(엄격 5가드) ↔ `loadOpenPositions`(divergence 경량 2가드) — **필터강도 다른 정당 분리**(ADR-0191).

ADR-0558 의 `LEGITIMATE_BUDGET_LAZY`/`LEGITIMATE_DIAGNOSTIC` 영구 허용 선례와 동일하게,
정당 분리는 burn-down 대상이 아니되 **신규 *유사* 복제(미등재 3번째 구현)는 여전히 차단**한다.

### D5. grandfather + burn-down 경로

- **grandfather** = 현재 코드에 존재하는 LEGITIMATE 쌍(krxTradingCalendar 위임, ssotPipeline
  projection, get/loadOpenPositions 등)을 레지스트리 `allowed` 에 명시 → 통과.
- **burn-down** = `addBusinessDaysFromKstDate` 의 catalog #2 인라인 구현(nearMissOutcomeLedger/
  gate2OutcomeRepo/futureReturnResolver)은 owner 로 수렴 대상 → 수렴 완료 시 `allowed` 가 빈 채로
  유지되어 가드가 자동 강화(수렴 완료 = 위반 0). 본 ADR 은 가드·레지스트리만 확정하며,
  실제 수렴(인라인 → owner import 교체)은 **별도 patch/ADR**(중복정리 #2)다.

### D6. 가드 입력 계약 (engine-dev 인수인계 — 정확한 두 집합)

`docs/SSOT_REGISTRY.md §3` 이 가드가 추출할 정확한 입력을 SSOT 로 보유한다:

- **GUARDED_SYMBOLS** (중복 금지 심볼 집합):
  `isKrxHoliday`, `addBusinessDaysFromKstDate`, `addWeekdaysApprox`, `collectUnifiedSnapshot`,
  `UnifiedSourceSnapshot`, `getOpenPositions`, `loadOpenPositions`, `MarketSession`.
- **LEGITIMATE_PAIRS** (정당 예외 = 통과 쌍): `(guarded) → { owner, allowed[] }`.
  - `isKrxHoliday` → owner `server/trading/krxHolidays.ts`, allowed `[server/calendar/krxTradingCalendar.ts]`.
  - `addBusinessDaysFromKstDate` → owner `server/trading/krxHolidays.ts`, allowed `[]`(수렴 목표).
  - `addWeekdaysApprox` → owner `server/screener/businessDayApprox.ts`, allowed `[]`.
  - `collectUnifiedSnapshot` → owner `server/trading/symbolDataCollector.ts`, allowed `[]`.
  - `UnifiedSourceSnapshot` → owner `server/trading/sourceSnapshot/unifiedSourceSnapshot.ts`,
    allowed `[src/services/autoTrading/ssotPipeline.ts]`(projection 동명이인).
  - `getOpenPositions` → owner `server/persistence/shadowPositionLedger.ts`, allowed `[]`.
  - `loadOpenPositions` → owner `server/persistence/positionTruth.ts`, allowed `[]`(3번째 reader 금지).
  - `MarketSession` → owner `server/ssotSnapshot.ts`, allowed `[]`(파생은 *다른 심볼명*).

**메타 등재(#5 providerIssue↔marketSignal 격리)** 는 "심볼 중복"이 아니라 *불변식 #6 격리*이므로
guarded 집합에서 제외(또는 별도 불변식 #6 가드에 위임) — 레지스트리는 단일 소유 사실의 기록만.

### D7. 탐지 사양 (false positive 최소화)

- 파싱: `check_ssot_single_funnel.js` 방식 라인 단위 정규식.
  `export (function|const|type|interface) <guarded>` / `export { …, <guarded>, … }` /
  `export default function <guarded>` 패턴, word boundary 정확 일치.
- 스캔 루트: `server/` + `src/` (`.test.ts`·`.d.ts` 제외).
- 동명이의(우연한 이름 충돌): owner 도메인 경로 휴리스틱으로 1차 필터 후 애매하면 보고 →
  사람이 레지스트리에 등재/배제 결정(컨셉 매핑이 동명이의를 분리).
- 에러 메시지(필수 포맷): `docs/SSOT_REGISTRY.md §3.4` —
  "개념 X 는 이미 <owner> 가 SSOT 입니다. 신규 구현 금지. 위임하거나 registry 에 LEGITIMATE 예외 등재(ADR 동반)."

### D8. 등재 위치 (engine-dev 가 package.json 편집)

- `validate:all` 체인 끝에 `&& npm run validate:ssotDriftRegistry` 추가
  (`"validate:ssotDriftRegistry": "node scripts/check_ssot_drift_registry.js"`).
- `precommit` 체인의 `check_ssot_single_funnel.js` 인접에 `&& node scripts/check_ssot_drift_registry.js` 추가.
- 회귀 테스트: `check_ssot_single_funnel.js` 처럼 `checkFile`/`GUARDED_SYMBOLS`/`LEGITIMATE_PAIRS`
  export → `*.test.ts` 로 잠금(레지스트리 표 ↔ 코드 입력 일치 단언).

## Consequences

- **drift 재발 사전 차단** — 등재 개념의 3번째 구현이 신규 PR 에서 추가되면 커밋타임 `EXIT 1`.
  calendar 류 LIVE 구멍이 *우연한* golden master 없이도 막힌다(탐지가 운에서 가드로 이동).
- **향후 개발 마찰** — 신규 중복이 차단되므로 개발자는 (a) owner 로 위임/re-export 하거나
  (b) 정당 분리면 레지스트리에 LEGITIMATE 등재(ADR 동반)해야 한다. 이는 의도된 마찰(헌법 비용)이다.
- **grandfather 로 무회귀** — 현재 LEGITIMATE 쌍은 모두 등재 → 도입 시 신규 위반 0건(byte-equivalent
  거버넌스, 런타임 0줄). 기존 코드 강제 수정 없음.
- **burn-down 경로 명시** — `addBusinessDaysFromKstDate` 인라인 수렴(중복정리 #2) 완료 시 `allowed`
  가 빈 채 유지되어 가드가 자동 강화. 레지스트리 §4 가 amendment 절차(신규 개념/예외/burn-down)를 규정.
- **불변식 보존** — 본 ADR 은 거버넌스 문서·정적 가드 사양만. Trading Engine(#1)·Shadow(#2) 무영향,
  SourceSnapshot/providerIssue/marketSignal 비변환(#3/#6), 새 SSOT 신설 0(#3, ADR-0555 §0).

## executionImpact

- **본 ADR(문서 단계): NONE** — 런타임 `.ts` 본체 0줄. ADR + `docs/SSOT_REGISTRY.md` + ARCHITECTURE.md
  위치 1줄 + INDEX 갱신만.
- **후속 가드 구현 단계: NONE** — `check_ssot_drift_registry.js` 는 정적 텍스트 검사(런타임 매매 경로
  무접촉). KIS/KRX quota 0, ENV 0건. 신규 위반 발견 시 커밋 차단(개발 마찰)일 뿐 매매 동작 변경 0.

## Rollback

- 가드 미등재 상태(현재) = 도입 전. 도입 후 롤백은 `package.json` 체인에서 가드 1줄 제거 →
  byte-equivalent 거버넌스 복귀. 레지스트리·ADR 은 문서로 잔존(무해).

## Alternatives Considered

- **A. 모든 중복 개념을 무조건 단일화** — 기각. catalog #3/#4/#5 처럼 정당한 분리(projection,
  divergence 기준선, 도메인 세션 어휘)를 파괴해 회귀 표면 폭증 + ADR-0558 원칙 위배.
- **B. 가드 없이 코드 리뷰로만 방지** — 기각. calendar 구멍이 *우연한* golden master 로만 발견된 전례 →
  사람 의존은 재발 차단을 운에 맡김. 자동 강제(매 커밋)가 헌법.
- **C. AST/TypeChecker 기반 심볼 그래프 분석** — 기각(현 단계). 텍스트 정규식(import type 제외,
  export 선언 위주)이 `check_ssot_single_funnel.js`·`check_kis_official_endpoint_registry.js` 와
  동일 모델로 TypeScript 컴파일·런타임 import 없이 동작 → 가드의 격리·속도·단순성 우위. 동명이의는
  레지스트리 컨셉 매핑으로 분리. AST 승격은 false positive 가 실측되면 후속 검토.
- **D. 별도 신규 registry 모듈(.ts) 신설** — 기각. 두 번째 SSOT 아티팩트(ADR-0555 §0 위반).
  레지스트리는 문서(`docs/SSOT_REGISTRY.md`)이고 가드가 텍스트로 읽는다(KIS registry 모델과 동형).

## References

- 중복 카탈로그: `docs/audits/2026-06-03-duplicate-concept-catalog.md` (16건 + 오케스트레이터 검증 주석)
- 레지스트리(데이터 SSOT): `docs/SSOT_REGISTRY.md` (§1 guarded 표 / §3 가드 입력 계약 / §4 amendment)
- 가드 모델: `scripts/check_ssot_single_funnel.js` (allowlist/grandfather 패턴),
  `scripts/check_kis_official_endpoint_registry.js` (registry 텍스트 검증 모델)
- 계승 헌법: ADR-0555 (Single-Funnel Enforcement Constitution, "두 번째 SSOT 신설 금지"),
  ADR-0558 (LEGITIMATE 영구 허용 · 진짜 drift 만 차단 원칙)
- 보호 개념 근거: ADR-0559(calendar #1) / ADR-0556·0557(SourceSnapshot factory·projection #3) /
  ADR-0191(open-position reader #4) / ADR-0045·0548(휴장일 데이터·KIS sync)
- 후속 구현: `scripts/check_ssot_drift_registry.js` (engine-dev), `package.json` validate:all·precommit 등재
