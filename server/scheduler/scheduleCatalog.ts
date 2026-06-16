/**
 * @responsibility 등록 스케줄 카탈로그·다음/상세/이력 포맷·실행 링버퍼 제공
 *
 * SCHEDULE_CATALOG 가 사람이 읽는 시간표 SSOT, recordScheduleRun() 이 실행 이력을
 * 기록해 /scheduler history 에서 조회 가능하다.
 */

import { emitMaintenanceWarn } from '../observability/maintenanceWarn.js';

export interface ScheduleEntry {
  timeKst: string;
  label: string;
  group: 'reports' | 'alerts' | 'trading' | 'screener' | 'learning' | 'maintenance';
  /** SCHEDULE_CATALOG의 항목과 recordScheduleRun() 의 jobName 매칭에 사용. 미지정 시 label 으로 매칭. */
  jobName?: string;
  /** 비활성 표시용 — env / 기능 토글로 꺼져 있을 때 true. */
  disabled?: boolean;
  /**
   * 조건부 무음 설명 — cron 은 돌지만 조건 미달 시 Telegram 을 의도적으로 보내지 않는
   * 작업은 여기에 사유를 적는다. /scheduler detail 에 "🔕 조건부 무음: …" 으로 표시되어
   * "왜 이 시각에 메시지가 안 오느냐" 에 대한 운영 답변을 단일 소스로 관리한다.
   */
  silentWhen?: string;
}

