# ADR-0056: EgressGuard Intent Classification (의도 태그)

- **Status**: Accepted (PR-EG1 본 PR 로 정착)
- **Date**: 2026-04-26
- **연관 ADR**:
  - ADR-0010 (PR-24) 외부 호출 예산 (블랙리스트 + coalescing) — IntentTag 는 그 위 레이어
  - ADR-0028 (PR-29) EgressGuard 도입 — 본 PR 이 직접 후속
  - ADR-0009 (PR-23) 외부 호출 예산 게이트 — 시간대 정책 SSOT
  - ADR-0026/0027 (PR-26/27) SymbolMarketRegistry — 본 PR 의 의도 매트릭스가 위 레지스트리 위에 올라감

---

## Context

PR-29 (`server/utils/egressGuard.ts`) 는 outbound HTTP 의 "최종 관문" 으로, URL → 심볼 → `isMarketOpenFor()` 단일 규칙으로 시장이 닫혀 있으면 503 synthetic Response 를 반환해 호출을 차단한다. 도입 이후 14개 호출자가 동일하게 `guardedFetch(input, init)` 시그니처로 통합됐고, 미들웨어 우회 누수가 봉합됐다 — 이는 본 PR 이 그대로 보존하는 이득이다.

그러나 **호출자별 의도가 다르다는 사실** 이 단일 규칙에서 표현되지 않는다:

1. **사용자 보고 (2026-04-26)**: `06:00 KST globalScanAgent` cron 이 EgressGuard 의 NYSE 정규장 시간(EST 09:30~16:00 = KST 23:30~06:00) 밖 차단으로 새벽 글로벌 스캔이 실패. 그러나 새벽 스캔은 *애프터마켓 데이터로도 충분히 신호 가치* 가 있다 — Yahoo 가 EST 16:00~20:00 동안 애프터마켓 가격을 그대로 제공하기 때문. EgressGuard 가 정규장 외를 "데이터 없음" 으로 가정하는 건 틀렸다.

2. **HISTORICAL 호출의 시간대 무관성**: `backtestEngine.ts` 가 2년 일봉을 가져오거나 `quantitativeCandidateGenerator.ts` 가 3개월 일봉을 가져올 때, *지금 시각이 정규장이든 아니든* T-1 데이터 자체는 항상 존재한다. 시간대 차단은 비용 절감 명목이 아니라 "데이터가 없을 거" 라는 가정에 기반하는데, HISTORICAL 호출에는 그 가정이 적용되지 않는다.

3. **REALTIME 만 정규장 의존**: 클라 `/api/historical-data` 프록시·DXY 인트라데이·sectorEtfMomentum 30분 cron 같은 호출은 정말로 *지금* 의 시세를 원한다. 정규장 밖이면 데이터가 stale 또는 부재 — 이 케이스만 차단의 진짜 동기다.

요컨대, **EgressGuard 가 단일 시간 정책을 적용하는 것은 14개 호출자 중 정확히 일부(REALTIME 군) 에만 옳은 결정** 이다. 나머지 (HISTORICAL · OVERNIGHT) 호출은 회귀로 인해 차단되거나 (HISTORICAL → 새벽 백테스트 차단), 정상 데이터 윈도우를 놓치고 있다 (OVERNIGHT → 06:00 글로벌 스캔 NYSE 애프터마켓 실패).

---

## Decision

`EgressIntent` 옵셔널 의도 태그를 도입해 14 호출자가 의도를 명시할 수 있게 한다. EgressGuard 가 의도별 결정 매트릭스를 적용한다.

```ts
// server/utils/egressGuard.ts
export type EgressIntent = 'REALTIME' | 'HISTORICAL' | 'OVERNIGHT';

export function evaluateEgress(
  urlLike: string | URL,
  intent: EgressIntent = 'REALTIME',  // 기본값 = 기존 동작 = 회귀 0
  now: Date = new Date(),
): EgressDecision { /* ... */ }

export async function guardedFetch(
  input: string | URL,
  init?: RequestInit,
  intent: EgressIntent = 'REALTIME',  // 옵셔널 3번째 인자
): Promise<Response> { /* ... */ }
```

### 결정 매트릭스 (SSOT)

