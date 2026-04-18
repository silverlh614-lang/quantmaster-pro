import React from 'react';
import { ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import type { BrokerConnectionState } from '../../services/autoTrading/autoTradingTypes';
import { Section } from '../../ui/section';

interface BrokerConnectionPanelProps {
  broker: BrokerConnectionState;
}

export function BrokerConnectionPanel({ broker }: BrokerConnectionPanelProps) {
  return (
    <Section title="브로커 연결 상태" subtitle="Broker Connection Panel">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card
          label="브로커"
          value={broker.brokerName}
          icon={
            broker.connected ? (
              <Wifi className="h-4 w-4 text-emerald-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-400" />
            )
          }
        />

        <Card label="계좌" value={broker.accountMasked ?? '-'} />
        <Card
          label="주문 가능 여부"
          value={broker.orderAvailable ? '가능' : '불가'}
          tone={broker.orderAvailable ? 'ok' : 'danger'}
        />
        <Card label="잔고 동기화" value={broker.balanceSyncedAt ?? '-'} />
        <Card label="시세 동기화" value={broker.quoteSyncedAt ?? '-'} />

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-xs text-white/50">
            <ShieldAlert className="h-4 w-4" />
            최근 오류
          </div>
          <div className="mt-2 text-sm text-red-300">{broker.lastError || '없음'}</div>
        </div>
      </div>
    </Section>
  );
}

function Card({
  label,
  value,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'ok' | 'danger';
}) {
  const toneClass =
    tone === 'ok' ? 'text-emerald-300' : tone === 'danger' ? 'text-red-300' : 'text-white';

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-xs text-white/50">
        {icon}
        {label}
      </div>
      <div className={`mt-2 text-sm font-medium ${toneClass}`}>{value}</div>
    </div>
  );
}
