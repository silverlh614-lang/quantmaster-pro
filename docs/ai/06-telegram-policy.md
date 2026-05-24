# 06 · Telegram Policy (명령 레지스트리·채널 라우팅·HTML 정제)

**Read this file only when working on:**
- 텔레그램 명령 추가/수정 · 명령 레지스트리(commandRegistry) 등록 경로 · 메뉴 동기화
- 알림 채널 라우팅(CH1~CH4) · 진동 정책 · 개인 회선 분리 · dedup
- `/scan_blockers` 등 진단 명령의 **출력 형식**(compact/full 페이지네이션 · 4096 char)
- Telegram HTML 전송(허용 태그 · 청크 분할 · invariant 라우팅 · 이스케이프)

**Do not read this file for:**
- scan_blockers 가 진단하는 *원인 분해* 자체(Gate forensic) → `04-gate-system.md`
- provider 진단이 보는 데이터(회로차단기·fallback) → `05-provider-policy.md`
- 학습 진단(`/learning_*`) 이 보는 데이터 → `07-learning-engine.md`

---

## 명령 레지스트리 (ADR-0017)

- **commandRegistry SSOT** — 모든 텔레그램 명령은 `server/telegram/commandRegistry.ts` 에 등록.
  `commands/*/*.cmd.ts` 파일이 import 시점에 `commandRegistry.register(cmd)` 자체 호출 (side-effect).
- **8 카테고리 디렉토리** — `commands/{system,watchlist,positions,alert,learning,control,trade,infra}/`.
  51+ cmd 객체. 새 명령 추가 = 파일 1개 + barrel 1줄.
- **메뉴 압축 (Stage 1)** — `setMyCommands` 노출 메뉴 8개 메타 명령 (`/help /status /now /watch
  /positions /learning /control /admin`). 51 alias 는 직접 입력 + 자동완성 노출.
- **사용량 텔레메트리 (Stage 3)** — `commandUsageRepo` 사용량 집계 + 폐기 후보 주간 리포트 + `/help` 개인 Top 5.
- **메뉴 자동 동기화** — `buildBotMenuCommands()` 가 META_COMMAND_REGISTRY 키에서 자동 파생.
  drift 차단 가드 (META_COMMAND_REGISTRY ↔ MENU_DESCRIPTIONS 키 불일치 시 throw).

---

## 알림 채널 라우팅 (ADR-0037)

**alertRouter SSOT** (`server/alerts/alertRouter.ts`) — 4 카테고리 단일 진입점 (`dispatchAlert`).

| 시멘틱 별칭 | enum 값 | 채널 의미 |
|-------------|---------|-----------|
| `EXECUTION` | TRADE | CH1 — 체결/주문 즉각 인지 |
| `SIGNAL` | ANALYSIS | CH2 — 종목 픽/신호 |
| `REGIME` | INFO | CH3 — 매크로 사령탑 (정기 다이제스트) |
| `JOURNAL` | SYSTEM | CH4 — 메타 학습/회고 |

- **VIBRATION_POLICY 매트릭스 SSOT** — 카테고리×심각도별 진동 결정.
  EXECUTION 모든 심각도 진동 ON / SIGNAL CRITICAL 만 / REGIME CRITICAL+HIGH / JOURNAL 모두 OFF.
- **개인 회선 분리 (ADR-0038)** — `sendPrivateAlert` 는 개인 DM 전용 (잔고/자산/손절 카운트다운).
  채널 발송(`dispatchAlert`)에 잔고 키워드(총자산/주문가능현금/평가손익 등) 누출 금지 — `validate:sensitiveAlerts` 차단.
- **채널 ID boundary** — `process.env.TELEGRAM_*_CHANNEL_ID` 직접 접근은 alertRouter 만 (`validate:channelBoundary`).
- **정기 다이제스트** — CH3 매크로 (08:30+16:00 KST, ADR-0040), CH4 주간 자기비판 리포트 (일 19:00, ADR-0041).
- **손절 카운트다운** — CH1 채널 아닌 개인 DM 만 (`sendPrivateAlert`, ADR-0042) — 패닉 매도 차단.

---

## /scan_blockers 출력 정책 (ADR-0478/0479)

