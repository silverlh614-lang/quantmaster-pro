# ADR-0005: STRONG_BUY 분류 기준 고착 해소 + Telegram Pre-Mortem/구분선 trim 정책

- 상태: 채택
- 날짜: 2026-04-24
- 작성: QuantMaster Harness (architect)

## 배경

1. **SHADOW 성과 현황 `STRONG_BUY WIN 0.0%` 고착**
   2026-04 기준 종결 5건·미결 6건 상태에서도 STRONG_BUY WIN이 0.0%로 고정되어
   "STRONG_BUY 표본 부족으로 SHADOW 졸업 불가" 상태. 원인 두 가지:
   - `computeShadowMonthlyStats()` 가 `entryKellySnapshot.signalGrade` 만 STRONG_BUY
     판정 입력으로 사용 (`shadowTradeRepo.ts:607`). 레거시 trade (Kelly 스냅샷
     기록 이전 생성) 는 snapshot 필드가 `undefined` 라 집계에서 제외.
   - `signalScanner.ts:1222` 의 `isStrongBuy = gateScore >= 9` 규칙은 유효하나,
     실제 장중 gate 최대치(≈11)에서 9점을 상회하는 종목이 희소해 STRONG_BUY 표본
     자체가 누적되지 않음. 분류 기준이 자동매매와 AI 추천 경로에서 서로 다름.

2. **Pre-Mortem 본문 메시지 잘림 + 구분선 개행**
   손절 집행 투명 리포트(`stopLossTransparencyReport.ts:120`) 가
   `shadow.preMortem.split('\n').slice(0, 3)` 로 앞 3줄만 표시하는데,
   Gemini 가 응답 선두에 페르소나/서문("QuantMaster 시스템 아키텍트로서…")
   을 붙이면 실제 번호 항목이 밀려나 `Gate 2` 뒤에서 잘림.
   추가로 `CHANNEL_SEPARATOR = '━' × 20` 이 일부 모바일 폭에서 2줄로 wrap.

3. **AI 추천 경로와 자동매매 Gate 기준 비동기**
   `src/services/stock/momentumRecommendations.ts` 가 사용하는 BUY/STRONG_BUY
   기준은 프롬프트 내 하드코딩 문자열이며, `server/trading/gateConfig.ts` 의
   실제 임계값·레짐별 band 와 동기화되지 않음. 운영 중 레짐이 전환되어 임계값이
   완화·강화돼도 AI 추천은 옛 기준을 그대로 사용.

## 결정

### 1. STRONG_BUY 분류 단일 기준 정의

**자동매매 (SSOT):**
- Primary: `entryKellySnapshot.signalGrade === 'STRONG_BUY'` (이미 기록되는 경로)
- 분류 규칙: `signalScanner.ts` 의 `isStrongBuy = gateScore >= 9` 유지.
  - gateScore band (regime-aware) 는 `getRegimeGateScoreBand(regime).strong` 사용.
  - 현재 band: `R1=8.5 / R2=9 / R3=9.5 / R4=10 / R5=11 / R6=차단`.
- 추가 요건 (signalScanner 의 기존 Gate 1/2 충족은 진입 자체가 이미 통과했음을 의미):
  - MTAS > 3
  - RRR ≥ 3.0 (일반 BUY 는 2.0)

**SHADOW 집계 Fallback (레거시 복원):**
`entryKellySnapshot` 이 없는 레거시 trade 에 대해 다음 휴리스틱으로 STRONG_BUY
판정을 복원한다:
- `preMortemStructured?.targetScenario.rrr >= 3.0` AND
- `profileType === 'A' | 'B'` (대형 주도 / 중형 성장 — gate 9 이상 달성 프로파일)
AND
- `entryRegime ∈ {R1_TURBO, R2_BULL, R3_EARLY}` (R4 이하는 BUY-only)

이 fallback 은 오직 집계용이며 신규 샘플 생성 경로에는 영향 없음.

