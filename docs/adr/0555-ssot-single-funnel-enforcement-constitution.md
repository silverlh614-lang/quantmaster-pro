# ADR-0555: SSOT Single-Funnel Enforcement Constitution

@responsibility governance — SSOT 단일통로 강제 헌법 (Information Ownership Registry + 순서대로 패치 로드맵 + KIS 레퍼런스 바인딩)

## Status

Accepted

## Context

사용자 요청 — "헌법을 세워 각 정보가 한 곳으로 모이게 하고, 순서대로 패치를 진행."
근거 감사 `docs/audits/2026-06-03-ssot-coherence-audit.md` 의 결론을 정식 거버넌스로 채택한다.

**핵심 진단 (감사 §0·§3):**
- 문제의 본질은 **"SSOT 부재"가 아니라 "설계·ADR·타입은 다 있는데 구현이 우회하고 절반만
  배선된 드리프트(drift)"** 다. 제안된 "Ledger Re-Architecture" 의 **70~80% 는 이미
  불변식(§2.1)·7대 단일통로(§2.2)·ADR-0519/0525/0526/0527/0528 Canonical Data 체인으로 존재**한다.
  이를 새 원장·새 타입으로 재정의하면 **두 번째 SSOT** 가 생겨 단일성을 오히려 파괴한다.
- 진짜 뿌리 원인은 `src/services/autoTrading/ssotPipeline.ts:44` 의 `UnifiedSourceSnapshot` 가
  **타입(청사진)만 존재하고 factory 가 미구현·미배선**이라는 것이다 (프로덕션은
  `candidateDecisionModel.ts:380` 별도 경로). 그래서 각 모듈이 어쩔 수 없이 provider/store 를
  직접 본다 (universeScanner V1, marketProgramFlowProvider V3, dartProviderSignalSplit V2).
- 따라서 처방은 **재설계(re-architecture)가 아니라 enforce(정적 가드로 드리프트 차단) +
  complete(factory 완성)** 다. 이 차이가 위험도를 바꾼다: "재설계"는 불변식 #1·#2(Engine/Shadow
  정지 금지)를 정면 위협하지만, "강제+완성"은 LIVE 본체 0줄 변경 + byte-equivalent 점진 이행이다.

본 ADR 은 코드를 구현하지 않는다. **거버넌스 기반 문서(헌법)** 로서 (a) 정보 소유 지도,
(b) 이행 순서, (c) KIS 스펙 SSOT 바인딩, (d) enforcement 방식을 확정한다.

## Decision

### (a) Information Ownership Registry 를 헌법으로 채택

각 정보 타입은 *단 하나의 소유 모듈(SSOT)* 만 채운다는 원칙을, 코드 grep 으로 검증한 *현존*
소유 모듈 지도로 명문화한다. 표 전문은 `docs/ai/03-source-snapshot-ssot.md` §"Information
Ownership Registry" (산출물 2). 13개 정보 타입 — quote/price · investor-flow/supply ·
technicals/OHLCV · fundamentals/DART · macro · sectorEnergy · providerHealth ·
candidate-universe · gate-decision · execution/order-intent · position(shadow/live) ·
learning/counterfactual · telegram-projection — 각각 "소유 모듈 / 허용 소비 / 금지 경로 /
현재 위반" 4열로 고정. **새 원장·새 타입을 신설하지 않으며** 기존 자산의 소유권을 *재확인*한다.

### (b) 순서대로 패치 로드맵 채택

감사 §6 이행 순서를 정식 로드맵으로 채택한다 (아래 §Roadmap). P0(본 헌법) → P1(정적 가드 +
baseline allowlist) → P2(UnifiedSourceSnapshot factory 구현·배선) → P3(provider 우회 제거) →
P4(dart mixed 제거) → P5(ShadowPositionRegistry 영속화). 각 P 는 독립 PR.

### (c) KIS 공식 api 를 스펙 SSOT 레퍼런스로 바인딩

