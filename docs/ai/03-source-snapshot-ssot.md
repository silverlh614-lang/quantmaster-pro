# 03 · SourceSnapshot SSOT (단일 진실 출처·provider 우회 금지)

**Read this file only when working on:**
- SourceSnapshot 을 읽거나 채우는 경로 · Gate 평가 입력 전달
- providerIssue · marketSignal · confidence · ExecutionPermission 의 데이터-측 의미
- 호출자가 provider 를 직접 조회(우회)하려 할 때 (불변식 #9)
- stockService / aiUniverseService 데이터 페칭 단일 통로
- carry wiring (시장/종목 프로그램매매 · 섹터 분류) 정밀화

**Do not read this file for:**
- engineMode/SELL_ONLY/R6 가 실행 권한을 어떻게 바꾸는가 → `02-trading-engine-rules.md`
- Gate 통과 판정·조건 가중치·scan_blockers → `04-gate-system.md`
- provider 장애 처리·회로차단기·fallback·L1~L4 운영 → `05-provider-policy.md`

---

## SourceSnapshot SSOT (불변식 #3)

**모든 판단은 단일 SourceSnapshot 에서 출발한다.** 가격·거래량·캔들·수급·매크로 등 모든 입력은
하나의 SourceSnapshot 으로 모인 뒤 Gate/사이징/진단으로 흐른다.

- 호출자가 provider 를 개별 조회하면 **drift** 발생 — 같은 종목이 경로마다 다른 데이터를 본다.
- carry wiring 은 SourceSnapshot 의 값을 candidate 단위로 전달만 한다. **새 외부 호출 0건** 이 원칙.
- carry payload 는 모두 `executionImpact: 'NONE'` + `providerIssue: false` + `marketSignal: false`
  literal type 으로 컴파일 타임 강제 — 데이터 결손이 failed / bearish signal 로 변환되지 않게 차단.

### carry wiring SSOT 패턴 (Patch-MARKET/PER-STOCK/SECTOR-CLASSIFICATION-CARRY)

| 영역 | SSOT 모듈 | ENV gate (default OFF) |
|------|-----------|------------------------|
| 시장 프로그램매매 4-필드 | `marketProgramCarryWiringPolicy.ts` | `MARKET_PROGRAM_CARRY_WIRING_DISABLED` |
| 종목별 프로그램 수급 | `perStockProgramFlowCarryWiringPolicy.ts` | `PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED` |
| 섹터 분류 (SectorKey 12-표준) | `sectorClassificationCarryWiringPolicy.ts` | `SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED` |

- 각 SSOT 는 `build*CarryPayload()` + `build*CarryMap()` (key-keyed O(1) lookup) + `is*Disabled()` ENV 헬퍼 제공.
- 호출자(`normalSupplyPreviewRunner.ts`)는 SSOT 위임 + try/catch 격리만 — inline object 직접 조립 금지.
- 섹터 분류는 `sectorEnergyMaster.ts:getSectorByAlias` SSOT 위임 (12-표준 SectorKey union 무수정).

---

## Gate 내부 provider 우회 금지 (불변식 #9)

**Gate 평가는 SourceSnapshot 입력만 사용한다.** Gate 내부에서 KIS/KRX/Yahoo 를 직접 fetch 하면 #3 위반.

- evaluator (`server/quant/conditions/`) 는 SourceSnapshot 의 필드만 읽는다.
- 데이터 부재 시 evaluator 는 `DATA_UNAVAILABLE` 반환 — `null` 로 silent fallback 금지 (ADR-0416).
  registry 가 `evaluator.inputs` 메타로 `requiredData`/`availableData`/`hadRequiredData` 자동 생성 (ADR-0418).
- 호출자(stockScreener)가 evaluator 별 데이터 knowledge 를 가지지 않게 — registry metadata 자동화.

---

## 자동매매·서버 스크리너 단일 통로 (절대 규칙 #3)

- **stockService 단일 통로** — 자동매매와 서버 스크리너의 외부 데이터(Yahoo/DART/Gemini/KIS 프록시/KRX)
  페칭은 `src/services/stockService.ts` 에서만 시작한다.
- **aiUniverseService 단일 통로 (ADR-0011)** — AI 종목 추천(MOMENTUM/QUANT_SCREEN/BEAR_SCREEN/EARLY_DETECT)
  universe 발굴·enrichment 는 `server/services/aiUniverseService.ts` 단일 통로만. KIS/KRX 직접 호출 금지.
  자동매매 경로는 본 모듈 import 금지.

### AI 추천 vs 자동매매 분리

- **AI 추천**: google_search + naver_finance + Yahoo OHLCV 만 사용 (KIS/KRX quota 미소비, ADR-0011 PR-25).
  5-Tier fallback (Google CSE → snapshot → 정량 후보 → Naver 단독 → seed, ADR-0016).
- **자동매매**: KIS·KRX 가 L1 데이터 원천. signalScanner / entryEngine / autoTradeEngine 전용.
- 두 경로의 데이터 출처를 절대 섞지 않는다 — AI 추천 호출이 KIS/KRX quota 를 소비하면 회로차단기 부담.

---

## stale / sanity 검증 (L3 fallback 안전)

- **safePctChange** (ADR-0028) — `((current - base) / base) * 100` 패턴의 stale base price + sanity bound
  단일 안전 헬퍼. 5종 가드 (분모/분자/결과 NaN·Infinity, ±90% sanity bound, null 반환 강제).
  `safePctChangeStrict` (ADR-0117) 는 거래 차단 게이트 — sanity 위반 시 entryEngine WAIT/DATA_HOLD 반환.
- **KRX 거래일 달력** (ADR-0190) — `isAcceptableKrxDailyBase` SSOT 로 휴장일 클러스터의 정상 base 를
  stale 로 오판하지 않게 한다. provider-측 데이터 품질 규칙이므로 상세 → `docs/ai/05-provider-policy.md`.

데이터 신뢰 등급(L1~L4)·provider 장애 처리 → `docs/ai/05-provider-policy.md`
Gate 시스템 상세 → `docs/ai/04-gate-system.md`
