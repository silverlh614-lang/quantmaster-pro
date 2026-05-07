# ADR-0438 (= 사용자 명시 ADR-0442) — Symbol Resolver / Invalid KRX Code Normalization

**Status**: Accepted
**Date**: 2026-05-07
**번호 정합**: 사용자 명시 ID = ADR-0442. 실제 발급 = ADR-0438 (INDEX.md 다음 발급 SSOT, ADR-0148 정합).

## 사용자 핵심 의도 (절대 변경 금지)

*"invalid code 는 degraded 가 아니라 hard reject 다. master missing 은 degraded/fallback 이지만, invalid code 는 시스템 안으로 들이면 안 된다. ADR-0442 는 수익률 로직이 아니라 데이터 오염 방지용 경계 방어 패치다."*

## 1. 배경

### 1.1 운영 보고 (5/7 KST)

`[Watchlist/CodeGuard] invalid KRX code 자동 필터링 - code="0011TO" name="체비"` + `[YahooSymbolResolver] 038880 마스터 미검 ... 038880.KQ sane fallback` 두 로그가 동시 발생. invalid code (`0011TO`) 가 watchlist 에 도달했고, master missing (`038880` 마스터 부재) 이 fallback 으로 처리되는 두 시나리오가 *같은 메시지 패턴* 을 사용하여 운영자가 *어느 쪽이 진짜 결함인지* 분간 어려운 상태.

### 1.2 다중 유입 경로 audit

`normalizeKrxCode` (또는 정규식 인라인) 호출자 5+ 식별:
- `server/dataQuality/emergencyDataQualityGuards.ts` — 기존 SSOT (본 PR 이전)
- `server/persistence/watchlistRepo.ts` — saveWatchlist 진입부 invalid filter (ADR-0184 PR-B12-A)
- `server/trading/buyPipeline.ts` — createBuyTask 진입부 KRX code sanity (ADR-0185 PR-B12-B)
- `server/trading/historicalClosePrice.ts` — 매수가 fallback chain
- `server/clients/kisWebSocketSubscriptionManager.ts:164` — `normalizeKrxCodeForWs` inline (ADR-0437)
- `server/screener/adapters/yahooSymbolResolver.ts` — `${code}.KS` / `${code}.KQ` direct concat (별도 SSOT, ADR-0231)

### 1.3 결함 패턴

1. `kisWebSocketSubscriptionManager.ts` 가 자체 정규식 (`/^[0-9]{6}$/`) 인라인 — emergencyDataQualityGuards 의 SSOT 와 *drift* 발생 가능 (suffix list / case 처리 차이).
2. `counterfactualUniverseLearningWiring.ts buildCandidateSummaries` 가 `symbol = stockCode` 보존 — invalid code (`0011TO`, `5930`, `ABCDEF`) 가 universe learning ledger 에 영구 박제되어 학습 데이터 오염.
3. `yahooSymbolResolver.ts` 의 `${code}.KS` direct concat — invalid `code` 가 들어오면 `0011TO.KS` 같은 잘못된 Yahoo 심볼 fetch 시도.
4. `master missing` 와 `invalid code` 가 같은 fallback 분기 — 운영자가 진단 시 분간 불가.

## 2. 결정

### 2.1 Symbol Normalizer SSOT 신설

`server/utils/symbolNormalizer.ts` — 6자리 KRX code 정규화 + Yahoo 심볼 변환 단일 진입점. 호출자 측 inline 정규식 영구 차단 (ADR-0148 정적 grep 가드 후속 PR scope).

### 2.2 invalid hard reject 정책

invalid code 는 *degraded 가 아니다*. 다음 5 영역에서 invalid → hard reject:
1. **KIS WebSocket subscribe** — `normalizeKrxCodeForWs` 가 SSOT 위임으로 invalid 시 null 반환 → priority queue 가 reject (ADR-0437 정합).
2. **Watchlist add** — `saveWatchlist` 가 invalid filter (ADR-0184).
3. **buyPipeline createBuyTask** — invalid code SKIP (ADR-0185).
4. **counterfactual learning ledger** — `buildCandidateSummaries` 가 invalid filter (본 PR §2.4).
5. **provider 호출 (KIS/KRX/Naver/Yahoo)** — invalid code 검증된 코드만 호출자 측에서 통과.

### 2.3 master missing degraded/fallback 분리

master missing 은 *degraded* 분류 — `FALLBACK_SYMBOL` marker 부착 + 운영자에게 진단 가시화 (`/health` / `/scan_blockers` 후속 PR scope).

## 3. KRX Internal Code Policy

- 6자리 숫자 문자열만 valid (`/^\d{6}$/`)
- trim 후 검증
- uppercase 정규화 (Yahoo 심볼 .KS / .KQ 는 대문자)
- 6자리 미만/초과 + 알파벳 포함 + 빈 문자열 + null/undefined → invalid
- non-string 입력 → invalid (number/object 등)

## 4. Suffix Stripping Policy

