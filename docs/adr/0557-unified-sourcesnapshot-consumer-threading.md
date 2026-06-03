# ADR-0557: Unified SourceSnapshot Consumer Threading (정본 소비 배포 계약)

@responsibility governance — SourceSnapshot 정본이 스캔/비-스캔(telegram) 양 경로 소비자에 닿는 표준 threading 규약 + Consumer Contract(dead carry 방지) 확정 (문서/타입 핀 전용)

## Status

Accepted (문서/계약 전용 — read-site 런타임 구현은 후속 engine-dev P2 묶음3·5·6)

## Context

ADR-0556(factory 계약)으로 `symbolDataCollector.collectUnifiedSnapshot()` 가 SourceSnapshot 정본을
생산하게 됐고, 묶음4가 `supply.marketProgram`(시장 레벨 프로그램 순매수, `resolveMarketProgramFlow()`
정본)을 factory 출력 타입(`unifiedSourceSnapshot.ts:90 marketProgram?`)에 부착했다. 그러나 **현재
이 필드의 소비처가 0건(dead carry)** 이다. 묶음3(`normalSupplyPreviewRunner` read-site 교체)의
0단계 평가는 "snapshot 미전달"로 **중단(STOP)** 됐다
(`_workspace/2026-06-03_ssot-constitution/engine-dev/bundle3-v3b-stop-report.md`).

### 진단 — "정본 생산"과 "정본 소비"의 물리적 분리 (dead carry anti-pattern)

코드 정독으로 확인한 근본 원인은 **두 call tree 가 분리** 됐다는 것이다:

- **생산 경로(scan loop):** `collectUnifiedSnapshot` 의 유일 호출처는
  `signalScanner/index.ts:390`(`runSignalScan` 내부). 결과는 **지역 변수**
  `unifiedSnapshot`(index.ts:381)에 담긴다. 이 변수는 `injectPerSymbol*Context(... snapshotData:
  unifiedSnapshot?.perSymbol ...)`(index.ts:409/419/467/474/490/495)로만 thread 됨 — **`perSymbol`
  만 전달, `marketProgram` 미전달.** index.ts:277/280/446/447 의 marketProgram 은 전부
  `buildMarketProgramFlowCarryPayload(...macroState)`(legacy carry)일 뿐 `unifiedSnapshot.marketProgram`
  read 0건.
- **소비 경로(telegram):** `normalSupplyPreviewRunner.ts` 는 별개 call tree 다. 유일 호출자는
  `telegram/commands/system/normalSupplyPreview.cmd.ts:66`(`/normal_supply_preview` 핸들러)로
  **factory 를 거치지 않는다.** runner 시그니처(`:47-50`)에 snapshot 인자가 없고, `:127`
  `const liveMarketProgramFlow = await resolveMarketProgramFlow().catch(() => undefined);`
  로 provider 를 **직접 재호출** 한다 — scope 에 정본이 없으므로 "있으면 그것" 분기를 만들 source 가 없다.

즉 factory 가 생산한 `marketProgram` 정본과, 그것을 *재호출*로 다시 만드는 telegram 소비자가
같은 함수(`resolveMarketProgramFlow`)를 두 번 호출하면서도 서로 닿지 못한다. **factory 가 생산한
필드가 소비 계약을 갖지 못하면 dead carry** 가 된다. 남은 소비자 정렬 묶음(3·5·6)이 전부 이 벽에
부딪혀 정지했다. 본 ADR 은 "정본 일치"의 **소비자측 배포(threading) 계약** 을 확정해 이 벽을 푼다.

### 결정 입력 — engine-dev 가 제시한 옵션 A/B/C

| 후보 | 진입점 | 내용 | 리스크 |
|---|---|---|---|
| **A. retention store 신설** | factory 산출 직후 `setLatestUnifiedSnapshot(snapshot)`, runner 가 `getLatestUnifiedSnapshot().marketProgram` read | scan loop 이 채우고 telegram 이 사후 read | **두 번째 SSOT 위험**(헌법 §0 충돌). freshness/stale 의미 신규 부여 필요 |
| **B. 소비 경로 진입부에서 factory 직접 호출** | cmd/runner 진입부가 `collectUnifiedSnapshot(symbols)` 1회 호출 후 `.marketProgram` 을 runner 로 전달 | scan loop 과 동형. flag OFF 시 factory 가 undefined 반환 → 기존 호출 유지 | telegram 명령마다 factory 1회(quota). flag OFF 면 순증 0 |
| **C. runner optional `snapshot?`/`marketProgram?` 인자 + 호출자 주입** | 가장 얇은 read-site 교체. 단 source 는 A 또는 B 가 선행 | 저(runner 측), source 미해결 |

