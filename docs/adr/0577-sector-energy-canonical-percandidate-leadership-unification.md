# ADR-0577 — 섹터에너지 canonical 일원화: per-candidate Gate2 SECTOR_LEADERSHIP 축을 verified official(L1)로 단일화

- Status: Proposed (설계/ADR 전용 — 런타임 소스 0줄)
- Date: 2026-06-04
- Type: ADR type (신규 경계·데이터 위계 정책)
- 계승: ADR-0534(verifiedMapping)·0544/0545(canonical 표시·lastKnown)·0561(KIS Primary 절대불변식)·0568(sectorEnergyResult→Gate2 confluence threading)·0570(sectorIndexCycleProvider 공식 index 20d/5d)·0571(sectorThemeCycle producer 합성)
- 후속 구현: engine-dev (별도 patch/PR — 본 ADR 은 경계·계약만 확정)

---

## 1. Context

QuantMaster Pro 섹터에너지 시스템이 **이원화(dual-source)** 되어 공존한다. 두 경로가 같은
"섹터 강도" 개념을 서로 다른 데이터·코드로 산출하며, 그 출력이 한쪽은 top-level 게이팅,
다른 한쪽은 per-candidate Gate2 축을 구동한다.

### 1.1 canonical (정상 SSOT) — top-level 게이팅 구동

- 모듈: `src/domain/sector-energy/SectorEnergyCanonicalResolver.ts`
- 매핑: `OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS` (line ~299) — **올바른 idxcode.mst
  공식 업종코드**: 반도체 4003 · 자동차 4002 · 기계장비 0012 · 화학 0008 · 바이오/헬스케어
  4004 · 철강 4008 · 건설 0018 · 금융 0021 · 유통/소비재 0016 · 음식료 0005 · 방송통신 4010.
- 현재 상태(스캔 forensic): `verifiedOfficialSectorCount=11/11`, `promotionCoverage=100%`,
  `promotionCoveragePass=true`, `dataQuality=VERIFIED`,
  `selectedSourceTier=OFFICIAL_KIS_SECTOR_INDEX`(L1), `sourceOfTruth=SectorEnergyCanonicalResolver`.
- 구동 대상: **top-level** `promotionAllowed`/`sectorBoostAllowed`/`strongBuyAllowed` 게이팅 +
  leadership 표시 (`SectorEnergyCanonicalState`).
- ADR-0570 이 이 매핑을 재사용하는 `sectorIndexCycleProvider.fetchKisSectorIndexDaily(iscd)` 로
  **공식 섹터 index 20d/5d return 을 이미 L1 으로 산출**한다(섹터당 1콜·6h+ TTL 캐시·raw KIS 0).

### 1.2 레거시 basket (이원화의 잔재) — per-candidate Gate2 축 구동

- 객체: `macroState.sectorEnergyResult` — `server/trading/marketDataRefresh.ts:1347` 에서
  `buildSectorEnergyInputsWithMeta()` → `evaluateSectorEnergy()` 로 빌드, `liveExecutionAllowed:false` 스탬프.
- 코드 출처: `server/clients/kisSectorEnergyProvider.ts` 의 `KIS_SECTOR_ISCD_MAP` =
  **레거시 2xxx 코드**(2004/2012/2009/2010…) — `kisBasketDerivedStatus=DIAGNOSTIC_ONLY`.
- per-candidate threading 경로:
  `server/screener/universeScanner.ts:463,550` + `server/screener/stockScreener.ts:699`
  → `evaluateServerGate` 8번째 인자(`sectorEnergyResult`)
  → `server/quant/gate2Diagnostics/externalCoverage.ts:668` `normalizeSectorThemeCycleForGate2`
  → `server/clients/sectorThemeLeaderCycleNormalizer.ts:313,320` `getSectorEnergyScore` /
    `getSectorRank` / `isLeadingSector`
  → `server/quant/gate2ConfluenceScore.ts:442` `buildSectorAxis`
    (`external.sectorCycle.values.sectorReturn20d`).

### 1.3 산증거 — 모순과 잘못된 데이터원

