import { RandomUtil } from '@/utils';

import type { DBInbound } from '@/models/dbinbound';

/*
 * One-click "common listener" templates. Each template builds a wire payload
 * for POST /panel/api/inbounds/add (same shape as buildClonePayload: JSON
 * strings for settings/streamSettings/sniffing, nodeId for remote targets).
 *
 * Tags are stable per template ("tpl-*") so "same-named listener" detection is
 * deterministic: an inbound with the same tag on the same target is offered
 * for overwrite before creation.
 */

export type ListenerCore = 'xray' | 'singbox' | 'embedded';

export interface GeneratedKeys {
  reality: { privateKey: string; publicKey: string } | null;
  mldsa65: { seed: string; verify: string } | null;
  vlessEncMlkem: { decryption: string; encryption: string } | null;
  clientUuid: string;
  clientPassword: string;
  obfsPassword: string;
  ssPassword: string;
  shortIds: string[];
  email: string;
}

export interface TemplateContext {
  domain: string;
  certFile: string;
  keyFile: string;
  keys: GeneratedKeys;
  port: number;
  email: string;
}

export interface ListenerTemplate {
  id: string;
  /** i18n key under pages.inbounds.generate.templates.<id> */
  labelKey: string;
  core: ListenerCore;
  /** Fixed port, when the template is conventionally bound to one. */
  fixedPort?: number;
  udp?: boolean;
  /** ShadowTLS-style port hopping size (sing-box hysteria2 only). */
  portHopping?: number;
  needsDomain?: boolean;
  needsCert?: boolean;
  /** sing-box templates require the sidecar binary. */
  requiresSingbox?: boolean;
  build: (ctx: TemplateContext) => Omit<TemplatePayload, 'port' | 'nodeId'>;
}

export interface TemplatePayload {
  up: number;
  down: number;
  total: number;
  remark: string;
  enable: boolean;
  expiryTime: number;
  listen: string;
  port: number;
  protocol: string;
  settings: string;
  streamSettings: string;
  sniffing: string;
  tag: string;
  nodeId?: number;
}

/** Their deploy-reality-target.sh convention: local nginx camouflage target. */
export const REALITY_TARGET = '127.0.0.1:7443';

export const SS2022_METHOD = '2022-blake3-aes-128-gcm';

const DEFAULT_SNIFFING = {
  enabled: true,
  destOverride: ['http', 'tls', 'quic', 'fakedns'],
  metadataOnly: false,
  routeOnly: false,
  ipsExcluded: [],
  domainsExcluded: [],
};

function clientBase(email: string, extra: Record<string, unknown> = {}) {
  return {
    email,
    limitIp: 0,
    totalGB: 0,
    expiryTime: 0,
    enable: true,
    tgId: 0,
    subId: '',
    comment: '',
    reset: 0,
    ...extra,
  };
}

function realityStream(ctx: TemplateContext, withMldsa65: boolean) {
  const settings: Record<string, unknown> = {
    publicKey: ctx.keys.reality?.publicKey ?? '',
    fingerprint: 'chrome',
    serverName: '',
    spiderX: '/',
    mldsa65Verify: '',
  };
  const reality: Record<string, unknown> = {
    show: false,
    xver: 0,
    target: REALITY_TARGET,
    serverNames: [ctx.domain],
    privateKey: ctx.keys.reality?.privateKey ?? '',
    minClientVer: '',
    maxClientVer: '',
    maxTimediff: 0,
    shortIds: ctx.keys.shortIds,
    mldsa65Seed: '',
    settings,
  };
  if (withMldsa65 && ctx.keys.mldsa65) {
    reality.mldsa65Seed = ctx.keys.mldsa65.seed;
    settings.mldsa65Verify = ctx.keys.mldsa65.verify;
  }
  return {
    network: 'tcp',
    tcpSettings: { header: { type: 'none' } },
    security: 'reality',
    realitySettings: reality,
  };
}

function tlsStream(ctx: TemplateContext, alpn: string[], network?: string) {
  const stream: Record<string, unknown> = {
    security: 'tls',
    tlsSettings: {
      serverName: ctx.domain || '',
      alpn,
      certificates: [
        {
          useFile: true,
          certificateFile: ctx.certFile,
          keyFile: ctx.keyFile,
          certificate: [],
          key: [],
          ocspStapling: 0,
          oneTimeLoading: false,
          usage: 'encipherment',
          buildChain: false,
        },
      ],
      settings: { fingerprint: network === undefined ? 'chrome' : '' },
    },
  };
  if (network === 'xhttp') {
    stream.network = 'xhttp';
    stream.xhttpSettings = { mode: 'auto' };
  }
  return stream;
}

function xhttpTlsStream(ctx: TemplateContext) {
  return tlsStream(ctx, ['h2', 'http/1.1'], 'xhttp');
}