export const SCHEDULE_CATALOG: ScheduleEntry[] = [
  // ── 리포트 (Telegram 송출 중심) ────────────────────────────────────────────
  { timeKst: '06:00', label: '글로벌 스캔 에이전트', group: 'screener', jobName: 'global_scan_agent', silentWhen: 'Yahoo 미국 지수·섹터 ETF 종합 스캔 — KR 휴장 무관 ALWAYS_ON' },
  { timeKst: '06:15', label: '미 섹터 ETF 모멘텀 스캔', group: 'reports', jobName: 'sector_etf_momentum' },
  { timeKst: '06:05', label: 'DXY 미국 장마감 직후 모니터', group: 'alerts', jobName: 'dxy_us_close', silentWhen: 'DXY 방향 전환 신호 없을 시 무음' },
  { timeKst: '06:10', label: '미국 장후 글로벌 진단 (ADR-0403)', group: 'screener', jobName: 'us_postmarket_scan', silentWhen: '글로벌 진단 전용 — KR 신호 스캔 미호출' },
  { timeKst: '06:30', label: '파이프라인 자가진단 (ADR-0056 v4)', group: 'maintenance', jobName: 'self_diagnosis', silentWhen: '치명 이슈 없으면 무음' },
  { timeKst: '06:35', label: '워치리스트 시장 다양성 모니터 (ADR-0248)', group: 'maintenance', jobName: 'watchlist_diversity_monitor', silentWhen: '코스닥 비중·마스터 커버리지 임계 미달 시에만 발송 (24h dedupe)' },
  { timeKst: '07:35', label: '외국인 수급 선행 경보', group: 'alerts', jobName: 'foreign_flow_leading', silentWhen: 'EWY·DXY·외인 3축 합치하지 않으면 무음' },
  { timeKst: '08:00', label: '데이터 완전성 카운터 리셋', group: 'maintenance', jobName: 'data_completeness_reset', silentWhen: '내부 카운터 리셋만 — Telegram 송출 없음' },
  { timeKst: '08:10', label: '주도주 유니버스 일일 갱신 (ADR-0618)', group: 'screener', jobName: 'leader_universe_daily_refresh', silentWhen: '내부 유니버스 갱신 — Telegram 송출 없음 (ENV `LEADER_DAILY_REFRESH_ENABLED` 미활성 시 콜백 단락, 랭킹 fetch 0)' },
  { timeKst: '08:20', label: 'KIS 토큰 강제 갱신 (아침)', group: 'trading', jobName: 'kis_token_refresh', silentWhen: '성공 시 내부 로그만' },
  { timeKst: '08:25', label: '매크로 다이제스트 PRE_OPEN (ADR-0040)', group: 'alerts', jobName: 'macro_digest_pre_open' },
  { timeKst: '08:30', label: '장전 방향 카드', group: 'alerts', jobName: 'pre_market_card', silentWhen: '|Bias Score| < 40 (NEUTRAL) 이면 무음 — BULL/BEAR 일에만 발송' },
  { timeKst: '08:32', label: 'ADR 갭 스캔', group: 'alerts', jobName: 'adr_gap_scan', silentWhen: '|ADR 역산 갭| < 2% 이면 무음' },
  { timeKst: '08:35', label: 'Stage2/3 최종 스크리닝', group: 'screener', jobName: 'stage2_3_final_screening', silentWhen: '내부 스크리닝 — Telegram 송출 없음' },
  { timeKst: '08:38', label: '시장 레짐 변수 갱신 (아침)', group: 'reports', jobName: 'market_regime_refresh_morning', silentWhen: '내부 캐시 갱신만 — Telegram 송출 없음' },
  { timeKst: '08:40', label: 'DXY 한국 개장 직전 모니터', group: 'alerts', jobName: 'dxy_kr_open', silentWhen: 'DXY 방향 전환 신호 없을 시 무음' },
  { timeKst: '08:45', label: '아침 통합 브리핑', group: 'reports', jobName: 'morning_briefing' },
  // umbrella 라벨이라 jobName 은 실제 등록된 primary cron (mhs_morning_alert) 을 가리킨다.
  // 09:00 KST = '0 0 * * 1-5' UTC, alertJobs.ts:48 / TRADING_DAY_ONLY / pollMhsMorningAlert.
  // 거시-섹터 동기화는 동일 시각 macro_sync_day_open(trading) 으로 별도 등록되어 있음.
  { timeKst: '09:00', label: 'MHS 알림 / 거시-섹터 동기화 시작', group: 'alerts', jobName: 'mhs_morning_alert', silentWhen: 'MHS 가 RED(<40) 또는 GREEN(≥70) 전환이 아니면 무음' },
  // FOMC DAY 사전 경보/30분 전 경보/자동 청산 항목 제거 — cron 실등록 부재 확인
  // (orchestratorJobs.ts: FOMC_LIQUIDATION_REMOVED, cron stagger 감사 2026-06-10 유령 항목 정리).
  { timeKst: '09:00', label: '거시 동기화 day-open 초기화', group: 'trading', jobName: 'macro_sync_day_open', silentWhen: '내부 매크로 동기화만 — Telegram 송출 없음' },
  { timeKst: '09:00', label: '매도 체결 폴링 시작', group: 'trading', jobName: 'sell_poll_start', silentWhen: '내부 폴링 타이머 기동만 — Telegram 송출 없음' },
  { timeKst: '09:00', label: 'KIS WebSocket 스트림 시작', group: 'trading', jobName: 'kis_stream_start', silentWhen: '내부 스트림 연결만 — Telegram 송출 없음' },
  { timeKst: '09:00', label: '일일 데이터 진단 다이제스트', group: 'maintenance', jobName: 'daily_data_diagnostic_digest', silentWhen: '데이터 부재/staleness 이슈 없으면 무음' },
  { timeKst: '09:05', label: '보유 포지션 모닝카드', group: 'reports', jobName: 'morning_position_card', silentWhen: '활성 포지션 없으면 무음' },
  { timeKst: '09:05', label: '연휴 복귀 보수 매매 모드', group: 'alerts', jobName: 'holiday_resume_alert', silentWhen: 'POST_HOLIDAY + isLongHoliday 미충족 시 무음 — 추석/근로자의 날 직후만 발송' },
  { timeKst: '09:05', label: 'KIS 스트림 워치독 (09:05/09:15/09:30)', group: 'trading', jobName: 'kis_stream_watchdog', silentWhen: '연결 정상이면 무음 — 미연결 시에만 재시작' },
  { timeKst: '09:07', label: '파이프라인 헬스체크', group: 'maintenance', jobName: 'pipeline_health_check', silentWhen: '정상 시 요약만 — 실패 항목 있을 때 강조' },
  { timeKst: '09:12', label: 'newsSupply 추적', group: 'screener', jobName: 'news_supply_tracker' },
  { timeKst: '10:45', label: '장전 방향 카드 (HK 개장 30분 후 재계산)', group: 'alerts', jobName: 'pre_market_card_hk', silentWhen: '|Bias Score| < 40 이면 무음' },
  { timeKst: '12:30', label: '점심 통합 브리핑', group: 'reports', jobName: 'lunch_briefing' },
  { timeKst: '14:35', label: '섹터 사이클 대시보드', group: 'reports', jobName: 'sector_cycle_dashboard' },
  { timeKst: '15:15', label: '휴장 진입 직전 알림 (ADR-0132)', group: 'alerts', jobName: 'holiday_enter_alert', silentWhen: '다음 영업일까지 비영업 간격 < 3일이면 무음 — LONG_HOLIDAY 진입 직전에만 발송' },
  { timeKst: '15:20', label: '활성 OCO 일괄 취소 (장마감 전 정리)', group: 'trading', jobName: 'cancel_all_active_oco', silentWhen: '내부 주문 정리만 — Telegram 송출 없음' },
  { timeKst: '15:20', label: 'KIS WebSocket 스트림 종료', group: 'trading', jobName: 'kis_stream_stop', silentWhen: '내부 스트림 종료만 — Telegram 송출 없음' },
  { timeKst: '15:30', label: '시장 레짐 변수 갱신 (장마감)', group: 'reports', jobName: 'market_regime_refresh_close', silentWhen: '내부 캐시 갱신만 — Telegram 송출 없음' },
  { timeKst: '15:30', label: 'Market-close runtime debug snapshot capture (Patch-AFTER-HOURS-RUNTIME-DEBUG-SNAPSHOT-001/002/003)', group: 'maintenance', jobName: 'runtime_debug_snapshot_capture', silentWhen: 'RUNTIME_DEBUG_SNAPSHOT_DISABLED=true 이거나 KRX 휴장일이면 무음 — 15:30 = 장마감 기준 스냅샷 (장후 KIS/KRX 400/500 회피), replay 시 SELL_ONLY 의미 부여 금지 (sessionInterpretation=INTRADAY_REPLAY_EQUIVALENT). 다음 거래일 15:30 성공 capture 시 single-latest overwrite, 금→월 lifecycle 보존.' },
  { timeKst: '15:35', label: 'INFO 일일 다이제스트 flush', group: 'reports', jobName: 'info_digest_flush', silentWhen: 'INFO 버퍼 비어 있으면 무음 (당일 INFO 알림 없음)' },
  { timeKst: '15:35', label: '매도 체결 폴링 종료', group: 'trading', jobName: 'sell_poll_stop', silentWhen: '내부 폴링 타이머 정리만 — Telegram 송출 없음' },
  { timeKst: '15:40', label: 'Ghost Portfolio 갱신', group: 'learning', jobName: 'ghost_portfolio', silentWhen: '내부 캐시 갱신만 — Telegram 송출 없음' },
  { timeKst: '15:50', label: '학습 흐름 unclog (EOD)', group: 'learning', jobName: 'learning_flow_unclog_eod', silentWhen: '내부 학습 복구만 — Telegram 송출 없음' },
  { timeKst: '16:00', label: 'Counterfactual Resolve (ADR-0007)', group: 'learning', jobName: 'counterfactual_resolve', silentWhen: '내부 학습 영속만 — Telegram 송출 없음' },
  { timeKst: '16:00', label: '장마감 통합 브리핑', group: 'reports', jobName: 'eod_briefing' },
  { timeKst: '16:00', label: '워치리스트 정리 (EOD)', group: 'screener', jobName: 'cleanup_watchlist', silentWhen: '내부 정리만 — Telegram 송출 없음' },
  { timeKst: '16:03', label: '매크로 다이제스트 POST_CLOSE (ADR-0040)', group: 'alerts', jobName: 'macro_digest_post_close' },
  { timeKst: '16:15', label: 'Ledger Resolve (ADR-0007)', group: 'learning', jobName: 'ledger_resolve', silentWhen: '내부 학습 영속만 — Telegram 송출 없음' },
  { timeKst: '16:05', label: '52주 신고가 모멘텀 스캔', group: 'reports', jobName: 'high_52w_scan', silentWhen: '편입 후보 0건이면 무음' },
  { timeKst: '16:07', label: 'Shadow 수량 drift 점검 (DRY-RUN)', group: 'maintenance', jobName: 'shadow_qty_dryrun_broadcast', silentWhen: 'drift 0건이면 무음' },
  { timeKst: '16:12', label: 'Near-Miss Outcome Evaluation (ADR-454b)', group: 'maintenance', jobName: 'near_miss_outcome_evaluation', silentWhen: '관측 활동 0건이면 무음 — executionImpact=NONE' },
  { timeKst: '16:25', label: '저녁 사이클 회로 자동 reset', group: 'maintenance', jobName: 'circuit_auto_reset', silentWhen: '내부 회로 reset 만 — Telegram 송출 없음' },
  { timeKst: '16:20', label: '일일 종목 픽 리포트', group: 'reports', jobName: 'daily_pick_report' },
  { timeKst: '16:33', label: '데이터 검증 배치 (ADR-0128)', group: 'maintenance', jobName: 'data_verification_batch', silentWhen: '내부 검증/격리 마커만 — Telegram 송출 없음 (`DATA_VERIFICATION_BATCH_DISABLED=true` 시 skip)' },
  { timeKst: '16:55', label: 'Stage1 사전 스크리닝', group: 'screener', jobName: 'stage1_pre_screening', silentWhen: '내부 스크리닝 — Telegram 송출 없음' },
  { timeKst: '16:30', label: 'Future Return Resolve (ADR-0175)', group: 'learning', jobName: 'future_return_resolve', silentWhen: 'ENV `FUTURE_RETURN_RESOLVER_ENABLED` 미활성 또는 활성 signal 없으면 무음' },
  { timeKst: '16:35', label: 'Gate3 Forward Return 갱신 (P1-FIX)', group: 'learning', jobName: 'gate3_forward_return_update', silentWhen: 'ENV `GATE3_FORWARD_RETURN_CRON_ENABLED=false` 또는 갱신된 seed 0건이면 무음 — 갱신>0 시에만 LOW 알림' },
  { timeKst: '16:40', label: 'Safety Gate Attribution (ADR-0174 §2.1)', group: 'learning', jobName: 'safety_gate_attribution', silentWhen: 'ENV `SAFETY_GATE_ATTRIBUTION_ENABLED` 미활성이면 무음 — 내부 학습 분석 로그만, Telegram 송출 없음' },
  { timeKst: '16:45', label: 'Shadow vs Live Delta (ADR-0174 §2.2)', group: 'learning', jobName: 'shadow_live_delta_report', silentWhen: 'ENV `SHADOW_LIVE_DELTA_REPORT_ENABLED` 미활성이면 무음 — 내부 학습 분석 로그만, Telegram 송출 없음' },
  { timeKst: '16:36', label: 'Unified Forward Outcome Labeler (게이트 ledger forward-return 성숙, counterfacture_gate)', group: 'learning', jobName: 'unified_forward_outcome_labeling', silentWhen: '내부 학습 성숙만 — Telegram 송출 없음 (ENV `UNIFIED_FORWARD_OUTCOME_LABELER_ENABLED=false` 시 비활성)' },
  { timeKst: '16:50', label: 'counterfacture_gate Readiness 알람 (Phase J)', group: 'learning', jobName: 'counterfacture_gate_readiness_alert', silentWhen: 'gate×regime 첫 actionable(≥30표본) 전이 시에만 발송 — 전이 없으면 무음 (ENV `COUNTERFACTURE_GATE_READINESS_ALERT_DISABLED=true` 시 비활성)' },
  { timeKst: '17:05', label: 'L2 일일 평가 fallback (2026-06-11 EVAL_STALE 인시던트 처방)', group: 'learning', jobName: 'daily_eval_fallback', silentWhen: '16:30 오케스트레이터가 당일 평가를 이미 실행했으면 no-op 무음 — 누락 보충 실행 시에만 NORMAL 1줄 (CH4)' },
  { timeKst: '16:40', label: '스캔 회고 리포트', group: 'reports', jobName: 'scan_retrospective' },
  { timeKst: '19:00', label: 'Nightly Reflection', group: 'learning', jobName: 'nightly_reflection' },
  { timeKst: '20:30', label: 'KIS 토큰 강제 갱신 (저녁)', group: 'trading', jobName: 'kis_token_refresh', silentWhen: '성공 시 내부 로그만' },
  { timeKst: '22:25', label: '미국 장전 글로벌 진단 (ADR-0403)', group: 'screener', jobName: 'us_premarket_scan', silentWhen: '글로벌 진단 전용 — KR 신호 스캔 미호출' },
  { timeKst: '23:30', label: '일일 Reconciliation', group: 'maintenance', jobName: 'daily_reconcile', silentWhen: '장부 일치 시 내부 로그만 — 불일치 임계 초과 시에만 CRITICAL' },

  // ── 새벽 / 장전 배치 ──────────────────────────────────────────────────────
  { timeKst: '01:00', label: '백업 세리머니', group: 'maintenance', jobName: 'backup_ceremony', silentWhen: '내부 백업만 — Telegram 송출 없음' },
  { timeKst: '03:00', label: '일일 백업', group: 'maintenance', jobName: 'daily_backup', silentWhen: '내부 백업만 — Telegram 송출 없음' },
  { timeKst: '03:10', label: 'F2W Reverse Loop', group: 'learning', jobName: 'f2w_reverse_loop' },
  { timeKst: '04:00', label: '섹터맵 일일 재시도', group: 'maintenance', jobName: 'sector_map_daily_retry', silentWhen: '주간 갱신 성공 시 무음 (재시도 불필요)' },
  { timeKst: '06:00', label: '주식마스터 자동 보강 (ADR-0242/0413 — 06:00·19:00 1일 2회)', group: 'maintenance', jobName: 'stock_master_auto_enrichment', silentWhen: '변동 없으면 내부 로그만' },

  // ── 주간 / 월간 리포트 ────────────────────────────────────────────────────
  { timeKst: '월 08:00', label: '주간 캘리브레이션 리포트', group: 'reports', jobName: 'weekly_report' },
  { timeKst: '월 08:10', label: '주간 조건 성과 스코어카드', group: 'reports', jobName: 'weekly_condition_scorecard' },
  { timeKst: '수 15:00', label: '주간 심층 분석 카드 (SWING)', group: 'reports', jobName: 'weekly_deep_analysis', silentWhen: 'SWING Gate 상위 종목 없을 시 무음' },
  { timeKst: '수 16:30', label: '주중 Sharpe 급락 조기 경보', group: 'learning', jobName: 'weekly_sharpe_alert', silentWhen: 'Sharpe 이번 주 > 4주 평균 50% 이면 무음' },
  { timeKst: '금 17:00', label: '주간 퀀트 인사이트', group: 'reports', jobName: 'weekly_quant_insight' },
  { timeKst: '금 17:10', label: 'SYSTEM 채널 주간 요약 flush', group: 'reports', jobName: 'system_weekly_flush', silentWhen: 'SYSTEM 버퍼 비어 있으면 무음' },
  { timeKst: '일 10:00', label: '주간 무결성 + 알림 감사 리포트', group: 'reports', jobName: 'weekly_integrity_report' },
  { timeKst: '월 07:00', label: 'L3 주간 경량 캘리브레이션', group: 'learning', jobName: 'weekly_calib', silentWhen: '내부 학습 — Telegram 송출 없음' },
  { timeKst: '월 09:17', label: '명령어 폐기 후보 리포트', group: 'maintenance', jobName: 'deprecation_report', silentWhen: '폐기 후보 0건이면 무음' },
  { timeKst: '토 08:00', label: '주간 백테스트', group: 'learning', jobName: 'weekly_backtest', silentWhen: '내부 학습 — Telegram 송출 없음' },
  { timeKst: '토 09:00', label: '동적 유니버스 확장', group: 'screener', jobName: 'dynamic_universe_expansion', silentWhen: '내부 유니버스 갱신 — Telegram 송출 없음' },
  { timeKst: '토·일 02:00', label: '주말 해외 뉴스 스캔 (공급망)', group: 'screener', jobName: 'supply_chain_scan_02kst' },
  { timeKst: '토·일 10:10', label: '주말 해외 뉴스 재스캔 (공급망)', group: 'screener', jobName: 'supply_chain_scan_10kst' },
  { timeKst: '일 03:00', label: 'trace 파일 정리', group: 'maintenance', jobName: 'cleanup_trace_files', silentWhen: '내부 파일 정리만 — Telegram 송출 없음' },
  { timeKst: '월 03:00', label: 'KRX 전종목 섹터맵 주간 갱신', group: 'maintenance', jobName: 'sector_map_weekly', silentWhen: '내부 갱신만 — Telegram 송출 없음' },
  { timeKst: '일 18:00', label: 'Silent Distillation (주간 지식 증류)', group: 'learning', jobName: 'silent_distillation', silentWhen: '내부 학습 축적 — Telegram 송출 없음' },
  { timeKst: '일 19:00', label: 'CH4 JOURNAL 주간 자기비판 (ADR-0041)', group: 'alerts', jobName: 'weekly_self_critique' },
  { timeKst: '1일 09:00', label: 'KIS 휴장일 동기화 (월간)', group: 'maintenance', jobName: 'kis_holiday_sync_monthly', silentWhen: '변경 없으면 내부 로그만' },
  { timeKst: '1/2 09:00', label: 'KIS 휴장일 동기화 (연간)', group: 'maintenance', jobName: 'kis_holiday_sync_yearly', silentWhen: '변경 없으면 내부 로그만' },
  { timeKst: '1일 10:00', label: 'BUG_LEDGER 월간 자동 요약 (PR #669/#670 후속 P2-B)', group: 'reports', jobName: 'bug_ledger_monthly_report', silentWhen: 'BUG_LEDGER 비어 있거나 BUG_LEDGER_MONTHLY_REPORT_DISABLED=true 이면 무음' },
  { timeKst: '09:30', label: 'BUG 후보 검출 (CRITICAL 알림 패턴, PR #669~#674 후속 P3)', group: 'maintenance', jobName: 'bug_candidate_detector', silentWhen: 'BUG_CANDIDATE_DETECTOR_ENABLED 미활성 또는 신규 후보 0건이면 무음 (자동 BUG_LEDGER 전사 영구 금지)' },
  { timeKst: '1일 07:00', label: 'Walk-Forward Validation (월 1회)', group: 'learning', jobName: 'walk_forward_validation', silentWhen: 'IS↔OOS 승률 격차 ≤ 15%p 이면 무음' },
  { timeKst: '12/1 09:00', label: 'KRX 차년도 휴장일 감사 (연 1회)', group: 'maintenance', jobName: 'krx_holiday_audit', silentWhen: '차년도 휴장일 ≥ 8개 등록되어 있으면 무음 — 미달 시 CRITICAL' },

  // ── 자가점검 헬스 루프 (ADR-0131) ─────────────────────────────────────────
  { timeKst: '상시',  label: '자가점검 헬스 루프 Tier 1 (5분)', group: 'maintenance', jobName: 'health_loop_tier1', silentWhen: '임계 변화 없으면 무음 (KIS 토큰 6h bucket / master 50% drop / Tier 4 / autoTrade 토글)' },
  { timeKst: '상시',  label: '자가점검 헬스 루프 Tier 2 (1시간)', group: 'maintenance', jobName: 'health_loop_tier2', silentWhen: '임계 변화 없으면 무음 (시드 — 향후 Yahoo/KRX/Gemini 임계 확장)' },
  { timeKst: '09:00', label: '자가점검 헬스 루프 Tier 3 (일일 종합)', group: 'maintenance', jobName: 'health_loop_tier3', silentWhen: '임계 변화 없으면 무음 (시드 — 향후 일일 종합 보고)' },
  { timeKst: '09:30', label: '인증키 만료 watchdog', group: 'maintenance', jobName: 'credential_expiry_watchdog', silentWhen: 'D-90/30/7/1 임계 미도달 시 무음 (KRX_API_KEY 2027-04-19 등)' },
  { timeKst: '07:30', label: 'Pre-Market Kickstart (휴장 후 첫날)', group: 'maintenance', jobName: 'post_holiday_kickstart', silentWhen: '일반 거래일은 무음 — 휴장 직후 첫 거래일에만 발송' },
  { timeKst: '08:30', label: 'Pre-Market Kickstart 추적 점검', group: 'maintenance', jobName: 'post_holiday_followup', silentWhen: '일반 거래일은 무음 — 1차 fail 해소 여부 비교' },

  // ── 상시 ──────────────────────────────────────────────────────────────────
  { timeKst: '상시',  label: '오케스트레이터 1분 tick', group: 'trading', jobName: 'orchestrator_tick' },
  { timeKst: '00:30', label: 'Daily Mini Backtest', group: 'learning', jobName: 'daily_mini_backtest', silentWhen: '내부 학습 영속만 — Telegram 송출 없음' },
  { timeKst: '09:30', label: 'MissedLearningQueue replay (ADR-0176)', group: 'learning', jobName: 'missed_learning_replay', silentWhen: 'ENV `MISSED_LEARNING_QUEUE_ENABLED` 미활성 또는 큐 비어 있으면 무음' },
  // OCO 감시 그룹 — tradeFlowJobs.ts. (cron stagger 감사 2026-06-10: 보조 cron 도 명시 등재)
  { timeKst: '상시',  label: 'OCO/매도 체결 감시 (30초)', group: 'trading', jobName: 'oco_confirm' },
  { timeKst: '상시',  label: 'OCO 생존 점검 (장중 15분)', group: 'trading', jobName: 'oco_survival', silentWhen: '내부 OCO 감시만 — Telegram 송출 없음' },
  { timeKst: '상시',  label: 'OCO 복구 라운드 (장중 5분)', group: 'trading', jobName: 'oco_recovery_round', silentWhen: '내부 OCO 복구만 — Telegram 송출 없음' },
  { timeKst: '상시',  label: '포트폴리오 리스크 점검 (장중 15분)', group: 'trading', jobName: 'portfolio_risk_check', silentWhen: '리스크 임계 미초과 시 무음' },
  { timeKst: '상시',  label: '거시-섹터 정렬 점검 (장중 30분, 09:30~14:30)', group: 'trading', jobName: 'macro_sector_alignment', silentWhen: '내부 동기화 점검 — Telegram 송출 없음' },
  { timeKst: '상시',  label: 'Shadow Resolver tick (장중 5분)', group: 'learning', jobName: 'shadow_resolver_tick', silentWhen: '내부 shadow 청산 판정 — Telegram 송출 없음' },
  { timeKst: '상시',  label: '학습 흐름 unclog (장중 15분)', group: 'learning', jobName: 'learning_flow_unclog_intraday', silentWhen: '내부 학습 복구만 — Telegram 송출 없음' },
  { timeKst: '상시',  label: '시장 레짐 변수 장중 TTL refresh (3분)', group: 'reports', jobName: 'market_regime_refresh_intraday_ttl', silentWhen: '내부 캐시 갱신만 — Telegram 송출 없음' },
  { timeKst: '상시',  label: '워치리스트 장중 정리 (30분, 09:00~15:30)', group: 'screener', jobName: 'cleanup_watchlist_intraday', silentWhen: '내부 정리만 — Telegram 송출 없음' },
  // DART/IPS/ACK 그룹 — alertJobs.ts. (cron stagger 감사 2026-06-10: 보조 cron 도 명시 등재)
  { timeKst: '상시',  label: 'DART/IPS/ACK 폴링 (30분 primary)', group: 'alerts', jobName: 'dart_poll_30min' },
  { timeKst: '상시',  label: 'DART 고속 폴링 (08시 매분)', group: 'alerts', jobName: 'dart_fast_check_pre', silentWhen: '신규 공시 없으면 무음' },
  { timeKst: '상시',  label: 'DART 고속 폴링 (09~18시 매분)', group: 'alerts', jobName: 'dart_fast_check', silentWhen: '신규 공시 없으면 무음' },
  { timeKst: '상시',  label: 'Bear Regime 폴링 (08시 15분)', group: 'alerts', jobName: 'bear_regime_pre', silentWhen: '레짐 전환 없으면 무음' },
  { timeKst: '상시',  label: 'Bear Regime 폴링 (09~17시 15분)', group: 'alerts', jobName: 'bear_regime', silentWhen: '레짐 전환 없으면 무음' },
  { timeKst: '상시',  label: 'IPS 변곡점 경보 (24/7 15분)', group: 'alerts', jobName: 'ips_alert', silentWhen: '변곡점 신호 없으면 무음' },
  { timeKst: '상시',  label: 'T1 ACK 폐루프 스윕 (5분)', group: 'alerts', jobName: 'ack_sweep', silentWhen: '미확인 ACK 없으면 무음' },
  { timeKst: '상시',  label: 'IPYL 장중 수율 tick (30분)', group: 'alerts', jobName: 'intraday_yield_tick', silentWhen: '내부 스냅샷 갱신 — Telegram 송출 없음' },
  // DXY 인트라데이 그룹 — alertJobs.ts.
  { timeKst: '상시',  label: 'DXY 인트라데이 5분 모니터 (US 장중)', group: 'alerts', jobName: 'dxy_intraday_us_session' },
  { timeKst: '상시',  label: 'DXY 인트라데이 5분 모니터 (KST 점심)', group: 'alerts', jobName: 'dxy_intraday_lunch', silentWhen: 'DXY 방향 전환 신호 없을 시 무음' },
  { timeKst: '상시',  label: 'KIS 실잔고 vs Shadow 정합성 (15분)', group: 'maintenance', jobName: 'kis_shadow_reconcile', silentWhen: '장중·SHADOW 모드 자동 스킵 — 불일치 시에만 알림' },
  { timeKst: '상시',  label: 'Mutation Canary (매시 정각)', group: 'maintenance', jobName: 'hourly_canary', silentWhen: '판단 로직 변이 없으면 무음' },
];

