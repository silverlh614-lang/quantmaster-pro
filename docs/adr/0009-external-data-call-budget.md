# ADR-0009 — 외부 데이터 호출 예산·캐싱 정책

- **Status**: Accepted (2026-04-24, PR-23)
- **Supersedes**: 없음 (ADR-0004 Yahoo ADR 비활성 정책을 좁힌 후속)
- **Owners**: architect, engine-dev

## 문제 정의

Railway 운영 로그와 사용자 이미지 증거 기준으로, 다음 3개 외부 의존이 동시에 **과호출 + 실패 누적** 상태였다.

1. **KIS 랭킹 TR (FHPST01710000 등)** — 장 종료 후(19:55~20:00 KST) 매 분 404 누적.
   - 원인: 랭킹 API 는 장중 전용이며, KIS 서버는 장외에 해당 TR 을 "not found" 로 응답한다.
   - PR-21 의 소프트 회로(10회/2분)가 파손을 완화하긴 했으나 **호출 자체를 막지 않으므로**
     404 로그 폭증 + 회로차단기 쿨다운이 반복됨.
2. **KRX 공개 통계 (MDCSTAT02203 투자자별 거래 / MDCSTAT03501 PER·PBR)** — 매 호출 HTTP 400.
   - 원인: KRX 공개 엔드포인트는 "오늘 날짜" 요청에 대해 통계 확정 전(일반적으로 18:00 KST 전)
     400 을 반환. 또한 `fetchPerPbr`, `fetchInvestorTrading` 은 호출 시점마다 `todayKstYYYYMMDD()`
     를 기본값으로 사용하여 **매 호출이 신선한 400** 을 발생시킨다.
3. **Yahoo Finance 프록시 과호출** — `server/routes/marketDataRouter.ts` 프록시가
   클라이언트 폴링(`useStockSync`, 5분 주기) 에 걸려 같은 심볼을 분당 수 회 반복 호출.
   - IP 블랙리스트 누적 위험 (사용자 직접 보고).

사용자 의견(원문 축약): **"KIS·KRX API 끌어오는 방식이 근본적으로 문제가 있고, Yahoo 도
ping 이 너무 많다 — 장외에는 아예 외부 호출을 줄이는 쪽으로 가야 한다."**

## 결정

외부 소스별 **호출 예산(budget)** 과 **서버 캐시 TTL** 을 고정하고, 호출 경로 앞단에
`isMarketOpen()` 게이트를 두어 **장외 시간에는 새 호출을 시도하지 않는다**. 대신 캐시에 남은
마지막 성공 스냅샷을 서빙한다.

### 1. 시장 시간 SSOT

`server/utils/marketClock.ts` (신규) 가 서버 측 단일 SSOT.
- `isMarketOpen(now)` — KST 09:00~15:30 평일. (기존 `src/utils/marketTime.ts` 와 동일 구현, 서버용 분리)
- `isMarketDataPublished(now)` — KRX 일간 통계 확정 시각(18:00 KST) 이후인지.
- 환경 override: `DATA_FETCH_FORCE_MARKET=true` (e2e 테스트), `DATA_FETCH_FORCE_OFF=true` (런북).

### 2. 소스별 정책

| 소스 | 장중(09:00~15:30 KST) | 장외 (주말/평일 외) | 캐시 TTL |
|------|----------------------|---------------------|----------|
| **KIS 랭킹 TR** (`FHPST017*`, `FHPST01600000` 등) | 정상 호출 | **호출 금지**, 캐시 반환. 캐시 miss 시 `[]` 반환 | 10 분 (장중), 다음 개장 9:00 까지 유지 (장외) |
| **KIS 현재가/체결** (`FHKST01010100`, `FHKST01020100`) | 정상 호출 | 호출 허용 (사용자 액션 기반), 소프트 404 만 카운트 | 60 초 |
| **KIS 일봉** (`FHKST03010100`) | 정상 호출 | 당일 마감 데이터 재호출 불필요 — 캐시 사용 | 1 시간 (장중), 24 시간 (장외) |
| **KRX 공개 MDCSTAT** (`MDCSTAT02203`, `MDCSTAT03501`, `MDCSTAT30001`) | **`isMarketDataPublished=true` 인 경우에만** 호출 | **호출 금지**, 캐시 반환 | 60 분 |
| **KRX Open API 인증** (`/svc/apis/...`) | 정상 호출 (할당량 내) | `isMarketDataPublished=true` 인 경우에만 | 60 분 |
| **Yahoo Finance** (`query1/2.finance.yahoo.com`) | 호출 허용, **서버 응답 캐시 필수** | **호출 최소화** — 갱신 주기 ≥ 30 분 | intraday 5 분, daily 1 시간, EOD 12 시간 |
| **Gemini** (reflection/screening) | 스케줄 cron 에서만 | 허용 | 호출자별 |