`/\.(KS|KQ|KOSPI|KOSDAQ)$/u` 매칭 후 strip. strip 결과 `marketSuffix` 로 보존 (KS / KQ 단순화).

검증 *순서* — uppercase → suffix strip → 6자리 숫자 검증. suffix 가 있었으면 reason='SUFFIX_STRIPPED' 로 분류 (호출자 진단 가능).

매핑:
- `.KS` → `marketSuffix='KS'`
- `.KOSPI` → `marketSuffix='KS'` (Yahoo 매핑 정합)
- `.KQ` → `marketSuffix='KQ'`
- `.KOSDAQ` → `marketSuffix='KQ'`

## 5. Invalid Hard Reject Policy

`NormalizedKrxSymbolReason` 8-value union — invalid 분기 3종:

| Reason | 트리거 조건 | 예시 |
|--------|-------------|------|
| `EMPTY` | null / undefined / non-string / 빈 문자열 / whitespace-only | `null` / `""` / `"  "` / `1234` (number) |
| `NON_NUMERIC` | suffix strip 후 알파벳 포함 또는 mix | `0011TO` / `ABCDEF` |
| `INVALID_LENGTH` | suffix strip 후 모두 숫자 + 6자리 아님 | `5930` / `0059300` |

valid 분기 2종:
| Reason | 트리거 조건 |
|--------|-------------|
| `OK` | suffix 없이 6자리 숫자 통과 |
| `SUFFIX_STRIPPED` | suffix 가 있었고 strip 후 6자리 숫자 통과 (`marketSuffix` 부착) |

reason `MASTER_MISSING` / `FALLBACK_SYMBOL` / `UNKNOWN` 은 `toYahooSymbol()` 결과 마커 (정규화 결과 아님).

## 6. Master Missing vs Invalid 차이

| 분류 | code 6자리 | master 등록 | hardReject | fallback 가능 |
|------|-----------|-------------|-----------|---------------|
| Invalid (NON_NUMERIC/INVALID_LENGTH/EMPTY) | ❌ | N/A | ✅ | ❌ |
| Master Missing | ✅ | ❌ | ❌ | ✅ (FALLBACK_SYMBOL marker) |
| Master Hit | ✅ | ✅ | ❌ | N/A (정상 OK) |

Invalid → 시스템 안으로 진입 절대 금지. Master Missing → degraded fallback 가능 (운영자 진단 의무).

## 7. Yahoo Fallback Policy (FALLBACK_SYMBOL marker)

`toYahooSymbol(rawOrCode, marketHint?)` 결정 트리:
1. normalizeKrxCode invalid → `INVALID_SYMBOL` (yahooSymbol=null)
2. master 매칭 (KOSPI/KOSDAQ) → `OK` + .KS/.KQ
3. master 부재 + marketHint (또는 suffix 잔존) → `FALLBACK_SYMBOL` + fallback=true
4. master 부재 + hint 없음 → `MASTER_MISSING` (yahooSymbol=null)

`fallback=true` marker — 호출자가 진단 로그에 표기 의무 (`/scan_blockers` UI 노출 후속 PR scope).

## 8. 적용 범위 (본 PR)

### 점진 통합 (회귀 위험 격리)

| 호출자 | 본 PR 작업 | 상태 |
|--------|-----------|------|
| `emergencyDataQualityGuards.ts` | SSOT 위임 wrapper (deprecated) | ✅ |
| `kisWebSocketSubscriptionManager.ts:164` | `normalizeKrxCodeForWs` SSOT 위임 (ADR-0437 inline 제거) | ✅ |
| `counterfactualUniverseLearningWiring.ts` | `buildCandidateSummaries` invalid filter | ✅ |
| `yahooSymbolResolver.ts` | 변경 0 (별도 `toYahooSymbol(code)` SSOT export) | 후속 PR scope |
| `watchlistRepo.ts` | 변경 0 (이미 invalid filter 보유, 진단 로그 prefix 변경 선택) | 후속 PR scope |
| `buyPipeline.ts createBuyTask` | 변경 0 (이미 ADR-0185 가 SSOT 통합) | 자동 흡수 |
| `historicalClosePrice.ts` | 변경 0 (자동 흡수 — 기존 `normalizeKrxCode` import) | 자동 흡수 |

### 자동 흡수 (호출자 변경 0줄)

기존 `emergencyDataQualityGuards.normalizeKrxCode` import 호출자 4개는 wrapper SSOT 위임으로 자동 흡수:
- `watchlistRepo.ts`
- `buyPipeline.ts`
- `historicalClosePrice.ts`
- `kisWebSocketSubscriptionManager.ts` (inline 함수는 별도 wiring)

## 9. LIVE 매매 본체 영향 0

- `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` 모두 0줄 변경
- KIS 주문 함수 5종 (`placeKisMarketBuyOrder` / `placeKisSellOrder` / `cancelKisOrder` / `placeKisStopLossOrder` / `placeKisTakeProfitOrder`) import 0건 (정적 grep 가드)
- Gate threshold + condition weight + STRONG_BUY 조건 0 변경
- virtual account holdings/cash 무수정