**AI 추천 경로 (`momentumRecommendations.ts`):**
- 프롬프트 내 STRONG_BUY 기준은 "서버 Gate 9점 이상 + RRR 3.0 이상 + 레짐 R1~R3"
  로 명시. 서버 쪽 실효 임계값을 `getEffectiveGateThreshold(regime)` 호출로
  런타임 주입하여 레짐·override 변화에 자동 동기화.

### 2. Telegram 메시지 표시 정책

**Pre-Mortem 출력 정규화:**
- `entryEngine.generatePreMortem()`:
  - Gemini 프롬프트에 "페르소나 언급 금지, 서문 없이 1. 2. 3. 형식으로 즉시 출력"
    지시 추가.
  - 응답 후처리:
    1. "QuantMaster|아키텍트|분석한다|이다\." 로 시작하는 서문 단락 제거.
    2. 번호 항목(`^\s*\d+[\.\)]`) 만 추출해 최대 3개 유지.
    3. 각 항목 120자 초과 시 말줄임.
    4. 전체 길이 600자 상한.
- `stopLossTransparencyReport.ts` 의 `preMortemBlock`:
  - `split('\n').slice(0, 3)` → `split(/\n/)` 후 번호·하이픈 라인만 필터.

**구분선 정책:**
- `CHANNEL_SEPARATOR = '━' × 20` → `'━' × 16`.
  (모바일 360dp 가로폭 기준 16자가 안전. 기존 20자는 한글 본문과 섞이면 2줄
  wrap 확률 상승.)

### 3. 후속 과제 (이 ADR 범위 외)

- `quantScreenRecommendations.ts` 와 `bearScreenerRecommendations.ts` 의 프롬프트
  기준도 `getEffectiveGateThreshold` 동기화 대상이나, 본 ADR 에서는
  `momentumRecommendations.ts` 먼저 정비하고 후속 PR 로 확장.
- SHADOW STRONG_BUY 표본이 계속 부족하면 fallback 휴리스틱의 임계값 (profileType A/B
  + RRR 3.0) 을 6개월 누적 데이터로 재조정.
- Pre-Mortem 서문 regex 가 Gemini 모델 변경 시 실패할 수 있으므로, 1분기마다
  실 응답 샘플 10건으로 회귀 테스트.

## 대안 검토

| 대안 | 채택 여부 | 사유 |
|------|-----------|------|
| STRONG_BUY 임계값을 `gateScore >= 7` 로 대폭 완화 | 기각 | 표본은 늘지만 신호 선별력 하락, Fractional Kelly 캡 무의미화 |
| Pre-Mortem 을 structured-only 로 단순화 | 기각 | Gemini free-text 가 사람 복기에 더 직관적, structured 는 이미 병행 기록 중 |
| CHANNEL_SEPARATOR 를 제거 | 기각 | 섹션 구분 시각적 단서 필요, 16자 축소로 충분 |
| AI 추천에 서버 `gateConfig` 직접 import | 기각 | 클라이언트 번들 크기 증가 + 서버 전용 런타임 상태 오염 위험. 대신 API 경유 주입 방식 추후 검토 |

## 영향 범위

- `server/persistence/shadowTradeRepo.ts` — STRONG_BUY fallback 로직 추가
- `server/trading/entryEngine.ts` — generatePreMortem 프롬프트·후처리
- `server/alerts/stopLossTransparencyReport.ts` — preMortemBlock 필터링
- `server/alerts/channelFormatter.ts` — SEPARATOR 16 자 축소
- `src/services/stock/momentumRecommendations.ts` — STRONG_BUY 기준 명시 갱신
- 테스트 co-location: `shadowTradeRepo.test.ts`, `preMortemStructured.test.ts`
  는 기존 케이스 유지, 신규 fallback 경로 1 케이스 추가

## 롤백 절차

- SEPARATOR 복원: `channelFormatter.ts:8` 을 20 자로 되돌리면 즉시 복구.
- STRONG_BUY fallback 제거: `computeShadowMonthlyStats()` 내 fallback 블록 삭제
  하면 기존 거동으로 복귀.
- Pre-Mortem trim: `generatePreMortem` 반환값을 원본 그대로 사용하도록 roll-back.
