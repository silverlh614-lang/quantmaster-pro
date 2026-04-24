# ADR 0004 — Yahoo ADR 역산 폐기 · KIS 전일종가 기반 Overnight Gap Probe 도입

- **상태**: Accepted
- **제안일**: 2026-04-24
- **담당 에이전트**: `architect` (설계) · `engine-dev` (구현) · `quality-guard` (회귀)

## Context

운영 중 텔레그램 장전 브리핑에서 ADR 기반 이론시가 역산이 비현실적 괴리율을
출력하는 사건이 반복 발생.

### 실측 오탐 사례 (2026-04-24 08:35 KST)

| 종목 | KRX 종가 | ADR 역산 이론시가 | 괴리율 |
|------|---------|------------------|-------:|
| SK텔레콤 (SKM) | 98,800원 | 6,234원 | **-93.69%** |
| POSCO홀딩스 (PKX) | 410,500원 | 100,841원 | **-75.43%** |
| 삼성전자 (SSNLF) | 224,500원 | 96,378원 | -57.07% |
| LG디스플레이 (LPL) | 13,250원 | 12,651원 | -4.52% |

### 근본 원인

1. **PKX**: 2015년 NYSE 상장폐지 후 Yahoo가 **화석 종가** 반환 (현재 거래 없음).
2. **SSNLF**: 독일 OTC 호가만 존재, 일간 거래량 수백 주 수준의 가격 왜곡.
3. **SKM**: `adrRatio = 1/9` 같은 소수 반올림이 $37.96 × 1,478 × 1/9 계산에서
   오차가 누적되어 이론시가를 왜곡.
4. **공통**: Yahoo의 `close` 필드만 사용하며 `adjClose` 미사용 — 액면분할·
   무상증자가 일어나도 조정 전 가격으로 환산.
5. **유동성 판정 부재**: 호가 스프레드·거래량을 보지 않고 모든 ADR 심볼을 동등 처리.

## Decision

### 1. `server/alerts/adrGapCalculator.ts` — 완전 비활성

- Export 되는 모든 공개 API 가 **즉시 빈 결과/null** 을 반환하도록 stub 화.
- 함수 시그니처는 유지(호출처 유지보수를 위해) 하되 내부는 단일 early return.
- 파일 상단에 `@deprecated ADR-0004` 주석 + 본 ADR 링크.
- 파일 자체 삭제는 하지 않는다 — 호출처(스케줄러·텔레그램 브리핑)가 존재하므로
  다음 PR 에서 호출처 제거 후에 삭제.

### 2. 대체 구현 — `preMarketGapProbe` (KIS 전일종가 기반)

