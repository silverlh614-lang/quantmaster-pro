# 05 · Provider Policy (장애 격리·신뢰 등급·fallback)

**Read this file only when working on:**
- KIS / KRX / DART / Yahoo / Naver provider 호출 경로 수정
- provider 장애(500 / 빈 응답 / stale / empty) 처리 · official schema
- 회로차단기 · Last Good Value · fallback 라우터 · 24h 블랙리스트
- 데이터 신뢰 등급 L1~L4 강등의 운영 적용 · KRX 거래일 달력(stale 판정)
- AI_ESTIMATED 데이터 live 사용 금지(불변식 #7) · provider 장애≠signal(불변식 #6) 검증

**Do not read this file for:**
- provider 장애가 실행 권한을 어떻게 바꾸는가(엔진 측) → `02-trading-engine-rules.md`
- SourceSnapshot 으로의 데이터 carry · 단일 통로 → `03-source-snapshot-ssot.md`
- Gate 통과 판정 · DATA_UNAVAILABLE 의 Gate 의미 → `04-gate-system.md`
- provider 진단 명령의 Telegram 출력 형식 → `06-telegram-policy.md`

---

## Provider 장애 ≠ market signal (불변식 #6)

**KIS 500 / KRX 빈 응답 / Yahoo stale 은 provider issue 이지 bearish market signal 이 아니다.**

- provider 장애를 약세 신호로 변환하면 정상 시장에서 매매가 잘못 차단된다.
- 처리 방법: confidence downgrade · fallback · circuit breaker · Shadow case recording.
- 모든 provider 진단 payload 는 `providerIssue: true` + `marketSignal: false` + `executionImpact: 'NONE'`
  literal type 으로 강제 — provider 장애가 매매 의사결정/엔진 mode 를 바꾸지 못하게 차단.

---

## AI_ESTIMATED ≠ live execution (불변식 #7)

- **L4 (AI 추정) 데이터는 참조 전용.** 어떤 경로에서도 live execution 입력으로 사용 불가.
- AI 추정 조건(18개)은 학습 가중치 ×0.4 로 보정 (ADR-0020/0149) — COMPUTED(9개) ×1.0 과 분리.
- AI 추천(MOMENTUM/QUANT_SCREEN/BEAR_SCREEN/EARLY_DETECT)은 KIS/KRX quota 미소비 (ADR-0011).

---

## 데이터 신뢰 등급 (L1~L4)

| 등급 | 출처 | 용도 | fallback 위치 |
|------|------|------|---------------|
| **L1** | KIS·KRX 공식 | 매수·매도 결정 (live execution) | — |
| **L2** | FRED·ECOS·DART | Gate 통과 판정 입력 | — |
| **L3** | Yahoo·Naver | L1/L2 결손 시 보조 | stale/sanity 검증 통과 후만 |
| **L4** | AI 추정 | 참조 전용 (불변식 #7) | live 금지 |

- provider 결손 시 등급 강등은 **데이터 품질 문제** 로 분류 — market signal 변환 금지.
- L3 fallback 은 `safePctChange`(ADR-0028) + `isAcceptableKrxDailyBase`(ADR-0190) 통과 후만.

---

## KIS RealData 장애 격리 (Patch KIS500 provider health isolation)

KIS RealData 500 burst / TR throttle / circuit OPEN 을 매매 판단과 완전 분리.

- **Circuit breaker state machine** — OPEN / HALF_OPEN / CLOSED 3-state.
  trip 사유: 60s 3건 / 5min 10건 / 연속 5건. 60s cooldown 후 자동 OPEN→HALF_OPEN.
  HALF_OPEN 1회 test 성공 시 CLOSED reset. OPEN 동안 호출 자체 skip (provider 부담 ↓).
- **Last Good Value cache** — TTL fresh 30s / stale 180s. providerDegraded=true 시 HIGH→DEGRADED 격하.
- **Fallback router 우선순위 SSOT** — `KIS_QUOTE > KIS_CACHED > KRX > YAHOO > CONFIDENCE_LOW` (절대 변경 금지).
- **InvestorFlow signal override** — providerIssue=true 시 BULLISH/WEAK_BULLISH/BEARISH/WEAK_BEARISH → UNKNOWN.
  NEUTRAL/UNKNOWN 보존. (provider 장애가 수급 신호를 왜곡하지 못하게 차단.)
- **Shadow case recording** — `CASE_KIS_REALDATA_500` learningTag 으로 학습 표본 보존.
- **진단 로그 SSOT** — `[KIS_CIRCUIT_OPEN]` / `[KIS_CIRCUIT_CLOSED]` / `[KIS_CIRCUIT_HALF_OPEN]`
  Railway 로그 전용. Telegram 일반 알림 발송 금지 (`telegramAllowed: false`).
- **KIS RealData noise** (Patch-001) — 500 반복 로그를 중앙 logger 게이트로 라우팅 (`LOG_LEVEL=info` 억제,
  per-key 60s cooldown, suppressed 누적). errorKind 7-value (TRANSIENT_SERVER_500 / RATE_LIMIT / AUTH /
  MARKET_CLOSED / BAD_REQUEST / NETWORK_TIMEOUT / UNKNOWN).
- **KIS chart cooldown** — Yahoo stale + KIS chart 500 cooldown 결합 시 해당 종목만 `quoteHydrationFailed`
  (`STALE_YAHOO_AND_KIS_CHART_FAILED`). 전체 스캔/Shadow learning/보유 관리는 무중단.

---

## KIS 회로차단기 + 24h 블랙리스트

- **404 하드/소프트 이원화** (PR-21) — 하드(5xx/403) 3회→10분 / 소프트(404) 10회→2분. 독립 카운터.
  `KIS_LENIENT_404=true` 시 404 회로 카운팅 제외.
- **24h endpoint 블랙리스트** (PR-24) — 404 30분 윈도우 10회 임계 → 24h 차단. 메모리 + Volume JSON 이중 저장.
  부팅 시 만료 entry 자동 청소. `KIS_DISABLE_404_BLACKLIST=true` 탈출구.
- **재시도 jitter** (ADR-0014) — 50% jitter backoff. `KIS_RETRY_DISABLED` / `KIS_RETRY_JITTER_DISABLED` 스위치.
- **KIS 토큰 디스크 영속** (ADR-0147) — 재부팅 시 OAuth2 호출 0건 (23h TTL hydrate). 정기 cron 2회 (08:30/20:30 KST).
  부팅 강제 갱신 제거 — `KIS_TOKEN_BOOT_REFRESH=true` 시에만. `KIS_TOKEN_PERSIST_DISABLED=true` legacy.

---

## KRX / Yahoo fallback

- **EgressGuard** (ADR-0028/0058) — outbound HTTP 최종 관문. 시장 닫힘 시 자동 차단 (503 synthetic).
  IntentTag (REALTIME / HISTORICAL / OVERNIGHT) — HISTORICAL 은 시간대 무관 통과.
  `EGRESS_GUARD_DISABLED=true` 롤백.
- **Yahoo range ≤1y 전역 정책** (ADR-0082) — `capYahooRange()` SSOT. `2y/5y/10y/max` → `1y` 자동 cap.
  stale base price 사고 확률 ↓ + Railway egress 부담 ↓. `YAHOO_RANGE_CAP_DISABLED=true` 우회.
- **Yahoo symbol resolver SSOT** (ADR-0231/0443) — `${code}.KS|.KQ` direct concat 금지.
  `tryGetYahooSymbol` / `fetchYahooQuoteByCode` / `toYahooSymbol` SSOT 위임. 정적 grep 가드 (ADR-0444).
- **KRX 거래일 달력** (ADR-0190) — `isAcceptableKrxDailyBase` SSOT. 5/1·5/5·추석 휴장일 클러스터에서
  정상 base 를 stale 로 오판 차단. `KRX_DAILY_PRICE_SOURCES` 4 출처 적용.
- **멀티소스 마스터** (ADR-0013) — KRX → Naver → Shadow → Seed 4-tier orchestrator + source 별 health score.
  KRX 단일 실패점 제거. 매일 06:00 + 19:00 KST cron 2회 갱신 (ADR-0413).
- **KIS market program-trade fallback** (Patch-004/006) — KIS empty output → KRX fallback → CACHE fallback.
  ACCEPTED_EMPTY 는 최종 표시 상태가 아닌 내부 raw status (7-state routedStatus). KRX intraday endpoint
  (MDCSTAT00301) wiring 은 ENV `KRX_INTRADAY_MARKET_PROGRAM_ENABLED=true` default OFF (endpoint shape 검증 의무).

---

## Provider 진단 명령

- `/health` — KIS 토큰·KRX OpenAPI 회로·Yahoo probe·공매도 출처·매크로 신선도 통합 (severity 분류).
- `/supply_health` — KRX/NAVER/KIS/CACHE 수급 provider 상태. PARSER_EMPTY_ROWS 원인 분해 (ADR-0445).
  시장 프로그램매매 routedStatus + KRX confidence + cacheTtl + intraday session.
- `/program_market` `/program_market_raw` — 시장 종합 프로그램매매 + raw 진단 (endpoint/trId/marketCode).
- `/margin_balance` `/fss_status` `/foreigner_trend` `/program_today` — ECOS 신용공여/FSS records age/Naver 외인 추세/KIS 종목별 프로그램.

데이터 신뢰 철학 → `docs/ai/00-project-charter.md` · SourceSnapshot SSOT → `docs/ai/03-source-snapshot-ssot.md`
Telegram 진단 명령 상세 → `docs/ai/06-telegram-policy.md`
