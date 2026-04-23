export interface ScheduleEntry {
  timeKst: string;
  label: string;
  group: 'reports' | 'alerts' | 'trading' | 'screener' | 'learning' | 'maintenance';
}

export const SCHEDULE_CATALOG: ScheduleEntry[] = [
  { timeKst: '08:30', label: '장전 방향 카드', group: 'alerts' },
  { timeKst: '08:35', label: 'ADR 갭 스캔 / 최종 스크리닝', group: 'alerts' },
  { timeKst: '08:45', label: '아침 통합 브리핑', group: 'reports' },
  { timeKst: '09:00', label: 'MHS 알림 / 거시-섹터 동기화 시작', group: 'alerts' },
  { timeKst: '09:05', label: '보유 포지션 모닝카드', group: 'reports' },
  { timeKst: '09:10', label: 'newsSupply 추적', group: 'screener' },
  { timeKst: '12:30', label: '점심 통합 브리핑', group: 'reports' },
  { timeKst: '14:30', label: '섹터 사이클 대시보드', group: 'reports' },
  { timeKst: '15:35', label: 'INFO 일일 다이제스트 flush', group: 'reports' },
  { timeKst: '15:40', label: 'Ghost Portfolio 갱신', group: 'learning' },
  { timeKst: '16:00', label: '장마감 통합 브리핑', group: 'reports' },
  { timeKst: '16:05', label: '52주 신고가 모멘텀 스캔', group: 'reports' },
  { timeKst: '16:30', label: '일일 종목 픽 리포트', group: 'reports' },
  { timeKst: '16:40', label: '스캔 회고 리포트', group: 'reports' },
  { timeKst: '19:00', label: 'Nightly Reflection', group: 'learning' },
  { timeKst: '20:30', label: 'KIS 토큰 강제 갱신', group: 'trading' },
  { timeKst: '23:30', label: '일일 Reconciliation', group: 'maintenance' },
  { timeKst: '상시', label: '오케스트레이터 1분 tick', group: 'trading' },
  { timeKst: '상시', label: 'OCO/매도 체결 감시', group: 'trading' },
  { timeKst: '상시', label: 'DART/IPS/ACK 폴링', group: 'alerts' },
];

const GROUP_LABELS: Record<ScheduleEntry['group'], string> = {
  reports: '리포트',
  alerts: '알림',
  trading: '트레이딩',
  screener: '스크리너',
  learning: '학습',
  maintenance: '유지보수',
};

export function formatSchedulerSummary(): string {
  const lines: string[] = ['🗓 <b>[스케줄러 시간표]</b>'];
  const order: ScheduleEntry['group'][] = ['reports', 'alerts', 'trading', 'screener', 'learning', 'maintenance'];

  for (const group of order) {
    const items = SCHEDULE_CATALOG.filter((entry) => entry.group === group);
    if (items.length === 0) continue;
    lines.push(`\n<b>${GROUP_LABELS[group]}</b>`);
    for (const item of items) lines.push(`• ${item.timeKst} — ${item.label}`);
  }

  return lines.join('\n');
}
