# ADR-0661 — Gate3 재검증 실시간 현재가 재각인 (entry-price false-STALE 해소)

- Status: Accepted
- Date: 2026-07-02
- Type: ADR (Gate3 입력 신선도 배선 정정 + flag 도입 — live 판정 경로 행동 변화)
- Branch: `claude/scan-blockers-diagnostic-l0w0tm`
- Touches: ADR-0547(technicalQuoteRouter 6h 일봉 캐시), ADR-0031 PR-60(kisIntradayCorrectionStep 추출),
  ADR-0658/0652(default ON kill-switch 패턴), ADR-0157(flag 비교 규약).
- 현 engineMode: SHADOW_ONLY (live 주문 0 — 안전창).

---

## Context — 실측 부검 (scan-eval-20260702114714)

`/scan_blockers` 에서 Gate3 Timing Readiness 가 `entryPriceFresh=STALE 11/11`,
`entryPriceStaleBlocked=11/11` 로 전 후보 진입 판정을 차단했다. 시세 라인 자체는 정상
(quote hydrated 45/45 failed 0, KIS sector verify 11/11 성공)이라 provider 장애가 아니다.

원인 체인 (코드 확정):

1. `fetchTechnicalQuoteByCode` (technicalQuoteRouter.ts, ADR-0547) 는 KIS 일봉 quote 를
   **6h(휴장 18h) TTL 인메모리 캐시**로 재사용한다. 캐시 객체의 `asOf` = 최초 fetch 시각.
2. 재검증 스텝 `kisIntradayCorrectionStep` (revalidationSteps) 은 `fetchKisIntraday`
   (FHKST01010100) 로 **fresh 현재가와 fresh `asOf` 를 이미 조회**하지만, `dayOpen`/`prevClose`
   만 quote 에 반영하고 fresh `price`/`asOf` 는 폐기해 왔다 (ADR-0031 PR-60 추출 당시의 원 범위).
3. `buildGate3EntryPriceGuard` (gate3LastTrigger.ts:203) 는 quote 의 `priceAsOf`/`asOf` 류
   타임스탬프로 나이를 계산하고 `>60s → ENTRY_PRICE_STALE` 로 차단한다.
4. 결과: 캐시 TTL 내 모든 재검증에서 낡은 `asOf` 가 guard 에 들어가 **fresh 재검증조차
   무조건 STALE** — 배선 갭이지 데이터 장애가 아니다.

## Decision

### D1 — fresh price/priceAsOf 각인 (kisIntradayCorrectionStep)

flag ON 시, 같은 스텝의 `fetchKisIntraday` 스냅에서:

- `reCheckQuote.price = kisSnap.price`, `reCheckQuote.currentPrice = kisSnap.price`
- `reCheckQuote.priceAsOf = kisSnap.asOf ?? now().toISOString()` (스냅은 동일 스텝에서 방금
  fetch 됐으므로 now fallback 은 초 단위 정확)

**명시 age 필드(`entryPriceAgeSec`)는 각인하지 않는다** — 재검증 quote 는 6h 캐시와 객체를
공유하므로(기존 dayOpen/prevClose mutate 선례와 동일), 고정 age=0 이 남으면 이후 캐시 히트
평가가 영구 FRESH 로 오염된다. 타임스탬프만 각인하면 guard 가 평가 시점마다 나이를
재계산하므로 자기-정정된다 (시간이 지나면 다시 정직하게 STALE).

`kisSnap.price <= 0` 또는 스냅 실패 시 미각인 (기존 graceful 경로 그대로).

### D2 — guard 무접촉

`buildGate3EntryPriceGuard` 의 로직·60초 임계·드리프트 3% 임계는 0줄 변경. 진짜 stale
(재검증 미경유 경로, KIS 실패)은 여전히 차단된다 — 본 ADR 은 측정을 정직하게 만들 뿐
기준을 완화하지 않는다.

### D3 — flag (default ON kill-switch)

SSOT `gateConfig.isGate3EntryPriceRestampEnabled()` = `GATE3_ENTRY_PRICE_RESTAMP_ENABLED !== 'false'`.
default ON 근거 (ADR-0658/0652 동일 패턴): (1) 실측 확정된 배선 결함의 정정 (2) 신규 fetch 0 —
같은 콜이 이미 반환한 L1 값의 각인 (3) 운영자 P0 착수 승인 (4) 현 engineMode=SHADOW_ONLY 라
live 주문 0 안전창. explicit `=false` 1줄 kill-switch → dayOpen/prevClose 보정만 남는
byte-identical 롤백.

## 불변식 정합

- #3/#9 (SourceSnapshot): 스냅샷 모듈 무접촉. 재검증 quote 는 본 스텝이 원래 mutate 하던
  객체이며(선례: dayOpen/prevClose), Gate *내부* provider 신규 조회가 아니라 기존 재검증
  스텝의 기존 콜 결과 활용.
- #6 (provider ≠ market signal): 각인 실패/스냅 실패 = 미각인 graceful, bearish 변환 0.
- #7 (L4 금지): 각인 값은 KIS FHKST01010100 L1.
- requiredScore=70·Gate 임계·사이징 무접촉.

## Consequences

- (+) Gate3 entry price guard 가 재검증 시점의 진짜 신선도를 측정 — false-STALE 로 인한
  전 후보 차단 해소. 레짐 전환(live 재개) 시 진입 지연 제거.
- (+) Gate3 진단(`entryPriceFresh`/`priceFreshness` 분포)이 실제 데이터 상태를 반영.
- (−) 재검증 경로 밖(첫 스캔 패스 등)의 STALE 은 본 ADR 범위 밖 — 관측 후 각인 지점 확장은
  별도 ADR (flag lifecycle nextAction).
- (−) volume 등 다른 intraday 필드는 여전히 캐시값 — Gate3 volume DRY_UP 진단의 신선도는
  후속 검토 항목 (scope 밖, 3도메인 규칙).

## Rollback

`GATE3_ENTRY_PRICE_RESTAMP_ENABLED=false` ENV 1줄 → 각인 미적용 byte-identical.

## References

- 실측: scan-eval-20260702114714 `/scan_blockers` (entryPriceStaleBlocked 11/11).
- 코드: `server/trading/signalScanner/revalidationSteps/kisIntradayCorrectionStep.ts` (각인 지점),
  `server/quant/gate3LastTrigger.ts:155-219` (guard — 무변경), `server/screener/adapters/technicalQuoteRouter.ts` (6h 캐시 — 무변경).
- flag SSOT: `server/trading/gateConfig.ts` `isGate3EntryPriceRestampEnabled()` · `scripts/gate_flag_lifecycle.json`.
