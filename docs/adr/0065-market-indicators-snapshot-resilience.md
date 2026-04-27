# ADR-0065: /api/market-indicators disk snapshot 영속화 + stale fallback (PR-γ, ADR-0065)

**상태**: Accepted
**날짜**: 2026-04-27
**관련**: ADR-0009 (외부 호출 예산 — LRU 캐시), ADR-0010 (외부 호출 강화 — coalescing), ADR-0058 (EgressGuard IntentTag), ADR-0061 (PR-α — Yahoo prefill overlay)

---

## 1. 배경

`server/routes/marketDataRouter.ts:358-440` (PR-γ 이전) 의 `/market-indicators` 핸들러가 9개 Yahoo 호출을 `Promise.allSettled` 로 병렬 실행한 뒤 *실패한 필드는 그대로 null 응답* 하던 구조.

```
const [vixR, us10yR, irxR, samsungR, vkospiR, ks11R, kq11R, ewyR, mtumR] = await Promise.allSettled([...]);
res.json({
  vix: getPrice(vixR),  // null 가능
  ...
});
```

### 1.1 사용자 보고 회귀

> "장중에 VKOSPI 가 잠깐 실패했다가 다음 호출엔 성공하면, 화면값이 '—' → '18.3' → '—' → '17.9' 로 출렁입니다."

원인: 단일 필드 일시 실패 (Yahoo 503 / 네트워크 timeout / EgressGuard 차단) 가 즉시 UI 의 "—" 표시로 이어지고, 다음 호출 성공 시 다시 값이 들어와 flicker 발생. snapshot 영속화는 `/historical-data` 에만 적용 (ADR-0009 LRU + 디스크 영속) 되어 있고 `/market-indicators` 에는 *전무*.

### 1.2 추가 회귀

서버 재배포 직후 9개 필드 모두 처음 한 번 fetch 실패하면 모든 화면이 빈 상태로 표시.

---

## 2. 결정

11 필드 (vix / us10yYield / usShortRate / samsungIri / vkospi / vkospiDayChange / vkospi5dTrend / kospi / kosdaq / ewyReturn / mtumReturn) 별 last-known-good 값을 디스크에 영속하고, 일시 실패 시 stale fallback 으로 채워 응답한다.

### 2.1 신규 모듈 — `server/persistence/marketIndicatorsSnapshotRepo.ts`

- `MARKET_INDICATOR_FIELDS` SSOT 11 필드 키 (응답 스키마와 1:1 정합 — 회귀 테스트가 검증).
- `loadMarketIndicatorsSnapshot()` — 빈 객체 / 손상 JSON / null / array 모두 빈 객체 fallback.
- `saveMarketIndicatorsSnapshot(snapshot)` — atomic write (tmp → rename), 부분 쓰기 race 시 이전 정상 본 보존.
- `mergeFreshIntoSnapshot(current, fresh, capturedAt)` — 성공 필드만 갱신, NaN/Infinity/음수 가격 무시, null 필드는 last-known-good 보존. 새 객체 반환 (부수효과 없음).
- `fillMissingFromSnapshot(fresh, snapshot)` — null 필드를 snapshot 값으로 fill + `staleFields[]` 반환.

### 2.2 라우터 wiring

`/market-indicators` 핸들러 본체:
1. 9개 Yahoo 호출 → fresh 객체 11 필드 추출 (기존 동작 유지).
2. `loadMarketIndicatorsSnapshot()` → 디스크 영속 last-known-good 로드.
3. `fillMissingFromSnapshot(fresh, current)` → null 필드 채움 + staleFields 누적.
4. `mergeFreshIntoSnapshot(current, fresh, capturedAt)` → 성공 필드만 snapshot 갱신.
5. `saveMarketIndicatorsSnapshot(merged)` → atomic write.
6. `staleFields.length > 0` 시 `X-Field-Stale: vix,us10yYield,...` 헤더 부착.
7. snapshot I/O throw 시 fresh 그대로 반환 (graceful baseline = PR-γ 이전 동작).

### 2.3 X-Field-Stale 헤더 정책

stale 필드 이름을 콤마 구분 문자열로 응답 헤더에 노출. UI / 운영자가 어느 필드가 last-known-good 인지 즉시 인지. 클라이언트 측 표기 강화 (배지 등) 는 후속 PR.