const GROUP_LABELS: Record<ScheduleEntry['group'], string> = {
  reports: '리포트',
  alerts: '알림',
  trading: '트레이딩',
  screener: '스크리너',
  learning: '학습',
  maintenance: '유지보수',
};

// ── 실행 이력 (in-memory 링버퍼) ─────────────────────────────────────────────
//   서버 재시작 시 휘발됨 — 운영 디버깅용. 디스크 저장은 채널 audit 로그가 담당.

export interface ScheduleRunRecord {
  jobName: string;
  startedAt: string;       // ISO
  finishedAt: string;      // ISO
  durationMs: number;
  status: 'success' | 'failure' | 'skipped';
  /** 짧은 사유 — 실패면 에러 메시지 첫 줄, success 면 결과 요약 */
  note?: string;
}

const HISTORY_LIMIT = 100;
const _history: ScheduleRunRecord[] = [];
const _lastByJob = new Map<string, ScheduleRunRecord>();

/**
 * 작업별 누적 메트릭 — recordScheduleRun() 가 갱신.
 * 운영자가 "지난주 어떤 잡이 가장 많이 실패했나?" 같은 시계열 질문에 답하기 위한 SSOT.
 */
export interface JobMetrics {
  jobName: string;
  /** success + failure + skipped 누적 */
  runCount: number;
  successCount: number;
  failCount: number;
  skippedCount: number;
  /** 마지막 성공 시각 (ISO) */
  lastSuccessAt?: string;
  /** 마지막 실패 시각 (ISO) */
  lastFailureAt?: string;
  /** 마지막 실패 메시지 — note 첫 줄 ≤120자 절삭 */
  lastErrorMessage?: string;
  /**
   * 마지막 스킵 사유 — ScheduleGuard(ADR-0043) 가 기록.
   * 'WEEKEND' / 'KRX_HOLIDAY' / 'LONG_HOLIDAY' / 'TRADING_DAY' / 'NON_TRADING_DAY' 등.
   * 운영자가 "월요일 자기반성이 정상 실행됐는가" 같은 시계열 진단에 활용.
   */
  lastSkipReason?: string;
}