| intent       | KRX 정규장 | KRX 외 | NYSE 정규장 | NYSE 애프터(16:00~20:00 EST) | NYSE 외 (그 외) | TSE 정규장 | TSE 외 | 미등록 host |
|--------------|-----------|--------|------------|------------------------------|-----------------|-----------|--------|------------|
| `REALTIME`   | pass      | skip   | pass       | skip                         | skip            | pass      | skip   | pass       |
| `HISTORICAL` | pass      | pass   | pass       | pass                         | pass            | pass      | pass   | pass       |
| `OVERNIGHT`  | pass      | skip   | pass       | **pass**                     | skip            | pass      | skip   | pass       |

**핵심 규칙**:

1. **`REALTIME` (기본값)** = PR-29 동작 100% 보존. 의도 미전달 시 자동 적용 → 14 호출자 무수정 시에도 회귀 0.
2. **`HISTORICAL`** = 모든 시간대 통과. 호출 자체는 그대로 진행되고, 데이터 신뢰도(stale 여부) 는 호출자가 응답을 보고 판단.
3. **`OVERNIGHT`** = REALTIME 위에 NYSE 애프터마켓 윈도우(EST 16:00~20:00 = KST 06:00~10:00 EST 기준 / KST 05:00~09:00 EDT 기준 ±1h 수용)만 추가 통과. KRX/TSE 야간 거래는 없으므로 REALTIME 과 동일하게 closed.

### 구현 변경 (egressGuard.ts 본체)

기존 `evaluateEgress` 의 단일 분기:

```ts
if (isMarketOpenFor(symbol, now)) return { action: 'pass', symbol, market };
return { action: 'skip', symbol, market, reason: `${market} closed` };
```

→ intent 별 분기:

```ts
const regularOpen = isMarketOpenFor(symbol, now);
if (regularOpen) return { action: 'pass', symbol, market };

// 정규장 밖 — 의도별 추가 통과 결정
if (intent === 'HISTORICAL') {
  return { action: 'pass', symbol, market, reason: 'historical bypass' };
}
if (intent === 'OVERNIGHT' && market === 'NYSE' && isNyseAfterHours(now)) {
  return { action: 'pass', symbol, market, reason: 'nyse afterhours' };
}
return { action: 'skip', symbol, market, reason: `${market} closed` };
```

`isNyseAfterHours(now)` 헬퍼는 `symbolMarketRegistry.ts` 에 추가하지 않고 (정규장 SSOT 분리 유지) `egressGuard.ts` 내부에 두는 것을 권장 — *애프터마켓 통과* 는 EgressGuard 가 의도별로 결정하는 정책이지 "시장이 열려있다" 는 사실이 아니다. 시간 계산은 NYSE 시간표 SSOT(`MARKETS.NYSE`) 를 export 한 후 재사용한다 (DRY).

### 호출자 wiring 정책

본 PR (PR-EG1) 은 `evaluateEgress` 시그니처 + `EgressIntent` 타입 + 결정 매트릭스 본체까지만 추가한다. **14 호출자 wiring 은 engine-dev 후속 PR(PR-EG2) 에서 처리** — 의도 매핑 결정이 개별 호출자 컨텍스트에 따라 달라지므로 architect 가 매핑 표 (별도 산출물 `intent-mapping.md`) 를 먼저 확정하고 engine-dev 가 1줄씩 인자를 추가한다.

미전달 시 REALTIME 기본값으로 동작하므로 wiring 은 점진 적용 가능 — 한 PR 에서 한 호출자만 바꿔도 회귀 위험 없음.

---

## Consequences

### Positive
- **사용자 보고된 06:00 KST 글로벌 스캔 실패 해소** — `globalScanAgent` 가 `marketDataRefresh.fetchCloses` 를 경유하므로 (직접 `guardedFetch` 호출 없음), 후속 PR-EG2 에서 `fetchCloses(..., intent='OVERNIGHT')` 인자 추가 시 NYSE 애프터마켓 윈도우가 자동 통과.
- **HISTORICAL 호출의 시간대 무관 특성 표현** — 백테스트·학습 데이터·일봉 시계열 fetch 가 새벽이든 주말이든 통과.
- **회귀 안전망**: `REALTIME` 기본값으로 미전달 시 동작 100% 보존. 14 호출자 wiring 이 점진적이라도 안전.
- **결정 매트릭스가 SSOT** — 운영자가 `evaluateEgress` 단위 테스트만 보면 모든 의도×시장 조합 결과 확인 가능.

