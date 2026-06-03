# SSOT_REGISTRY — Single Source of Truth Drift-Prevention Registry

> **본 레지스트리는 "동일 개념 다중 구현 drift" 방지 헌법의 데이터 SSOT 다 (ADR-0560).**
> `scripts/check_ssot_drift_registry.js`(후속 engine-dev 구현) 가 본 파일을 읽어,
> 등재된 **guarded 심볼**이 소유 모듈 + 등재된 LEGITIMATE 예외 외의 모듈에서
> 중복 export/정의되면 커밋타임 `EXIT 1` 로 차단한다.
>
> **원칙(ADR-0558 계승):** 무조건 단일화가 아니다. *진짜 drift* 만 차단하고,
> 정당한 분리(LEGITIMATE)는 본 레지스트리에 명시 허용한다.
>
> **신규 개념·심볼 등재 또는 LEGITIMATE 예외 추가는 ADR 동반 의무.** (가드 사양 §3 참조)

---

## 1. Guarded Concept Registry (가드 대상 표)

각 행:
- **개념** — 보호 대상 정보/연산의 의미.
- **단일 소유 모듈·심볼 (owner)** — `file:export` 형식. 이 심볼의 *유일한 정의처*.
- **guarded 심볼명** — 중복 정의/export 가 금지되는 식별자. 가드의 검색 키.
- **정당 예외 (LEGITIMATE)** — 동일/연관 심볼을 합법적으로 보유하는 모듈 (위임 re-export 또는 의도된 분리). 없으면 `—`.
- **근거 ADR** — 결정의 출처.