- `sectorThemeLeaderCycleNormalizer.ts:320`:
  `sectorReturn20d = numberOrNull(raw.sectorReturn20d ?? sectorEnergyScore.sectorReturn20d ?? sectorEnergyScore.return4w)`
  에서 `sectorEnergyScore = getSectorEnergyScore(input.sectorEnergyResult, sector)` =
  **레거시 basket(2xxx 코드, DIAGNOSTIC_ONLY)** 에서 온다. 같은 모듈 :328 `getSectorRank`,
  :332 `isLeadingSector` 도 동일 레거시 basket 을 읽는다.
- 결과: **per-candidate Gate2 SECTOR_LEADERSHIP 축의 `sectorReturn20d`(및 sector rank /
  leading 여부)가 verified official(canonical) 이 아니라 레거시 basket 에서 온다.**
  canonical 의 `verifiedOfficialSectorCount=11/11 VERIFIED 100%` L1 데이터는
  per-candidate 축에 **쓰이지 않는다.**
- `/sector_energy_diag` 동시 모순 표시: `officialCoverage 0/12 basket-derived`(레거시 진단) 와
  `OFFICIAL 11/11 VERIFIED 100%`(canonical) 가 동시 노출.
  `officialIndexCoverage=77.8%` 같은 `diagnosticValuesDoNotDrivePromotion=true` 진단값이 노이즈.

### 1.4 ADR-0568/0570/0571 과의 관계 (왜 또 ADR 인가)

- 0568: caller 가 `sectorEnergyResult` 를 Gate2 confluence 로 **thread** 하는 배선 갭 픽스
  (flag `SECTOR_ENERGY_GATE2_WIRING_ENABLED`). **하지만 thread 되는 데이터는 여전히 레거시 basket.**
- 0570: `sectorIndexCycleProvider` 가 canonical 매핑으로 공식 index 20d/5d 를 산출해
  `SectorEnergyInput.sectorReturn20d` 에 배선 (flag `SECTOR_INDEX_CYCLE_WIRING_ENABLED`).
  **이 데이터가 `evaluateSectorEnergy` 를 거쳐 basket score 의 sectorReturn20d 를 채울 수는
  있으나, basket 빌더 경로(2xxx 코드 진단)와 canonical L1 의 경계가 명문화되지 않아 데이터원
  귀속이 모호하다.** 본 ADR 이 "per-candidate 축은 canonical L1 을 단일 데이터원으로 한다" 를
  **경계로 확정**한다.
- 0571: 후보 `sectorThemeCycle.sector` 합성(producer). **sector 라벨 매칭 해소이지, 그 섹터의
  `sectorReturn20d` 데이터원 일원화는 아니다.**

본 ADR-0577 는 **세 선행 ADR 이 만든 배선 위에서, per-candidate 축의 `sectorReturn20d`(+rank/
leading)의 *데이터 출처* 를 레거시 basket → canonical verified official(L1) 로 단일화**하는
경계·계약을 확정한다.

---

## 2. Decision

### D1. per-candidate SECTOR_LEADERSHIP 축의 `sectorReturn20d`(+rank/leading) 데이터원을 canonical L1 로 단일화

`normalizeSectorThemeCycleForGate2`(`sectorThemeLeaderCycleNormalizer.ts`)가 per-candidate
sector 강도 필드를 산출할 때, 우선순위를 다음으로 확정한다:

```
sectorReturn20d := raw.sectorReturn20d                       (caller 가 명시 제공 시 — 최우선)
               ?? canonicalSectorReturn20d(sector)            (★ 신규 — canonical L1, VERIFIED 일 때만)
               ?? sectorEnergyScore.sectorReturn20d           (레거시 basket — graceful fallback only)
               ?? sectorEnergyScore.return4w
```

- `canonicalSectorReturn20d(sector)` 는 ADR-0570 `sectorIndexCycleProvider` 의
  `SectorCycleReturn`(이미 `OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS` 기반 L1) 또는
  canonical resolver 의 verified mapping 에서 공급되는 **per-sector L1 return 룩업**이다.
- 신규 KIS/KRX raw 호출 0 — 이미 refresh 당 11콜로 캐시된 `SectorCycleReturn[]` 을
  per-candidate 에서 룩업만 한다(후보당 재fetch 0, ADR-0570 §16 quota 계약 보존).