`docs/reference/kis-open-trading-api/` (산출물 4: `domestic_stock.json` curated 스펙 +
교차대조 README) 를 kisClient 의 **TR_ID·엔드포인트 스펙 SSOT** 로 채택한다.
**규칙: KIS 엔드포인트를 추가·변경할 때 이 레퍼런스를 SSOT 로 교차검증한다.** 본 레퍼런스에
없는 신규 엔드포인트는 공식 출처 확인 후에만 추가하며, 기존 정적 가드
`scripts/check_kis_official_endpoint_registry.js` + `kisOfficialEndpointRegistry.ts` 의
권위 입력으로 연결한다.

### (d) Enforcement = 정적 가드로 매 커밋 강제 + baseline grandfather

드리프트는 *컴파일/커밋 타임에 매번 강제*되어야 유지된다 (감사 §7). enforcement 는
`scripts/check_*.js` 정적 가드로 하되, **기존 baseline 위반(universeScanner V1 등)은 즉시
fail 시키지 않고 allowlist 로 grandfather 후 burn-down** 한다 (회귀 위험 격리). 신규 위반만
즉시 차단한다. 가드는 `validate:all` · `precommit` 에 등재한다 (P1).

## Roadmap (순서대로 패치)

| P | 목표 (1줄) | 대상 파일 | ADR 필요 | executionImpact | 선행조건 |
|---|---|---|---|---|---|
| **P0** | 본 헌법 — Registry·로드맵·KIS 바인딩 확정 | docs only (본 ADR + 03 + reference/) | **본 ADR** | NONE | 감사 문서 |
| **P1** | 정적 가드: 기존 불변식 lock + baseline allowlist | `scripts/check_*.js` (+validate:all/precommit) | patch+가드 | NONE | P0 |
| **P2** | `UnifiedSourceSnapshot` factory 구현 + 프로덕션 배선 (ssotPipeline 승격) | `src/services/autoTrading/ssotPipeline.ts`, `server/trading/symbolDataCollector.ts` | **별도 ADR** | NONE→배선 | P1 가드 |
| **P3** | universeScanner·marketProgramFlowProvider provider 우회 제거 (snapshot 입력화) | `server/screener/universeScanner.ts`, `signalScanner/marketProgramFlowProvider.ts` | patch | NONE | P2 factory |
| **P4** | `dartProviderSignalSplit` mixed 제거 + 회귀 테스트 1개 | `server/dart/dartProviderSignalSplit.ts:29` | patch | NONE | P1 가드 |
| **P5** | `ShadowPositionRegistry` 영속화 + `/pos` 가드3/7 "숨김"→"라벨 표시" | `server/persistence/shadowPositionLedger.ts`, `telegram/commands/positions/pos.cmd.ts` | patch | NONE | P1 |

> KIS order TR_ID 4건(LEGACY) 신스킴 마이그레이션은 LIVE 주문 본체 변경이라 byte-equivalent 아님 —
> 위 P 와 분리한 **별도 ADR + VTS 모의계좌 회귀 검증** 트랙 (reference README §Burn-down).
> `decisionId` 하류 1:N 추적은 factory(P2) 완성 후 별건(감사 §5, 나머지 5-ID 보류).

### 순서 근거 — 왜 가드(P1)가 factory(P2)보다 먼저인가

정적 가드(P1)는 **byte-equivalent** 다 — 런타임 동작을 0줄도 바꾸지 않고 import/호출 패턴만
검사하므로 **회귀 위험이 0** 이다. 따라서 LIVE 매매 본체에 손대지 않고 즉시 배선할 수 있고, 일단
배선되면 **이후 모든 패치(P2~P5)가 새 드리프트를 만들면 커밋 타임에 잡아준다.** 반대로 factory(P2)
부터 손대면 회귀를 감지할 안전망 없이 가장 위험한 통합 작업을 하는 꼴이다. 가드를 먼저 깔아
"드리프트 재발"을 컴파일 타임에 봉인한 뒤, 그 보호막 안에서 factory 를 완성하고 우회 경로(P3~P5)를
하나씩 제거한다 — 각 단계가 직전 가드로 보호된다. (제안서가 "ID 6개 강제"를 1단계로 둔 것은 빈
원장에 라벨 다는 역순이라 교정: 감사 §6 핵심 교정 1·2.)

