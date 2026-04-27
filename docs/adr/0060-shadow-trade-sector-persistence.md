# ADR-0060: Shadow Trade 결정적 섹터 라벨 영속 + Correlation Guard / UI 매칭 양방향 fallback

## 상태
Accepted (2026-04-27)

## 배경

운영자 보고 3건이 동일 근본 원인을 가리킨 사건이 발생했다.

1. **HRS 매수 후 섹터 집중도가 미표시** — 동일 조선 섹터에 추가 매수가 차단되지 않고 진행됨.
2. **SOXX 글로벌 모멘텀 상승에도 반도체 종목이 워치리스트에서 미선택** — UI Drilldown 이 빈 결과만 노출.
3. **전반적 섹터 집중 감지 미작동** — sectorConcentrationGate 가 0 카운트만 반환.

기존 코드 audit 결과 **5중 누수** 확인:

- `ServerShadowTrade` 영속 레코드에 `sector` 필드 부재 — 매수 시점 섹터 라벨이 어디에도 박제되지 않음.
- `buildBuyTrade` 가 4개 매수 경로 (perSymbolEvaluation 4 위치 + shadowRouter 직접 리터럴 1건) 의 SSOT 임에도 sector 채움 코드 부재.
- `sectorConcentrationGate` 가 `stock.sector` 만 비교하고 부재 시 fallback 미적용 — 워치리스트 직접 입력 종목과 신규 lookup 필요 종목의 비대칭.
- 기존 영속 레코드 (sector 부재) 의 마이그레이션 정책 부재.
- UI `stockMatchesSector` 가 `relatedSectors` (AI 다중 라벨) 만 검사 — ShadowTrade-shaped 객체는 자연스럽게 매칭 0건.

## 결정

### 1. ServerShadowTrade.sector 단일 옵셔널 필드
`server/persistence/shadowTradeRepo.ts` 의 `ServerShadowTrade` 에 `sector?: string` 추가. **결정적 SSOT 박제값** — `getSectorByCode(stockCode)` 결과만 저장. AI 다중 라벨(`relatedSectors`) 추가 안 함 (server 측은 단일 라벨만 보존).

### 2. buildBuyTrade 단일 wiring 지점
`server/trading/buyPipeline.ts:188 buildBuyTrade` 가 4개 매수 경로 SSOT 이므로 본 함수 내부에서만 `sector: getSectorByCode(p.stockCode) || undefined` 호출. 호출자 무수정. `shadowRouter.ts:47` 직접 리터럴 1건은 별도 wiring.

### 3. loadShadowTrades lazy 백필
영속 레코드 마이그레이션은 **백필 정책** 채택 — `loadShadowTrades()` 진입부에서 `if (!t.sector) t.sector = getSectorByCode(t.stockCode) || undefined`. `sectorMap` 인메모리 lookup 이라 KIS/KRX quota 0. "신규부터만" 정책은 sectorConcentrationGate 효과를 약화시키므로 거부.

### 4. 게이트 fallback (sectorPreGuardGate 패턴 차용)
`sectorConcentrationGate` 의 `stock.sector` 와 `watchlist[].sector` 모두 부재 시 `getSectorByCode(code)` fallback 적용 — 대칭성 보장. 기존 진입 결정 로직 무변경, fallback 만 추가.

### 5. UI 양방향 매칭
`stockMatchesSector` 우선순위: `relatedSectors` 매칭 (AI 다중 라벨 풍부) → 없거나 불일치 시 `sector` 단일 필드 fallback. ShadowTrade-shaped 객체는 자연스럽게 fallback 만 사용. `SectorStocksDrilldown` 은 활성 shadow trade (PENDING/ACTIVE) 를 추가 source 로 통합 — `mapShadowsToCardLike` 헬퍼로 normalize 후 `filterStocksBySector` dedupe (code 기준).

## 결과

### Boundary Rules 추가 (ARCHITECTURE.md 명문화)
1. **ServerShadowTrade.sector 박제 SSOT**: `ServerShadowTrade.sector` 는 `getSectorByCode` 결과만 저장한다. 다른 source (사용자 입력 / AI 추론 / 외부 API) 금지.
2. **게이트 fallback 패턴 통일**: `sectorConcentrationGate` 와 `sectorPreGuardGate` 는 `stock.sector` 부재 시 `getSectorByCode(code)` fallback 후 비교한다. `watchlist[].sector` 도 동일 패턴 (대칭성).
3. **UI 양방향 매칭**: `stockMatchesSector` 는 `relatedSectors` 우선, `sector` 단일 필드 fallback. ShadowTrade-shaped 객체와 StockRecommendation 양쪽 매칭 보존.

### 회귀 영향
- LIVE 매매 본체 0줄 변경 — `buildBuyTrade` 반환 객체의 옵셔널 필드만 추가.
- KIS/KRX quota 0 침범 — `sectorMap` 은 인메모리 lookup.
- 19 신규 회귀 테스트 케이스 (서버 12 + 클라 7).
- 백필 mutate 부수효과는 saveShadowTrades 직렬화 시점에 자연 영속 (다음 변경 발생 시).

### 잔여 운영 안내
`data/krx-sector-map.json` 파일 부재 환경에서는 `getSectorByCode` 가 모두 null 반환 → 본 PR 의 모든 gate / UI 매칭이 자연 fallback 으로 빈 결과 / pass 처리되어 **회귀 위험 0**. 정상 동작을 위해서는 `npx tsx scripts/updateSectorMap.ts` 실행으로 sectorMap 갱신 권장 (P0 별도, 본 PR scope 밖).

## 참고
- ADR-0030/0031 (signalScanner Phase B EntryGate / RevalidationStep)
- PR-K (`SectorStocksDrilldown` UI) 와 본 PR 의 Drilldown 확장.