const _metricsByJob = new Map<string, JobMetrics>();
const ERROR_MESSAGE_LIMIT = 120;

// ── PR-Diag-5: JobMetrics 영속화 (Railway 재배포 시 reset 방지) ─────────────
// 메모리 _metricsByJob 만으로는 프로세스 재시작 시 runCount=0 으로 초기화되어
// /cron_introspect 가 모든 cron 을 CONTRADICTION_METRICS_LIES 로 보고하던 결함.
// 본 모듈 로드 시 1회 디스크 복원 + recordScheduleRun() 마다 debounce save.
// 순환 참조 부재 (scheduleCatalog → jobMetricsRepo → paths) — top-level static import 안전.

import { loadJobMetrics, saveJobMetrics, __resetJobMetricsFileForTests } from '../persistence/jobMetricsRepo.js';

const PERSISTENCE_DEBOUNCE_MS = 30000; // 30초 throttle — orchestrator_tick 매 분 호출 부하 흡수, 디스크 쓰기 부하 방어
let _persistTimer: NodeJS.Timeout | null = null;
let _persistenceLoaded = false;

function loadPersistedMetricsOnce(): void {
  if (_persistenceLoaded) return;
  _persistenceLoaded = true;
  try {
    const persisted = loadJobMetrics();
    let restored = 0;
    for (const [jobName, entry] of Object.entries(persisted)) {
      _metricsByJob.set(jobName, { ...entry });
      restored++;
    }
    if (restored > 0) {
      console.log(`[Boot] JobMetrics 복원: ${restored}개 cron (디스크 → 메모리)`);
    }
  } catch (e) {
    emitMaintenanceWarn({ domain: 'DIAGNOSTIC', code: 'P3_SCHEDULER_CATALOG_DRIFT', source: 'SCHEDULE_CATALOG', message: 'JobMetrics restore failed; starting with empty in-memory metrics.', dedupKey: 'p3:schedule-catalog:metrics-restore', error: e, details: { detailsSuppressed: true } });
  }
}

