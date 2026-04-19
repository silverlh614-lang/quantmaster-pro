import React from 'react';
import { ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import type { BrokerConnectionState } from '../../services/autoTrading/autoTradingTypes';
import { Section } from '../../ui/section';
import { InfoTile } from '../../ui/info-tile';

interface BrokerConnectionPanelProps {
  broker: BrokerConnectionState;
}

export function BrokerConnectionPanel({ broker }: BrokerConnectionPanelProps) {
  return (
    <Section title="브로커 연결 상태" subtitle="Broker Connection Panel">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <InfoTile
          label="브로커"
          icon={
            broker.connected ? (
              <Wifi className="h-4 w-4 text-emerald-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-400" />
            )
          }
          value={broker.brokerName}
        />

        <InfoTile label="계좌" value={broker.accountMasked ?? '-'} />

        <InfoTile
          label="주문 가능 여부"
          value={broker.orderAvailable ? '가능' : '불가'}
          tone={broker.orderAvailable ? 'success' : 'danger'}
        />

        <InfoTile label="잔고 동기화" value={broker.balanceSyncedAt ?? '-'} />
        <InfoTile label="시세 동기화" value={broker.quoteSyncedAt ?? '-'} />

        <InfoTile
          label="최근 오류"
          icon={<ShieldAlert className="h-4 w-4 text-red-400" />}
          value={broker.lastError || '없음'}
          tone={broker.lastError ? 'danger' : 'neutral'}
        />
      </div>
    </Section>
  );
}