## 10. KIS/KRX/Yahoo/Naver Quota 영향 0

- 외부 fetch 추가 0건 (master lookup 은 read-only `getStockByCode` 호출)
- `toYahooSymbol()` 본체에 외부 API 호출 0건
- counterfactual ledger 영속 invalid 0 (학습 데이터 오염 차단)

## 11. ENV 우회

`SYMBOL_NORMALIZER_STRICT_DISABLED=true` (default OFF, ADR-0157 정확 비교 — `'1'`/`'TRUE'`/`'yes'` 거부) — 회귀 발견 시 1줄 즉시 활성화로 호출자 측 inline 정규식 (ADR-0438 이전 동작) 100% 복원. 본 PR 의 SSOT 자체는 호출자 변경 없는 byte-equivalent 정책이라 활성화 시 동작 차이 0.

## 12. 잘못된 해결 방법 영구 차단

본 PR 진행 중 검토 후 *영구 차단* 결정 사항:

1. **invalid code fallback subscribe / provider 호출** — degraded fallback 절대 금지. invalid → hard reject + 호출자 SKIP 의무.
2. **종목명 fuzzy search 대형 구현** — 별도 ADR. DART name → code disambiguation 본격 구현은 후속 ADR scope.
3. **WebSocket invalid code 전달** — `normalizeKrxCodeForWs` 가 SSOT 위임으로 invalid 시 null 반환 → priority queue reject 강제.
4. **counterfactual learning invalid 영속** — `buildCandidateSummaries` 진입부 filter 의무. 호출자 측 후처리 절대 금지.
5. **KRX master 전체 수집 신규 외부 호출** — `getStockByCode` read-only 사용. 마스터 부재 시 fallback marker 만, 자동 master refresh 트리거 절대 금지.
6. **종목명 ↔ code disambiguation 본격 구현** — DART/뉴스/Naver name 매칭 별도 ADR. 본 PR 은 *경계 방어* 만.
7. **`normalizeKrxCode` 정규식 호출자 측 복붙** — SSOT 위임 의무. `kisWebSocketSubscriptionManager.ts` 의 `normalizeKrxCodeForWs` 가 첫 마이그레이션 케이스 — 후속 호출자 (`yahooSymbolResolver.ts` direct concat 등) 점진 통합.

## 13. 회귀 30+ 신규

- `server/utils/symbolNormalizerAdr0438.test.ts` — normalizeKrxCode 16 + toYahooSymbol 8 + ENV 4 + assertValidKrxCode 3 + 정적 grep 가드 6
- `server/clients/kisWebSocketSubscriptionManagerAdr0438.test.ts` — SSOT 위임 검증 + 기존 ADR-0437 회귀
- `server/trading/signalScanner/counterfactualUniverseLearningWiringAdr0438.test.ts` — invalid filter 5 케이스
- `server/dataQuality/emergencyDataQualityGuardsAdr0438.test.ts` — wrapper 후방호환 5 케이스

heuristic ≥5/100 LoC 충족 (목표 30+, 실측 ~50+).

## 14. 후속 ADR 후보

- **ADR-0439+** `watchlistRepo` / `buyPipeline` / `historicalClosePrice` 호출자 점진 SSOT 통합 (`server/utils/symbolNormalizer` 직접 import).
- **DART name → code disambiguation** — 종목명 fuzzy search 본격 구현 (별도 ADR).
- **KRX master DB 전체 수집 자동화** — 현재 24h TTL refresh 위에 미커버 종목 자동 enrichment.
- **`yahooSymbolResolver.ts` direct concat 통합** — `${code}.KS` 패턴을 `toYahooSymbol(code)` SSOT 위임으로 마이그레이션.
- **정적 grep 가드 강화** — 호출자 측 inline 정규식 (`/^\d{6}$/` / `.KS` direct concat) 자동 차단 (`scripts/check_*` 시리즈 추가).

## 15. 롤백 방법

회귀 발견 시 ENV 우회:
```bash
export SYMBOL_NORMALIZER_STRICT_DISABLED=true
```

또는 git revert — 본 PR 머지 sha 1줄. byte-equivalent 후방호환 wrapper 라 호출자 4개 무수정 — 회귀 위험 격리.

## 참고

- ADR-0184 (PR-B12-A) — `watchlistRepo` invalid code filter
- ADR-0185 (PR-B12-B) — `buyPipeline` createBuyTask KRX code sanity
- ADR-0231 — `yahooSymbolResolver` SSOT
- ADR-0233 — `${code}.KS / ${code}.KQ` direct concat 호출자 통합
- ADR-0234 — `${code}.KS` 운영 진단 보강
- ADR-0437 — KIS WebSocket Subscription Priority Queue (`normalizeKrxCodeForWs` 본 PR 통합 대상)
- ADR-0148 — 거버넌스 자동화 (정적 grep 가드 후속 PR)
- ADR-0157 — ENV 정확 비교 의무