- `sectorRank20d`(`getSectorRank`) 와 `isCurrentLeadingSector`(`isLeadingSector`) 도 동일하게
  canonical verified leadership 순위에서 우선 공급, basket 은 fallback.

### D2. canonical 우선·basket fallback (점진 마이그레이션 — basket 즉시 제거 금지)

- basket 경로(`getSectorEnergyScore`/`getSectorRank`/`isLeadingSector`)는 **제거하지 않는다.**
  canonical 룩업이 `null`(해당 섹터 미verify / off-hours / sector-index-master 결손)일 때
  레거시 basket 으로 graceful fallback 한다.
- 이로써 canonical L1 가 살아 있는 정상 거래일에는 **per-candidate 축이 L1 으로 구동**되고,
  canonical 이 결손인 경우에만 기존 basket 동작으로 복귀 = 회귀 안전.

### D3. ENV flag-gate + default OFF = byte-identical (execution-adjacent 안전)

- **executionImpact 분류 = execution-adjacent**(NONE 아님). 근거 체인:
  `sectorReturn20d` → `buildSectorAxis`(gate2ConfluenceScore) →
  `applySectorScoreBoost +2/-1` → STRONG_BUY 게이팅(`bullishAxisCount`/`coverageAdjustedScore`)
  영향 가능. 따라서 byte-identical 원칙을 ENV flag 로 강제한다.
- **flag 재사용 우선(신규 flag 0 권장):** canonical 데이터 *공급* 은 ADR-0570
  `SECTOR_INDEX_CYCLE_WIRING_ENABLED`(`sectorIndexCycleProvider`)가, per-candidate 축 *소비* 는
  ADR-0568 `SECTOR_ENERGY_GATE2_WIRING_ENABLED`(`sectorEnergyGate2WiringFlag.ts`)가 이미 gate 한다.
  본 ADR 의 "데이터원 우선순위 전환(basket → canonical)" 은
  **`SECTOR_ENERGY_GATE2_WIRING_ENABLED` 가 ON 인 경우의 *내부 데이터원 선택*** 으로 한정한다.
  - 두 기존 flag 가 모두 OFF(default) → per-candidate 축 미배선 = **현행과 byte-identical**.
  - 둘 다 ON → canonical 우선 데이터원으로 per-candidate 축 구동.
  - 정밀 A/B(canonical-vs-basket 데이터원 단독 토글)가 운영상 필요하면, 신규 flag
    `SECTOR_LEADERSHIP_CANONICAL_SOURCE_ENABLED`(default OFF) 를 추가 도입할 수 있으나,
    **기본 설계는 기존 2-flag 재사용**이며 신규 flag 도입은 engine-dev 의 구현 단계 판단에 위임한다.
- default OFF 경로는 `process.env.X === 'true'` 정확 비교(ADR-0157)로 명시적 opt-in 만 활성.

### D4. 데이터 신뢰 위계 명문화 — canonical = L1, basket = diagnostic/fallback

- canonical `selectedSourceTier=OFFICIAL_KIS_SECTOR_INDEX` = **L1**(KIS 공식 업종지수).
- 레거시 basket(2xxx 코드, `kisBasketDerivedStatus=DIAGNOSTIC_ONLY`) = **derived/diagnostic**
  (준-L1, 게이팅 신뢰 불가). per-candidate 축은 L1 우선이 절대불변식(ADR-0561 KIS Primary)에 정합.
- 단, basket 의 fallback 사용은 **canonical L1 이 진짜 대체불가(미verify/결손)일 때만** 허용 —
  ADR-0561 "Yahoo 는 KIS 대체불가 시에만" 패턴과 동형(여기선 basket-diagnostic 이 fallback 자원).

### D5. 레거시 basket 진단 모순 표시 정리 (부수 — DISPLAY_ONLY)

- `/sector_energy_diag` 에서 canonical `promotionCoveragePass=true`(VERIFIED 100%) 일 때,
  `officialCoverage 0/12 basket-derived` · `officialIndexCoverage=77.8%` 등
  `diagnosticValuesDoNotDrivePromotion=true` 노이즈를 **collapse(축약)** 확장한다.
