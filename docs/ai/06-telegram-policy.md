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
- **현재 SHADOW 메뉴 (ADR-0671)** — `/help /paper /paper_research /paper_bot /control`. 기존 진단 명령은 직접 입력용으로 유지한다. `/paper`는 새 관측·전략 원장, `/paper_research`는 저장 자료 연구, `/paper_bot`은 실제 발송 결과를 읽는다.
- **예약 발송** — 거래일 08:45 해외 뉴스·국내 연관주, 16:10 마감, 일요일 19:00 연구. 한국 시간 기준이며 `paperBot.ts`가 매분 예정 보고와 새 가상 매매·운영 상태 변화를 확인한다. 중복 보고 cron 20개와 폐기 후보 주간 발송은 제거했다.
- **해외 아침 브리핑 (ADR-0679)** — CH3 INFO의 기존 아침 보고 한 건에 BBC·CNBC·미 연준 RSS 중요 사건 3~5개, 원문·발행시각·국내 영향 해석·연관 종목 최대 2개와 이유를 묶는다. 직전 KRX 거래일 15:30~당일 08:30 발행 범위이며 주말·휴일을 포함한다. 제목·발췌 언급/업종 연관 추정을 구분하고 부족한 기사·수집 실패·AI 지연을 그대로 표시한다. 수집은 배경 실행, 하루 요약과 발송 원장을 재사용한다. `/api/shadow/morning-report`는 발송 없는 저장 자료 미리보기다.
- **마감 요약 (ADR-0677)** — 오늘 평가일 성과·누적·지연 확인·다음 평가일, 전략의 장중 마지막 대기 사유, 뉴스·공시·수급 범위를 구분한다. 장후 판단에서 장중 사유를 추정하지 않는다. `/api/shadow/close-report`는 발송 없는 미리보기이며 이미 보낸 마감 메시지는 재발송하지 않는다.
- **4채널 연결 (ADR-0672)** — CH1 signal은 가상 진입·청산, CH2 분석은 같은 종목·진입일의 고정 학습 근거·청산 복기, CH3 정보는 08:45 해외 뉴스·국내 연관주, CH4 시스템은 16:10 성과·일요일 연구를 받는다. 운영 상태는 개인 DM이다. 새 메시지에 목적지를 저장하고 채널별 성공·재시도를 분리한다. 기존 목적지 없는 기록은 DM으로 유지한다.
- **발송 기록** — `paper-bot.json`에 ID가 확인된 성공과 재시도·실패·만료를 분리한다. 재시작 시 기존 매매를 다시 알리지 않는다. 수집·학습은 알림과 독립적으로 계속한다.
- **구 가상 보유 접근 경보** — 명시적으로 SHADOW인 구 포지션의 손절 접근 3단계 DM은 발송하지 않는다. 실주문 없는 기록이 T1 확인·재발송을 일으키던 노이즈를 제거한다. LIVE·모드 미확인 알림, 가격 기반 청산 규칙과 현재 전략의 진입·청산 보고는 유지한다.
- **마감 평가 조회** — `/api/shadow/evaluation`은 전체 관측의 날짜별 성과·고유 종목/진입일·중복/시각 감사, 조건 확보율·재무 시각, 연구와 실제 봇 발송 상태를 축약한다. 화면용 최근 200건을 전체 원장으로 오인하지 않으며 상세 일봉·학습 ID·메시지 본문을 전송하지 않는다. 읽기 전용이며 가격 수집·주문·점검 메시지 발송을 일으키지 않는다.
- **관측 지연 노이즈 억제** — 완료 시각 기준 장중 10분·휴장/장외 60분을 적용한다. 최근 2분 내 실제 종목 진행이 있으면 수집 중으로 인정하되 한 수집의 유예는 장중 30분·장외 120분으로 제한한다. 지연 경고는 5분 지속 후, 이전 성공 발송부터 최소 1시간 간격으로 보낸다. 전송 대기 중 회복하면 경고·복구를 함께 생략하며, 이미 알린 지연의 복구는 새 관측 완료로 확인한다. 오류·일시정지 알림과 관측 일정은 유지한다.
- **출력 범위** — SHADOW에서 기존 예약 작업의 일반 Telegram 출력은 제외한다. 새 봇·직접 명령 응답·실제 주문 영향·긴급 알림은 보존한다. AsyncLocalStorage를 사용해 동시 실행 중인 수동 명령을 막지 않는다.
- **메뉴 자동 동기화** — SHADOW는 5개 메뉴, 다른 모드는 기존 META_COMMAND_REGISTRY와 설명 키의 drift 가드를 유지한다. 사용량 집계는 진단용으로 보존한다.

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
- **기존 채널 다이제스트** — 자동 발송 예약은 제거했다. 필요할 때 관리 명령으로 수동 조회·발송할 수 있다.
- **손절 카운트다운** — CH1 채널 아닌 개인 DM 만 (`sendPrivateAlert`, ADR-0042) — 패닉 매도 차단.