/** debounce 우회 즉시 디스크 저장 (fail 발생 시 디버깅 우선) */
function flushMetricsImmediate(): void {
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  try {
    const snapshot: Record<string, JobMetrics> = {};
    for (const [k, v] of _metricsByJob) snapshot[k] = { ...v };
    saveJobMetrics(snapshot);
  } catch (e) {
    emitMaintenanceWarn({ domain: 'DIAGNOSTIC', code: 'P3_SCHEDULER_CATALOG_DRIFT', source: 'SCHEDULE_CATALOG', message: 'JobMetrics immediate persistence failed.', dedupKey: 'p3:schedule-catalog:metrics-flush-immediate', error: e, details: { detailsSuppressed: true } });
  }
}

function schedulePersistMetrics(): void {
  if (_persistTimer) return; // debounce window 안 — skip
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    try {
      const snapshot: Record<string, JobMetrics> = {};
      for (const [k, v] of _metricsByJob) snapshot[k] = { ...v };
      saveJobMetrics(snapshot);
    } catch (e) {
      emitMaintenanceWarn({ domain: 'DIAGNOSTIC', code: 'P3_SCHEDULER_CATALOG_DRIFT', source: 'SCHEDULE_CATALOG', message: 'JobMetrics debounced persistence failed.', dedupKey: 'p3:schedule-catalog:metrics-flush-debounced', error: e, details: { detailsSuppressed: true } });
    }
  }, PERSISTENCE_DEBOUNCE_MS);
  // 프로세스 종료 차단 안 함
  if (typeof _persistTimer.unref === 'function') _persistTimer.unref();
}