### Negative / Trade-offs
- **HISTORICAL 잘못 분류 시 우회 위험** — 호출자가 잘못 `intent='HISTORICAL'` 로 표시하면 정규장 외 실시간 호출이 통과한다. 이는 외부 호출 예산 폭주 위험으로 이어짐. 도입 후 EgressGuard 통과 통계 모니터링 필요 (후속 운영 작업 — 본 PR scope 밖).
- **NYSE 애프터마켓 윈도우의 데이터 신뢰도** — Yahoo 가 16:00~20:00 EST 동안 제공하는 가격은 정규장보다 거래량이 얇다. OVERNIGHT 의도로 받은 데이터는 *근사값* 이라는 호출자 인지가 필요. 본 PR 은 이를 명시적으로 차단하지 않음 (OVERNIGHT 의도가 그 trade-off 를 수용한 것).
- **TSE/KRX OVERNIGHT 미지원** — 한국·도쿄 시장은 야간 거래가 없으므로 OVERNIGHT = REALTIME 과 동일하게 closed. 추후 KRX 야간 시장 도입 시 매트릭스에 셀 추가 (확장 가능).

### Rollback
- **개별 호출자 단위**: `intent` 인자 제거 → REALTIME 기본값 → 기존 PR-29 동작.
- **전역 단위**: `EGRESS_GUARD_DISABLED=true` env (PR-29 이미 존재) → outbound 무차단. 본 PR 은 이 스위치를 보존.

---

## Alternatives Considered

### A. 시간대 화이트리스트 (사용자 아이디어 3)
호출자별로 cron 시각 또는 시간대 윈도우를 화이트리스트에 등록해 EgressGuard 가 그 시각에 통과시키는 방식.

**기각 사유**: 더 단순하지만 호출자별 *의도* 분리가 표현되지 않는다. 같은 호출자가 cron(새벽) + 사용자 명령(임의 시각) 두 경로로 호출될 수 있는데, 시간 화이트리스트는 의도를 잡지 못한다. IntentTag 는 *의도* 를 명시적 1급 시민으로 끌어올린다.

### B. NYSE 애프터마켓을 정규장에 무조건 포함 (사용자 아이디어 2)
`symbolMarketRegistry.MARKETS.NYSE.closeMin` 을 16:00 → 20:00 으로 확장.

**기각 사유**: 정규장과 애프터마켓의 *데이터 신뢰도 차이* 를 무시한다. REALTIME 호출자가 19:00 EST 에 받은 가격을 정규장 시세로 오인할 위험. IntentTag 가 의도별 분리 → REALTIME 은 정규장만 / OVERNIGHT 는 애프터마켓도 OK 로 명시 분리하는 게 더 정확하다.

### C. 호출자 stack trace 로 의도 자동 추론
`guardedFetch` 가 호출자 stack 을 보고 backtest/scheduler/route 분류로 자동 의도 부여.

**기각 사유**: 마법(magic) 동작은 디버깅·테스트가 어렵다. 호출자가 명시적으로 의도를 표시하는 게 IDE 친화적이고 grep 가능.

---

## Migration & Compat

- **PR-EG1 (본 PR)**: 타입 + 시그니처 + 매트릭스 본체. 14 호출자 무수정 (REALTIME 기본값으로 동작). 신규 회귀 테스트 (intent 분기 매트릭스 검증) 추가.
- **PR-EG2 (후속, engine-dev)**: `intent-mapping.md` 표대로 14 호출자에 1줄씩 의도 추가. 개별 호출자별 PR 분리도 가능 (회귀 위험 격리).
- **PR-EG3 (후속, force watch scan)**: `/force_watch_scan [full]` 텔레그램 명령 — 새벽/장 마감 후 운영자가 강제로 워치리스트 스캔 트리거. 본 ADR §"Watch Scan Trigger" 절 확장 (별도 산출물 `force-watch-scan-design.md` 참조).

---

## References
- 사용자 보고 (2026-04-26): 06:00 KST GlobalScan NYSE 차단
- ADR-0028 (PR-29) EgressGuard 도입
- `server/utils/egressGuard.ts` (134줄, 본 PR 수정 대상)
- `server/utils/symbolMarketRegistry.ts` (NYSE 시간표 SSOT)
- `_workspace/2026-04-26_pr-egressguard-intent-tags/architect/intent-mapping.md` (14 호출자 매핑 표)
- `_workspace/2026-04-26_pr-egressguard-intent-tags/architect/force-watch-scan-design.md` (PR-EG3 인터페이스)