function wire(tag: string, protocol: string, settings: unknown, stream: unknown, remark: string) {
  return {
    up: 0,
    down: 0,
    total: 0,
    remark,
    enable: true,
    expiryTime: 0,
    listen: '',
    protocol,
    settings: JSON.stringify(settings),
    streamSettings: JSON.stringify(stream),
    sniffing: JSON.stringify(DEFAULT_SNIFFING),
    tag,
  };
}

export const LISTENER_TEMPLATES: ListenerTemplate[] = [
  {
    id: 'reality-vision',
    labelKey: 'pages.inbounds.generate.templates.realityVision',
    core: 'xray',
    needsDomain: true,
    build: (ctx) =>
      wire(
        'tpl-reality-vision',
        'vless',
        {
          clients: [clientBase(ctx.email, { id: ctx.keys.clientUuid, flow: 'xtls-rprx-vision' })],
          decryption: 'none',
          encryption: 'none',
          fallbacks: [],
        },
        realityStream(ctx, false),
        `VLESS-Reality-Vision (${ctx.domain})`,
      ),
  },
  {
    id: 'tls-pqc-xhttp',
    labelKey: 'pages.inbounds.generate.templates.tlsPqcXhttp',
    core: 'xray',
    fixedPort: 8443,
    needsCert: true,
    build: (ctx) =>
      wire(
        'tpl-tls-pqc-xhttp',
        'vless',
        {
          clients: [clientBase(ctx.email, { id: ctx.keys.clientUuid })],
          decryption: ctx.keys.vlessEncMlkem?.decryption ?? 'none',
          encryption: ctx.keys.vlessEncMlkem?.encryption ?? 'none',
          fallbacks: [],
        },
        xhttpTlsStream(ctx),
        'TLS+PQC+XHTTP+CDN',
      ),
  },
  {
    id: 'tls-pqc-vision-xhttp',
    labelKey: 'pages.inbounds.generate.templates.tlsPqcVisionXhttp',
    core: 'xray',
    fixedPort: 2053,
    needsCert: true,
    build: (ctx) =>
      wire(
        'tpl-tls-pqc-vision-xhttp',
        'vless',
        {
          clients: [clientBase(ctx.email, { id: ctx.keys.clientUuid, flow: 'xtls-rprx-vision' })],
          decryption: ctx.keys.vlessEncMlkem?.decryption ?? 'none',
          encryption: ctx.keys.vlessEncMlkem?.encryption ?? 'none',
          fallbacks: [],
        },
        xhttpTlsStream(ctx),
        'TLS+PQC+Vision+XHTTP+CDN',
      ),
  },
  {
    id: 'reality-mldsa-vision',
    labelKey: 'pages.inbounds.generate.templates.realityMldsaVision',
    core: 'xray',
    needsDomain: true,
    build: (ctx) =>
      wire(
        'tpl-reality-mldsa-vision',
        'vless',
        {
          clients: [clientBase(ctx.email, { id: ctx.keys.clientUuid, flow: 'xtls-rprx-vision' })],
          decryption: 'none',
          encryption: 'none',
          fallbacks: [],
        },
        realityStream(ctx, true),
        `REALITY+PQC+Vision (${ctx.domain})`,
      ),
  },
  {
    id: 'shadowtls-ss2022',
    labelKey: 'pages.inbounds.generate.templates.shadowtlsSs2022',
    core: 'singbox',
    requiresSingbox: true,
    needsDomain: true,
    build: (ctx) =>
      wire(
        'tpl-shadowtls-ss2022',
        'shadowtls',
        {
          version: 3,
          ssMethod: SS2022_METHOD,
          ssPassword: ctx.keys.ssPassword,
          clients: [clientBase(ctx.email, { password: ctx.keys.clientPassword })],
        },
        {
          // The ShadowTLS handshake borrows the same local camouflage target
          // the REALITY templates use; no certificate is involved.
          security: 'reality',
          realitySettings: {
            target: REALITY_TARGET,
            serverNames: [ctx.domain],
            privateKey: '',
            shortIds: [],
          },
        },
        `ShadowTLS-SS2022 (${ctx.domain})`,
      ),
  },
  {
    id: 'anytls-tls',
    labelKey: 'pages.inbounds.generate.templates.anytlsTls',
    core: 'singbox',
    requiresSingbox: true,
    needsCert: true,
    build: (ctx) =>
      wire(
        'tpl-anytls-tls',
        'anytls',
        { clients: [clientBase(ctx.email, { password: ctx.keys.clientPassword })] },
        tlsStream(ctx, ['h2', 'http/1.1']),
        'AnyTLS-TLS',
      ),
  },
  {
    id: 'anytls-reality',
    labelKey: 'pages.inbounds.generate.templates.anytlsReality',
    core: 'singbox',
    requiresSingbox: true,
    needsDomain: true,
    build: (ctx) =>
      wire(
        'tpl-anytls-reality',
        'anytls',
        { clients: [clientBase(ctx.email, { password: ctx.keys.clientPassword })] },
        realityStream(ctx, false),
        `AnyTLS-Reality (${ctx.domain})`,
      ),
  },
  {
    id: 'hysteria2-salamander',
    labelKey: 'pages.inbounds.generate.templates.hysteria2Salamander',
    core: 'singbox',
    requiresSingbox: true,
    needsCert: true,
    udp: true,
    portHopping: 100,
    build: (ctx) =>
      wire(
        'tpl-hysteria2-salamander',
        'hysteria',
        {
          version: 2,
          core: 'singbox',
          obfs: { type: 'salamander', password: ctx.keys.obfsPassword },
          // Panel-side validation reads client.auth for hysteria clients.
          clients: [
            clientBase(ctx.email, {
              auth: ctx.keys.clientPassword,
              password: ctx.keys.clientPassword,
            }),
          ],
        },
        tlsStream(ctx, ['h3']),
        'Hysteria2-TLS-BBR-Salamander',
      ),
  },
  {
    id: 'tuic-bbr',
    labelKey: 'pages.inbounds.generate.templates.tuicBbr',
    core: 'embedded',
    needsCert: true,
    udp: true,
    build: (ctx) =>
      wire(
        'tpl-tuic-bbr',
        'tuic',
        {
          server: {
            certificate: ctx.certFile,
            private_key: ctx.keyFile,
            congestion_control: 'bbr',
            alpn: ['h3', 'spdy/3.1'],
            udp_relay_mode: 'native',
            zero_rtt_handshake: true,
            log_level: 'info',
            max_idle_time: 15,
            authentication_timeout: 3,
            max_udp_relay_packet_size: 1500,
            sni: ctx.domain || '',
          },
          clients: [
            clientBase(ctx.email, {
              // Panel-side validation reads client.id (UUID); the embedded TUIC
              // server reads uuid — set both.
              id: ctx.keys.clientUuid,
              uuid: ctx.keys.clientUuid,
              password: ctx.keys.clientPassword,
            }),
          ],
        },
        {},
        'TUIC-TLS-BBR',
      ),
  },
  {
    id: 'naive-quic',
    labelKey: 'pages.inbounds.generate.templates.naiveQuic',
    core: 'singbox',
    requiresSingbox: true,
    needsCert: true,
    udp: true,
    build: (ctx) =>
      wire(
        'tpl-naive-quic',
        'naive',
        { clients: [clientBase(ctx.email, { password: ctx.keys.clientPassword })] },
        tlsStream(ctx, ['h3']),
        'Naive-TLS-QUIC',
      ),
  },
  {
    id: 'naive-tcp',
    labelKey: 'pages.inbounds.generate.templates.naiveTcp',
    core: 'singbox',
    requiresSingbox: true,
    needsCert: true,
    build: (ctx) =>
      wire(
        'tpl-naive-tcp',
        'naive',
        { clients: [clientBase(ctx.email, { password: ctx.keys.clientPassword })] },
        tlsStream(ctx, ['h2']),
        'Naive-TLS-TCP',
      ),
  },
];