---

## severity 필터 & 노이즈 정책 (ADR-532)

ADR-531 taxonomy 를 Telegram 출력에 적용. **이미 구현된 라우팅을 SSOT 로 성문화** + 사용자-facing 소음 차단.
상세·검증 케이스 → `docs/archive/adr/adr-532-telegram-noise-reduction.md`.

- **CH2(SIGNAL) = 사용자-facing 매매만** — BUY/SELL·Shadow 신호·체결·포지션·손절/익절/청산·executionImpact≠NONE.
- **executionImpact=NONE diagnostic/provider → CH2 금지** — `providerIssue=true && executionImpact=NONE` 은
  CH3(REGIME/INFO)·CH4·Railway 로만 (이미 PROVIDER_HEALTH→CH3 라우팅으로 충족). 시장 위험 경고로 표시 금지 (불변식 #6).
- **DIAGNOSTIC/DEBUG/SUPPRESSED → CH2 직접 노출 금지** — DEBUG/INVARIANT/TRACE 는 Railway-log-only
  (`classifyTelegramRouting`), SUPPRESSED 는 CH4/요약만, DIAGNOSTIC 은 사용자 요청 명령(`/scan_blockers` 등) 응답만.
- **정책 상태 ≠ 장애** — SELL_ONLY/R6/HOLIDAY/SHADOW_ONLY/PRE_MARKET 은 INFO/정책 상태로 표시 (오류 표현 금지).
  정책 상태 + 실제 장애 결합 시에만 WARN/ERROR (예: R6 + Shadow stopped → ERROR).
- **dedup 키** — Trading Signal `tradeDate+symbol+side+strategy+sourceSnapshotId` / Position `positionId+symbol+eventType+stage+tradeDate` /
  Liquidation `positionId+exitReason+exitStage+tradeDate` / Policy `policyState+engineMode+effectiveRegime+tradingDate`(전환 시만).
  기존 `dedupeKey`+`cooldownMs`+category×priority 활용 (신규 인프라 불필요).
- **legacy 명령 보존** — `/pos`·`/pnl` 는 shadow-first(`shadowPositionSources.ts`) 이미 적용 — liveCount=0 정상.
  severity 필터가 사용자 조회 응답(`/pos`·`/pnl`·`/help`)을 차단하지 않는다.
- **진단 보존** — 모든 diagnostic 을 숨기지 않는다. CH3/CH4/Railway/Admin 경로로 운영자가 원인 추적 가능해야 함.

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
| `/channel_test` (`/channel_health` 별칭) | 활성 채널 시험 발송. 동일 채팅방은 1회, 결과는 요약 1건. |

알림 채널 철학 → `docs/ai/00-project-charter.md` · Provider 진단 → `docs/ai/05-provider-policy.md`
학습 진단 명령 → `docs/ai/07-learning-engine.md`

연결 확인: 설정 유무는 발송 성공이 아니다. 웹 테스트는 Telegram 메시지 ID를 받은 경우에만 성공으로 표시한다. 서버 기동 시 개인 요약 1건만 보내며 채널 시험 발송은 하지 않는다.