// 모듈 로드 시 1회 자동 복원
loadPersistedMetricsOnce();

function ensureMetrics(jobName: string): JobMetrics {
  let m = _metricsByJob.get(jobName);
  if (!m) {
    m = { jobName, runCount: 0, successCount: 0, failCount: 0, skippedCount: 0 };
    _metricsByJob.set(jobName, m);
  }
  return m;
}

export function recordScheduleRun(rec: ScheduleRunRecord): void {
  _history.push(rec);
  if (_history.length > HISTORY_LIMIT) _history.shift();
  _lastByJob.set(rec.jobName, rec);

  // 누적 메트릭 갱신 — JobMetrics SSOT
  const m = ensureMetrics(rec.jobName);
  m.runCount += 1;
  if (rec.status === 'success') {
    m.successCount += 1;
    m.lastSuccessAt = rec.finishedAt;
  } else if (rec.status === 'failure') {
    m.failCount += 1;
    m.lastFailureAt = rec.finishedAt;
    if (rec.note) {
      m.lastErrorMessage = rec.note.slice(0, ERROR_MESSAGE_LIMIT);
    }
  } else {
    m.skippedCount += 1;
    if (rec.note) {
      m.lastSkipReason = rec.note.slice(0, ERROR_MESSAGE_LIMIT);
    }
  }
  // PR-Diag-5: 갱신 후 영속화 — fail 은 디버깅 우선으로 즉시 저장,
  // success/skipped 는 30초 throttle 로 디스크 부하 방어 (orchestrator_tick 매 분 호출 흡수).
  if (rec.status === 'failure') {
    flushMetricsImmediate();
  } else {
    schedulePersistMetrics();
  }
}

