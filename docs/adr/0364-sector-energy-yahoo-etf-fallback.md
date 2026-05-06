# ADR-0364: KRX 미사용 sectorEnergy fallback — Yahoo 섹터 ETF (Phase 1)

**Status**: Accepted (Phase 1 — pure provider, 호출자 0건 dead code)
**Date**: 2026-05-06

## 배경

사용자 5/6 명시 + 14:12 KST [매수 차단 사유 분포] 메시지 보고 — KRX OpenAPI 외부 결함 (`reasons: todayIdx empty — KRX OpenAPI 응답 부재` + `dataQuality: FAILED` + `validSectorCount: 0/12`) 발생. ADR-0341 (휴장일 정합) + ADR-0342 (빈 응답 자동 재시도 max 5) + ADR-0343 (macroState 캐시 fallback) 3 layer 안전망에도 불구하고 KRX 자체 다운/장애 시 `sectorScoreBoost` 영구 비활성.

ADR-0343 의 캐시 fallback 은 *과거 데이터* (48h 이내) 만 사용. 신선한 데이터를 *다른 출처* 에서 산출하는 4번째 안전망 필요.

## 결정

### Phase 1 (본 PR scope) — provider 만 (호출자 0건)

**적용**:
1. `server/clients/sectorEnergyFallbackProvider.ts` SSOT 신규
2. `KOREAN_SECTOR_ETFS` 매핑 — 12 섹터 → KRX 섹터 ETF 심볼 (사용자 spec 직접 등재)
3. `buildSectorEnergyFromYahooETF()` async 함수 — fetchDailyBars 12 회 병렬 호출
4. `safePctChange` SSOT 사용 — sanity 90% 위반 시 자동 skip (ADR-0117 정합)
5. ENV `SECTOR_ENERGY_ETF_FALLBACK_DISABLED=true` (default OFF) 우회

**보류 (후속 PR)**:
- 호출자 마이그레이션 — ADR-0343 wrapper 의 macroState 캐시 fallback 실패 시 본 모듈 호출 → 4중 안전망 (KRX → 재시도 5회 → macroState 48h → Yahoo ETF)
- volumeChangePct + foreignConcentration 보강 (ETF 거래량은 섹터 거래량과 다름 — Yahoo intraday + Naver Finance 혼합 필요)

### KOREAN_SECTOR_ETFS 매트릭스 SSOT

| 섹터 | ETF 심볼 |
|---|---|
| 반도체 | 091160.KS (KODEX 반도체) |
| 이차전지 | 305720.KS (KODEX 이차전지) |
| 바이오/헬스케어 | 244580.KS (KODEX 바이오) |
| 인터넷/플랫폼 | 364990.KS (메타버스) |
| 자동차 | 091180.KS (KODEX 자동차) |
| 조선 | 139260.KS (TIGER 조선) |
| 방산 | 449450.KS (PLUS K방산) |
| 금융 | 091170.KS (KODEX 은행) |
| 유통/소비재 | 266390.KS (KODEX 유통) |
| 건설/부동산 | 117700.KS (KODEX 건설) |
| 에너지/화학 | 139250.KS (TIGER 에너지화학) |
| 통신/유틸리티 | 098560.KS (TIGER 방송통신) |

향후 ETF 상장폐지/심볼 변경 시 본 매핑만 수정 — 호출자 무수정.

### 임계 SSOT

| 상수 | 값 | 의미 |
|---|---|---|
| `ETF_FALLBACK_RANGE` | `'1mo'` | Yahoo 일봉 range (≈ 21 거래일) |
| `ETF_FALLBACK_MIN_BARS` | 20 | 표본 임계 (4주 산출 신뢰도) |
| `ETF_FALLBACK_PARTIAL_THRESHOLD` | 8 | PARTIAL 임계 (≥8 PARTIAL / 1~7 STALE / 0 FAILED) |

### dataQuality 분기 SSOT

1. ENV DISABLED → `FAILED` + reasons[0] = ENV 마커
2. validCount ≥ 8 → `PARTIAL` (sectorScoreBoost ×0.5)
3. 0 < validCount < 8 → `STALE` (sectorScoreBoost ×0)
4. validCount = 0 → `FAILED` (sectorScoreBoost ×0)

## 안전 invariant

- LIVE 매매 본체 0줄 변경 (호출자 0건 dead code)
- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4 — Yahoo 만 사용, KRX 미사용)
- Yahoo 호출 — 12 ETF × 1회 (호출 부담 미미)
- 섹터별 try/catch 격리 — 1개 ETF 실패가 다른 섹터 차단 안 함
- safePctChange sanity 위반 자동 skip (stale base / 액면분할 의심)
- ENV `SECTOR_ENERGY_ETF_FALLBACK_DISABLED=true` 1줄 즉시 비활성
- 4중 안전망 마지막 layer — KRX 정상 시 본 함수 미호출 (호출자 wiring 후속 PR)

## 잘못된 해결 방법 영구 차단

1. **호출자 마이그레이션 본 PR 통합** — Phase 1 = dead code 정책. 회귀 위험 격리.
2. **volumeChangePct/foreignConcentration 본 PR 산출** — ETF 거래량은 섹터 거래량과 다름 (잘못된 데이터 입력). Phase 2 에서 Yahoo intraday + Naver Finance 혼합 필요.
3. **fetchDailyBars 외 직접 fetch** — marketDataRefresh SSOT 우회 (회로차단기/IP blacklist 우회 위험).
4. **safePctChange 미사용 직접 산출** — ADR-0117 sanity gate 우회 위험.
5. **dataQuality='OK' 반환** — Yahoo ETF 는 PARTIAL/STALE/FAILED 만 정합 (KRX 미사용 → OK 분기 부적합).
6. **KOREAN_SECTOR_ETFS 호출자 측 inline 정의** — drift 위험. SSOT 위임 의무.

## 후속 PR

### Phase 2 — 호출자 wiring
ADR-0343 의 `buildSectorEnergyInputsWithMetaWithFallback` wrapper 의 분기 확장:

```
result.dataQuality === 'FAILED'
  → macroState 캐시 (48h 이내) → STALE marker
    → 캐시 부재 또는 만료 → buildSectorEnergyFromYahooETF (ADR-0364)
      → ETF 도 모두 실패 → 원본 FAILED 그대로 반환
```

### Phase 3 — 거래량/외국인 보강
- volumeChangePct: Yahoo ETF 거래량 4주 변화율 (ETF 자체 거래량, 섹터 거래량 근사값)
- foreignConcentration: Naver Finance 외국인 보유율 (ADR-0140 인프라 재사용)

## 회귀 테스트

`sectorEnergyFallbackProviderAdr0364.test.ts` — SSOT 상수 6 + ENV 정확 비교 3 + 동작 매트릭스 12 (ENV / 12 섹터 정상 / 8 PARTIAL boundary / 7 STALE / 1 STALE / 0 FAILED / MIN_BARS boundary / sanity 위반 / throw 격리 / range 정합 / 심볼 매트릭스 / header reason) + 정적 grep 가드 5 = 26 케이스.