/*
 * SS2022 payloads are fixed-size keys base64url-encoded: 16 bytes for
 * aes-128, 32 for aes-256. The templates standardize on aes-128.
 */
export function generateSs2022Password(): string {
  const raw = new Uint8Array(16);
  crypto.getRandomValues(raw);
  return base64UrlEncode(raw);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateObfsPassword(): string {
  const raw = new Uint8Array(16);
  crypto.getRandomValues(raw);
  return base64UrlEncode(raw);
}

export function generateTemplateEmail(id: string): string {
  const raw = new Uint8Array(4);
  crypto.getRandomValues(raw);
  const suffix = Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
  return `tpl-${id}-${suffix}@xui.local`;
}

/*
 * Random port for the target, avoiding ports already bound there. Mirrors
 * pickClonePort but lets the caller exclude the templates' fixed ports.
 */
export function pickListenerPort(used: Set<number> | undefined): number {
  let port = RandomUtil.randomInteger(10000, 60000);
  if (!used) return port;
  for (let attempts = 0; attempts < 20 && used.has(port); attempts++) {
    port = RandomUtil.randomInteger(10000, 60000);
  }
  if (used.has(port)) {
    for (port = 10000; port <= 60000 && used.has(port); port++) {
      /* dense-range scan */
    }
    if (port > 60000) port = RandomUtil.randomInteger(10000, 60000);
  }
  return port;
}

export function templateTag(id: string): string {
  return `tpl-${id}`;
}

/*
 * Overwrite candidates: inbounds on the target whose tag collides with one of
 * the selected templates. Tags are node-scoped, so the same template can exist
 * on the local panel and on every node at once.
 */
export function findOverwrites(
  selectedIds: string[],
  inbounds: DBInbound[],
  nodeId: number | null,
): DBInbound[] {
  const tags = new Set(selectedIds.map(templateTag));
  return inbounds.filter((ib) => {
    const ibNode = ib.nodeId == null ? null : Number(ib.nodeId);
    return ibNode === nodeId && tags.has(ib.tag);
  });
}
