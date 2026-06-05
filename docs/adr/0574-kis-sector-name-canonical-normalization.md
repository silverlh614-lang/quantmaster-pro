# ADR-0574: kis sector name canonical normalization

@responsibility quant — kis sector name canonical normalization

## Status

Accepted

## Context

KIS 공식 섹터 에너지(`kisSectorEnergyProvider`)를 Gate2 SECTOR_LEADERSHIP 축의 데이터
소스로 활성화(`KIS_SECTOR_INDEX_DAILY_ENABLED`)하기 전 taxonomy 정합을 감사했다.

- 축 매칭은 `getSectorEnergyScore(sectorEnergyResult, sector)` 가
  `scores[].name === sector` 로 찾는데, `sector` 는 canonical(ADR-0571
  `KRX_SECTOR_CANONICAL` = src/types/sectorEnergy.ts `KrxSectorName` 12종).
- **공식 인덱스 경로**(SECTOR_INDEX_MASTER, sectorEnergyMaster.ts)의 displayName 은
  이미 canonical('반도체'/'이차전지'/'바이오/헬스케어'/'에너지/화학'/'건설/부동산'/
  '유통/소비재' …) — 정합 OK(철강·기타만 예외, canonical 후보 없음).
- **그러나 basket fallback**(`KIS_SECTOR_BASKET_DEFINITIONS`, 공식 인덱스 미가용 시
  대표주 바스켓 합성)의 displayName 은 단축형('2차전지'/'바이오'/'화학'/'건설'/'유통'/
  '원자력')이라 canonical 과 불일치 → 활성 시 그 경로에선 축·섹터 boost 가
  `scores[].name` 을 못 찾는다.

즉 공식 인덱스가 떠 있으면 매칭되지만, 공식 인덱스 실패→basket fallback 시 섹터명이
어긋나 SECTOR_LEADERSHIP 가 다시 MISSING 이 되는 잔여 리스크.

## Decision

KIS provider 가 생산하는 `SectorEnergyInput.name` 을 sectorKey 기준으로 canonical 로
정규화한다(`KIS_SECTOR_NAME_CANONICAL_ENABLED`, default OFF).

- `KIS_SECTOR_KEY_TO_CANONICAL`: sectorKey→canonical 명시 맵(BATTERY→이차전지,
  BIO_HEALTHCARE→바이오/헬스케어, CHEMICAL→에너지/화학, CONSTRUCTION→건설/부동산,
  CONSUMER_RETAIL→유통/소비재, NUCLEAR→방산 …). **STEEL·OTHER 는 미매핑** — STEEL 을
  '에너지/화학' 으로 접으면 CHEMICAL 과 `scores` 충돌하므로 '철강' 유지(철강 후보는
  canonical 상 CHEMICAL 의 '에너지/화학' 점수에 귀속).
- 적용: `inputFromOfficialRow`(공식, 대개 no-op — master 이미 canonical) +
  `inputFromMetrics`(basket, 실질 정규화). 단일 헬퍼 `kisSectorInputName(sectorKey, fallback)`.
- 미매핑 sectorKey 는 fallback displayName 유지(graceful).

## Consequences

- **default OFF = byte-identical**: KIS provider 출력명 불변(기존 25 테스트 유지).
  ON 시에만 정규화. 회귀 테스트(kisSectorEnergyProvider.test: basket OFF '2차전지'/'바이오'/
  '화학' → ON '이차전지'/'바이오/헬스케어'/'에너지/화학', STEEL '철강' 유지).
- **ON 시**: KIS basket 경로 섹터명이 canonical 이 되어 Gate2 축·섹터 boost/cap 과 매칭.
  공식 인덱스 경로는 이미 canonical 이라 영향 미미(no-op 방어선).
- **활성화 번들**(Sector 0/25 종단 해소): `SECTOR_ENERGY_GATE2_WIRING_ENABLED`(L1+L2 축/라벨)
  + `KIS_SECTOR_INDEX_DAILY_ENABLED`(L3 KIS 데이터) + `KIS_SECTOR_NAME_CANONICAL_ENABLED`
  (basket fallback 정합). 운영자 flag·장중 검증.
- 외부 진행작(ADR-0570 SECTOR_INDEX_CYCLE returns 배선, ADR-0571 라벨 producer)과 직교 —
  본 ADR 은 *이름* 정합만, default OFF 라 충돌 0.

## Guardrails

- No live trading path change while flag OFF (default).
- **Sector data naming change is flag-gated**: ON 시 KIS basket 섹터명만 canonical 로 정규화
  (섹터 boost/cap/축 매칭 일관성 ↑). 공식 인덱스 master·KRX provider 무변경.
- No KIS/order import added — 기존 KIS provider 출력 가공만, 신규 fetch 0.
- No provider fetch behavior change.
- No data promotion behavior change.