- 이는 ADR-0534 follow-up `stripStaleSectorEnergyBlockers` /
  `STALE_SECTOR_ENERGY_BLOCKERS`(canonical resolver) 의 collapse 패턴 재사용 — **판단값 변경 0,
  출력만 정합화.** 모순(0/12 vs 11/11) 동시 노출 제거.
- 본 표시 정리는 게이팅·축 값과 무관(DISPLAY_ONLY)하므로 flag 무관하게 적용 가능하나,
  구현 시 canonical PASS 조건부 collapse 로 한정한다.

### D6. 단일 통로·복잡도·책임

- 신규 KIS 호출 0 — 모든 canonical return 데이터는 `fetchKisSectorIndexDaily`(kisClient SSOT,
  ADR-0570) 경유로 이미 존재. raw KIS REST 신설 금지(§2.2 #2).
- 신규 모듈(룩업 헬퍼 등)이 필요하면 상단 20줄 내 `@responsibility` 태그(25단어 이내) 의무,
  1,500줄 한계 준수. 기존 `sectorIndexCycleProvider`/`sectorThemeLeaderCycleNormalizer` 내
  최소 삽입을 우선(신규 파일 최소화).

---

## 3. Consequences

### 긍정

- per-candidate Gate2 SECTOR_LEADERSHIP 축이 **verified official L1**(11/11 VERIFIED)로 구동 →
  데이터원이 canonical SSOT 로 단일화, 이원화 모순 해소.
- top-level(canonical)·per-candidate(이제 canonical) 게이팅이 **동일 데이터원** → 일관성.
- `/sector_energy_diag` 모순 표시(0/12 vs 11/11) 제거 → 운영 가독성.
- ADR-0561 KIS Primary 절대불변식에 per-candidate 축까지 정합.

### 부정 / 위험

- execution-adjacent: flag ON 시 per-candidate `sectorReturn20d` 값이 basket→canonical 로
  바뀌면 `sectorScoreBoost`/STRONG_BUY 게이팅 결과가 이동할 수 있다 → **shadow A/B 검증 의무**
  (default OFF 동안 byte-identical 로 위험 격리).
- canonical 결손 시 basket fallback → 데이터원이 상황별로 갈릴 수 있으나, fallback 은
  graceful 이고 결손 자체가 드물며(VERIFIED 100% 관측) 회귀 안전 우선.

### 9대 불변식 영향 (VERBATIM 0줄 — 삭제·변경 없음)

- #1 Trading Engine always alive: 신규 hard-block 0(canonical 결손→basket fallback→기존 동작,
  throw 금지). 보존.
- #3 단일 SourceSnapshot: per-candidate 축이 macroState(SourceSnapshot 파생)에서 흐른 동일
  canonical 데이터를 읽음 — Gate 내부 provider 직접 조회 0(룩업만). #9 정합. 보존.
- #6 providerIssue ≠ marketSignal: canonical 결손(providerIssue)을 bearish 로 변환 0 —
  결손 시 basket fallback 또는 MISSING(중립). 보존.
- #7 AI_ESTIMATED(L4) live 금지: canonical/basket 모두 L1/diagnostic, L4 미혼입. 보존.
- #2/#4/#5/#8 무접촉.

### ADR-0146 PR 자가 review 5 카테고리 (본 ADR = 문서 단계)

1. **LIVE 매매 안전성**: 본 ADR 런타임 0줄. 구현 단계 = default OFF byte-identical + ENV 1줄
   롤백 + KIS/KRX quota 0 순증(룩업만). 회귀 테스트(§5) 필수.
2. **wiring 완료 vs 인프라만**: 본 ADR = 경계/데이터원 계약 확정. 구현(룩업 우선순위 삽입)은
   engine-dev 후속. dead carry 금지 — canonical 우선순위는 반드시 소비 계약(D1) 동반.
3. **ADR 발급 무결성**: INDEX 0572 등록 + 다음 발급 0573 갱신(§INDEX).
4. **회귀 테스트 적정성**: §5 카탈로그 — flag OFF byte-equal + canonical 우선 + basket fallback
   + marketSignal:false + 진단 collapse.
