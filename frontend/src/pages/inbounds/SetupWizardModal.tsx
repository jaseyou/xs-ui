import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Checkbox, Col, Input, Modal, Row, Steps, Typography, message } from 'antd';

import type { DBInbound } from '@/models/dbinbound';
import { LISTENER_TEMPLATES } from '@/lib/xray/listener-templates';
import {
  buildListenerCreations,
  createListenerInbounds,
  gatherListenerKeys,
  removeOverwrites,
} from '@/lib/xray/listener-create';
import './SetupWizardModal.css';

/*
 * First-run setup wizard (simple mode): pick listener templates, fill the
 * domain (and certificate paths when needed), create. Reuses the same
 * creation core as the one-click modal — no separate backend surface.
 */

const WIZARD_DONE_KEY = 'xui:setup-wizard-done';
export const WIZARD_RECOMMENDED_IDS = [
  'reality-vision',
  'tls-pqc-xhttp',
  'hysteria2-salamander',
  'tuic-bbr',
];

export function isWizardDone(): boolean {
  try {
    return localStorage.getItem(WIZARD_DONE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markWizardDone(): void {
  try {
    localStorage.setItem(WIZARD_DONE_KEY, 'true');
  } catch {
    /* ignore */
  }
}

interface SetupWizardModalProps {
  open: boolean;
  dbInbounds: DBInbound[];
  portsInUse: Set<number>;
  panelCertFile: string;
  panelKeyFile: string;
  onClose: () => void;
  onFinished: () => void | Promise<void>;
}

export default function SetupWizardModal({
  open,
  dbInbounds,
  portsInUse,
  panelCertFile,
  panelKeyFile,
  onClose,
  onFinished,
}: SetupWizardModalProps) {
  const { t } = useTranslation();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>(WIZARD_RECOMMENDED_IDS);
  const [domain, setDomain] = useState('');
  const [certFile, setCertFile] = useState('');
  const [keyFile, setKeyFile] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSelected(WIZARD_RECOMMENDED_IDS);
    setDomain('');
    setCertFile(panelCertFile);
    setKeyFile(panelKeyFile);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open]);

  const selectedTemplates = useMemo(
    () => LISTENER_TEMPLATES.filter((tpl) => selected.includes(tpl.id)),
    [selected],
  );
  const needsDomain = selectedTemplates.some((tpl) => tpl.needsDomain);
  const needsCert = selectedTemplates.some((tpl) => tpl.needsCert);

  const overwrites = useMemo(
    () =>
      LISTENER_TEMPLATES.filter(
        (tpl) => selected.includes(tpl.id) && dbInbounds.some((ib) => ib.tag === `tpl-${tpl.id}`),
      ),
    [selected, dbInbounds],
  );

  function canNext(): boolean {
    if (step === 0) return selected.length > 0;
    if (step === 1)
      return (!needsDomain || domain.length > 0) && (!needsCert || (!!certFile && !!keyFile));
    return true;
  }

  async function finish() {
    setSubmitting(true);
    try {
      const keys = await gatherListenerKeys(selected);
      const creations = buildListenerCreations({
        selectedIds: selected,
        domain,
        certFile,
        keyFile,
        keys,
        portsInUse: portsInUse ?? new Set<number>(),
        existing: dbInbounds,
        nodeId: null,
        labelOf: (id) => {
          const tpl = LISTENER_TEMPLATES.find((tpl) => tpl.id === id);
          return tpl ? t(tpl.labelKey) : id;
        },
      });
      await removeOverwrites(creations);
      const { okCount, failed, firstError } = await createListenerInbounds(creations);
      markWizardDone();
      if (failed === 0) {
        messageApi.success(t('wizard.done', { count: okCount }));
      } else {
        const base = t('pages.inbounds.generate.toasts.createdMixed', { ok: okCount, failed });
        messageApi.warning(firstError ? `${base} — ${firstError}` : base);
      }
      if (okCount > 0) await onFinished();
      onClose();
    } catch (e) {
      messageApi.error(t('pages.inbounds.generate.toasts.keyGenFailed', { error: String(e) }));
    } finally {
      setSubmitting(false);
    }
  }

  const stepContent = (
    <>
      <div style={{ marginBottom: 16 }}>
        <Steps
          size="small"
          current={step}
          items={[
            { title: t('wizard.step1') },
            { title: t('wizard.step2') },
            { title: t('wizard.step3') },
          ]}
        />
      </div>
      {step === 0 && (
        <>
          <Typography.Paragraph type="secondary">{t('wizard.step1Desc')}</Typography.Paragraph>
          <Row gutter={[8, 8]}>
            {LISTENER_TEMPLATES.map((tpl) => {
              const recommended = WIZARD_RECOMMENDED_IDS.includes(tpl.id);
              return (
                <Col span={12} key={tpl.id}>
                  <div
                    className="wizard-template-card"
                    style={{
                      border: '1px solid var(--ant-color-border-secondary)',
                      borderRadius: 8,
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflowWrap: 'anywhere', fontSize: 13 }}>
                        {t(tpl.labelKey)}
                      </div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {tpl.fixedPort
                          ? t('pages.inbounds.generate.portFixed', { port: tpl.fixedPort })
                          : t('pages.inbounds.generate.portRandom', {
                              type: tpl.udp ? 'UDP' : 'TCP',
                            })}
                        {recommended ? ` · ${t('wizard.recommended')}` : ''}
                        {tpl.core === 'singbox' ? ' · sing-box' : ''}
                      </Typography.Text>
                    </div>
                    <Checkbox
                      aria-label={t(tpl.labelKey)}
                      checked={selected.includes(tpl.id)}
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
        </>
      )}
      {step === 1 && (
        <>
          {needsDomain && (
            <div style={{ marginBottom: 12 }}>
              <label
                htmlFor="wizard-domain"
                style={{
                  display: 'block',
                  marginBottom: 5,
                  fontSize: 12.5,
                  color: 'var(--ant-color-text-tertiary)',
                }}
              >
                {t('pages.inbounds.generate.domain')} *
              </label>
              <Input
                id="wizard-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value.trim())}
                placeholder="panel.example.com"
              />
              <Typography.Paragraph
                type="secondary"
                style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}
              >
                {t('wizard.domainHint')}
              </Typography.Paragraph>
            </div>
          )}
          {needsCert && (
            <>
              <div style={{ marginBottom: 12 }}>
                <label
                  htmlFor="wizard-cert"
                  style={{
                    display: 'block',
                    marginBottom: 5,
                    fontSize: 12.5,
                    color: 'var(--ant-color-text-tertiary)',
                  }}
                >
                  {t('pages.inbounds.generate.certFile')}
                </label>
                <Input
                  id="wizard-cert"
                  value={certFile}
                  onChange={(e) => setCertFile(e.target.value.trim())}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label
                  htmlFor="wizard-key"
                  style={{
                    display: 'block',
                    marginBottom: 5,
                    fontSize: 12.5,
                    color: 'var(--ant-color-text-tertiary)',
                  }}
                >
                  {t('pages.inbounds.generate.keyFile')}
                </label>
                <Input
                  id="wizard-key"
                  value={keyFile}
                  onChange={(e) => setKeyFile(e.target.value.trim())}
                />
              </div>
            </>
          )}
          {!needsDomain && !needsCert && (
            <Typography.Paragraph type="secondary">
              {t('wizard.noInputsNeeded')}
            </Typography.Paragraph>
          )}
        </>
      )}
      {step === 2 && (
        <>
          <Typography.Paragraph type="secondary">{t('wizard.step3Desc')}</Typography.Paragraph>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {selectedTemplates.map((tpl) => (
              <li key={tpl.id} style={{ fontSize: 13 }}>
                {t(tpl.labelKey)}
                <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                  {tpl.fixedPort
                    ? `:${tpl.fixedPort}/TCP`
                    : `:${t('pages.inbounds.generate.portRandom', { type: tpl.udp ? 'UDP' : 'TCP' })}`}
                </Typography.Text>
              </li>
            ))}
          </ul>
          {overwrites.length > 0 && (
            <Alert
              style={{ marginTop: 12 }}
              type="warning"
              showIcon
              message={t('pages.inbounds.generate.overwriteTitle', { count: overwrites.length })}
            />
          )}
        </>
      )}
    </>
  );

  return (
    <>
      {messageContextHolder}
      <Modal
        open={open}
        title={t('wizard.title')}
        width={720}
        onCancel={onClose}
        destroyOnHidden
        footer={[
          step > 0 && (
            <button
              key="prev"
              type="button"
              className="wizard-nav-btn"
              onClick={() => setStep(step - 1)}
              disabled={submitting}
            >
              {t('wizard.prev')}
            </button>
          ),
          <button
            key="next"
            type="button"
            className="wizard-nav-btn primary"
            disabled={!canNext() || submitting}
            onClick={() => {
              if (step < 2) setStep(step + 1);
              else void finish();
            }}
          >
            {step < 2 ? t('wizard.next') : t('pages.inbounds.generate.create')}
          </button>,
        ]}
      >
        {stepContent}
      </Modal>
    </>
  );
}
