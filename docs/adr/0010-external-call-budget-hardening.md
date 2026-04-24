# ADR-0010 — 외부 호출 예산 강화 (게이트 미들웨어 · 코얼레싱 · 영속 블랙리스트)

- **Status**: Accepted (2026-04-24, PR-24)
- **Extends**: ADR-0009 (외부 데이터 호출 예산·캐싱 정책)
- **Owners**: architect, engine-dev

## 문제 정의

ADR-0009 (PR-23) 가 호출 예산·LRU 캐시·marketClock SSOT 를 도입했으나, 운영 로그에서
다음 3개 잔존 문제가 확인됨.

1. **주말 KR 심볼 호출이 여전히 outbound 됨**
   - `marketDataRouter.ts` 의 `/historical-data` 엔드포인트는 `yahooProxyTtlMs` 가 장외 TTL ×3
     연장만 적용. **클라이언트가 주말에 새 심볼을 polling 하면 캐시 미스 → 새 outbound** 가 발생.
   - 주말에 한국 종목 시세는 변동이 없으므로 새 호출의 가치가 0.

2. **Yahoo 프록시 in-flight 중복 호출**
   - `useStockSync` 가 동일 (symbol, range, interval) 조합을 짧은 시간에 다중 컴포넌트에서
     쿼리할 경우, LRU 캐시 set 이전 ~수백 ms 윈도우에서 outbound 가 N 번 발생.
   - 같은 심볼 N 회 = outbound N 회. coalescing 부재.

3. **KIS 404 가 2 분 쿨다운 후 재카운트 누적**
   - PR-21 의 소프트 회로(10회/2분) 는 transient 404 보호엔 적합하나, **endpoint 영구 미지원**
     (예: KIS 가 장외에 랭킹 TR 자체를 404 로 응답) 에서는 2 분 쿨다운 만료 → 다시 10회 누적
     → 2 분 쿨다운 → 무한 반복.
   - 회로 상태가 메모리에만 살아 있어 **재배포 시 카운터가 모두 리셋**, 같은 죽은 엔드포인트를
     처음부터 다시 두드리기 시작.

## 결정

### 1. 주말 KR 게이트 미들웨어 (`marketDataRouter`)

`/historical-data` 진입 직후 가벼운 미들웨어로:
- KR 심볼 패턴(`.KS$|.KQ$|^\d{6}$`) **and** KST 주말 → 게이트 발동
- LRU 캐시 hit (TTL 무시) → `X-Cache: STALE-WEEKEND` 헤더 + 기존 body 반환
- 캐시 miss → 204 No Content (클라이언트는 비어있음으로 처리, 새 호출 없음)
- 그 외(US 심볼, 평일) → `next()` 통과

이 게이트는 `marketClock.isMarketOpen()` 과 **독립**:
- 평일 장외(15:30~다음날 09:00)는 기존 LRU TTL 정책으로 충분 (3× 연장 + 클라 폴링 15분)
- 주말은 KR 거래 자체가 없으므로 새 outbound 가치가 0 → 더 강한 차단

### 2. In-flight Request Coalescing (Yahoo 프록시)

`/historical-data` 의 `cacheKey = symbol:range:interval` 단위로 in-flight Promise Map.
- 동일 키에 대해 진행 중인 Promise 가 있으면 새 요청은 그 Promise 에 편승
- finally 에서 Map 에서 제거 → 다음 요청은 새 outbound 또는 캐시 hit
- 캐시 hit 경로는 그대로 유지 (in-flight 보다 우선)

효과: 동시성이 높을수록 outbound 가 1회로 수렴. `useStockSync` race 해소.

### 3. KIS 404 엔드포인트 영속 블랙리스트

`server/persistence/kisEndpointBlacklistRepo.ts` 신설.

**스키마**:
```ts
interface BlacklistEntry {
  trId: string;
  blockedUntil: number;     // epoch ms
  reason: '404_RECURRING';
  recentFailureCount: number; // 최근 30분 윈도우 내 404 수
  firstSeenAt: number;
  lastSeenAt: number;
}
```

**저장 위치**: `data/kis-endpoint-blacklist.json` (Railway Volume).

**판정 로직** (`_recordCircuitFailure` 의 404 분기에 추가):
- 30분 슬라이딩 윈도우 내 동일 trId 의 404 카운터 유지
- 윈도우 내 누적 10회 도달 시 24시간 블랙리스트 등록 + 영속화
- 블랙리스트 entry 가 살아 있는 동안 `_isCircuitOpen` 이 즉시 true 반환

**부팅 wiring** (`server/index.ts`):
- `loadKisEndpointBlacklist()` 호출 후 만료 안 된 entry 만 메모리 적재
- 만료된 entry 는 자동 청소

**탈출구**:
- `KIS_DISABLE_404_BLACKLIST=true` env → 영속 블랙리스트 완전 비활성 (운영자 진단 모드)
- `resetKisCircuits()` 가 블랙리스트도 함께 청소 (운영자 수동 복구)

## 비결정 사항 (의도적)

- **30분 윈도우 / 10회 임계 / 24시간 차단** 은 `KIS_BLACKLIST_*` env 로 노출하지 않음.
  운영 데이터 누적 후 PR-25 에서 튜닝 예정. 현재는 ADR 본문이 SSOT.
- 블랙리스트 등록·해제 알림은 console.warn 만. 텔레그램 푸시는 PR-25 에서 검토.
- 블랙리스트 엔트리는 trId 기준. (apiPath 별 분리는 같은 trId 가 동일 KIS 정책의 영향만
  받는다는 가정 하에 단순화.)

## 영향 범위

- `server/routes/marketDataRouter.ts` — 미들웨어 + coalescing 추가 (~50 LoC)
- `server/clients/kisClient.ts` — 블랙리스트 통합 (~40 LoC, 기존 회로 코드 변경 최소)
- `server/persistence/kisEndpointBlacklistRepo.ts` (신규) — ~120 LoC
- `server/persistence/paths.ts` — `KIS_ENDPOINT_BLACKLIST_FILE` 추가
- `server/index.ts` — 부팅 시 blacklist 로드 (~5 LoC)

테스트:
- `server/routes/marketDataRouter.weekendGate.test.ts` (신규)
- `server/routes/marketDataRouter.coalescing.test.ts` (신규)
- `server/persistence/kisEndpointBlacklistRepo.test.ts` (신규)
- `server/clients/kisCircuitBlacklist.test.ts` (신규)