- **`/scan_blockers` (요약, compact)** — ≤4096 char Telegram 한도. SCAN_BLOCKERS_BUDGET=4000.
  Section Priority Registry 로 섹션 압축 (baseMessage 1000 절대 가드 / executionImpact·liveness ≥800 보존).
  초과 시 truncation marker + pagination (Patch-SUPPLY-DIAG-ACCURACY).
- **`/scan_blockers full`** — 전체 + pagination (3500 char 페이지, 태그 중간 절단 금지).
- **`/scan_blockers gate`** (ADR-0507 compact) — Gate1/ADR-0505 핵심 30~40줄. `gate full` 로 ADR 마커 필터링 장문.
- **`/scan_blockers_detail`** (ADR-0479) — detail trace registry (`data/scan_blockers_detail_trace.json`,
  7일 TTL + FIFO 200 + sanitized inputDigest). `/scan_blockers` = 요약, `/scan_blockers_detail` = 전체 trace 책임 분리.

---

## Telegram HTML 전송 정제 (Patch-TELEGRAM-HTML-SANITIZER)

**`telegramHtmlSanitizer.ts` SSOT** — 모든 HTML 알림은 전송 전 sanitize/validate 통과.

- **허용 태그 15종** — Telegram Bot API `parse_mode: 'HTML'` 공식 지원 (b/strong/i/em/u/ins/s/strike/del/
  code/pre/a/span/tg-spoiler/blockquote). 비허용 `<...>` 와 stray `<` 는 `&lt;` 이스케이프 ("can't parse entities" 차단).
- **이중 이스케이프 차단** — 태그 사이 텍스트 콘텐츠는 절대 건드리지 않음 (`<` 단위로만 정제).
  호출자가 이미 escapeHtml 한 변수/진단값 보존.
- **invariant/debug 라우팅** — `[INVARIANT]`/`[DEBUG]`/`[TRACE]` 접두 메시지는 Telegram 발송 생략,
  Railway 로그 전용 (`classifyTelegramRouting`, ENV `TELEGRAM_INVARIANT_ROUTING_DISABLED`).
- **HTML-safe 청크 분할** — `splitHtmlSafeChunks(text, 4096)` — `<...>` 태그 중간 절단 금지 + 개행 경계 선호.
- **실패 로그 dedup** — `shouldLogHtmlFailure` 5분 cooldown (같은 시그니처 도배 차단).
- **plain text 전용 send** — `sendTelegramPlainText` (raw 진단 출력은 HTML 파싱 자체 회피).

---

## 주요 진단 명령

| 명령 | 용도 |
|------|------|
| `/health` | KIS 토큰·KRX 회로·Yahoo probe·공매도 출처·매크로 신선도 통합 (severity 분류) |
| `/regime` | 매매 레짐 (R1~R6) + Kelly 배율 + MHS axis + USD/KRW dual-source (ADR-0071) |
| `/scan_blockers` `/scan_blockers_detail` | Gate 차단 사유 진단 (→ `docs/ai/04-gate-system.md`) |
| `/supply_health` `/program_market` `/program_market_raw` | provider 수급 (→ `docs/ai/05-provider-policy.md`) |
| `/signal_status` `/signals` | TradeSignalStatus 6단계 상태머신 추적 (AI_CANDIDATE→…→AUTO_TRADE_READY/BLOCKED, ADR-0077) |
| `/guards` `/blocks` | 6 가드 + 일일 손실 한도 + R3 sanity latch 통합 read-only (ADR-0194/0195) |
| `/r3_unblock` `/unblock_buy` `/unmanage_only` | 가드 즉시 해제 (R3 sanity / blockNewBuy / manage-only, ADR-0193/0194/0195) |
| `/sizing_debug` `/sd` | 사이징 프로파일 매트릭스 (→ `docs/ai/02-trading-engine-rules.md`) |
| `/snapshot_latest` `/snapshot_status` | runtime debug snapshot (18:00 KST capture, replayOnly) |
| `/learning_status` `/learning_history` `/learning_loop_health` | 학습 진단 (→ `docs/ai/07-learning-engine.md`) |
| `/channel_test` | 4 채널 동시 헬스체크 (ADR-0042) |

알림 채널 철학 → `docs/ai/00-project-charter.md` · Provider 진단 → `docs/ai/05-provider-policy.md`
학습 진단 명령 → `docs/ai/07-learning-engine.md`
