# ADR-0014 — KIS 재시도 안전성 정책 (Read/Write 분리 + Jitter + Idempotency)

- 상태: Accepted
- 날짜: 2026-04-25
- 영향 범위: `server/clients/kisClient.ts`, `server/trading/*` (간접)

## 컨텍스트

PR-21 (회로차단기 hard/soft 이원화) + PR-24 (24h 영속 블랙리스트) 가 적용된
현재 `kisClient` 의 재시도 정책은 다음과 같다.

| 시그널 | 처리 |
|--------|------|
| 401 Unauthorized | 토큰 강제 갱신 후 즉시 재시도 (3회) |
| 429 Too Many Requests | 1초 대기 후 재시도 (3회) |
| 5xx Server Error | 1s → 2s → 4s 지수 백오프 후 재시도 (3회) |
| 4xx (400/404 등) | 즉시 fail (404 는 소프트 회로 카운팅) |

**현재 정책의 두 가지 결함:**

### 결함 1 — 쓰기(주문) 재시도가 idempotent 하지 않음

`_rawKisPost` 가 **모든 호출에 대해** 5xx 에서 자동 재시도한다. 그러나 KIS 주문 API
(`order-cash`, `order-rvsecncl`) 는 다음 흐름에서 중복 주문을 만들 수 있다.

```
1. 클라이언트 → KIS: order-cash POST (PDNO=005930, ORD_QTY=10, 매수)
2. KIS 매칭엔진:    주문 접수 → 체결 큐 진입 (실제 주문 확정)
3. KIS API 게이트웨이 → 클라이언트: 502 Bad Gateway (백엔드 응답 직전 프록시 타임아웃)
4. 클라이언트:       5xx → 1초 후 재시도
5. 클라이언트 → KIS: order-cash POST (동일 파라미터)
6. KIS 매칭엔진:    또 다른 주문 접수 → 체결
7. 결과:            10주 의도 → 20주 보유
```

KIS 주문 API 는 **클라이언트 공급 idempotency 키를 받지 않는다** (ODNO 는 서버 발급).
유일하게 client-supplied 인 `MGCO_APTM_ODNO` 필드는 "기관 지정 주문번호" 로,
end-to-end fingerprinting 을 위해 사용 가능하지만 실주문 흐름 전반에 wiring 이 필요.
본 PR 범위에서는 더 보수적인 접근을 채택한다 — **5xx 후처리에서 쓰기는 재시도하지 않는다**.

### 결함 2 — Deterministic backoff 가 thundering herd 유발

여러 동시 호출이 KIS 5xx 를 동시에 받으면 1초 → 2초 → 4초 의 정확히 같은 시점에
재시도 폭주를 만든다. KIS 서버가 일시 과부하 상태라면 동기화된 재시도가 회복을 지연시킨다.

## 결정

### 정책 1 — 호출을 READ vs WRITE 로 분류

| 분류 | 예시 | 5xx 재시도 |
|------|------|-----------|
| **READ** (idempotent) | `kisGet` 전체, 데이터 조회용 `kisPost` (해당 없음) | ✅ 안전 |
| **WRITE** (mutate) | `order-cash` 매수/매도, `order-rvsecncl` 정정/취소 | ❌ **차단** |

**근거**: 현재 코드베이스의 `kisPost` 호출 14곳은 모두 주문/취소 (mutate).
read-like POST 가 추가될 가능성을 위해 명시 옵션을 노출하되 기본값은 안전 측 `'unsafe'`.

WRITE 차단 범위는 다음 시그널에 한정한다:
- **5xx after request sent** (KIS 가 받았는지 알 수 없음 → 중복 주문 위험)
- **요청 후 timeout / abort** (동일 사유)

다음은 WRITE 도 안전하게 재시도한다 (요청이 KIS 매칭엔진에 도달하지 않은 것이 확실):
- **401** (토큰 만료) — 401 은 인증 체크에서 즉시 거부, 매칭엔진 미진입
- **429** (rate limit) — KIS 게이트웨이가 거부, 매칭엔진 미진입
- **네트워크 에러 (DNS / TCP)** — 요청이 KIS 에 도달조차 못함

WRITE 가 5xx/timeout 으로 실패하면:
1. 즉시 실패 반환 (재시도 없음)
2. **Telegram 즉시 경보** — 사용자가 KIS HTS 로 실주문 상태를 직접 확인
3. exitEngine/buyPipeline 의 후속 fill 선반영을 LIVE_FAILED 로 분기 (기존 `SellOrderResult` 흐름 그대로)

### 정책 2 — Jitter 추가

기존 deterministic 백오프 (`Math.pow(2, 3 - retriesLeft) * 1000`) 를
**50% deterministic + 50% random** 로 교체:

```typescript
// 기존: retriesLeft=3→1000ms, 2→2000ms, 1→4000ms
// 변경: retriesLeft=3→500~1500ms, 2→1000~3000ms, 1→2000~6000ms
const base = Math.pow(2, 3 - retriesLeft) * 1000;
const delay = Math.floor(base * 0.5 + Math.random() * base);
```

429 의 1초 고정 대기에도 0~500ms jitter 추가 → `1000 + Math.random() * 500`.

### 정책 3 — 환경 변수로 긴급 무력화

```bash
KIS_RETRY_DISABLED=true        # 모든 재시도 무력화 (긴급 진단용)
KIS_RETRY_JITTER_DISABLED=true # jitter 만 무력화 (deterministic 회귀 비교용)
```

기본값은 둘 다 false (재시도 + jitter 모두 활성).

## 결과

### 긍정

- **중복 주문 위험 제거**: 주문 5xx 이후 침묵 재시도가 만들던 잠재적 2배 포지션 차단
- **운영 가시성 향상**: WRITE 실패는 무조건 텔레그램 → 사용자가 즉시 인지
- **Thundering herd 완화**: jitter 로 동시 회복 시도의 동기화 해소
- **"매매에 막힘이 없어야 한다" 원칙 보존**: READ 재시도는 강화 (jitter), WRITE 는
  실패 시 fast-fail + 텔레그램으로 사용자가 즉시 후속 판단

### 부정

- WRITE 5xx 시 운이 좋으면 한 번 더 시도해 성공할 수도 있던 케이스를 포기 — 운영자가
  Telegram 알림 보고 수동 재실행 필요. 안전 우선이므로 trade-off 수용.
- 신규 옵션 (`idempotency`) 이 kisPost 시그니처에 추가되어 호출자 명시 필요. 기본값은
  안전 측 `'unsafe'` 라 명시 안 하면 자동으로 보호.

## 후속

- `kisPost(trId, path, body, priority?, options?)` 시그니처 확장
- `_rawKisPost` 5xx 분기에서 `options.idempotency === 'unsafe'` 면 재시도 없이 fail
- 5xx WRITE 실패 시 `sendTelegramAlert` 호출 (긴급 priority)
- `_kisBackoffDelayMs` 에 jitter 적용
- 기존 `kisCircuit404.test.ts` 호환 유지 + 신규 `kisRetrySafety.test.ts` 추가
- 본 ADR 의 Phase 2 로 `MGCO_APTM_ODNO` 기반 fingerprinting 검토 (현재 범위 외)
