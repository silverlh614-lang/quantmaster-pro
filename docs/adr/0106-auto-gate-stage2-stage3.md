# ADR-0106 — AUTO gate Stage 2-2 (enemy) + Stage 3 (MOMENTUM decay)

## Status
Accepted (2026-04-29)

## Context

ADR-0105 (PR #431) 가 AUTO gate 품질 강화의 Stage 1 (`AUTO_MIN_SCORE=7.8`) +
Stage 2-1 (`AUTO_MIN_TURNOVER_KRW=5억`) 만 적용. 사용자 통찰 *"자동 시스템이
자기증식 — populate 빈도 감소보다 AUTO 후보 품질 강화 + stale eviction 강화"*
의 잔여 단계 본 PR 에서 처리:

- **Stage 2-2 — enemy 자동 차단**: `enemyAutoBlock` (ADR-0078) 은 `buyPipeline.ts`
  진입 직전 1회 호출되어 *매수 직전* 차단. 그러나 *후보 등록 단계* (AUTO gate)
  에서는 미적용 → 신용잔고율 ≥12% 또는 개인 비중 ≥88% 종목이 watchlist 에
  먼저 *등록* 된 후 매수 시점에야 차단되는 비대칭. 본 단계는 양쪽 안전망.

- **Stage 3 — MOMENTUM 약세 강등**: 기존 정책은 MOMENTUM 섹션 만료 2영업일
  (`expiresAt`). 그 사이 promotion 안 된 약한 종목이 watchlist 노이즈 누적.
  사용자 의도 *"2일 이상 momentum 유지 실패 → auto demotion"* 의 직접 구현 —
  expiresAt 만료 대기 *전* 즉시 제거.

## Decision

### Stage 2-2 — `autoPopulateWatchlist` enemy gate

`server/screener/stockScreener.ts` 의 Stage 2-1 (거래대금) 직후 위치에 enemy
gate 추가:

```ts
if (process.env.AUTO_ENEMY_GATE_DISABLED !== 'true') {
  try {
    const { fetchEnemyCheckData } = await import('../clients/enemyCheckClient.js');
    const { evaluateEnemyAutoBlock } = await import('../trading/enemyAutoBlock.js');
    const enemyData = await fetchEnemyCheckData(stock.code).catch(() => null);
    if (enemyData) {
      const decision = evaluateEnemyAutoBlock(enemyData);
      if (decision.shouldBlock) {
        rejectionLog.push({ ..., reason: `enemy 차단 — ${decision.reason}` });
        continue;
      }
    }
  } catch (e) {
    // graceful degradation — 평가 실패는 차단 사유 아님
  }
}
```

**비용 절감**: Stage 1 (gateScore≥7.8) + Stage 2-1 (거래대금≥5억) 통과한 종목만
호출. 50개 universe 중 보통 5~10개만 통과 → KIS 호출 부담 ↓.

**ENV 우회**: `AUTO_ENEMY_GATE_DISABLED=true` 시 skip.

**Dynamic import**: 서버 부팅 비용 절감 + 모듈 결합도 ↓.

### Stage 3 — `cleanupWatchlist` MOMENTUM decay

`server/screener/watchlistManager.ts` `cleanupWatchlist()` 의 MOMENTUM 초과
제거 직후 위치에 약세 강등 단계 추가:

```ts
if (process.env.AUTO_MOMENTUM_DECAY_DISABLED !== 'true') {
  const decayThreshold = parseFloat(process.env.AUTO_MIN_SCORE ?? '7.8') - 1.0;
  const oneDayAgoMs = now.getTime() - 24 * 3600 * 1000;
  cleaned = cleaned.filter((w) => {
    if (w.section !== 'MOMENTUM') return true;
    if (!w.addedAt) return true;
    const addedMs = new Date(w.addedAt).getTime();
    if (!Number.isFinite(addedMs) || addedMs >= oneDayAgoMs) return true;
    if ((w.gateScore ?? 0) >= decayThreshold) return true;
    return false; // 강등 = 제거
  });
}
```

**조건**: MOMENTUM 섹션 + 등록 후 1일+ 경과 (24h 단순 비교) + gateScore < 6.8
(default `AUTO_MIN_SCORE=7.8` − 1.0).

**SWING/CATALYST 보존**: section !== 'MOMENTUM' 시 즉시 통과.

**graceful**: addedAt 부재 / NaN / 24h 미경과 / 임계 통과 — 모두 보존.

**ENV 우회**: `AUTO_MOMENTUM_DECAY_DISABLED=true` 시 skip.

### 본 PR scope 외 (후속 명시)

- **Stage 2-2 추가 — spread (호가 갭) gate**: Yahoo 데이터에 spread 부재. KIS
  호가 보드 (`/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn`)
  wiring 필요. KIS 호출 추가 부담 — 별도 PR 분리.

- **gateScore 재평가 기반 demotion**: 현재 Stage 3 는 *등록 시점 gateScore* 와
  임계 비교. *재평가* (현 시점 quote + evaluateServerGate 재호출) 는 Yahoo +
  KIS 호출 부담 큼 — 운영 데이터 누적 후 별도 PR.

## Consequences

### 즉시 효과 (배포 후)

- **Stage 2-2**: enemy 종목이 watchlist 에 등록되지 않음 → 매수 직전 차단 +
  등록 시점 차단 양쪽 안전망. 잔여 watchlist 품질 ↑.
- **Stage 3**: 약한 MOMENTUM (gateScore 6.8 미만) 등록 1일 후 자동 제거 →
  watchlist *창고화* 차단. 사용자 통찰 "약한 종목은 자연 탈락" 직접 구현.

### 회귀 위험

- Stage 2-2 — KIS `enemyCheckClient` 호출 추가. 호출 실패 시 graceful
  degradation (평가 skip). 운영 KIS quota 영향: Stage 1+2-1 통과한 5~10개 ×
  enemyCheckClient (KIS 2 TR) = 평일 약 10~20 호출/사이클. 부담 미미.
- Stage 3 — 기존 expiresAt 정책 위에 *조기 제거* 추가. 약세 종목 자연 탈락
  속도 ↑. ENV 우회 안전망.

### 회귀 테스트 20 신규

- `autoEnemyGate.test.ts` 6 — Stage 2-2 정적 패턴 (dynamic import / ENV 우회 /
  shouldBlock 분기 / 위치 정합 / try-catch graceful / 비용 절감 주석)
- `autoMomentumDecay.test.ts` 14 — Stage 3 정적 패턴 8 + 통합 동작 6 (gateScore
  6.7 임계 미달 제거 / 7.0 통과 보존 / 12h 미경과 보존 / SWING 보존 / ENV 우회 /
  AUTO_MIN_SCORE=8.5 임계 갱신)

## References

- ADR-0078 — Enemy Auto Block (buyPipeline 진입 직전 wired) — 본 ADR 의 전제
- ADR-0105 — Post-FOMC 4 항목 Stage 1 + 2-1 (PR #431, 본 PR 의 base)
- 사용자 보고 (2026-04-29 FOMC DAY 운영 종료 후) — 항목 4 P0 잔여 단계