### 3. 구현 훅

- **서버 공용 marketClock**: `server/utils/marketClock.ts` 신설.
- **KIS 랭킹 게이트**: `kisRankingClient.getRanking()` 진입부에서 `isMarketOpen()` 체크 →
  장외면 기존 캐시만 반환, 신규 fetch 스킵.
- **KRX 게이트**: `krxClient.fetchInvestorTrading` / `fetchPerPbr` / `fetchShortBalance` 진입부에서
  `isMarketDataPublished()` 체크 + 최근 성공 캐시로 fallback.
- **Yahoo 프록시 캐시**: `server/routes/marketDataRouter.ts` 의 `/api/market-data/proxy` 앞단에
  in-process LRU 캐시 (TTL 5분) 추가. 동일 URL 중복 호출 coalescing.
- **클라 폴링 완화**: `useStockSync.ts` 의 5 분 주기를 장외에는 15 분으로, 장중에는 유지.
- **Gemini reflection 교정**: `reflectionGemini.ts` 가 `prependPersona: false`,
  `stripPreamble: false`, `maxOutputTokens: 4096` 을 전달 → JSON 파싱 실패율 하락.

### 4. 예산 모니터링

- 각 게이트에는 "스킵 사유" 를 debug 로그로 1 회 / 1 분 out 한다 — 과도한 로그 스팸 방지.
- `GET /api/system/data-budget` (신규 소형 라우트) 로 다음을 노출:
  - `{ source, attempts, skips, cacheHits, errors }` — 마지막 24 시간.

## 기각된 대안

1. **Yahoo primary for off-hours** — 사용자 명시적 반대 ("Yahoo 핑도 너무 많다, 블랙리스트
   위험"). 소스 대체가 아니라 **총 호출량 감축** 이 목표.
2. **단순 회로차단기 강화** — PR-21 의 hard/soft 이원화는 이미 있다. 문제는 "호출이 애초에
   시도된다" 는 점. 회로가 닫히기 전 n 번의 호출 자체가 낭비이므로 **앞단 게이트** 가 본질.
3. **Redis 공용 캐시** — Railway 런타임에서 Redis 미운영. 인프로세스 LRU + 주기적 디스크
   스냅샷이면 현 규모(단일 서버) 에 충분. 다중 replica 시 재검토.

## 영향 범위

- `server/utils/marketClock.ts` (신규)
- `server/clients/kisRankingClient.ts` — 장외 게이트
- `server/clients/krxClient.ts` — 장외 + `isMarketDataPublished` 게이트
- `server/routes/marketDataRouter.ts` — Yahoo 프록시 LRU 캐시
- `server/learning/reflectionModules/reflectionGemini.ts` — Gemini opts 교정
- `src/hooks/useStockSync.ts` — 장외 폴링 완화
- `docs/incident-playbook.md` — "KIS 404 폭증 / KRX 400 폭증 / Yahoo 블랙리스트"
  섹션 추가(후속 PR).

## 검증 기준

- `npm run validate:all` 통과.
- 로컬 런에서 `DATA_FETCH_FORCE_OFF=true` 설정 시 KIS 랭킹/KRX 통계 호출 로그 0건 확인.
- Yahoo 프록시 동일 URL 2회 연속 GET 시 2번째는 캐시 hit (콘솔 로그 확인).
- Gemini reflection dry-run (`RUN_REFLECTION_NOW=true`) 에서 template fallback 이 아닌
  실제 JSON 응답으로 parse 성공.