5. **정책 위반 baseline 무회귀**: KIS Primary(0561)·9대 불변식·sourceSnapshot 우회 0 유지.

---

## 4. Execution Impact

| 상태 | executionImpact | 설명 |
|------|-----------------|------|
| 본 ADR (문서) | NONE | 런타임 .ts 0줄 변경 |
| 구현 flag OFF (default) | NONE | per-candidate 축 미배선 = 현행 byte-identical |
| 구현 flag ON | **execution-adjacent (MEDIUM)** | `sectorReturn20d`(basket→canonical) → `sectorScoreBoost +2/-1` → STRONG_BUY 게이팅 이동 가능 → shadow A/B 검증 의무 |

- providerImpact: KIS(룩업만 — 신규 콜 0, ADR-0570 캐시 재사용). KRX/DART/Yahoo NONE.
- sourceSnapshotImpact: READ_ONLY(canonical 파생 데이터 룩업, SourceSnapshot 불변).
- shadowLearningImpact: 데이터원 전환이 shadow 귀인 sectorReturn 에 반영될 수 있음 → A/B 관측 대상.
- telegramImpact: DISPLAY_ONLY(D5 진단 collapse).

---

## 5. 회귀 테스트 목록 (무회귀 보장 카탈로그)

후속 engine-dev 구현 시 아래 테스트가 무회귀를 보장한다(신규 case 추가 포함):

| 테스트 파일 | 보장 |
|-------------|------|
| `server/clients/sectorIndexCycleProviderAdr0570.test.ts` | canonical return 계산·flag OFF 빈 Map·캐시·graceful — canonical 데이터원 정확성 |
| `server/clients/sectorCycleWiringAdr0570.test.ts` | sectorReturn20d 배선·MISSING 해소·UNKNOWN 잔존 |
| `server/quant/gate2Diagnostics.test.ts` | `normalizeSectorThemeCycleForGate2` 우선순위(raw→canonical→basket) — **신규 case: canonical 우선·basket fallback·flag OFF byte-equal** |
| `server/quant/gate2Diagnostics/legacyWiringDiagnosticFollowup1.test.ts` | 레거시 wiring 진단 — basket fallback 경로 보존 |
| `server/quant/gate2ConfluenceScore.test.ts` | `buildSectorAxis` sectorReturn20d → sectorScoreBoost — flag OFF byte-equal, ON 시 canonical 값 반영 |
| `server/trading/signalScanner/sectorEnergyCanonicalState.adr0544.test.ts` / `.adr0545.test.ts` | canonical state(VERIFIED/lastKnown) 무변경 |
| `server/telegram/commands/system/sectorEnergyDiag.test.ts` | `/sector_energy_diag` — **신규 case: canonical PASS 시 0/12 basket-derived collapse, 모순 미동시노출, marketSignal:false** |
| `server/quant/gate2ConsolidatedDiagnostic.test.ts` / `server/gatePipelineAudit.test.ts` | per-candidate Gate2 파이프라인 회귀 |

- **flag OFF byte-equivalence**: 두 기존 flag default OFF → 축 미배선 → 위 테스트 전부 현행 통과 보존(구조적 보장).
- 추가 검증: `npm run validate:responsibility`(신규 헬퍼 @responsibility), `npm run lint`,
  `npm run validate:all`.

---

## 6. 마이그레이션 단계 (engine-dev 후속 — 점진)

1. **Stage 0 (데이터원 룩업 헬퍼)**: `sectorIndexCycleProvider` 의 `SectorCycleReturn[]`(또는
   canonical verified mapping)을 sector명→return20d/5d·rank·leading 으로 룩업하는 헬퍼 노출
   (신규 KIS 콜 0, 기존 캐시 재사용). `@responsibility` 태그 의무.
2. **Stage 1 (우선순위 삽입)**: `normalizeSectorThemeCycleForGate2`(`sectorThemeLeaderCycleNormalizer.ts`)
   의 `sectorReturn20d`/`sectorRank20d`/`isCurrentLeadingSector` 산출에 canonical 룩업을
   basket 보다 **앞** 우선순위로 삽입(D1). flag(`SECTOR_ENERGY_GATE2_WIRING_ENABLED`) ON +
   canonical present 일 때만 적용, 그외 basket fallback(D2). flag OFF byte-equal.