## Decision

### D1. 채택 — C(주입 시그니처) + B(비-스캔 경로 진입부 factory 호출) 조합. A 기각.

**결정: 표준 threading 규약은 "소비자는 정본을 *주입받는다*(C) + 비-스캔 경로는 진입부에서 factory 를
*직접 호출*해 정본을 얻는다(B)"의 조합으로 한다. A(retention store)는 기각한다.**

코드 정독 후 5대 판단기준 적용 결과:

1. **두 번째 SSOT 신설 0** — A 는 `getLatestUnifiedSnapshot` 류 새 영속/공유 store 를 만든다. 이는
   ADR-0555 §0("두 번째 SSOT 신설 금지")·헌법 §2.1 불변식 #3(단일 SourceSnapshot)을 정면 위반한다.
   더해 store 는 freshness/stale/소유권 의미를 새로 정의해야 해 **세 번째 SourceSnapshot 아티팩트**
   (A=collector·B=ssotPipeline projection 에 이은)가 된다(ADR-0556 §드리프트 진단 승계). **B+C 는
   store 0 — 정본은 factory 가 *호출 시점에* 생산하고 인자로 흐를 뿐, 어디에도 보관되지 않는다.**
2. **flag OFF byte-equivalent** — B 는 `collectUnifiedSnapshot` 내부 `collectMarketProgramFlow()`
   (`symbolDataCollector.ts:474`)가 `USE_UNIFIED_SOURCE_SNAPSHOT !== 'true'` 시 `undefined` 반환.
   C 의 주입 인자가 undefined → runner 는 기존 `resolveMarketProgramFlow()` fallback(`:127`) 100% 유지.
   flag OFF 경로 0줄 동작 변경.
3. **quota 순증 0(flag OFF)** — flag OFF 시 factory 가 provider 를 미호출(`collectMarketProgramFlow`
   조기 return) → KIS/KRX 순증 0. flag ON 시에도 factory 의 `marketProgram` 은 runner 가 직접 호출하던
   `resolveMarketProgramFlow()` 와 **동일 단일 함수**(`marketProgramFlowProvider` 정본)를 호출하므로,
   "재호출 1회 → factory 호출 1회"로 호출수 동일(byte-equivalent). 묶음5/6 의 per-symbol fetch 도
   ADR-0556 D5(신규 fetch 0·dedup·쿨다운 존중) 계약을 그대로 승계한다.
4. **양 경로 동일 정본이 닿는 일반 패턴** — 스캔 경로는 *이미* 지역 변수(`unifiedSnapshot`)에 정본을
   보유한다 → 추가 인프라 없이 그 변수를 read-site 에 thread(C)만 하면 된다. 비-스캔 경로(telegram)는
   진입부에서 factory 를 1회 호출(B)해 동일 타입의 정본을 얻고, 동일한 주입 시그니처(C)로 runner 에
   넣는다. **두 경로가 *같은 모양의 주입 인자* 로 수렴** — 이것이 일반 threading 규약의 핵심이다.
5. **묶음5·6 재사용** — C 의 "정본 주입" + "fallback 보존" 형태는 read-site 교체의 *모양* 을
   고정한다. 묶음5(universeScanner Stage2)는 *이미 스캔 경로* 라 지역 변수 thread(C-스캔) 만으로
   충분(B 불요), 묶음6(Stage1 ranking)도 동일 주입 규약을 쓴다(단 executionImpact 직접 → §주의 별도 ADR).

### D2. 표준 threading 경로 — "snapshot 이 닿는 표준 경로" 1개 일반 패턴

정본은 **두 입구** 중 하나로 들어와 **하나의 주입 형태** 로 소비자에 닿는다:

```
[입구 1 — 스캔 경로]  signalScanner/index.ts: 지역 변수 unifiedSnapshot (이미 보유)
                        └─ snapshotData=unifiedSnapshot.perSymbol      → per-symbol read-site
                        └─ marketProgram=unifiedSnapshot.marketProgram → market-level read-site  ← 본 ADR 신설 경로

[입구 2 — 비-스캔 경로]  telegram cmd / runner 진입부: collectUnifiedSnapshot(symbols) 1회 호출(B)
                        └─ 동일 타입 UnifiedSourceSnapshot 획득 → 동일 주입 형태(C)로 runner 주입

[공통 소비 형태(C)]  소비자 시그니처에 optional 인자(snapshot? / marketProgram?) 추가
                        └─ 인자 present  → 정본 read
                        └─ 인자 absent   → 기존 provider/store fallback (byte-equivalent)
```

- **스캔 경로 소비자**(예: per-symbol injection, Gate2 입력)는 입구 1 의 지역 변수를 thread 받는다.
  정본이 이미 scope 에 있으므로 factory 재호출 0.
- **비-스캔 경로 소비자**(예: `normalSupplyPreviewRunner`, telegram 표시)는 진입부(cmd 또는 runner
  head)에서 입구 2 로 정본을 얻어 자기 자신/하위에 주입한다.
- 두 경로 모두 소비자 read-site 의 *모양* 은 동일(D3 Consumer Contract).

### D3. Consumer Contract — dead carry 방지 표준 형태

**규칙: factory 가 생산한 필드는 *반드시* 소비 계약을 가진다. 생산만 하고 소비처 0 인 필드(dead
carry)는 금지한다.** 각 소비자는 아래 표준 형태를 따른다:

```
(a) 정본 인자(snapshot/marketProgram)가 present  → 그것을 read (정본 일치 발현)
(b) 정본 인자가 absent(undefined)               → 기존 경로 fallback (flag OFF byte-equivalent)
```

- **(a) 정본 우선:** 주입된 정본이 있으면 provider/store 재호출 없이 정본을 읽는다 — "정본 일치"는
  여기서 발현된다(flag ON).
- **(b) fallback 보존:** 정본이 없으면(flag OFF 또는 비-스캔 경로에서 factory 미호출) 기존 동작을
  100% 유지한다 — 이것이 byte-equivalent 안전판이다.
- **dead carry 방지 게이트:** factory 출력 타입에 새 필드를 부착하는 묶음(예: 묶음4 marketProgram)은
  **같은 묶음 또는 직후 묶음에서 최소 1개 소비 계약** 을 동반해야 한다. 소비 계약 없는 필드 부착은
  본 ADR 위반(향후 묶음 PR 의 자가 review 항목).