---

## 3. 효과

- **첫 부팅 후 재배포**: 디스크에 snapshot 영속되어 새 컨테이너에서 즉시 stale 값 복구. 9개 필드 모두 동시 실패 + snapshot 도 비어있는 매우 드문 케이스만 null.
- **장중 일시 실패**: 단일 필드 fetch 실패 시 snapshot 의 직전 정상 값으로 fill — UI flicker ('—' → '18.3' → '—') 영구 차단.
- **Yahoo 회로 차단**: 회로차단기 + 24h 블랙리스트 (PR-21/24) 가 fetch 자체를 차단하는 동안에도 snapshot 으로 응답 유지. 운영자는 X-Field-Stale 헤더로 인지.

---

## 4. 자동매매 영향

`/market-indicators` 호출자는 클라이언트 `fetchMarketIndicators` (`marketOverview.ts:7`) 가 거의 유일. 자동매매 경로 (signalScanner / autoTradeEngine / entryEngine) 는 macroState (서버 측 다른 SSOT) 를 사용. 본 PR 의 응답 형식은 stale fill 만 추가 — 기존 9개 필드 타입 그대로.

LIVE 매매 본체 0줄 변경.

---

## 5. 디스크 영속 정책

- **파일**: `data/market-indicators-snapshot.json` (Railway Volume 마운트)
- **갱신**: 매 `/market-indicators` 요청마다 (성공 필드만)
- **TTL**: 없음 — last-known-good 무한 보존. 운영 데이터가 *아주 오래된 stale* 을 사용할 위험은 X-Field-Stale 헤더로 운영자에게 노출.
- **손상 복구**: 손상 JSON 감지 시 빈 객체 fallback → 다음 정상 fetch 가 자동 복구.
- **atomic write**: tmp → rename 패턴 — 동시 갱신 race 시 이전 정상 본 보존.

---

## 6. 회귀 위험

- **stale 값이 너무 오래 살아남음**: 본 PR 은 TTL 없음. 만약 Yahoo 가 영구 차단되면 1주일 전 값이 그대로 노출될 수 있음. 완화: X-Field-Stale 헤더 + 운영자가 `pipelineDiagnosis` (PR-26 ADR-0056) 로 Yahoo health 모니터링. 추가 완화 (TTL / "오래된 stale 경고") 는 후속 PR.
- **디스크 I/O 비용**: 매 요청마다 atomic write — `data/market-indicators-snapshot.json` 가 ~1KB 라 무시할 수준. debounce 미적용 (간단함 우선).
- **kospi/kosdaq quote 객체 검증**: snapshot 에 잘못된 quote 가 박제되면 응답에 그대로 노출. mergeFreshIntoSnapshot 진입 시 `price > 0 && Number.isFinite` 가드로 차단.

---

## 7. 후속 PR

- **클라이언트 stale 표기**: `fetchMarketIndicators` 가 X-Field-Stale 헤더 read + UI 배지로 노출.
- **TTL + 운영자 경고**: stale 값이 24h 이상 박제된 경우 텔레그램 운영자 알림.
- **ECOS/FRED 거시지표**: PR-α 의 후속으로 `interestRates` / `macroIndicators` (한국 3년물 / CPI / PCE / 실업률) 도 동일 snapshot 패턴으로 disk 영속화.

---

## 8. 테스트

- `server/persistence/marketIndicatorsSnapshotRepo.test.ts` (14 케이스)
  - SSOT: 11 필드 키 정합 (응답 스키마와 1:1)
  - load/save: 빈 파일 / round-trip / 손상 JSON fallback / null·array 직접 저장 가드
  - mergeFreshIntoSnapshot: 빈 snapshot 첫 갱신 / null 필드 보존 / NaN+Infinity 무시 / kospi quote price≤0+NaN 무시 / updatedAt 동기화
  - fillMissingFromSnapshot: snapshot 부재 + null 그대로 / snapshot 있을 때 fill+staleFields / 성공 필드는 fresh 그대로 / 모든 11 필드 stale

- 라우터 통합 테스트는 supertest + fetch mocking 부담이 커서 본 PR 에선 단위 테스트 + lint/tsc 로 검증. 기존 `marketDataRouter.{coalescing,proxyCache,marketGate}.test.ts` 패턴 (export 표면 lock) 과 일관.
