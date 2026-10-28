import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Empty, Switch, Tag, Tooltip, Typography } from 'antd';
import {
  ClockCircleOutlined,
  CloudOutlined,
  CopyOutlined,
  EditOutlined,
  ExportOutlined,
  InfoCircleOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  DeleteOutlined,
} from '@ant-design/icons';

import { SizeFormatter } from '@/utils';
import type { ClientCountEntry, DBInboundRecord, RowAction } from './list/types';
import './InboundDetailPanel.css';

interface InboundDetailPanelProps {
  inbound: DBInboundRecord | null;
  clientCount?: ClientCountEntry;
  onlineClients: string[];
  speed?: { up: number; down: number };
  onRowAction: (key: RowAction, dbInbound: DBInboundRecord) => void;
  onToggleEnable: (dbInbound: DBInboundRecord, next: boolean) => void | Promise<void>;
}

function expiryLabel(expiryTime: number): string {
  if (!expiryTime || expiryTime <= 0) return '∞';
  const days = Math.ceil((expiryTime - Date.now()) / 86_400_000);
  return days > 0 ? `${days}d` : '—';
}

const PROTOCOL_LABELS: Record<string, string> = {
  vmess: 'VMess',
  vless: 'VLESS',
  trojan: 'Trojan',
  shadowsocks: 'SS',
  wireguard: 'WG',
  hysteria: 'HY2',
  tuic: 'TUIC',
  masque: 'MASQ',
  mtproto: 'MTProto',
  amneziawg: 'AWG',
  anytls: 'AnyTLS',
  shadowtls: 'ShadowTLS',
  naive: 'Naive',
  http: 'HTTP',
  mixed: 'Mixed',
  tunnel: 'Tunnel',
};

export default function InboundDetailPanel({
  inbound,
  clientCount,
  onlineClients,
  speed,
  onRowAction,
  onToggleEnable,
}: InboundDetailPanelProps) {
  const { t } = useTranslation();

  if (!inbound) {
    return (
      <Card size="small" className="inbound-detail-card" data-testid="inbound-detail-empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('pages.inbounds.detail.empty')}
        />
      </Card>
    );
  }

  const clients = clientCount?.clients ?? 0;
  const online = (clientCount?.online ?? []).filter((email) =>
    onlineClients.includes(email),
  ).length;
  const totalUsed = inbound.up + inbound.down;
  const totalQuota = inbound.total;
  const usedPct = totalQuota > 0 ? Math.min(100, (totalUsed / totalQuota) * 100) : 0;

  const actions: { key: RowAction; icon: ReactNode; label: string; danger?: boolean }[] = [
    { key: 'showInfo', icon: <InfoCircleOutlined aria-hidden />, label: t('info') },
    { key: 'edit', icon: <EditOutlined aria-hidden />, label: t('edit') },
    { key: 'clipboard', icon: <CopyOutlined aria-hidden />, label: t('pages.inbounds.copyLink') },
    {
      key: 'export',
      icon: <ExportOutlined aria-hidden />,
      label: t('pages.inbounds.exportInbound'),
    },
    {
      key: 'clone',
      icon: <ThunderboltOutlined aria-hidden />,
      label: t('pages.inbounds.clone') ?? t('clone'),
    },
    { key: 'delete', icon: <DeleteOutlined aria-hidden />, label: t('delete'), danger: true },
  ];

  return (
    <Card
      size="small"
      className={`inbound-detail-card${inbound.enable ? '' : ' is-disabled'}`}
      data-testid="inbound-detail-panel"
    >
      <div className="inbound-detail-head">
        <span className="inbound-detail-proto">
          {PROTOCOL_LABELS[inbound.protocol] ?? inbound.protocol.toUpperCase()}
        </span>
        <Typography.Text strong ellipsis className="inbound-detail-title">
          {inbound.remark || `#${inbound.id}`}
        </Typography.Text>
        <Switch
          size="small"
          checked={inbound.enable}
          aria-label={t('pages.inbounds.enable')}
          onChange={(next) => void onToggleEnable(inbound, next)}
        />
      </div>

      <div className="inbound-detail-grid">
        <div>
          <div className="k">{t('pages.inbounds.port')}</div>
          <div className="v">
            {inbound.port}
            <Tooltip title={t('pages.inbounds.speed')}>
              {speed && (speed.up > 0 || speed.down > 0) ? (
                <span className="inbound-detail-speed">
                  ↑ {SizeFormatter.sizeFormat(speed.up)}/s ↓ {SizeFormatter.sizeFormat(speed.down)}
                  /s
                </span>
              ) : null}
            </Tooltip>
          </div>
        </div>
        <div>
          <div className="k">{t('pages.inbounds.traffic')}</div>
          <div className="v">
            {totalQuota > 0
              ? `${SizeFormatter.sizeFormat(totalUsed)} / ${SizeFormatter.sizeFormat(totalQuota)}`
              : `${SizeFormatter.sizeFormat(totalUsed)} / ∞`}
          </div>
          {totalQuota > 0 && (
            <div className="inbound-detail-usage">
              <div style={{ width: `${usedPct}%` }} />
            </div>
          )}
        </div>
        <div>
          <div className="k">{t('pages.inbounds.expireDate')}</div>
          <div className="v">
            <ClockCircleOutlined aria-hidden /> {expiryLabel(inbound.expiryTime)}
          </div>
        </div>
        <div>
          <div className="k">{t('clients')}</div>
          <div className="v">
            <TeamOutlined aria-hidden /> {clients}
            <Tooltip title={t('online')}>
              <span className="inbound-detail-online">
                <CloudOutlined aria-hidden /> {online}
              </span>
            </Tooltip>
          </div>
        </div>
      </div>

      {inbound.nodeId != null && (
        <div className="inbound-detail-node">
          <Tag>
            {t('pages.inbounds.node')} #{inbound.nodeId}
          </Tag>
        </div>
      )}

      <div className="inbound-detail-actions">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className={`inbound-detail-action${action.danger ? ' danger' : ''}`}
            onClick={() => onRowAction(action.key, inbound)}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
