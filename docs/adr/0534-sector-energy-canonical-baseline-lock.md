# ADR-0534 SectorEnergy Canonical Baseline Lock

## Status

Accepted — 2026-05-26

## Context

SectorEnergy 판단 기준이 부품마다 충돌한다. 동일 도메인(promotion/sectorBoost/strongBuy)에 대해
서로 다른 denominator·source 가 공존한다:

- **ADR-0488 SectorEnergyMaster** (`sectorEnergyMasterSupplyUnknownPolicyAdr0488.ts`)는
  `safeOfficialVerifiedCoverage >= 80` 으로 `promotionAllowed`/`sectorBoostAllowed`/`strongBuyAllowed` 를 자체 계산.
- **Gate2 Leadership Attribution** (`gate2LeadershipAttribution.ts`)는 ADR-0488 결과를 rebind 하며 `liveLeadership` 재산출.
- **Grouped Sector Energy** (`groupedSectorEnergyProvider.ts`)·**KIS basket derived**·**internal grouped snapshot**·
  old 12/15-sector coverage 가 각각 다른 denominator(12/12, 15-sector 등)로 coverage 를 표현.
- **TopBlocks** (`qmpGateDetailHeaderCanonical.ts`)는 `promotionAllowed` 를 두 경로
  (`freshGate2Attribution...officialIndex` ∥ `sectorEnergySupplyUnknownAdr0488.sectorEnergyMaster`)에서 읽어 충돌 가능.

근본 원인: SectorEnergy 의 Source of Truth 가 없다. "기준을 KIS basket 으로 둘지, grouped snapshot 으로 둘지"
논쟁이 반복된다. 불변식 인용 **#3** "모든 판단은 단일 SourceSnapshot 에서 출발한다" 위반(SSOT 부재).

## Decision

**SectorEnergy 최종 기준 = `SectorEnergyCanonicalResolver`
(`src/domain/sector-energy/SectorEnergyCanonicalResolver.ts`) 의 `SectorEnergyCanonicalState`.**
모든 promotion/sectorBoost/strongBuy 출력·판단은 이 값 하나만 읽고 그대로 렌더링한다.

- **공식 universe 고정**: `OFFICIAL_SECTOR_ENERGY_11` 정확히 11개. `officialSectorCount` 는 언제나 11.
  12/15/grouped/basket count 를 final denominator 로 쓰지 않는다.
- **판단식**: `promotionCoverage = verifiedOfficialSectorCount / 11`,
  `promotionCoveragePass = promotionCoverage >= requiredPromotionCoverage(기본 0.8)`.
  verified >= 9 → PASS, <= 8 → FAIL. pass=false 면 promotion/sectorBoost/strongBuy 전부 false.
- **source tier 순서**: `OFFICIAL_KIS_SECTOR_INDEX → OFFICIAL_KRX_SECTOR_INDEX → NONE`.
- **Theme Tag 제외 정책**: 조선/방산/원자력/이차전지 는 공식 섹터 아님 → `themeTag`/`shadowEvidence` 전용
  (`SECTOR_THEME_TAG_POLICY`). universe/denominator/numerator/sectorBoost/strongBuy/liveLeadership 에 포함 금지.
- **진단 강등(diagnosticOnly)**: KIS basket derived, internal grouped snapshot, old 12/15-sector coverage,
  `validSectorCount=12/12` 는 promotion 판단에 영향 없는 진단값으로만 표시.
- **판단 권한 회수**: 기존 모듈(scan_blockers summary, Gate2 Leadership, ADR-0488, Grouped Sector Energy,
  Runtime Pipeline Audit, TopBlocks, Telegram/gate_full renderer)은 canonical 값을 그대로 읽는다.
  본 PR 의 wiring: ADR-0488 단일 assembly point 에서 canonical 을 1회 계산하여
  `SectorEnergyAndSupplyUnknownPolicyReportAdr0488.sectorEnergyCanonicalState` 로 carry,
  TopBlocks 는 canonical 을 우선 source 로 읽음, ADR-0488 compact/detail 렌더러는 canonical 3블록을 final 로 선두 배치.
- **TopBlock 일관성 강제**: `enforceSectorEnergyTopBlockConsistency` —
  promotionAllowed=false → `SECTOR_OFFICIAL_PROMOTION_DISABLED` 포함, true → 제거.
  `SECTOR_OFFICIAL_PROMOTION_DISABLED` + strongBuyAllowed=true 동시 존재 금지(가드 throw).

## Behavior change & byte-equivalent

- **LIVE 주문 본체 0줄 변경.** `executionImpact` 는 항상 `NONE`. KIS/KRX quota 0 침범.
- canonical 의 verified count 는 ADR-0488 의 공식 verified coverage 를 11 denominator 로 재기준하되,
  80% 경계에서 `master.promotionAllowed` 와 일치하도록 보정 — 기존 LIVE promotion 판단 byte-equivalent 보존.
- 변경 대상은 진단/표시 surface(텔레그램 렌더·TopBlocks)와 단일 SSOT 도입. ENV 롤백 불요(신규 순수 모듈 + 표시 wiring).

## ADR-0146 PR 자가 review (5 카테고리)

1. **LIVE 매매 안전성** — 매매 본체 0줄. executionImpact=NONE. KIS/KRX quota 미사용. 회귀 테스트 추가(아래).
2. **wiring 완료 vs 인프라만** — resolver(인프라) + ADR-0488 carry + TopBlocks read + 렌더러 3블록 = wiring 완료.
3. **ADR 발급 무결성** — INDEX 다음 발급 0534 사용, 발급 직후 INDEX·patch-history 갱신.
4. **회귀 테스트 적정성** — Test 1~10 + Invariant 1~9(`SectorEnergyCanonicalResolver.test.ts`),
   기존 ADR-0488/Gate2/TopBlocks/scan_blockers 테스트 무회귀 확인.
5. **정책 위반 baseline 무회귀** — `validate:all` 통과(SDS/responsibility/complexity/boundary 등).

## Consequences

- (+) SectorEnergy 기준 논쟁 종료 — 단일 SSOT(공식 11개 coverage)로 고정. renderer/source conflict 제거.
- (+) 조선/방산/원자력/이차전지 의 공식 편입 차단을 타입·정책으로 강제.
- (−) ADR-0488 master 의 자체 promotion 필드는 당분간 진단으로 잔존(후속 PR 에서 내부 계산 제거 가능).
- 후속: Gate2/Grouped/Runtime audit 내부 자체 계산 로직의 점진적 제거(본 PR 은 단일 read + 표시 고정에 집중).
