# AI 협업 & 토큰 절약 규칙

> QuantMaster Pro에서 AI(클로드) 협업 시 토큰 사용을 최소화하기 위한 단일 지침서.
> `CLAUDE.md`의 "## AI 협업 & 토큰 절약 규칙" 섹션이 본 문서를 참조한다.
> 본 문서는 매매 로직·검증 파이프라인을 바꾸지 않는다. 협업 방식만 규정한다.

## 1. 황금 규칙 — diff 출력

**수정된 부분만 diff 형식으로 출력해. 변경 없는 코드는 절대 출력하지 마.**

- 파일 전체 재출력 금지 — 변경된 hunk만 보여준다.
- 효과: 응답 토큰 70~90% 절약.
- 예외: 신규 파일 생성 시에만 전체 출력 허용.

## 2. 표준 PR 프롬프트 템플릿

작업 요청 시 아래 5개 항목을 채워서 전달한다:

| 항목 | 설명 |
|------|------|
| 파일 | 수정 대상 파일 경로 |
| 작업 | 무엇을 할 것인가 (한 문장) |
| 범위 | 손대도 되는 영역 / 손대면 안 되는 영역 |
| ADR | 관련 ADR 번호 (있으면) |
| 제약 | 절대 규칙·금지 사항 |

→ 맥락 탐색 토큰을 줄이고 한 번에 정확한 작업을 유도한다.

## 3. Telegram 먼저 → Claude 나중

운영 진단은 **텔레그램 명령으로 먼저 확인**한 뒤, 그래도 해결 안 되면 Claude에게 맥락과 함께 전달한다.

- 텔레그램 진단으로 끝나는 문제에 Claude 토큰을 쓰지 않는다.
- Claude 호출 시 "어떤 명령을 쳤고 무엇이 나왔는지"를 같이 준다.

## 4. @responsibility 태그 = 토큰 라우터

- 모든 새 파일은 상단 20줄 내 25단어 이내 `@responsibility` 태그 (RULE-1, `scripts/check_responsibility.js` 강제).
- 이 태그가 "이 파일이 무엇을 하는가"의 단일 진실 → AI가 파일 전체를 읽지 않고도 책임을 파악.
- 태그가 정확할수록 탐색 토큰이 줄어든다.

## 5. 파일 크기 × 토큰 비용

| 파일 크기 | 대략 토큰 | 상태 |
|-----------|----------:|------|
| ~200줄 | ~800 | 이상적 |
| ~800줄 | ~3,200 | 함수 분할 경고 임계 |
| 1,500줄+ | ~6,000+ | 파일 한계 초과 — 즉시 분할 |

- 큰 파일은 읽기·수정 모두 토큰을 폭증시킨다.
- 한계: 파일당 1,500줄 / 함수당 300줄(hard), 800줄(warn) — `scripts/check_complexity.js` 기준.

## 6. Silent Catch 절대 금지

- `catch {}` 또는 사유 없는 무시 금지.
- 의도적 swallow는 `/* SDS-ignore: <사유> */` 주석으로 명시.
- `scripts/silent_degradation_sentinel.js`(`npm run validate:sds`)가 강제.

## 7. 데이터 신뢰 등급 (L1~L4)

| 등급 | 출처 | 용도 |
|------|------|------|
| L1 | KIS 실시간 / KRX 공식 마스터 | 매수·매도 결정 |
| L2 | FRED / ECOS / DART | Gate 조건 |
| L3 | Yahoo / Naver | fallback |
| L4 | AI 추정 | 참조 전용 — 직접 매매 결정 금지 |

- 비공식 스크랩 엔드포인트(`data.krx.co.kr`) 신규 추가 금지.

## 8. 배포 체크리스트 + 텔레그램 진단 명령

배포 후 텔레그램으로 즉시 점검:

| 명령 (alias) | 점검 항목 |
|------|-----------|
| `/health` | 파이프라인 헬스체크 (KIS/스캐너/토큰/Yahoo/DART/Gemini/Volume/Stream) |
| `/ci` | cron JobMetrics 보고와 실제 파일 갱신 흔적 교차 검증 (메트릭 wiring 결함) |
| `/lp` | 학습 루프 v5 진단 (fresh / counterfactual / fresh-only promotion) |
| `/gkd` | Ghost cron KIS 호출 실패 가설 4종 분리 (EgressGuard / Blacklist / Rate Limit / Deprecated) |
| `/gfr` | Ghost Portfolio 강제 실행 진단 — refreshGhostPortfolio() 즉시 호출 (60s rate-limit) |
| `/at` | 직전 N개 closed shadow trade 의 attribution 생성 wiring 추적 (read-only) |
| `/kms` | KRX stock master 상태 진단 — Tier 추정 + 워치리스트 미등록 + per-source health |
| `/learning_status` | 직전 reflection · 편향 · 실험 제안 · suggest 알림 7일 요약 |
| `/scan_blockers` | 직전 스캔의 매수 차단 사유 분포 + 거시 게이트 상태 (compact, ADR-0118 / ADR-0506) |
| `/scan_blockers full` | 위 진단의 전체(상세) 출력 |

## ONE-LINE PRINCIPLE

> 토큰은 비용이다. 가장 작은 변경으로 가장 큰 효과를 — diff만, 한 번에, 텔레그램 먼저.
