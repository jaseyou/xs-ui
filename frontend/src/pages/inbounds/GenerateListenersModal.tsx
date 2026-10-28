import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Checkbox, Col, Input, Modal, Row, Select, Typography, message } from 'antd';

import type { NodeRecord } from '@/api/queries/useNodesQuery';
import type { DBInbound } from '@/models/dbinbound';
import {
  LISTENER_TEMPLATES,
  findOverwrites,
  type GeneratedKeys,
} from '@/lib/xray/listener-templates';
import {
  buildListenerCreations,
  createListenerInbounds,
  gatherListenerKeys,
  removeOverwrites,
} from '@/lib/xray/listener-create';

// 0 is the "local panel" sentinel (inbounds without a nodeId) — the same
// convention as the clients page node filter and the clone dialog.
const LOCAL_PANEL = 0;

interface GenerateListenersModalProps {
  open: boolean;
  nodes: NodeRecord[];
  dbInbounds: DBInbound[];
  portsInUse: Map<number, Set<number>>;
  panelCertFile: string;
  panelKeyFile: string;
  onClose: () => void;
  onGenerated: () => void | Promise<void>;
}

export default function GenerateListenersModal({
  open,
  nodes,
  dbInbounds,
  portsInUse,
  panelCertFile,
  panelKeyFile,
  onClose,
  onGenerated,
}: GenerateListenersModalProps) {
  const { t } = useTranslation();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [target, setTarget] = useState<number>(LOCAL_PANEL);
  const [selected, setSelected] = useState<string[]>([]);
  const [domain, setDomain] = useState('');
  const [certFile, setCertFile] = useState('');
  const [keyFile, setKeyFile] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(LOCAL_PANEL);
    setSelected([]);
    setDomain('');
    setCertFile(panelCertFile);
    setKeyFile(panelKeyFile);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open]);

  const targetOptions = useMemo(
    () => [
      { value: LOCAL_PANEL, label: t('pages.inbounds.localPanel') },
      ...(nodes || [])
        .filter((n) => n.enable)
        .map((n) => ({
          value: n.id,
          label: `${n.name}${n.status === 'online' ? '' : ` (${n.status || 'offline'})`}`,
          disabled: n.status !== 'online',
        })),
    ],
    [nodes, t],
  );

  const isNodeTarget = target !== LOCAL_PANEL;
  // sing-box runs next to THIS panel only in v1: templates it hosts cannot be
  // deployed to remote nodes, whose sidecar state the panel does not manage.
  const selectable = (id: (typeof LISTENER_TEMPLATES)[number]) =>
    !isNodeTarget || !id.requiresSingbox;

  const selectedTemplates = useMemo(
    () => LISTENER_TEMPLATES.filter((tpl) => selected.includes(tpl.id)),
    [selected],
  );
  const needsDomain = selectedTemplates.some((tpl) => tpl.needsDomain);
  const needsCert = selectedTemplates.some((tpl) => tpl.needsCert);

  const overwriteList = useMemo(
    () => findOverwrites(selected, dbInbounds as DBInbound[], isNodeTarget ? target : null),
    [selected, dbInbounds, target, isNodeTarget],
  );

  const gatherKeys = () => gatherListenerKeys(selected);

  async function submit() {
    if (selectedTemplates.length === 0) return;
    if (needsDomain && !domain) {
      messageApi?.warning(t('pages.inbounds.generate.domainRequired'));
      return;
    }
    if (needsCert && (!certFile || !keyFile)) {
      messageApi?.warning(t('pages.inbounds.generate.certRequired'));
      return;
    }
    setSubmitting(true);
    try {
      let keys: GeneratedKeys;
      try {
        keys = await gatherKeys();
      } catch (e) {
        messageApi?.error(t('pages.inbounds.generate.toasts.keyGenFailed', { error: String(e) }));
        return;
      }

      const creations = buildListenerCreations({
        selectedIds: selected,
        domain,
        certFile,
        keyFile,
        keys,
        portsInUse: portsInUse.get(target) ?? new Set<number>(),
        existing: dbInbounds,
        nodeId: isNodeTarget ? target : null,
        labelOf: (id) => {
          const tpl = LISTENER_TEMPLATES.find((tpl) => tpl.id === id);
          return tpl ? t(tpl.labelKey) : id;
        },
      });
      // Overwrite pass first: the backend refuses a duplicate tag, so any
      // same-named listener on the target must be deleted before creating.
      await removeOverwrites(creations);

      const { okCount, failed, firstError } = await createListenerInbounds(creations);
      if (failed === 0) {
        messageApi?.success(t('pages.inbounds.generate.toasts.createdMany', { count: okCount }));
      } else {
        const base = t('pages.inbounds.generate.toasts.createdMixed', { ok: okCount, failed });
        messageApi?.warning(firstError ? `${base} — ${firstError}` : base);
      }
      if (okCount > 0) await onGenerated();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const grid = (
    <Row gutter={[8, 8]}>
      {LISTENER_TEMPLATES.map((tpl) => {
        const disabled = !selectable(tpl);
        return (
          <Col span={12} key={tpl.id}>
            <div
              className="listener-template-card"
              style={{
                border: '1px solid var(--ant-color-border-secondary, rgba(128,128,128,0.25))',
                borderRadius: 8,
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                opacity: disabled ? 0.5 : 1,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{t(tpl.labelKey)}</div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {tpl.fixedPort
                    ? t('pages.inbounds.generate.portFixed', { port: tpl.fixedPort })
                    : t('pages.inbounds.generate.portRandom', {
                        type: tpl.udp ? 'UDP' : 'TCP',
                      })}
                  {tpl.core === 'singbox' ? ' · sing-box' : ''}
                </Typography.Text>
              </div>
              <Checkbox
                aria-label={t(tpl.labelKey)}
                checked={selected.includes(tpl.id)}
                disabled={disabled}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked ? [...prev, tpl.id] : prev.filter((id) => id !== tpl.id),
                  )
                }
              />
            </div>
          </Col>
        );
      })}
    </Row>
  );

  return (
    <>
      {messageContextHolder}
      <Modal
        open={open}
        title={t('pages.inbounds.generate.title')}
        okText={t('pages.inbounds.generate.create')}
        cancelText={t('cancel')}
        okButtonProps={{ disabled: selected.length === 0, loading: submitting }}
        onCancel={onClose}
        onOk={submit}
        width={860}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          {t('pages.inbounds.generate.intro')}
        </Typography.Paragraph>
        <div>
          <Row gutter={16}>
            <Col span={14}>
              <div className="gen-field">
                <label className="gen-field-label" htmlFor="gen-target">
                  {t('pages.inbounds.generate.target')}
                </label>
                <Select
                  value={target}
                  onChange={setTarget}
                  options={targetOptions}
                  showSearch={{ optionFilterProp: 'label' }}
                  aria-label={t('pages.inbounds.generate.target')}
                />
              </div>
            </Col>
            <Col span={10}>
              <div className="gen-field">
                <Input
                  value={`${selected.length} / ${LISTENER_TEMPLATES.length}`}
                  readOnly
                  aria-label={t('pages.inbounds.generate.selected')}
                />
              </div>
            </Col>
          </Row>
          {needsDomain && (
            <div className="gen-field">
              <label className="gen-field-label" htmlFor="gen-domain">
                {t('pages.inbounds.generate.domain')} *
              </label>
              <Input
                id="gen-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value.trim())}
                placeholder="panel.example.com"
              />
            </div>
          )}
          {needsCert && (
            <Row gutter={16}>
              <Col span={12}>
                <div className="gen-field">
                  <label className="gen-field-label" htmlFor="gen-cert">
                    {t('pages.inbounds.generate.certFile')}
                  </label>
                  <Input
                    id="gen-cert"
                    value={certFile}
                    onChange={(e) => setCertFile(e.target.value.trim())}
                  />
                </div>
              </Col>
              <Col span={12}>
                <div className="gen-field">
                  <label className="gen-field-label" htmlFor="gen-key">
                    {t('pages.inbounds.generate.keyFile')}
                  </label>
                  <Input
                    id="gen-key"
                    value={keyFile}
                    onChange={(e) => setKeyFile(e.target.value.trim())}
                  />
                </div>
              </Col>
            </Row>
          )}
        </div>
        {grid}
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
          <button
            type="button"
            className="gen-link"
            onClick={() =>
              setSelected(
                LISTENER_TEMPLATES.filter((tpl) => selectable(tpl) && !tpl.needsCert).map(
                  (tpl) => tpl.id,
                ),
              )
            }
          >
            {t('pages.inbounds.generate.selectAllFree')}
          </button>
          <button type="button" className="gen-link" onClick={() => setSelected([])}>
            {t('clear')}
          </button>
        </div>
        {isNodeTarget && (
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message={t('pages.inbounds.generate.nodeSingboxNote')}
          />
        )}
        {overwriteList.length > 0 && (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message={t('pages.inbounds.generate.overwriteTitle', { count: overwriteList.length })}
            description={overwriteList.map((ib) => ib.remark || ib.tag).join('、')}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
          {t('pages.inbounds.generate.singboxNote')}
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