- **불변식 보존:** (a)/(b) 어느 분기도 throw 하지 않는다(불변식 #1 Engine always-on). provider 장애
  시 정본은 ADR-0556 D4 격리(`providerIssue` + freshness)를 그대로 carry 하며 marketSignal 로
  변환하지 않는다(불변식 #6). L4(AI_ESTIMATED)는 정본 컨테이너 미포함(불변식 #7).

### D4. 첫 적용 — 묶음3 `normalSupplyPreview` (telegram 비-스캔 경로)

본 ADR 의 첫 소비자는 묶음3 의 `normalSupplyPreviewRunner` 다. 표준 규약 적용형:

- **(B) 진입부 factory 호출:** `normalSupplyPreview.cmd.ts:66` 또는 runner 진입부에서, watchlist 후보
  심볼로 `collectUnifiedSnapshot(symbols)` 를 1회 호출해 `snapshot.marketProgram` 을 얻는다. flag OFF
  시 factory 가 undefined → 아래 fallback.
- **(C) runner 주입 시그니처:** `collectNormalSupplyPreviewFromWatchlist({ ..., marketProgram?:
  MarketProgramFlowResult })` 로 optional 인자를 추가하고 호출자가 주입한다.
- **(a)/(b) read-site:** runner `:127` `liveMarketProgramFlow` 는 — 주입된 `marketProgram` 이 present
  면 그것을, absent 면 기존 `resolveMarketProgramFlow().catch(()=>undefined)` 를 사용한다.
- **타입 핀:** 인자 타입은 **기존** `MarketProgramFlowResult`(`marketProgramFlowProvider.ts`, factory
  출력 필드와 동일 타입) 재사용 — 신규 타입 0.

### D5. ARCHITECTURE.md threading 경계 등재

본 threading 규약을 Boundary Rules 에 등재한다(Single Responsibility ≤25 words). factory 출력 정본이
스캔 경로(지역 변수 thread)·비-스캔 경로(진입부 factory 호출) 양쪽에 동일 주입 형태로 닿으며, 소비자는
정본 present→read / absent→fallback 표준 형태를 따른다는 경계를 명문화한다.

## Roadmap (소비자 정렬 묶음 재개 순서)

본 ADR 위에서 ADR-0556 §Roadmap 의 묶음3·5·6 이 재개된다. 각 묶음의 선행조건을 명시한다:

| 묶음 | 대상 | 경로 | threading 적용형 | executionImpact | 선행조건 |
|---|---|---|---|---|---|
| **3** | `normalSupplyPreviewRunner` marketProgram read-site | 비-스캔(telegram) | B(진입부 factory) + C(runner 주입) | NONE(flag OFF byte-equiv) | 본 ADR(D4) |
| **5** | `universeScanner` Stage2 quote/supply read-site | 스캔 | C-스캔(지역 변수 thread, B 불요) | 간접(Gate1/2 입력, 후보집합 동일성 회귀 잠금) | 본 ADR + 묶음4 |
| **6** | `universeScanner` Stage1 ranking snapshot화 | 스캔 | C-스캔(지역 변수 thread) | **직접(발굴 풀 변경 가능)** | **별도 ADR + shadow A/B**(본 ADR 이 대체 안 함) |

> 본 ADR 은 묶음3·5 의 threading 벽을 푼다(둘 다 NONE/간접·byte-equivalent 가능). **묶음6 은
> executionImpact 가 *직접*(universe 발굴 풀 변경)이라 본 ADR 의 byte-equivalent 보장 밖** —
> 별도 ADR + shadow 모드 A/B 비교 후에만 live 승격(ADR-0556 §묶음6 분리 원칙·ADR-0011 데이터 경로
> 분리 승계). 본 ADR 은 묶음6 의 *threading 모양* 만 재사용 가능하게 할 뿐, 발굴 풀 변경을 허가하지 않는다.

## Consequences

- **계약 공개.** engine-dev 가 묶음3 read-site 교체를 즉시 재개 가능 — 진입부(B)·주입 시그니처(C)·
  read-site(a/b)·타입(기존 `MarketProgramFlowResult` 재사용) 이 모두 pin 됨. 묶음5 는 스캔 경로
  지역 변수 thread 만으로 동일 규약 적용.
- **dead carry 해소.** 묶음4 가 부착한 `supply.marketProgram` 이 묶음3 에서 소비 계약을 얻어 정본
  일치가 발현된다. 이후 "생산만 하고 소비 0" 필드는 Consumer Contract(D3) 게이트로 차단.
- **두 번째 SSOT 신설 0.** A(retention store) 기각으로 store/영속 신설 없음 — 정본은 호출 시점
  생산·인자 흐름뿐. 헌법 §0·불변식 #3 정합.
- **executionImpact: 문서 단계 = NONE.** 본 ADR 은 ADR/ARCHITECTURE.md/타입 핀 전용 — 런타임 소스
  (.ts 비-테스트) 0줄 변경, behavior change 0, KIS/KRX quota 0 침범, ENV 0건 신설, LIVE 0줄. 구현 단계
  executionImpact 는 묶음별(묶음3=NONE, 묶음5=간접, 묶음6=직접·별도 ADR).
- **flag OFF NONE / flag ON 정본 일치.** `USE_UNIFIED_SOURCE_SNAPSHOT` OFF → 모든 소비자가 fallback
  분기(b)로 기존 동작 100% 유지. ON → 정본 present 분기(a)로 정본 일치 발현.
- **타입 pin 범위.** 신규 타입 0 — 기존 `MarketProgramFlowResult`(factory 출력 필드와 동일) 재사용.
  주입 시그니처 optional 인자만 추가(byte-equivalent, behavior change 0).
- **Rollback:** 문서 변경이므로 N/A(git revert). 구현 단계는 `USE_UNIFIED_SOURCE_SNAPSHOT` flag OFF
  또는 주입 인자 미전달로 byte-equivalent 롤백.
- **Self-review (ADR-0146):** (1) LIVE 안전성 — 코드 0줄, NONE·flag OFF byte-equivalent. (2) wiring
  vs 인프라 — 본 ADR 은 threading 계약(문서)이며 read-site wiring 은 묶음3·5·6 후속. (3) ADR 무결성
  — INDEX 0557→0558 갱신 + 전체 인덱스 행. (4) 회귀 테스트 — 문서라 불요(묶음3·5 각 byte-equivalent
  회귀 테스트가 담당). (5) baseline 무회귀 — 신규 위반 0, 기존 baseline(V1~V7)은 ADR-0555 grandfather
  allowlist 승계, 묶음6 은 별도 ADR 분리.

## Alternatives Considered

- **A. retention store 신설(`getLatestUnifiedSnapshot`).** 기각: scan loop 이 채우고 telegram 이
  사후 read 하는 구조는 편리하나 — 새 공유/영속 store 가 **세 번째 SourceSnapshot 아티팩트 = 두 번째
  SSOT**(헌법 ADR-0555 §0·불변식 #3 위반)이고, freshness/stale/소유권 의미를 신규 정의해야 한다.
  B+C 는 store 0 으로 동일 목적(양 경로 정본 도달)을 달성하므로 A 의 인프라 비용·드리프트 위험이 불필요.
- **C 단독(주입만, source 미해결).** 기각: runner 시그니처에 인자를 추가해도 비-스캔 경로(telegram)에는
  채울 정본 source 가 없다(scan loop 전용 지역 변수). 반드시 B(진입부 factory 호출)가 source 를
  공급해야 C 가 작동 — C+B 조합이 정답.
- **B 단독(factory 호출 후 내부 변수만).** 기각: factory 정본을 얻어도 runner 시그니처에 주입 통로
  (C)가 없으면 runner scope 로 흐르지 못한다. B 의 정본을 C 로 흘려야 read-site 에 닿는다.
- **묶음6 을 본 ADR 에 포함.** 기각: Stage1 ranking snapshot화는 universe 발굴 풀을 바꿔
  executionImpact 가 *직접* — byte-equivalent 보장 밖. 별도 ADR + shadow A/B 분리(ADR-0556 승계).

## References

- 헌법: `docs/adr/0555-ssot-single-funnel-enforcement-constitution.md` (§0 두 번째 SSOT 신설 금지)
- factory 계약: `docs/adr/0556-sourcesnapshot-factory-boundary-and-contract.md` (§Roadmap 묶음3·5·6 · D4 격리 · D5 quota 0)
- 묶음3 중단 보고(진단): `_workspace/2026-06-03_ssot-constitution/engine-dev/bundle3-v3b-stop-report.md`
- dead factory anti-pattern: `docs/audits/2026-06-03-ssot-coherence-audit.md` §3
- 생산 경로(지역 변수): `server/trading/signalScanner/index.ts:381/390`(collectUnifiedSnapshot 유일호출), `:409/419/467/474/490/495`(perSymbol thread), `:277/280/446/447`(legacy marketProgram carry)
- 비-스캔 소비 경로: `server/trading/signalScanner/normalSupplyPreviewRunner.ts:47/127` · `server/telegram/commands/system/normalSupplyPreview.cmd.ts:66`
- factory 출력 marketProgram 정본: `server/trading/symbolDataCollector.ts:474/601/681`(`collectMarketProgramFlow`, flag-gated) · `server/trading/sourceSnapshot/unifiedSourceSnapshot.ts:90`(`marketProgram?: MarketProgramFlowResult`)
- 주입 타입(재사용): `server/trading/signalScanner/marketProgramFlowProvider.ts`(`MarketProgramFlowResult`, `resolveMarketProgramFlow`)
- Gate2 입력(별도 thread, 본 ADR 무관): `server/quant/gate2Diagnostics/externalCoverage.ts:681`(`input.programTrade?.marketProgram`)
- 데이터 경로 분리: ADR-0011(`aiUniverseService` 단일통로) · CLAUDE.md §2.2-3
- 불변식: CLAUDE.md §2.1 (#1 Engine always-on · #3 단일 SourceSnapshot · #6 provider≠signal · #7 L4 격리)