export function getScheduleHistory(limit = 20): ScheduleRunRecord[] {
  return _history.slice(-limit).reverse();
}

export function getLastRunByJob(jobName: string): ScheduleRunRecord | undefined {
  return _lastByJob.get(jobName);
}

/** 단일 작업 누적 메트릭. 한 번도 실행 안 된 작업은 undefined. */
export function getJobMetrics(jobName: string): JobMetrics | undefined {
  return _metricsByJob.get(jobName);
}

/**
 * 등록된 모든 작업의 메트릭 — failCount 내림차순, 동률은 runCount 내림차순.
 * "최악 실패율" 작업이 항상 먼저 보이도록 정렬.
 */
export function getAllJobMetrics(): JobMetrics[] {
  return Array.from(_metricsByJob.values())
    .map((m) => ({ ...m })) // 외부에서 mutate 차단
    .sort((a, b) => {
      if (b.failCount !== a.failCount) return b.failCount - a.failCount;
      return b.runCount - a.runCount;
    });
}

/** 테스트 전용 — 메트릭/이력 초기화 + 영속 파일 삭제 + debounce 타이머 청소 */
export function __resetScheduleMetricsForTests(): void {
  _history.length = 0;
  _lastByJob.clear();
  _metricsByJob.clear();
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  _persistenceLoaded = false; // 다음 recordScheduleRun 또는 재로드 시 디스크 복원 재시도
  try {
    __resetJobMetricsFileForTests();
  } catch {
    /* noop — paths 미설정 환경 */
  }
}

/** 테스트 전용 — 디스크에서 현재 영속 상태 즉시 강제 저장 (debounce 우회) */
export function __flushJobMetricsForTests(): void {
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  try {
    const snapshot: Record<string, JobMetrics> = {};
    for (const [k, v] of _metricsByJob) snapshot[k] = { ...v };
    saveJobMetrics(snapshot);
  } catch {
    /* noop */
  }
}

/**
 * cron 콜백 래퍼 — 시작/종료 시각, 성공/실패, 소요 시간을 자동 기록한다.
 * 사용 예: cron.schedule('30 11 * * *', wrapJob('kis_token_refresh', () => doStuff()))
 */
export function wrapJob<T>(
  jobName: string,
  fn: () => Promise<T> | T,
  noteFn?: (result: T) => string | undefined,
): () => Promise<void> {
  return async () => {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    try {
      const result = await fn();
      const finishedAt = new Date().toISOString();
      recordScheduleRun({
        jobName,
        startedAt,
        finishedAt,
        durationMs: Date.now() - t0,
        status: 'success',
        note: noteFn ? noteFn(result) : undefined,
      });
    } catch (e) {
      const finishedAt = new Date().toISOString();
      const note = e instanceof Error ? e.message.split('\n')[0] : String(e);
      recordScheduleRun({
        jobName,
        startedAt,
        finishedAt,
        durationMs: Date.now() - t0,
        status: 'failure',
        note,
      });
      // 실패도 throw 하지 않고 swallow — 다음 cron 주기는 계속 살아있어야 한다.
      console.error(`[Scheduler:${jobName}] 실패:`, e);
    }
  };
}

