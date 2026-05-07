# ADR-0440 — symbolNormalizer Direct Import Migration (deprecated wrapper 제거)

## 발급 일자
2026-05-07

## 사용자 명시 우선순위 (최상위)
ADR-0438 후속 잔여 부채 #1 — `watchlistRepo` / `buyPipeline` / `historicalClosePrice`
3 callers 가 *deprecated wrapper* 를 경유하던 것을 `server/utils/symbolNormalizer` SSOT
직접 import 로 점진 마이그레이션 + `emergencyDataQualityGuards.ts` 의
`normalizeKrxCode` / `assertValidKrxCode` deprecated wrapper export 등록 해제.

## 배경

ADR-0438 (= 사용자 명시 ADR-0442) 는 `server/utils/symbolNormalizer.ts` 를 KRX 6자리
코드 정규화 SSOT 로 신설하면서 기존 4 callers (watchlistRepo / buyPipeline /
historicalClosePrice / kisWebSocketSubscriptionManager) 의 자동 흡수를 위해
`emergencyDataQualityGuards.ts` 의 `normalizeKrxCode` / `assertValidKrxCode` 를
*후방호환 deprecated wrapper* (`unknown → string | null`) 로 보존했다.

`kisWebSocketSubscriptionManager.ts` 는 이미 ADR-0438 의 `normalizeKrxCodeForWs` SSOT
위임 패턴으로 마이그레이션됐고, 나머지 3 callers 도 SSOT 직접 import 로 격상하면
deprecated wrapper export 자체를 등록 해제 가능하다 (사용자 명시 잔여 부채 #1).

## 문제

1. **drift 위험** — deprecated wrapper 는 향후 신규 호출자가 잘못된 진입점으로 사용할 가능성.
   정적 grep 가드 부재 시 wrapper 의존이 누적되어 SSOT 격상 의도가 훼손될 수 있다.
2. **historicalClosePrice 의 정규식 복붙 anti-pattern** —
   ```ts
   function normalizeKrxCode(symbol: string): string | null {
     const raw = String(symbol ?? '').trim();
     const match = raw.match(/^(\d{6})(?:\.(?:KS|KQ))?$/i);
     return match ? match[1] : null;
   }
   ```
   - 별도 로컬 함수 (정규식 복붙). SSOT 본체와 drift 위험 + .KOSPI / .KOSDAQ suffix 미지원
     (SSOT 보다 좁은 동작).
3. **시그니처 불일치** — wrapper 는 `string | null` 반환, SSOT 는 `NormalizedKrxSymbol`
   객체 반환. 호출자가 둘 중 하나에만 의존하면 마이그레이션 시점에 분리.

## 결정

### 1. 3 callers SSOT 직접 import

| 파일 | 변경 |
|------|------|
| `server/persistence/watchlistRepo.ts:7-8` | `from '../dataQuality/emergencyDataQualityGuards.js'` import 분리 → `from '../utils/symbolNormalizer.js'` 분리 |
| `server/persistence/watchlistRepo.ts:428` | `if (normalizeKrxCode(entry.code) !== null)` → `if (normalizeKrxCode(entry.code).valid)` |
| `server/trading/buyPipeline.ts:45-48` | import 분리 — `normalizeKrxCode` 만 SSOT, `isEmergencyBuyPipelineCodeGuardEnabled` 는 그대로 |
| `server/trading/buyPipeline.ts:333` | `normalizeKrxCode(p.stockCode) === null` → `!normalizeKrxCode(p.stockCode).valid` |
| `server/clients/historicalClosePrice.ts:21-25` | 로컬 `function normalizeKrxCode` **완전 제거** + SSOT 신규 import |
| `server/clients/historicalClosePrice.ts:98` | `const code = normalizeKrxCode(symbol);` → `const code = normalizeKrxCode(symbol).code;` |
| `server/clients/historicalClosePrice.ts:107-109` | `__testOnly` 의 `normalizeKrxCode` 도 `.code` accessor 로 wrap (string|null 시그니처 보존) |

### 2. emergencyDataQualityGuards 의 deprecated wrapper 등록 해제

- `export function normalizeKrxCode(input: unknown): string | null` 영구 제거
- `export function assertValidKrxCode(input: unknown): string` 영구 제거
- `import * as symbolNormalizerSsot from '../utils/symbolNormalizer.js';` 영구 제거
- `DataQualityError` / `FatalDataQualityError` / `DEFAULT_KRX_MASTER_GUARD` /
  `assertUsableKrxMaster` / `assertQuoteSanityHealth` / `classifyStage1RejectStrict` /
  `makeStaleQuoteResult` / `formatNullablePct` / 4 ENV 헬퍼 (`isEmergencyMasterGuardScanEnabled`
  / `isEmergencyWatchlistCodeGuardEnabled` / `isEmergencyBuyPipelineCodeGuardEnabled` /
  `isEmergencyStage1StrictEnabled`) 모두 그대로 유지.

### 3. emergencyDataQualityGuards.test.ts 정합

기존 `normalizeKrxCode` / `assertValidKrxCode` import 를 SSOT (`server/utils/symbolNormalizer`)
직접 import 로 교체. 동작 검증 자체는 보존하되 `.code` / `.valid` accessor 사용으로 격상.

### 4. emergencyDataQualityGuardsAdr0438.test.ts 영구 삭제

본 파일은 deprecated wrapper 동작 자체를 검증하던 회귀 테스트. wrapper 등록 해제로
검증 대상 부재 → 파일 영구 제거. SSOT 본체 회귀 (`server/utils/symbolNormalizerAdr0438.test.ts`
44 케이스) 는 그대로 유지하므로 실질 회귀 손실 0.

### 5. .KS / .KQ 외 .KOSPI / .KOSDAQ suffix 자연 확장

기존 historicalClosePrice 의 로컬 정규식 (`^(\d{6})(?:\.(?:KS|KQ))?$/i`) 은 .KOSPI / .KOSDAQ
suffix 미지원. SSOT 의 `stripSuffix` 함수가 .KOSPI → .KS / .KOSDAQ → .KQ 자동 매핑하므로
본 마이그레이션은 자연스러운 확장 (의도된 변경, byte-equivalent 의 *수퍼셋*).

## 12 invariants (정적 grep 회귀 가드 의무)

1. `from '../dataQuality/emergencyDataQualityGuards.js'` import 안에 `normalizeKrxCode` / `assertValidKrxCode` 0건
2. `from '../dataQuality/emergencyDataQualityGuards.js'` import 자체는 *DEFAULT_KRX_MASTER_GUARD / isEmergencyMasterGuardScanEnabled / isEmergencyWatchlistCodeGuardEnabled / isEmergencyBuyPipelineCodeGuardEnabled / isEmergencyStage1StrictEnabled / DataQualityError / FatalDataQualityError / classifyStage1RejectStrict / etc.* 등 다른 export 만 허용
3. `historicalClosePrice.ts` 의 로컬 `function normalizeKrxCode` 부재 (정규식 복붙 영구 차단)
4. 3 callers 모두 `from '../utils/symbolNormalizer.js'` 직접 import
5. `normalizeKrxCode(...)` 반환값 사용은 `.code` 또는 `.valid` 명시 — wrapper 의 string|null 패턴 금지
6. 인접 영역 (watchlistRepo / buyPipeline / historicalClosePrice 의 invalid filter 동작) byte-equivalent 보존
7. LIVE 매매 본체 0줄 변경 (signalScanner / entryEngine / exitEngine / kisClient / orchestrator / autoTradeEngine / trancheExecutor)
8. KIS 주문 함수 5종 import 0건 — 본 PR 신규 호출자 부재
9. 외부 fetch 추가 0
10. emergencyDataQualityGuards 다른 호출자 (productionMasterGuard / krxMaster*.cmd / health.cmd / universeScanner / pipelineHelpers) 무수정
11. ENV 신규 0건 — 본 PR 은 import path 마이그레이션만
12. 회귀 테스트 정적 grep 가드 — 향후 `from '../dataQuality/emergencyDataQualityGuards'` 안에 `normalizeKrxCode` 재등장 시 즉시 실패

## byte-equivalent 동작 보존

- `normalizeKrxCode(input).valid` ≡ `wrapper normalizeKrxCode(input) !== null`
- `normalizeKrxCode(input).code` ≡ `wrapper normalizeKrxCode(input)` (둘 다 invalid 시 null)
- 단, `historicalClosePrice` 의 `.KOSPI` / `.KOSDAQ` 추가 지원은 SSOT 자연 확장 (의도된 격상)

## LIVE 매매 본체 영향 0

- `server/trading/signalScanner.ts` / `signalScanner/**` / `entryEngine.ts` / `exitEngine/**` /
  `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` 모두 0줄 변경
- 본 PR 의 변경은 *호출자 측 import path* + `.valid` / `.code` accessor 정합 정정만

## KIS / KRX / Yahoo / Naver outbound 0

- 본 PR 은 import path 마이그레이션만, 외부 API 호출 추가 0건
- `getStockByCode` (krxStockMasterRepo) read-only — SSOT 가 이미 사용 중

## 잘못된 해결 방법 영구 차단

1. **emergencyDataQualityGuards 의 deprecated wrapper 재도입** — 본 ADR 의 정적 grep 가드가
   향후 PR 에서 `export const normalizeKrxCode` 또는 `export function normalizeKrxCode` 재등장 시
   즉시 실패.
2. **호출자 측 정규식 복붙 (historicalClosePrice 패턴 영구 차단)** — 정적 grep 가드가
   `function normalizeKrxCode(symbol: string)` 패턴 재등장 시 즉시 실패.
3. **`normalizeKrxCode` 시그니처 string|null 변경** — SSOT 의 `NormalizedKrxSymbol` 격상
   의도 위반. 신규 호출자는 반드시 `.code` 또는 `.valid` 명시 사용.
4. **본 PR 에서 productionMasterGuard / DEFAULT_KRX_MASTER_GUARD 등 다른 export 변경** (scope 외).
5. **kisWebSocketSubscriptionManager 의 `normalizeKrxCodeForWs` 본체 변경** — ADR-0438 의 SSOT
   위임 패턴 그대로 보존, 본 PR scope 외.

## 잔여 후속 ADR (사용자 명시)

- ADR-0441 — WAIT cooldown (사용자 명시 잔여 부채 #2 reserve)
- ADR-0442 reserve — `yahooSymbolResolver.ts` direct concat 통합 + 정적 grep 가드 강화
  (`scripts/check_*` 시리즈 추가)

## ADR-0146 PR 자가 review 5 카테고리

- **A. LIVE 매매 안전성**: KIS/KRX quota 0 침범 / LIVE 본체 0줄 / KIS 주문 import 0 / 외부 fetch 0
- **B. wiring 완료 vs 인프라만**: wiring 완료 (3 callers 모두 마이그레이션 확정) / PENDING_WIRING 등재 부재 (즉시 종결)
- **C. ADR INDEX 발급 무결성**: 다음 발급 0440 정합 / 충돌 0 / 별칭 정책 무관
- **D. 회귀 테스트 적정성**: 신규 22 케이스 (정적 grep 가드 14 + 동작 검증 8) / heuristic ≥5/100 LoC 충족 (~22/100)
- **E. 정책 위반**: validate:all 16종 baseline 무회귀 / 사전 baseline INDEX.md 22 + SilentDegradation 1건 본 PR 무관

## 거버넌스

- INDEX.md 다음 발급 0440 → 0441 + 0440 등재
- CLAUDE.md 변경 이력 한 줄
- PENDING_WIRING 갱신 부재 (즉시 종결 결함)
