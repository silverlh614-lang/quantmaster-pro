# ADR-0121: Price Source Policy SSOT — KIS canonicalPrice 승격 + Yahoo 강등

**상태:** 채택 (PR-C 인프라 단계, 2026-04-30)
**시리즈:** 옵션 B PR-A → PR-B → **PR-C** 의 세 번째 단계 (인프라만)

## 컨텍스트

사용자 4/30 진단 §1 인용:

> 한국 주식에서 Yahoo 가격은 다음 문제가 반복됩니다:
> - 액면분할/액면병합/무상증자/권리락 보정 오류
> - 종목 코드 매핑 오류
> - 전일 기준가와 현재가 기준 불일치
> - 국내 실시간 체결가와 괴리 발생
>
> 사용자가 보여준 사례처럼 -60% ~ -80% 괴리가 다발로 나오면, 이것은 시장 신호가 아니라 데이터 오염 신호입니다.

ADR-0091 (Yahoo Stale Base Fallback) + ADR-0113 (Drift Tiered Sanity) + ADR-0117 (Sanity Trade-Block Gate) 가 *호출자별로 분산된* 가드를 추가했지만, *KIS canonicalPrice 우선* 단일 SSOT 부재. ADR-0114 (Data Trust Layer Tier 분류) 는 정책만 명문화했고 실제 호출자 가드는 부재.

## 결정

### 1. `DataQualityStatus` 6값 SSOT

```typescript
export type DataQualityStatus =
  | 'VALID'                      // KIS+Yahoo 괴리 ≤3%
  | 'WARN'                       // 3~10%
  | 'INVALID'                    // 10~30%
  | 'CORPORATE_ACTION_SUSPECT'   // 30%+ (50%+ → hard quarantine)
  | 'STALE'                      // KIS 부재 + Yahoo 만 있음
  | 'MISSING';                   // 둘 다 부재
```

### 2. `DataQualityResult` 인터페이스 SSOT (사용자 §2 정합)

`canonicalPrice` + `canonicalSource` (KIS/KRX/NAVER/YAHOO_VALIDATED/NONE) + `discrepancyPct` + `allowExecution` + `allowTechnicalIndicators` + `reasons[]`.

### 3. `evaluateDataQuality(input)` 분류 SSOT

우선순위 트리:
1. ENV `PRICE_SOURCE_POLICY_DISABLED=true` → VALID + KIS 우선 fallback (회귀 분석용)
2. KIS+Yahoo 모두 부재 → MISSING + 매수 차단
3. KIS 부재 + Yahoo 만 → STALE + 매수 차단 (기술지표 허용)
4. KIS 만 → VALID + 매수 허용
5. 둘 다 + 괴리 ≤3% → VALID
6. 3~10% → WARN (매수 허용, KIS canonical 신뢰)
7. 10~30% → INVALID + 매수 차단
8. 30~50% → CORPORATE_ACTION_SUSPECT (액면분할 의심)
9. 50%+ → CORPORATE_ACTION_SUSPECT + HARD_QUARANTINE (기술지표도 차단)

### 4. 임계 SSOT 4값

`PRICE_SOURCE_THRESHOLDS`: 3 / 10 / 30 / 50 (사용자 §3 정합).

### 5. 호출자 가드 헬퍼 2종

- `shouldAllowExecution(quality)` — 매수 주문 직전 가드
- `shouldQuarantine(status)` — 격리 분류 (DataQuarantine 카운터 입력)

### 6. 호출자 wiring 후속 PR 분리

본 PR-C 는 **SSOT 인프라만** 도입. 호출자 wiring (entryEngine / exitEngine / orderDispatch / signalScanner) 은 운영 데이터 1~2주 누적 후 분리. 사용자 옵션 B 의 핵심 — *진짜 차단 원인이 데이터 오염인지 운영 데이터로 확정한 후* Yahoo 강등 wiring 진행.

## 결과

### 변경 파일

- `server/trading/priceSourcePolicy.ts` (신규 SSOT)
- `server/trading/priceSourcePolicy.test.ts` (신규 34 케이스)

### 검증

- vitest 신규 34/34 pass
- lint(client + server tsc) 0 에러
- KIS/KRX 자동매매 quota 0 침범
- LIVE 매매 본체 0줄 변경 (호출자 wiring 부재 — 인프라만)

### 운영 효과

운영자가 PR-A 의 emptyScanReason + PR-B 의 R3 Sanity Check 로 1~2주 운영 데이터 누적한 후, *진짜 차단 원인이 DATA_INVALID 30%+ 인지* 확정 → 본 PR-C 의 evaluateDataQuality SSOT 위에 호출자 wiring 추가하면 즉시 효과. 098460 +221% / 336260 +207% 같은 1차 로그 시나리오에서 CORPORATE_ACTION_SUSPECT + HARD_QUARANTINE 자동 분류 → 매수 차단.

### ENV 롤백

`PRICE_SOURCE_POLICY_DISABLED=true` 1줄로 SSOT 무력화. 회귀 분석 시 사용.

### 후속 PR (인프라 의존 wiring)

- entryEngine / signalScanner 매수 직전 `shouldAllowExecution(quality)` 가드
- DataQuarantine 별도 ScanCounter (1~2주 누적 분포 데이터)
- enrichment.ts 의 Yahoo 호출 audit + KIS 우선 wiring