| # | 개념 | 단일 소유 모듈·심볼 (owner) | guarded 심볼명 | 정당 예외 (LEGITIMATE) | 근거 ADR |
|---|------|-----------------------------|----------------|------------------------|----------|
| 1 | KRX 휴장일 판정 (데이터 SSOT) | `server/trading/krxHolidays.ts:isKrxHoliday` | `isKrxHoliday` | `server/calendar/krxTradingCalendar.ts` — **위임 re-export** (owner 의 값을 그대로 재노출, 자체 휴일셋 보유 금지) | ADR-0559 / ADR-0045 / ADR-0548 |
| 2 | 영업일 산술 (휴일 인식) | `server/trading/krxHolidays.ts:addBusinessDaysFromKstDate` | `addBusinessDaysFromKstDate` | `server/learning/futureReturnResolver.ts` / `server/persistence/nearMissOutcomeLedger.ts` / `server/persistence/gate2OutcomeRepo.ts` — owner 로 **수렴 대상(중복정리 #2)**, 통합 후 정당 예외 0 | ADR-0560 (catalog #2) |
| 2b | 영업일 근사 (주말만, UI 표시) | `server/screener/businessDayApprox.ts:addWeekdaysApprox` | `addWeekdaysApprox` | — (owner 단일, 별도 개념) | ADR-0558 / catalog L3 |
| 3 | SourceSnapshot factory (정본 생성) | `server/trading/symbolDataCollector.ts:collectUnifiedSnapshot` | `collectUnifiedSnapshot` | — (factory 단일 진입점) | ADR-0556 / ADR-0519 |
| 3b | SourceSnapshot projection (gate/policy 투영) | `src/services/autoTrading/ssotPipeline.ts:UnifiedSourceSnapshot` | `UnifiedSourceSnapshot` (projection 타입) | **factory ≠ projection** — 동명이인 분리. server 정본 타입과 src projection 타입은 의도된 별도 책임 | ADR-0556 / ADR-0557 |
| 4 | 보유 포지션 조회 (엄격 표시/진입 view, 5가드) | `server/persistence/shadowPositionLedger.ts:getOpenPositions` | `getOpenPositions` | `server/persistence/positionTruth.ts:loadOpenPositions` — **divergence 경량 기준선(2가드)**, 필터강도 다른 정당 분리 | ADR-0191 / catalog #4 |
| 4b | 보유 포지션 조회 (divergence 경량 기준선, 2가드) | `server/persistence/positionTruth.ts:loadOpenPositions` | `loadOpenPositions` | (#4 의 짝 — 두 reader 가 서로의 정당 예외. **신규 3번째 open-position reader 금지**) | ADR-0191 / catalog #4 |
| 5 | providerIssue ↔ marketSignal 격리 (실행 허가) | `server/runtime/executionPermissionResolver.ts:resolveExecutionPermission` | `resolveExecutionPermission` | `server/.../dartProviderSignalSplit` — provider 메타와 marketSignal 분리 헬퍼 (불변식 #6, 비변환만 수행) | ADR-0555 / 불변식 #6 |
| 6 | MarketSession 어휘 (canonical) | `server/ssotSnapshot.ts:MarketSession` | `MarketSession` | gate1/entryPolicy/exit/investorFlow 의 파생 세션 타입 = **건별 LEGITIMATE** (이름·멤버 다른 도메인 어휘). **신규 추가는 registry 등재 의무** | catalog #5 |

> **#5 표기 주의:** providerIssue↔marketSignal 격리는 "심볼 중복"이 아니라 *불변식 격리*다.
> guarded 심볼은 `resolveExecutionPermission`(소유) 이며, dartProviderSignalSplit 은 격리 보조 헬퍼다.
> 가드는 이 행을 **메타 등재**로 취급한다 (provider 상태 → marketSignal 변환 심볼이 신규로 생기면 별도 불변식 #6 가드가 잡는다; 본 레지스트리는 "단일 소유" 사실의 기록).

---

## 2. Low-Risk / LEGITIMATE 부속 등재 (카탈로그 잔여)

가드 차단 대상은 아니나, 미래 dev 가 "중복 아닌가?" 오인하지 않도록 **정당 분리 사실을 기록**한다.
신규로 이 개념의 3번째 구현을 추가하려면 본 표를 갱신(ADR 동반).

| 개념 | 소유 / 분리 | 사유 | 근거 |
|------|------------|------|------|
| `PriceSourceSnapshot` vs `SourceSnapshotDataHealth` | 도메인 분리 | signalScanner 가격 추적 vs trading 건강도 — 소비자 다름 | catalog L1 |
| `OpenPositionEntry` vs `OpenPositionView` | 타입 분리 | ledger 표현 vs 정규화 public view (#4 의 타입 짝) | catalog #7 |
| `normalizePriceStatus` | private 다중 | gate3CandidateDetail private — 공용화 시 priceSnapshotSsot 로 단일 이동(P2) | catalog #6 |
| `syncKisHolidayCalendar` | 독립 fetch | krxHolidays(export) vs kisClient holidayCalendar(private fetch) — 부팅 1회, P3 통합 후보 | catalog #8 |

---

## 3. 가드 입력 계약 (engine-dev 인수인계 — `check_ssot_drift_registry.js`)

가드 구현이 본 레지스트리에서 추출해야 할 **정확한 입력 두 집합** (런타임 .ts 0줄, 본 ADR 범위 밖).

### 3.1 GUARDED_SYMBOLS (중복 금지 심볼 집합)

§1 표의 **guarded 심볼명** 컬럼. 메타 등재(#5)는 제외 또는 별도 불변식 #6 가드에 위임.

```
isKrxHoliday
addBusinessDaysFromKstDate
addWeekdaysApprox
collectUnifiedSnapshot
UnifiedSourceSnapshot
getOpenPositions
loadOpenPositions
MarketSession
```

### 3.2 LEGITIMATE_PAIRS (정당 예외 = 통과 쌍)

`(guarded 심볼) → { owner 모듈, 허용 모듈[] }`. 아래 쌍에서 동일 심볼이 2곳 이상 나타나도 **통과**.
그 외(미등재) 모듈에서 동일 guarded 심볼이 export/정의되면 **신규 위반 → EXIT 1**.

```
isKrxHoliday:
  owner   = server/trading/krxHolidays.ts
  allowed = [ server/calendar/krxTradingCalendar.ts ]   # 위임 re-export (ADR-0559)

addBusinessDaysFromKstDate:
  owner   = server/trading/krxHolidays.ts
  allowed = [ ]                                          # 수렴 목표 (현 catalog #2 인라인은 burn-down)

addWeekdaysApprox:
  owner   = server/screener/businessDayApprox.ts
  allowed = [ ]                                          # 별도 개념 (주말만 근사)

collectUnifiedSnapshot:
  owner   = server/trading/symbolDataCollector.ts
  allowed = [ ]

UnifiedSourceSnapshot:
  owner   = server/trading/sourceSnapshot/unifiedSourceSnapshot.ts
  allowed = [ src/services/autoTrading/ssotPipeline.ts ] # projection 동명이인 (ADR-0556, 의도 분리)

getOpenPositions:
  owner   = server/persistence/shadowPositionLedger.ts
  allowed = [ ]                                          # loadOpenPositions 는 별 심볼이므로 자체 owner

loadOpenPositions:
  owner   = server/persistence/positionTruth.ts
  allowed = [ ]                                          # getOpenPositions 와 짝 — 3번째 reader 금지

MarketSession:
  owner   = server/ssotSnapshot.ts
  allowed = [ ]                                          # 파생 세션은 *다른 심볼명* → 충돌 안 함; 동일명 신규는 fail
```

> **grandfather:** 위 `allowed` 가 현재 코드에 존재하는 LEGITIMATE 쌍(krxTradingCalendar 위임,
> ssotPipeline projection 등)을 명시 등재함으로써 통과시킨다. 신규(미등재) 중복만 `EXIT≠0`.
> burn-down: `addBusinessDaysFromKstDate` 의 catalog #2 인라인 구현은 owner 로 수렴 후
> `allowed` 가 비어 있는 상태가 유지되어야 한다(수렴 완료 = 자동으로 위반 0).

### 3.3 탐지 방법 (false positive 최소화)

- **파싱 단위:** `check_ssot_single_funnel.js` 방식 — 라인 단위 정규식으로 *export 선언* 과
  *함수/const/type 정의* 만 본다(주석 라인·`import type` 제외). 호출(call site)·import 는 검사 대상 아님.
- **검색 키:** `export (function|const|type|interface) <guarded>` / `export { ..., <guarded>, ... }` /
  `export default function <guarded>` 패턴. 심볼명 정확 일치(word boundary).
- **스캔 루트:** `server/` + `src/` (`.test.ts`·`.d.ts` 제외).
- **판정:** guarded 심볼별로 **정의/export 모듈 집합**을 모은다. 집합 ⊆ `{owner} ∪ allowed` 이면 통과.
  집합에 owner·allowed 외 모듈이 있으면 그 모듈만 신규 위반으로 보고.
- **동명이의(우연한 이름 충돌) 분리:** registry 의 개념 매핑으로 구분 — 같은 문자열이라도
  서로 다른 개념(예: 지역 변수, 무관 도메인 export)이면 owner 도메인 경로 휴리스틱(소유 모듈
  디렉토리)으로 1차 필터링 후, 애매하면 보고하여 사람이 registry 에 등재/배제 결정.

### 3.4 에러 메시지 (필수 포맷)

```
[SSOTDriftRegistry] [FAIL] 신규 동일개념 다중구현 (ADR-0560)
  개념 '<concept>' 은 이미 <owner file:export> 가 SSOT 입니다. 신규 구현 금지.
    위반 → <relPath>:<lineNo>  export '<guarded>'
    해결: (a) <owner> 로 위임/re-export 하거나
          (b) 정당한 분리면 docs/SSOT_REGISTRY.md 에 LEGITIMATE 예외 등재 (ADR 동반).
```

### 3.5 등재 위치 (engine-dev 가 package.json 편집)

- `validate:all` 체인 끝에 `&& npm run validate:ssotDriftRegistry` 추가
  (스크립트: `"validate:ssotDriftRegistry": "node scripts/check_ssot_drift_registry.js"`).
- `precommit` 체인에 `&& node scripts/check_ssot_drift_registry.js` 추가
  (`check_ssot_single_funnel.js` 인접 위치 권장).
- 회귀 테스트: `scripts/check_ssot_single_funnel.js` 의 export 재사용 패턴처럼
  `checkFile` / `GUARDED_SYMBOLS` / `LEGITIMATE_PAIRS` export → `*.test.ts` 로 잠금.

---

## 4. 변경 절차 (Amendment)

1. **신규 guarded 개념 추가** → §1 행 추가 + ADR 발급(소유 모듈 선정 근거).
2. **LEGITIMATE 예외 추가** → §3.2 `allowed` 갱신 + ADR(왜 분리가 정당한지).
3. **burn-down(예외 제거)** → 수렴 완료 후 `allowed` 에서 제거(가드가 자동 강화).
4. 모든 변경은 `docs/ai/10-patch-history-index.md` 한 줄 + INDEX 갱신(ADR 시).
