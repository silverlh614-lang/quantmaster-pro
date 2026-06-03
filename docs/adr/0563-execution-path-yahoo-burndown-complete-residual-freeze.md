# ADR-0563 — 실행경로 Yahoo burn-down 완료 선언 + 잔존 비실행 의존 동결

> 상태: Accepted (문서/ADR/CLAUDE.md/가드 사유문자열 전용 — 런타임 `.ts` 동작 0줄, ENV flag 변경 0, quota 0).
> 정식 발급 번호 `0563` — 출처: `docs/adr/INDEX.md` §"다음 발급: 0563" (2026-06-03, 마지막 발급 0562).
> 작성: 2026-06-03 / architect
> 분류 SSOT: `docs/audits/2026-06-03-yahoo-dependency-catalog.md` (전수 감사 B/C/D + KIS 대체표).
> 계승: ADR-0561(KIS Primary 절대불변식) · ADR-0562(Yahoo 경계 잠금 + 가드 전수 탐지).

---

## Context

ADR-0561 은 **KIS(L1) Primary 절대불변식**("KIS-capable 레이어에서 Yahoo(L3)-first 금지,
Yahoo 는 KIS 대체불가 시에만 최후 fallback")을 §2.3 데이터 신뢰 위계의 절대 규칙으로 코드화했다.
ADR-0562 는 전수 감사를 경계로 명문화하고 가드(`check_kis_primary_invariant.js`)를 **모든
Yahoo-first 진입**(직접 URL·`.KS`/`.KQ` raw concat·`fetchCloses` 국내심볼·Yahoo client 직접호출)
탐지로 확장했다. 그 결과 잔존 Yahoo-first 가 **GRANDFATHER_ALLOWLIST 7파일 / 13 hit** 으로
완전히 가시화되어 추적되고 있다 (사유 `MIGRATION_PENDING_ADR0561`, 신규 진입은 EXIT 1 차단).

**실행경로(매수·매도·Gate score) Yahoo burn-down 은 이미 완료됐다:**

- **Gate quote (시계열 파생지표 MA/RSI/MACD/ATR/BB/MTAS)** — C1, `fetchYahooQuoteByCode` 2종
  GRANDFATHER 비움(KIS FHKST03010100 primary, R1 라우터 `technicalQuoteRouter`). grandfather 0.
- **LIVE 청산 종가** — `exitEngine/helpers/priceHistory.ts`·`ma60.ts` → `closeSeriesProvider`
  (flag OFF byte-equal, flag ON KIS 일봉). ADR-0562 후속 patch(commit `ee7d6c1`)로 burn-down 완료.

**잔존 13 hit / 7파일을 전수 재조사**한 결과 — closeSeriesProvider 드롭인이 되는 파일은 0개,
그리고 **단 하나도 live 매수·매도·Gate score 결정에 유입되지 않는다.** 모두 학습 귀인 /
텔레그램 표시 / KRX(L1)-first 뒤 Yahoo fallback(이미 L1 primary)이다. 즉 사용자 원우려
("Yahoo stale 이 Gate score 를 오염시킨다")는 **실행경로에서 구조적으로 해소된 상태**다.

남은 7개를 하나씩 bespoke 라우터(OHLCV/지수/ECOS-FX/섹터/KIS-quote 어댑터)로 치는 것은 정확히
**두더지잡기(whack-a-mole)** 이며 — 사용자가 명시 거부한 방식 — 가치도 비실행이라 marginal 하다.
본 ADR 은 이 사실을 경계로 확정하고 잔존을 **동결(freeze)** 한다.

### 잔존 13 hit / 7파일 전수 분류 (실제 모양 · 소비처 · 매매 영향 · 필요 라우터)

| 파일:라인 | 실제 모양 | 소비처 | 매매 결정 영향 | (재활성 시) 필요 라우터 |
|---|---|---|---|---|
| `newsSupplyLogger.ts:85` | 종가배열 `number[]` — 국내 code + EWY(글로벌) **혼재** | alerts/뉴스-수급 귀인 | ❌ 학습 귀인 통계 | closeSeriesProvider 공용 승격 + 호출분리 |
| `lateWinEvaluator.ts:68` | **OHLCV[]**(high/low/close) raw URL | learningOrchestrator | ❌ 학습 | OHLCV 라우터(종가-only 부족) |
| `historicalClosePrice.ts:65` | 단일시점 종가 — **이미 KIS-first** | dataQuality/학습 라벨러 | ❌ 학습 결산 | Yahoo 잔존 fallback 제거만 |
| `koreanQuoteBridge.ts:142,154` | 전체 일봉 quote — **KRX(L1)-first → Yahoo fallback** | krxClient | △ quote 서빙(L1 primary 충족) | KRX·Yahoo 사이 KIS-quote 어댑터 |
| `reportGenerator.ts:896,905` | `^KS11` 지수 + `KRW=X` 환율 종가 | 텔레그램 시황요약 | ❌ 표시 | 지수 라우터 / ECOS 환율 |
| `marketDataRefresh.ts:855` | `KRW=X` 환율 — **이미 ECOS 교차검증**(ADR-0071) | 매크로 상태 | ❌ 표시·교차검증 | ECOS-primary 승격 |
| `sectorSources.ts:272,277` | `assetProfile` 섹터분류 | 스크리너 섹터 메타 | ❌ 메타데이터 | KRX 업종분류 |

핵심: 위 표의 "매매 결정 영향" 열 = **전부 ❌(또는 L1-primary 충족 △)**. 실행경로 ✅ 항목 0개.

---

## Decision

### D1 — 실행경로 Yahoo burn-down 완료 선언 (CLOSED)
매수·매도·Gate score 결정에 유입되던 Yahoo(L3)-first 진입은 **전부 burn-down 완료**됐다
(Gate quote C1 grandfather 0 + LIVE 청산 종가 closeSeriesProvider). 본 도메인의 추가
마이그레이션 작업은 **종료**한다. 사용자 절대불변식(ADR-0561)은 실행경로에서 충족됐다.

### D2 — 잔존 13 hit / 7파일 비실행 동결 (FROZEN, bounded backlog)
잔존은 **학습 귀인(3) + 텔레그램 표시(3: FX/지수/섹터) + KRX-fallback quote(1, 이미 L1 primary)**
이며 live 매매에 무관하다. 이를 **bounded backlog 로 동결**한다 — 추적은 유지하되 일괄·즉시
마이그레이션은 하지 않는다(두더지잡기 종료). Yahoo stale 이 이 경로에서 발생해도 오염 대상은
학습 통계·표시 문자열일 뿐 매매 신호가 아니다(불변식 #6 — provider 이슈 ≠ market signal).

### D3 — 가드 사유 재분류 (MIGRATION_PENDING → FROZEN_NON_EXECUTION)
`check_kis_primary_invariant.js` GRANDFATHER_ALLOWLIST 7항목의 사유를
`MIGRATION_PENDING_ADR0561` → **`FROZEN_NON_EXECUTION_ADR0563`** 으로 재분류한다.
탐지 로직·매칭·EXIT 코드는 **무변경** — 사유 문자열·OK 메시지·가이던스 텍스트만 바꾼다.
효과: (a) 잔존은 "마이그레이션 대기"가 아니라 "의도적 동결"로 의미가 명확해지고,
(b) 가드는 **신규 Yahoo-first 진입을 여전히 EXIT 1 로 차단**한다(drift 재발 방지 유지).

### D4 — 재활성 조건 (동결 해제는 deliberate ADR only)
동결된 7파일 중 어느 하나라도 재활성(KIS-first 치환)하려면 — 위 표의 "필요 라우터"가
서로 다르므로 — **shape 별 별도 실행 ADR**(라우터 신설 + shadow A/B + 회귀)을 발급한다.
일괄 batch·즉흥 one-by-one 치환은 금지(두더지잡기 재발 방지). 동결 해제는 전략 판단 사항이며
본 ADR 의 동결 상태가 기본값이다.

---

## 제약 (불변식 정합)

- 본 ADR 은 **문서/정책 선언 + 가드 사유 문자열 재분류**이며 런타임 동작을 바꾸지 않는다
  (executionImpact=NONE — 런타임 `.ts` 0줄, ENV 0, KIS/KRX/Yahoo quota 0).
- 9대 불변식(§2.1) VERBATIM 0줄 변경. §2.3 데이터 신뢰 절대규칙(ADR-0561) 충족 선언.
- ADR-0561 D1~D4(절대불변식·quota 엔지니어링·진짜 대체불가만·가드 사양), ADR-0562 D1~D4
  (5건 영구잠금·C grandfather·가드 통합·최종 5건)를 **계승**한다 (무효화 0).
- 가드 탐지 로직 무변경 → 신규 Yahoo-first 차단 능력 보존(회귀 0).

## Patch Scope Guard (ADR-530)

- `targetDomain`: governance(ADR/CLAUDE.md) + 가드 사유 문자열.
- `allowedFiles`: `docs/adr/0563-*.md`(신규) · `docs/adr/INDEX.md` · `CLAUDE.md`(§2.3 괄호 1줄) ·
  `scripts/check_kis_primary_invariant.js`(사유 문자열·메시지·헤더 주석) ·
  `docs/audits/2026-06-03-yahoo-dependency-catalog.md`(상태 동결 노트) ·
  `docs/ai/10-patch-history-index.md`(한 줄).
- `forbiddenFiles`: 모든 런타임 `server/**/*.ts` 동작 코드 · `src/**` · ENV · 가드 탐지 로직.
- `expectedBehaviorChange`: **없음** (가드 EXIT 0 유지, 신규 차단 유지).
- `sourceSnapshotImpact` / `executionImpact` / `shadowLearningImpact` / `telegramImpact` /
  `providerImpact`: **NONE** (선언·문자열 전용).
- `testsRequired`: `node scripts/check_kis_primary_invariant.js` EXIT 0 + `validate:responsibility`.
- `rollbackPlan`: 사유 문자열을 `MIGRATION_PENDING_ADR0561` 로 revert(byte-equivalent) + 문서 revert.

## 결과

- **실행경로 Yahoo 의존 = 0 (CLOSED).** 잔존 13 = 비실행 동결(FROZEN, bounded).
- 가드: grandfather 13 hit 추적 유지 + 신규 Yahoo-first EXIT 1 차단 유지 (drift 봉쇄 불변).
- 두더지잡기 → systematic 경계 잠금 → **완료 선언**. 동결 해제는 shape 별 deliberate ADR.
- INDEX 0563 → 0564 갱신.
