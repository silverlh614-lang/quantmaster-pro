# ADR-0444 — Static Grep Guards Hardening (yahooSymbolResolver SSOT 우회 영구 차단)

@responsibility 신규 호출자가 yahooSymbolResolver / symbolNormalizer SSOT 우회 시 정적 검증으로 즉시 차단. 가드 A (Yahoo direct concat) + 가드 B (KRX regex + Yahoo 조립 컨텍스트) 단일 스크립트 통합.

## Status

Accepted (2026-05-08).

사용자 명시 2순위 #2 — *"정적 grep 가드 강화 (inline regex / direct concat / wrapper / invalid code provider 자동 차단)"* 직접 반영.

## Context

ADR-0438 (PR #696) `symbolNormalizer` SSOT + ADR-0440 (PR #698) deprecated wrapper 영구 제거 + ADR-0443 (PR #700) `yahooSymbolResolver` SSOT 마이그레이션 후, **신규 호출자가 SSOT 우회 시 즉시 차단할 정적 검증 인프라 부재**.

ADR-0443 의 `yahooSymbolResolverAdr0443.test.ts` 는 *마이그레이션 검증* 용 (10 호출자 한정 정적 grep). 본 ADR 은 *전 코드베이스* 보호 정적 검증 스크립트 — 신규 호출자가 추가될 때마다 즉시 검증.

ADR-0438 §"잔여 후속 PR" 명시:
> 정적 grep 가드 강화 (`scripts/check_*` 시리즈 추가) — 호출자 측 inline 정규식 / direct concat 자동 차단

ADR-0440 §"잔여 후속 ADR" 명시:
> `scripts/check_*` 시리즈 정적 grep 가드 추가

## Decision

### 신규 정적 검증 스크립트 — `scripts/check_yahoo_symbol_resolver.js`

기존 `scripts/check_yahoo_range.js` (ADR-0082) / `scripts/check_symbol_boundary.js` (ADR-0185) 패턴 정합. ESM, 외부 패키지 0건, 노드 빌트인만 (`fs` / `path` / `child_process`).

가드 2종 (단일 스크립트로 통합).

### 가드 A — Yahoo Direct Concat

**탐지 시그니처**:
- `\$\{[^}]+\}\.KS\b` — 템플릿 리터럴 안 `${code}.KS` / `${entry.code}.KS` / `${baseCode}.KS` 등 (어떤 변수명도 매칭).
- `\$\{[^}]+\}\.KQ\b` — 동일 `.KQ`.

**화이트리스트 (자동 인정)**:

| 파일 / Prefix | 사유 |
|---|---|
| `server/screener/adapters/yahooSymbolResolver.ts` | SSOT 자기 자신 |
| `server/utils/symbolNormalizer.ts` | ADR-0438 SSOT (별도 .KS/.KQ 매핑) |
| `server/learning/defectEvolutionLedger.ts` | description 텍스트 ledger (시그니처 인용만) |
| `scripts/check_yahoo_symbol_resolver.js` | 본 스크립트 자기 자신 |
| `scripts/check_yahoo_symbol_resolver.test.js` | 회귀 테스트 |
| `*.test.ts` / `*.test.tsx` | 회귀 시나리오 (시그니처 fixture 포함) |
| `docs/adr/**.md` | ADR 문서 (시그니처 인용) |
| `src/` 디렉토리 | 클라이언트 측 (서버 SSOT 접근 불가, 서버 프록시 경유) |

**Graceful fallback 인정 (ADR-0443 마이그레이션 그레이스)**:

같은 라인에 SSOT 호출 함수 (`tryGetYahooSymbol|fetchYahooQuoteByCode|getYahooSymbol|resolveYahooSymbolForCode|fetchYahooQuoteWithMarketFallback|toYahooSymbol|normalizeKrxCode`) 가 함께 등장하면 위반 아님:

```ts
// graceful fallback 패턴 (위반 아님)
return tryGetYahooSymbol(code) ?? `${code}.KS`;
return (await fetchYahooQuoteByCode(code, fetchYahooQuote)) ?? `${code}.KS`;
```

**ADR opt-in 라인 주석 인정**:

같은 라인 또는 직전 라인에 `// ADR-NNNN:` 주석 (예: `// ADR-0443:` / `// ADR-0444:`) 이 있으면 위반 아님:

```ts
// 같은 라인 (위반 아님)
return `${code}.KS`; // ADR-0444: legacy fallback

// 직전 라인 (위반 아님)
// ADR-0443: 마이그레이션 그레이스
return `${code}.KS`;
```

**파일 헤더 ADR 마커 (파일 전체 opt-in)**:

파일 첫 50줄 안에 `ADR-0231` / `ADR-0438` / `ADR-0443` / `ADR-0444` 마커가 등장하면 파일 전체 opt-in. 기존 마이그레이션 PR (PR #700 = ADR-0443) 이 이미 `historicalClosePrice.ts` / `backtestEngine.ts` / `lateWinEvaluator.ts` 등에 헤더 마커 추가 — 자연 흡수.

광범위 ADR 인용 차단을 위해 *관련 ADR 4개* 만 인정 (다른 ADR 만 있는 파일은 opt-in 인정 안 함).

### 가드 B — KRX 6자리 정규식 + Yahoo 조립 컨텍스트

**탐지 시그니처**:
- `\/\^\\d\{6\}\$\/[gimsuy]*` — 정확히 `/^\d{6}$/` 또는 플래그 포함 (`/^\d{6}$/i` 등).

**위반 조건 (3 모두 만족)**:
1. 라인에 `/^\d{6}$/` 정규식 등장.
2. 같은 라인 OR 다음 1 라인에 `.KS` / `.KQ` 템플릿 리터럴 또는 문자열 리터럴 (`'.KS'` / `"\.KS"` / `` `.KS` ``) 등장.
3. 화이트리스트 / opt-in 주석 / 파일 헤더 마커 / SSOT 호출 부재.

**위반 아님 (legitimate input validator)**:

```ts
// 순수 input validator — 통과
if (/^\d{6}$/.test(code)) return null;
const isValid = /^\d{6}$/.test(code);
return code.match(/^(\d{6})(\.(KS|KQ))?$/);
```

**위반 (Yahoo symbol normalizer 패턴)**:

```ts
// 같은 라인 조립 — 차단
if (/^\d{6}$/.test(s)) return `${s}.KS`;

// 다음 라인 조립 — 차단
if (/^\d{6}$/.test(s)) {
  return `${s}.KS`;
}
```

가드 B 의 핵심 구분 — *순수 validator* (입력 검증만) vs *normalizer* (조립까지) 의미 분리. 코드베이스의 30+ legitimate `/^\d{6}$/` 사용처는 모두 input validator 라 baseline=0 자연 달성.

**화이트리스트** (가드 A 와 동일 + `server/utils/symbolNormalizer.ts` 명시).

### 14 Invariants (절대 변경 금지)

1. **신규 호출자 측 SSOT 우회 즉시 차단** — 가드 A: Yahoo direct concat / 가드 B: KRX regex + Yahoo 조립 컨텍스트.
2. **화이트리스트 명시** — SSOT 자기 자신 3 + 스크립트 + 테스트 + ADR docs + `src/` 클라이언트.
3. **Graceful fallback 인정** — `tryGetYahooSymbol(code) ?? \`${code}.KS\`` 패턴 (ADR-0443 마이그레이션 그레이스).
4. **ADR opt-in 라인 주석 인정** — `// ADR-0443:` / `// ADR-0444:` 같은 라인 또는 직전 라인.
5. **파일 헤더 ADR 마커** — 첫 50줄 안 ADR-0231/0438/0443/0444 마커 (파일 전체 opt-in).
6. **baseline 위반 0건** — 본 PR 도입 시점 코드베이스 전수 검증 (정확히 0 위반).
7. **외부 패키지 0건** — 노드 빌트인 (`fs` / `path` / `child_process`) + ESM.
8. **ENV 신규 도입 0건** — 정적 검증은 항상 활성 (회귀 위험 격리는 git revert).
9. **LIVE 매매 본체 0줄 변경** — `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` / `buyPipeline.ts` 모두 0줄.
10. **KIS / KRX / Yahoo / Naver outbound 0** — 정적 코드 분석만, 외부 API 호출 0건.
11. **ADR-0438 / ADR-0440 / ADR-0443 SSOT 인프라 위에 *시간 강제력* 추가** — 기존 SSOT 본체 변경 0.
12. **baseline 카탈로그 영구 도입 안 함** — 코드베이스 위반 0건 → 카탈로그 불필요 (`baseline 영구 제거` 정책).
13. **precommit 통합 의무** — `validate:all` 안에 17번째 → 18번째 통합.
14. **`autoTradeEngine` / `orderExecutor` / `trancheExecutor` import 0건** — 정적 분석 도구는 매매 본체 무관.

### ENV 우회

본 ADR 은 ENV 우회를 도입하지 **않는다**. 정적 검증은 항상 활성. 회귀 발견 시 `git revert` 로 즉시 롤백 가능.

ADR-0157 (ENV 정확 비교 의무) 는 본 ADR 에 무관 (ENV 신규 도입 0건).

## Consequences

### 긍정

- **신규 호출자 SSOT 우회 영구 차단** — 정적 grep 가드가 신규 코드에서 `${code}.KS` / `/^\d{6}$/.test(code) + .KS` 조립 즉시 검출.
- **마이그레이션 그레이스 보존** — graceful fallback 패턴 (`tryGetYahooSymbol(c) ?? \`${c}.KS\``) + 파일 헤더 ADR 마커 자연 인정.
- **input validator 보호** — 가드 B 의 좁은 시그니처 (조립 컨텍스트 필요) 로 30+ legitimate `/^\d{6}$/` validator baseline=0 보장.
- **외부 패키지 0건** — ESM + 노드 빌트인만으로 의존성 제로.

### 부정

- **수동 마이그레이션 그레이스** — ADR opt-in 주석 또는 파일 헤더 마커 추가는 호출자 책임 (자동 검출 불가).
- **다음 1 라인 컨텍스트 한정** — 가드 B 는 인접 1 라인까지만 컨텍스트 검증 (`if (regex) { ... return .KS; }` 다중 라인 패턴은 정확 매칭).

## Migration Plan

### 코드베이스 사전 조사 후 wiring

본 PR 도입 시점 코드베이스 audit 결과:

| 카테고리 | 파일 | 처리 |
|---|---|---|
| SSOT 자기 자신 (3) | yahooSymbolResolver.ts / symbolNormalizer.ts / defectEvolutionLedger.ts | 화이트리스트 |
| ADR-0443 graceful fallback (4) | prefetchedContext.ts / stockScreener.ts / universeScanner.ts / stockPickReporter.ts | 같은 라인 SSOT 호출 자연 인정 |
| ADR-0443 파일 헤더 마커 (4) | historicalClosePrice.ts / backtestEngine.ts / lateWinEvaluator.ts / reportGenerator.ts | 첫 50줄 ADR-0443 자연 인정 |
| 본 PR 신규 ADR-0444 opt-in (2) | priceHistory.ts:11+13 / counterfactualShadowPriceProviderAdapter.ts:196+198 | `// ADR-0444:` 주석 추가 (코드 byte-equivalent) |
| 클라이언트 측 (1) | src/services/stock/historicalData.ts | `src/` prefix 자연 제외 |

baseline=0 보장.

### 회귀 테스트

`scripts/check_yahoo_symbol_resolver.test.js` 신규 — vitest 기반 (기존 `scripts/check_yahoo_range.test.js` 패턴 정합). 31 케이스:

- **baseline 3** — 통과 + JSON 모드 + ADR-0444 마커.
- **Guard A 13** — direct concat / `.KQ` / graceful fallback / SSOT 호출 / opt-in 주석 같은·직전 라인 / 파일 헤더 / ADR-0231 / 주석 안 시그니처 / suffix strip / endsWith / 다중 위반 / JSON 출력 / 화이트리스트.
- **Guard B 5** — same-line / next-line / pure validator / early return / opt-in 주석.
- **화이트리스트 4** — yahooSymbolResolver SSOT / src 디렉토리 / docs/adr / *.test.ts.
- **모드 옵션 2** — `--changed` / `--json`.
- **통합 시나리오 3** — 양 가드 동시 / 진단 메시지 형식 / 해결 안내.

heuristic ≥5/100 LoC 충족 (~5 cases / 100 LoC scripts).

### `package.json` 통합

`validate:yahooSymbolResolver` npm script 추가:
```json
"validate:yahooSymbolResolver": "node scripts/check_yahoo_symbol_resolver.js"
```

`validate:all` 끝에 추가 (기존 17 항목 → 18 항목):
```
... && npm run validate:prPaceAudit && npm run validate:yahooSymbolResolver
```

precommit 통합은 자동 (`precommit` script 가 `validate:all` 호출 안 하므로 본 PR 은 `validate:all` 만 추가). 사용자 명시 *"precommit 통합 의무 — `validate:all` 안에 17번째 → 18번째 통합"* 정합.

## 잘못된 해결 방법 (영구 차단)

1. **가드 A whitelist 확장으로 위반 우회** — whitelist 는 SSOT 자기 자신 (3 파일) + 정의 파일 + 테스트 + ADR docs + `src/` 만. 새 호출자 추가 시 반드시 graceful fallback 또는 ADR opt-in 주석 사용.
2. **가드 B 단순 `/^\d{6}$/` 모두 차단** — input validator legitimate 30+ 위반 발생, baseline=0 불가능. *조립 컨텍스트* 결합 시그니처로 좁힘.
3. **baseline 카탈로그 도입** (`BASELINE_TECHNICAL_DEBT` 등) — `baseline 영구 0건` 정책 위반. 코드베이스 audit 후 graceful fallback / opt-in 주석 / 파일 헤더 마커로 자연 흡수.
4. **`src/` 디렉토리 server SSOT 강제 적용** — 클라이언트 측은 서버 SSOT 접근 불가 (서버 프록시 경유). 별도 ADR scope.
5. **ENV 우회 도입** — 정적 검증은 항상 활성 (ENV 무관). 회귀 발견 시 git revert.
6. **외부 npm 패키지 도입** — `fast-glob` / `picomatch` / `chalk` 등 외부 의존성 0 정책. 노드 빌트인 + ESM 만.
7. **다중 라인 광범위 컨텍스트 검증** — 다음 1 라인까지만 (가드 B). 더 넓은 컨텍스트는 false positive 위험 + AST 의존성 도입 필요.
8. **ADR opt-in 주석을 광범위 ADR 매칭** (모든 ADR 번호 인정) — 4개 관련 ADR (0231/0438/0443/0444) 만 헤더 인정. 광범위 ADR 매칭 시 무관한 파일도 우회 가능.

## 잔여 후속 PR (scope 외)

- **wrapper / invalid code provider 자동 차단 정책 추가** — `assertValidKrxCode` deprecated wrapper 재도입 시 정적 grep 가드 (별도 ADR — 사용자 명시 *"wrapper / invalid code provider 자동 차단"*).
- **KIS WebSocket invalid code 정적 grep 강화** — `kisStreamClient.subscribeStock` 직접 호출 시 ADR-0437/0438 위임 검증 (별도 ADR).
- **`historicalData.ts` (클라이언트) Yahoo SSOT 도입** — 서버 프록시 경유 매핑 별도 ADR scope.
- **AST 기반 정적 분석 격상** — 다중 라인 컨텍스트 검증 + 함수 시그니처 분석 (별도 ADR — `ts-morph` / TypeScript Compiler API 의존성 도입 의무).

## References

- ADR-0082 — Yahoo Range Restriction Policy (정적 grep 가드 패턴 시드).
- ADR-0146 — PR 자가 review 5 카테고리.
- ADR-0148 — Governance Followup Static Checks (4 정적 검증 도구 시드).
- ADR-0231 (PR #624) — yahooSymbolResolver SSOT 도입.
- ADR-0241 — Yahoo quote sanity 회복 정책 (STALE_BASE 자동 다른 시장 fallback).
- ADR-0438 (PR #696) — symbolNormalizer SSOT (KRX code 정규화 + Yahoo 심볼 변환 단일 진입점).
- ADR-0440 (PR #698) — symbolNormalizer 직접 import 마이그레이션 (deprecated wrapper 영구 제거).
- ADR-0443 (PR #700) — yahooSymbolResolver SSOT migration (10 호출자 마이그레이션).
