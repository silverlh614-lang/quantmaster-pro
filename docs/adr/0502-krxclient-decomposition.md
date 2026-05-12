# ADR-0502c — krxClient 분해 (ACMA 1500줄 한계 차단 해소)

**Status**: Accepted (2026-05-12)
**Alias group (ADR-0159)**: 0502a (`0502-kis-official-investor-flow-promotion.md`, 2026-05-11 23:05) / 0502b (`0502-kis-official-global-fallback-until-krx-recovery.md`, 23:39) / **0502c (본 ADR, 2026-05-12)**
**Related**: ADR-0135 (kisClient 분해 — 본 ADR 의 직접 패턴 차용), ADR-0133 (file complexity gate integrity), ADR-0009 (bld soft cooldown), ADR-0141 (Stage 1 raw fetcher), ADR-0256 (시간대 게이팅), ADR-0259 (recovery probe), ADR-0445 (parser empty rows), ADR-0438 (symbol normalizer), ADR-0159 (별칭 정책)

## Context

`server/clients/krxClient.ts` 가 **2105 줄** 로 누적되어 `scripts/check_complexity.js`
(ADR-0133) 의 1500줄 ACMA 한계를 초과하며 커밋 차단 baseline 미등재 상태.

CLAUDE.md 절대 규칙 #2 의 `kisClient` 단일 통로와 동등한 위치 — KRX 공개·인증
OpenAPI 단일 통로 SSOT. 한 파일에 누적된 책임:

1. **타입 SSOT** — `KrxInvestorRow` / `KrxPerPbrRow` / `KrxShortBalanceRow` / `KrxInvestorTradingDiagnostic` /
   `KrxInvestorDetailRow` / `KrxMarketCapRow` / `KrxInvestorParserStatus` / `FetchInvestorTradingOptions` 등 8+ 도메인 타입
2. **설정** — `KRX_BASE` / `KRX_JSON_PATH` / `KRX_OTP_PATH` / `KRX_DOWNLOAD_CSV_PATH` /
   `KRX_DISABLED` / `BLD_INVESTOR_TRADING` / `BLD_PER_PBR` / `BLD_SHORT_BALANCE` /
   `BLD_INVESTOR_DETAIL` / `REQUEST_TIMEOUT_MS` / `CACHE_TTL_MS` / `KRX_USER_AGENT`
3. **캐시** — `_cache` Map + `getCached` / `setCached` / `resetKrxCache` SSOT + diagnostic Map
4. **회로 (ADR-0009 bld cooldown + ADR-0259 recovery probe)** — `_bldFailureState` /
   `BLD_FAILURE_THRESHOLD` / `BLD_COOLDOWN_MS` / `RECOVERY_PROBE_WINDOW_MS` /
   `isBldCooldown` / `shouldSkipForRecoveryProbe` / `markRecoveryProbed` /
   `recordBldFailure` / `recordBldSuccess` / `isBldInRecoveryProbe` /
   `getKrxBldFailureStates` (외부 노출)
5. **시간대 게이팅 (ADR-0256)** — `isKrxTimeWindowGatingDisabled` /
   `shouldSkipKrxCallByTimeWindow` (PRE_DAWN/LUNCH_BREAK/POST_CLOSE_PRE_PUBLISH)
6. **날짜 유틸** — `todayKstYYYYMMDD` / `isValidYyyymmdd` / `previousBusinessDayYYYYMMDD` /
   `resolveTradeDate` (ADR-0009 후퇴)
7. **HTTP 헬퍼** (1269줄, 가장 큰 섹션) — `krxPost` / `krxInvestorOtpCsv` (OTP→CSV
   다운로드) / `decodeKrxCsv` (EUC-KR/UTF-8) / `parseCsvLine` / `parseKrxCsv` /
   `classifyContentType` / `makeKrxResponseKind` / `sanitizeKrxPayload` /
   `requiredKrxPayloadKeys` / `forbiddenKrxPayloadKeys` / `buildKrxOtpPayload` /
   `buildKrxAutoDisabledDiagnostic` / KIS-only/first-rebuild 모드 헬퍼
