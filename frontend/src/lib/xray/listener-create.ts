import { HttpUtil, RandomUtil } from '@/utils';

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
  type ListenerTemplate,
  type TemplatePayload,
} from '@/lib/xray/listener-templates';

/*
 * Shared creation core for the one-click listener modal and the first-run
 * setup wizard: key generation, payload assembly and the sequential POSTs.
 * Both entry points stay thin UI wrappers over these functions.
 */

export interface ListenerCreation {
  templateId: string;
  label: string;
  payload: TemplatePayload;
  overwrite: DBInbound | null;
}

export interface CreationResult {
  label: string;
  ok: boolean;
  reason: string;
}

function selectedTemplatesOf(ids: string[]): ListenerTemplate[] {
  return LISTENER_TEMPLATES.filter((tpl) => ids.includes(tpl.id));
}

async function fetchJson(url: string): Promise<unknown> {
  const msg = await HttpUtil.get(url, undefined, { silent: true });
  if (!msg?.success) throw new Error(msg?.msg || url);
  return msg.obj;
}

/** Pre-generates every credential the selected templates need, in parallel. */
export async function gatherListenerKeys(selectedIds: string[]): Promise<GeneratedKeys> {
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
  const templates = selectedTemplatesOf(selectedIds);
  const wantReality = templates.some((tpl) => tpl.needsDomain && tpl.core === 'xray');
  const wantMldsa = selectedIds.includes('reality-mldsa-vision');
  const wantVlessEnc =
    selectedIds.includes('tls-pqc-xhttp') || selectedIds.includes('tls-pqc-vision-xhttp');

  const jobs: Promise<void>[] = [];
  if (wantReality) {
    jobs.push(
      fetchJson('/panel/api/server/getNewX25519Cert').then((obj) => {
        keys.reality = obj as { privateKey: string; publicKey: string };
      }),
    );
  }
  if (wantMldsa) {
    jobs.push(
      fetchJson('/panel/api/server/getNewmldsa65').then((obj) => {
        keys.mldsa65 = obj as { seed: string; verify: string };
      }),
    );
  }
  if (wantVlessEnc) {
    jobs.push(
      fetchJson('/panel/api/server/getNewVlessEnc').then((obj) => {
        const auths =
          (
            obj as {
              auths?: { decryption: string; encryption: string; id?: string; label?: string }[];
            }
          ).auths ?? [];
        const block = auths.find(
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
      }),
    );
  }
  await Promise.all(jobs);
  return keys;
}

export interface BuildCreationsOptions {
  selectedIds: string[];
  domain: string;
  certFile: string;
  keyFile: string;
  keys: GeneratedKeys;
  /** Ports already bound on the target (labelled 0 = local panel). */
  portsInUse: Set<number>;
  /** Same-tag inbounds on the target that will be replaced. */
  existing: DBInbound[];
  /** Remote node id, or null for the local panel. */
  nodeId: number | null;
  labelOf: (templateId: string) => string;
}

export function buildListenerCreations(opts: BuildCreationsOptions): ListenerCreation[] {
  const templates = selectedTemplatesOf(opts.selectedIds);
  const used = new Set(opts.portsInUse);
  return templates.map((tpl) => {
    const port = tpl.fixedPort ?? pickListenerPort(used);
    if (!tpl.fixedPort) used.add(port);
    const email = generateTemplateEmail(tpl.id);
    opts.keys.email = email;
    const built = tpl.build({
      domain: opts.domain,
      certFile: opts.certFile,
      keyFile: opts.keyFile,
      keys: opts.keys,
      port,
      email,
    });
    return {
      templateId: tpl.id,
      label: opts.labelOf(tpl.id),
      payload: {
        ...built,
        port,
        ...(opts.nodeId != null ? { nodeId: opts.nodeId } : {}),
      } as TemplatePayload,
      overwrite:
        findOverwrites([tpl.id], opts.existing, opts.nodeId).find(
          (ib) => ib.tag === templateTag(tpl.id),
        ) ?? null,
    };
  });
}

/** Deletes overwrite targets first (the backend refuses duplicate tags). */
export async function removeOverwrites(creations: ListenerCreation[]): Promise<void> {
  for (const item of creations) {
    if (item.overwrite) {
      await HttpUtil.post(`/panel/api/inbounds/del/${item.overwrite.id}`, undefined, {
        silent: true,
      });
    }
  }
}

/** Sequentially POSTs each creation, aggregating ok/failed. */
export async function createListenerInbounds(
  creations: ListenerCreation[],
): Promise<{ results: CreationResult[]; okCount: number; failed: number; firstError: string }> {
  const results: CreationResult[] = [];
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
  const firstError = results.find((r) => !r.ok)?.reason ?? '';
  return { results, okCount, failed, firstError };
}