경계:
- KIS API 호출은 반드시 `server/clients/kisClient.ts` 경유 (CLAUDE.md 절대 규칙 #2).
- 새 함수 `fetchKisPrevClose(stockCode): Promise<PrevClose | null>` 를
  `kisClient.ts` 에 추가 — 다른 모듈은 이 함수만 사용.
- `PrevClose` 는 `{ stockCode, prevClose, tradingDate, fetchedAt }` 최소 스키마.

갭 계산:
- 기준가 = **KIS 전일종가** (dataFreshness 확인: `tradingDate` 가 오늘보다 2영업일
  이상 오래되면 stale 처리).
- 비교가 = 장전에는 워치리스트 진입가, 장 시작 후에는 당일 시가.
- **Gap 임계**:
  - `< 2%`: 정상, 주문 진행
  - `2% ~ 30%`: 주의, 경보 발송 + 주문 진행
  - `≥ 30%`: **데이터 오류로 분류**, 주문 스킵 + `skipReason = DATA_ERROR` 기록
  - 기준가 조회 실패: preMarket 경로 전체 스킵(안전 우선)

### 3. 갭 계산의 경계

- 갭 계산 유틸은 **`server/trading/preMarketGapProbe.ts` 신규 파일** 에 배치.
- `tradingOrchestrator.ts` 의 기존 인라인 갭 계산(68행) 제거 후 probe 호출.
- `adrGapCalculator.ts` 의 공개 함수는 이 probe 를 호출하지 않는다 — 완전히 분리.

### 4. 폴백 정책

| 상황 | 동작 |
|------|------|
| KIS 전일종가 API 200 정상 | probe 결과로 갭 판정 |
| KIS 4xx/5xx (심볼 없음 등) | 해당 종목만 스킵, 워치리스트 유지 |
| KIS 연속 실패 (서킷 오픈) | preMarket 루프 전체 중단 + Telegram 경보 |
| stale (2영업일 초과) | 해당 종목만 스킵, `skipReason = STALE_PREV_CLOSE` |

### 5. 재활성 조건 (향후 Yahoo 복귀 시)

Yahoo ADR 역산을 다시 활성화하려면 아래를 모두 충족해야 한다:
- ADR 심볼 유동성 필터 (일 거래대금 $100K 이상, 5영업일 평균).
- `adjClose` 기반 계산.
- `corporateActions` 테이블(액면분할·배당) 참조.
- 오차 ±5% 이내 지속 4주 검증.

이 조건 미충족 시 본 ADR 의 "완전 비활성" 상태를 유지한다.

## Consequences

### 긍정
- 장전 브리핑에서 현실 가격과 괴리된 이론시가 노출 제거 → 오판 주문 차단.
- 외부 의존성 축소 (Yahoo OTC → KIS 단일 소스).
- 경계 단순화: 가격 소스가 kisClient 하나.

### 부정
- 미국 프리마켓 기반 한국 종목 조기 경보 기능 일시 상실 → 장전 리스크 감지가
  08:30 KST 장 시작 직후로 지연.
- 재활성 조건 충족 전까지 해당 채널 부재.

## Migration Plan

### 본 PR (PR-1)
1. `adrGapCalculator.ts` 내부 stub 화 + `@deprecated` 주석.
2. `fetchKisPrevClose` 를 `kisClient.ts` 에 추가.
3. `preMarketGapProbe.ts` 신규.
4. `tradingOrchestrator.ts:68` 갭 계산 probe 호출로 교체.
5. 30% 이상 갭 → `skipReason = DATA_ERROR` 기록 로직 추가.

### 후속 PR
- `adrGapCalculator.ts` 호출처(스케줄러·브리핑 generator) 제거.
- 모듈 물리적 삭제.
- Yahoo 재활성 PoC (재활성 조건 검증).

## Alternatives Considered

### A. Yahoo 심볼 화이트리스트
- 장점: 기존 코드 유지 가능.
- 단점: 유동성은 시시각각 변함 → 지속 관리 비용. 재발 가능.

### B. Yahoo + DART 혼합
- 장점: DART 공시가 액션을 반영.
- 단점: DART 는 미국 프리마켓 가격 미보유. 갭 계산 본질 해결 안 됨.

### C. 본 결정 (KIS 전용)
- 장점: 단일 소스, 유동성/상장폐지 자동 배제 (KIS 에 없으면 한국 상장 종목 아님).
- 단점: 미국 프리마켓 신호 상실.

## References

- CLAUDE.md — "kisClient 단일 통로" 절대 규칙
- ARCHITECTURE.md — `server/clients/kisClient.ts` 경계
- `server/alerts/adrGapCalculator.ts` — 폐기 대상
- `server/clients/kisClient.ts` — `fetchKisPrevClose` 추가 지점

## Scope Clarification (PR-4 추가 분석)

본 ADR 은 **US OTC ADR 역산 경로 전체**를 폐기한다. 코드베이스에 남아 있는
`fetchYahooQuote('{code}.KS')` / `.KQ` 호출(예: `reportGenerator`,
`stockPickReporter`, `intradayScanner`, `universeScanner`, `prefetchedContext`,
`shadowDataGate`)은 **KOSPI/KOSDAQ 도메스틱 시세** 로 본 ADR 의 데이터 품질
문제와는 별개 데이터 소스다.

도메스틱 Yahoo 는 아래 한계를 가지지만 본 ADR 범위 밖이다:
- 무료 티어 15~20분 지연 (KIS 실시간 대비)
- 공휴일·장 마감 후 데이터 갱신 시점 편차
- OHLCV 기반 지표(RSI/MACD/ATR/compressionScore) 계산은 Yahoo 가 여전히 주 소스

**후속 과제 (별도 PR)**: KIS 일봉(FHKST03010100) + `src/utils/indicators.ts` 조합
으로 `YahooQuoteExtended` 를 대체 구현하면 도메스틱 Yahoo 의존도 추가 감소
가능. 단, 지표 일관성·레거시 캐시 무효화·테스트 스위트 갱신 비용으로
본 ADR 에 묶지 않는다.