8. **파싱·정규화** — `extractRows` / `extractRowsDetailed` / `collectArrayCandidates` /
   `normalizeKrxInvestorRows` / `investorBucket` / `classifyInvestorParserStatus` /
   `endpointIssueHintForInvestorParser` / `KRX_INVESTOR_ALIASES` /
   `INVESTOR_ROW_CANDIDATE_KEYS` / `rawValueByAliases` / `strByAliases` / `numByAliases` /
   `buildInvestorTradingDiagnostic` / `buildInvestorTradingVariants` /
   `resolveKrxIsuCdForSymbol` / `normalizeCode` / `normalizeIsuCd`
9. **공개 쿼리 API** (357줄) — `fetchInvestorTrading` (ADR-0141 변형 시도 루프) /
   `fetchInvestorTradingDetail` (Stage 1) / `fetchPerPbr` / `fetchShortBalance`
10. **상태 점검** — `getKrxStatus` / `getLastKrxInvestorTradingDiagnostic` /
    `isKrxAutomaticFetchDisabled`
11. **블루프린트 파사드 (인증 OpenAPI)** — `getKrxAuthKey` / `krxGet` /
    `fetchKrxDailyOhlcv` / `fetchKrxSectorIndices` / `fetchKrxMarketCap` +
    `fetchKrxInvestorTrading` / `fetchKrxPerPbr` / `fetchKrxShortBalance` alias +
    `krxOpenApi.ts` re-export

총 **28 export**, **14 외부 importer**, **3 회귀 테스트 파일**.

## Decision

ADR-0135 (kisClient 분해) 패턴 정확 차용 — `clients/krxClient/` 디렉토리 + 도메인
격리 + barrel re-export. **외부 importer 0줄 변경** + **byte-equivalent 동작 보존**.

### 디렉토리 구조

```
server/clients/krxClient/
├── types.ts                  // 8+ 타입 SSOT (~150 LoC)
├── constants.ts              // ENV/BLD/USER_AGENT/timeout/cache TTL (~50 LoC)
├── cache.ts                  // _cache + getCached/setCached/resetKrxCache/diagnostic Map (~60 LoC)
├── cooldown.ts               // ADR-0009 + ADR-0259 회로 (~110 LoC)
├── timeWindow.ts             // ADR-0256 시간대 게이팅 (~50 LoC)
├── dateUtils.ts              // 날짜 유틸 (todayKst / resolveTradeDate / previousBusinessDay) (~70 LoC)
├── http.ts                   // krxPost + KRX_USER_AGENT + content-type 분류 + payload sanitize (~250 LoC)
├── csv.ts                    // decodeKrxCsv + parseCsvLine + parseKrxCsv + otpCsv fetcher (~330 LoC)
├── parser/
│   ├── investorParser.ts     // normalizeKrxInvestorRows + alias + classifyParserStatus (~280 LoC)
│   ├── rowExtractor.ts       // extractRows + collectArrayCandidates + 다중 키 fallback (~120 LoC)
│   └── diagnostic.ts         // buildInvestorTradingDiagnostic + endpointIssueHint + buildVariants (~330 LoC)
├── queries/
│   ├── investor.ts           // fetchInvestorTrading + fetchInvestorTradingDetail (~180 LoC)
│   ├── perPbr.ts             // fetchPerPbr (~40 LoC)
│   └── shortBalance.ts       // fetchShortBalance (~40 LoC)
├── facade.ts                 // 인증 OpenAPI 파사드 (getKrxAuthKey / krxGet / fetchKrx*) (~120 LoC)
└── index.ts                  // barrel — 28 export 전수 (≤80 LoC)
```

총 **15 파일** (디렉토리 2 sub 포함), 각 파일 1,500줄 한계 안전 마진 확보.

### Boundary Rules

- **`types.ts`** — 외부 의존성 0 (logger 도 import 안 함). 다른 모듈이 import 가능
- **`constants.ts`** — process.env 직접 접근 격리, getter 함수 export
- **`cache.ts`** — `constants.ts` 만 import (CACHE_TTL_MS)
- **`cooldown.ts`** — `constants.ts` 만 import (BLD_FAILURE_THRESHOLD/COOLDOWN_MS/RECOVERY_PROBE_WINDOW_MS)
- **`timeWindow.ts`** — process.env 직접 접근 + 순수 함수
- **`dateUtils.ts`** — `marketClock.js` import (isMarketDataPublished)
- **`http.ts`** — `constants`, `cache`, `cooldown`, `timeWindow`, `types` import
- **`csv.ts`** — `http.ts` 의 KRX_USER_AGENT 공유, `constants` import
- **`parser/*`** — 외부 KRX SDK 의존성 없음, 순수 변환
- **`queries/*`** — `http`, `csv`, `parser`, `dateUtils`, `cache`, `types`, `constants` import +
  diagnostic Map mutate