3. **Stage 2 (진단 collapse)**: `/sector_energy_diag`(`sectorEnergyDiag.cmd.ts`)에서 canonical
   PASS 조건부 `0/12 basket-derived`·`officialIndexCoverage` 노이즈 collapse(D5, DISPLAY_ONLY).
4. **Stage 3 (shadow A/B)**: flag ON 으로 canonical-vs-basket 데이터원 차이를 shadow 학습에서
   관측, sectorScoreBoost/STRONG_BUY 게이팅 이동 허용오차 확정 후 운영 ON 승격(별도 patch).
5. **basket 즉시 제거 금지**: canonical L1 안정성(shadow A/B 무회귀) 확정 전까지 basket fallback
   유지. 제거는 별도 ADR(burn-down)로만.

각 단계는 `docs/ai/templates/patch-plan-template.md` 패치플랜으로 분리한다. `allowedFiles` /
`forbiddenFiles` 는 본 ADR 부속 패치플랜(`docs/ai/...` 또는 `_workspace/`) 참조.

---

## 7. Rollback

- 본 ADR: 문서만 — revert 시 byte-equivalent(런타임 무영향).
- 구현 단계: `SECTOR_ENERGY_GATE2_WIRING_ENABLED`(+ 도입 시 `SECTOR_LEADERSHIP_CANONICAL_SOURCE_ENABLED`)
  ENV 제거 → per-candidate 축 미배선 = byte-identical 복귀. canonical 우선순위 삽입 revert →
  basket 단독 경로 복원. ENV 1줄 롤백 원칙(§5 ADR-0146) 충족.

---

## 8. Alternatives Considered

- **A. basket 즉시 제거 후 canonical 단독 배선**: 기각 — canonical 결손 시 per-candidate 축
  급격 MISSING 회귀 위험. 점진 fallback(D2)이 회귀 안전.
- **B. 신규 전용 flag 단독 도입**: 보류(선택) — 기존 2-flag(0568/0570) 재사용으로 신규 flag 0 이
  기본. A/B 정밀 토글 필요 시에만 engine-dev 가 추가.
- **C. canonical state 에 per-sector return 필드 신설 후 직접 carry**: 부분 채택 — ADR-0570
  `SectorCycleReturn` 이 이미 per-sector L1 return SSOT 이므로 신규 필드 신설 없이 룩업 재사용
  (신규 아티팩트=두 번째 SSOT 회피, ADR-0555/0556 정합).
- **D. 진단 표시만 정리(D5)하고 데이터원 유지**: 기각 — 모순 표시만 가리면 근본(잘못된 데이터원)
  미해소. 데이터원 일원화(D1)가 핵심.

---

## 9. References

- ADR-0534 — verifiedMapping(공식 11섹터 매 스캔 verify)
- ADR-0544/0545 — canonical 표시 세션 분류 · lastKnown
- ADR-0561 — KIS(L1) Primary 절대불변식
- ADR-0568 — sectorEnergyResult → Gate2 confluence threading (`sectorEnergyGate2WiringFlag.ts`)
- ADR-0570 — `sectorIndexCycleProvider` 공식 섹터 index 20d/5d (`SECTOR_INDEX_CYCLE_WIRING_ENABLED`)
- ADR-0571 — 후보 sectorThemeCycle.sector 합성 producer
- ADR-0146 — PR 자가 review 5 카테고리 · byte-equivalent 원칙
- CLAUDE.md §2.1(9대 불변식) · §2.2(7대 단일 통로) · §2.3(데이터 신뢰 L1~L4) · §5(Patch Scope Rule)
- 소스: `src/domain/sector-energy/SectorEnergyCanonicalResolver.ts` ·
  `server/clients/sectorThemeLeaderCycleNormalizer.ts` ·
  `server/quant/gate2Diagnostics/externalCoverage.ts` · `server/quant/gate2ConfluenceScore.ts` ·
  `server/clients/sectorIndexCycleProvider.ts` · `server/clients/kisSectorEnergyProvider.ts` ·
  `server/telegram/commands/system/sectorEnergyDiag.cmd.ts`