/** 시:분 (KST) — 'HH:MM' 또는 '상시' → 분 정렬 키. '상시' 는 항상 마지막. */
function parseKstMinutes(s: string): number {
  if (!/^\d{2}:\d{2}$/.test(s)) return Number.MAX_SAFE_INTEGER;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function nowKstMinutes(): number {
  const kstNow = new Date(Date.now() + 9 * 3_600_000);
  return kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
}

/** 다음 실행 예정 작업 N개 — '상시' 작업은 next 결과에서 제외 (시각이 없음). */
export function getNextScheduled(limit = 5): ScheduleEntry[] {
  const now = nowKstMinutes();
  const timed = SCHEDULE_CATALOG
    .filter(e => /^\d{2}:\d{2}$/.test(e.timeKst))
    .map(e => ({ entry: e, mins: parseKstMinutes(e.timeKst) }))
    .sort((a, b) => a.mins - b.mins);
  // 오늘 남은 + 내일 새벽 (rotate)
  const remainingToday = timed.filter(x => x.mins >= now);
  const tomorrow = timed.filter(x => x.mins < now);
  return [...remainingToday, ...tomorrow].slice(0, limit).map(x => x.entry);
}

// ── 포맷터 ───────────────────────────────────────────────────────────────────

function fmtRunStatus(rec?: ScheduleRunRecord): string {
  if (!rec) return '<i>실행 이력 없음</i>';
  const ts = new Date(rec.finishedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const emoji = rec.status === 'success' ? '✅' : rec.status === 'failure' ? '❌' : '⏭';
  const note = rec.note ? ` — ${rec.note.slice(0, 60)}` : '';
  return `${emoji} ${ts} (${rec.durationMs}ms)${note}`;
}

/** 기본 시간표 (group 별 정리). /scheduler */
export function formatSchedulerSummary(): string {
  const lines: string[] = ['🗓 <b>[스케줄러 시간표]</b>'];
  const order: ScheduleEntry['group'][] = ['reports', 'alerts', 'trading', 'screener', 'learning', 'maintenance'];

  for (const group of order) {
    const items = SCHEDULE_CATALOG.filter((entry) => entry.group === group);
    if (items.length === 0) continue;
    lines.push(`\n<b>${GROUP_LABELS[group]}</b>`);
    for (const item of items) {
      const last = item.jobName ? getLastRunByJob(item.jobName) : undefined;
      const lastTag = last
        ? ` <i>(${last.status === 'success' ? '✅' : last.status === 'failure' ? '❌' : '⏭'})</i>`
        : '';
      const disabled = item.disabled ? ' <i>[비활성]</i>' : '';
      const silent = item.silentWhen ? ' 🔕' : '';
      lines.push(`• ${item.timeKst} — ${item.label}${disabled}${silent}${lastTag}`);
    }
  }
  lines.push('\n<i>🔕 = 조건부 무음 (상세는 /scheduler detail)</i>');
  lines.push('<i>/scheduler next · detail · history</i>');
  return lines.join('\n');
}

/** 다음 실행 예정 작업 5개. /scheduler next */
export function formatSchedulerNext(): string {
  const next = getNextScheduled(5);
  if (next.length === 0) return '🗓 다음 실행 예정 작업이 없습니다 (상시 tick 만 등록됨).';
  const lines: string[] = ['⏭ <b>[다음 실행 예정 5건]</b>'];
  const now = nowKstMinutes();
  for (const e of next) {
    const mins = parseKstMinutes(e.timeKst);
    const delta = mins - now;
    const eta = delta >= 0
      ? `+${Math.floor(delta / 60)}h${(delta % 60).toString().padStart(2, '0')}m 뒤`
      : `내일 ${e.timeKst}`;
    lines.push(`• ${e.timeKst} (${eta}) — ${e.label}`);
  }
  return lines.join('\n');
}

/** 작업별 상세: cron 시각, timezone, 활성 여부, 마지막 실행 결과. /scheduler detail */
export function formatSchedulerDetail(): string {
  const lines: string[] = ['🔧 <b>[스케줄러 상세]</b>', `<i>timezone: Asia/Seoul (UTC+9)</i>`];
  const order: ScheduleEntry['group'][] = ['reports', 'alerts', 'trading', 'screener', 'learning', 'maintenance'];
  for (const group of order) {
    const items = SCHEDULE_CATALOG.filter(e => e.group === group);
    if (items.length === 0) continue;
    lines.push(`\n<b>${GROUP_LABELS[group]}</b>`);
    for (const item of items) {
      const enabled = item.disabled ? '🔴 DISABLED' : '🟢 ENABLED';
      const last = item.jobName ? getLastRunByJob(item.jobName) : undefined;
      lines.push(`• <b>${item.label}</b> — ${item.timeKst} — ${enabled}`);
      if (item.silentWhen) {
        lines.push(`   🔕 조건부 무음: ${item.silentWhen}`);
      }
      lines.push(`   마지막: ${fmtRunStatus(last)}`);
    }
  }
  return lines.join('\n');
}

/** 최근 실행 이력 N건 (시간 역순). /scheduler history [n] */
export function formatSchedulerHistory(limit = 15): string {
  const hist = getScheduleHistory(limit);
  if (hist.length === 0) {
    return '📜 <b>[스케줄러 이력]</b>\n<i>아직 기록된 실행이 없습니다.</i>\n(서버 재시작 후 in-memory 링버퍼이며, 작업이 실행될수록 누적됩니다.)';
  }
  const lines: string[] = [`📜 <b>[스케줄러 이력 — 최근 ${hist.length}건]</b>`];
  for (const r of hist) {
    const ts = new Date(r.finishedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const emoji = r.status === 'success' ? '✅' : r.status === 'failure' ? '❌' : '⏭';
    const note = r.note ? ` — ${r.note.slice(0, 50)}` : '';
    lines.push(`• ${ts} ${emoji} <b>${r.jobName}</b> (${r.durationMs}ms)${note}`);
  }
  return lines.join('\n');
}