- **`facade.ts`** — `krxOpenApi.js` re-export + `queries/*` alias
- **`index.ts`** — 모든 모듈 barrel re-export. 28 export 시그니처 100% 보존

### Migration Plan

1. **Phase 2 (스캐폴딩)** — 15 신규 파일 빈 껍데기 + `@responsibility` 태그 + 시그니처만 추가.
   기존 `krxClient.ts` 본체는 무변경.
2. **Phase 3 (순차 이동)** — 다음 순서로 한 번에 한 모듈씩 이동 + lint 통과 확인 + 다음:
   - 3-1: `types.ts` (의존성 0)
   - 3-2: `constants.ts` (types 만 의존)
   - 3-3: `cache.ts` (constants)
   - 3-4: `cooldown.ts` (constants)
   - 3-5: `timeWindow.ts` (의존성 0)
   - 3-6: `dateUtils.ts` (marketClock)
   - 3-7: `http.ts` (constants/cache/cooldown/timeWindow/types) — 가장 큰 단계
   - 3-8: `csv.ts` (http/constants)
   - 3-9: `parser/rowExtractor.ts`
   - 3-10: `parser/investorParser.ts`
   - 3-11: `parser/diagnostic.ts`
   - 3-12: `queries/investor.ts`
   - 3-13: `queries/perPbr.ts`
   - 3-14: `queries/shortBalance.ts`
   - 3-15: `facade.ts`
   - 3-16: `index.ts` barrel 완성
3. **Phase 4 (barrel 축소)** — 기존 `krxClient.ts` 를 `export * from './krxClient/index.js'`
   단일 줄 barrel 로 축소 (ADR-0135 패턴 정합). 외부 14 importer 무수정.
4. **Phase 5 (검증)** — lint + validate:complexity + 회귀 3 테스트 + precommit.

## Consequences

### 긍정
- ACMA 1500줄 한계 통과 → 신규 wiring 시 baseline 우회 불필요
- 도메인 격리 → 새 KRX endpoint 추가 시 영향 반경 ↓
- ADR-0135 정합 → kisClient + krxClient 양쪽 SSOT 가 동일 분해 패턴
- HTTP/CSV/parser/queries 4 도메인이 명확히 분리되어 변경 시 회귀 위험 감소

### 부정
- 디렉토리 신규 2종 (`parser/`, `queries/`) — onboarding 추가 학습 1회
- import 경로 늘어남 — barrel 통합으로 외부 importer 영향 0

### 절대 불변식

1. **외부 importer 14개 모두 무수정** (barrel 호환 의무)
2. **28 export 시그니처 100% 보존** — 본 PR 은 정책 변경 0, 순수 이동
3. **byte-equivalent 동작** — krxPost / krxInvestorOtpCsv / parser 본체 의미 변경 0
4. **ADR-0009 / 0256 / 0259 / 0141 / 0445 정책 보존**
5. **회귀 테스트 3개 (`krxClient.test.ts` / `marketClockGate.test.ts` / `investorDetail.test.ts`) 무수정**
6. **`krxOpenApi.ts` 본체 변경 0** (facade re-export 만)
7. **CLAUDE.md 절대 규칙 #2 정합** — KRX 단일 통로 정책 보존
8. **LIVE 매매 본체 0줄 변경** — kisClient/orchestrator/signalScanner/autoTradeEngine 무수정

## Alternatives Considered

- **A. 임시 baseline 등재 후 wiring** — ADR-0133 baseline drift 결함 누적 (scanDiagnostics
  3538 줄 사례). 거버넌스 정책 위반으로 거부.
- **B. queries/* 만 분리, HTTP+parser 합본 유지** — http.ts 가 800줄+ 되어 ACMA 재차단.
  분해 효과 미충분.
- **C. 1 파일 = 1 query (fetchInvestorTrading.ts / fetchPerPbr.ts / ...) 패턴** — 공통 HTTP
  헬퍼가 중복되거나 순환 import 위험. ADR-0135 패턴과 어긋남.

채택: **ADR-0135 정합 도메인 격리** (auth → constants/cache/cooldown 대응, queries → 도메인별).

## Migration Plan 체크리스트

`_workspace/2026-05-12_krxclient-decomposition/refactor/plan.md` 참조.