## Consequences

- **강제(P1 이후):** Information Ownership Registry 의 "금지 경로"(예: Gate evaluator 내 provider
  직접 fetch, telegram 렌더 시점 재계산, learning ledger 신설) 는 **신규 발생 시 커밋 타임 차단**.
  KIS 엔드포인트 추가는 reference SSOT 교차검증 의무.
- **Grandfather (burn-down):** 기존 baseline 위반 — V1 `universeScanner.ts`(provider 직접 호출),
  V3 `marketProgramFlowProvider.ts`, V2 `dartProviderSignalSplit.ts:29` mixed, V4 ShadowPositionRegistry
  미영속, V5 telegram 직접 조회, order TR_ID 4건 LEGACY — 는 allowlist 로 등재 후 P2~P5 + 별건에서
  순차 해소. 즉시 fail 시키지 않는다 (회귀 격리).
- **무엇이 grandfather 되지 않는가:** P0 시점 *신규* 작성되는 우회 경로는 grandfather 대상 아님 —
  처음부터 SSOT 통로를 쓴다.
- **executionImpact: NONE.** 본 ADR 은 문서/ADR 전용 — 런타임 소스(.ts 비-테스트) 0줄 변경,
  behavior change 0, KIS/KRX quota 0 침범, ENV 0건 신설, 9대 불변식·7대 단일통로 무위반(확장만).
- **Rollback:** 문서 변경이므로 N/A (git revert 로 충분, LIVE 영향 없음).
- **Self-review (ADR-0146):** (1) LIVE 안전성 — 코드 0줄, NONE. (2) wiring vs 인프라 — 본 ADR 은
  헌법(인프라/문서)이며 wiring 은 P1~P5 후속. (3) ADR 무결성 — INDEX 0555→0556 갱신.
  (4) 회귀 테스트 — 문서라 불요 (P1+ 가드/테스트가 담당). (5) baseline 무회귀 — 신규 위반 0,
  기존 baseline grandfather 명시.

## Alternatives Considered

- **A. "Ledger Re-Architecture" 전면 재설계 (제안서 원안)** — 새 6-ID 원장·새 타입 신설. 기각:
  두 번째 SSOT 생성 → 단일성 파괴, 불변식 #1·#2 위협, 수개월·LIVE 리스크 (감사 §0·§5).
- **B. 가드 없이 factory 먼저 구현** — 기각: 회귀 안전망 부재 상태에서 최고난도 통합 우선 = 위험
  역순 (§순서 근거).
- **C. baseline 위반 즉시 fail** — 기각: universeScanner 등 다수 즉시 차단 시 빌드 붕괴·회귀 위험.
  grandfather allowlist + burn-down 채택.

## References

- 근거 감사: `docs/audits/2026-06-03-ssot-coherence-audit.md`
- 산출물 2 (Registry): `docs/ai/03-source-snapshot-ssot.md` §Information Ownership Registry
- 산출물 4 (KIS SSOT): `docs/reference/kis-open-trading-api/README.md` + `domestic_stock.json`
- 기존 SSOT 체인: ADR-0519(unified-source-snapshot) · ADR-0525/0526/0527(Canonical Data) ·
  ADR-0528(decision-log correlation) · ADR-0529(DART canonical) · ADR-0011(aiUniverseService 단일통로) ·
  ADR-0504/0452(Shadow position) · ADR-0499(provider health classifier)
- 가드 패턴 모델: `scripts/check_rally_lens_isolation.js` (ADR-0549) ·
  `scripts/check_kis_official_endpoint_registry.js`
- 헌법 근거: CLAUDE.md §2.1(9대 불변식) · §2.2(7대 단일통로)
