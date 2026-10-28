import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Checkbox, Col, Input, Modal, Row, Select, Typography, message } from 'antd';

import { HttpUtil } from '@/utils';
import { RandomUtil } from '@/utils';
import type { NodeRecord } from '@/api/queries/useNodesQuery';
import type { DBInbound } from '@/models/dbinbound';
import {
  LISTENER_TEMPLATES,
  findOverwrites,
  generateObfsPassword,
  generateSs2022Password,
  generateTemplateEmail,
  pickListenerPort,
  templateTag,
  type GeneratedKeys,
  type TemplatePayload,
} from '@/lib/xray/listener-templates';

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

interface PreparedCreate {
  templateId: string;
  label: string;
  payload: TemplatePayload;
  overwrite: DBInbound | null;
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
    () => findOverwrites(selected, dbInbounds, isNodeTarget ? target : null),
    [selected, dbInbounds, target, isNodeTarget],
  );

  async function gatherKeys(): Promise<GeneratedKeys> {
    const keys: GeneratedKeys = {
      reality: null,
      mldsa65: null,
      vlessEncMlkem: null,
      clientUuid: crypto.randomUUID(),
      clientPassword: crypto.randomUUID().replace(/-/g, ''),
      obfsPassword: generateObfsPassword(),
      ssPassword: generateSs2022Password(),
      shortIds: RandomUtil.randomShortIds()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      email: '',
    };
    const wantReality = selectedTemplates.some((tpl) => tpl.needsDomain && tpl.core === 'xray');
    const wantMldsa = selected.some((id) => id === 'reality-mldsa-vision');
    const wantVlessEnc = selected.some(
      (id) => id === 'tls-pqc-xhttp' || id === 'tls-pqc-vision-xhttp',
    );
    const fetchJson = async (url: string) => {
      const msg = await HttpUtil.get(url, undefined, { silent: true });
      if (!msg?.success) throw new Error(msg?.msg || url);
      return msg.obj;
    };
    if (wantReality) {
      keys.reality = (await fetchJson('/panel/api/server/getNewX25519Cert')) as {
        privateKey: string;
        publicKey: string;
      };
    }
    if (wantMldsa) {
      keys.mldsa65 = (await fetchJson('/panel/api/server/getNewmldsa65')) as {
        seed: string;
        verify: string;
      };
    }
    if (wantVlessEnc) {
      const obj = (await fetchJson('/panel/api/server/getNewVlessEnc')) as {
        auths?: { decryption: string; encryption: string; id?: string; label?: string }[];
      };
      const block = (obj.auths || []).find(
        (a) =>
          (a.label || a.id || '')
            .toLowerCase()
            .replace(/[-_\s]/g, '')
            .includes('mlkem768') &&
          !(a.label || a.id || '').toLowerCase().includes('xorpub') &&
          !(a.label || a.id || '').toLowerCase().includes('random'),
      );
      if (block)
        keys.vlessEncMlkem = { decryption: block.decryption, encryption: block.encryption };
    }
    return keys;
  }

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

      const used = new Set(portsInUse.get(target));
      const creations: PreparedCreate[] = selectedTemplates.map((tpl) => {
        const port = tpl.fixedPort ?? pickListenerPort(used);
        if (!tpl.fixedPort) used.add(port);
        const email = generateTemplateEmail(tpl.id);
        keys.email = email;
        const built = tpl.build({ domain, certFile, keyFile, keys, port, email });
        return {
          templateId: tpl.id,
          label: t(tpl.labelKey),
          payload: {
            ...built,
            port,
            ...(isNodeTarget ? { nodeId: target } : {}),
          } as TemplatePayload,
          overwrite: overwriteList.find((ib) => ib.tag === templateTag(tpl.id)) ?? null,
        };
      });

      // Overwrite pass first: the backend refuses a duplicate tag, so any
      // same-named listener on the target must be deleted before creating.
      for (const item of creations) {
        if (item.overwrite) {
          await HttpUtil.post(`/panel/api/inbounds/del/${item.overwrite.id}`, undefined, {
            silent: true,
          });
        }
      }

      const results: { label: string; ok: boolean; reason: string }[] = [];
      for (const item of creations) {
        const msg = await HttpUtil.post('/panel/api/inbounds/add', item.payload, { silent: true });
        results.push({
          label: item.label,
          ok: !!msg?.success,
          reason: msg?.success ? '' : msg?.msg || '',
        });
      }
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.length - okCount;
      if (failed === 0) {
        messageApi?.success(t('pages.inbounds.generate.toasts.createdMany', { count: okCount }));
      } else {
        const firstError = results.find((r) => !r.ok)?.reason ?? '';
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
