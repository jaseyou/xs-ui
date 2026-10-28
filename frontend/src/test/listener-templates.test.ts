import { describe, expect, it } from 'vitest';

import type { DBInbound } from '@/models/dbinbound';
import {
  LISTENER_TEMPLATES,
  SS2022_METHOD,
  findOverwrites,
  generateSs2022Password,
  pickListenerPort,
  templateTag,
  type GeneratedKeys,
  type TemplateContext,
} from '@/lib/xray/listener-templates';

const keys: GeneratedKeys = {
  reality: { privateKey: 'priv', publicKey: 'pub' },
  mldsa65: { seed: 'seed', verify: 'verify' },
  vlessEncMlkem: {
    decryption: 'mlkem768x25519plus.native.0rtt.k',
    encryption: 'mlkem768x25519plus.native.0rtt.k',
  },
  clientUuid: '22222222-3333-4444-9555-666666666666',
  clientPassword: 'clientpw',
  obfsPassword: 'obfspw',
  ssPassword: '8JCsPssfgS8tiRwiMlhARg==',
  shortIds: ['a3f1'],
  email: 'tpl-test@xui.local',
};

const ctx = (port: number, domain = 'panel.example.com'): TemplateContext => ({
  domain,
  certFile: '/etc/ssl/c.pem',
  keyFile: '/etc/ssl/k.pem',
  keys,
  port,
  email: keys.email,
});

function asObject(template: unknown): Record<string, unknown> {
  return JSON.parse(template as string) as Record<string, unknown>;
}

describe('listener templates', () => {
  it('defines all 11 templates with stable tpl- tags', () => {
    expect(LISTENER_TEMPLATES).toHaveLength(11);
    for (const tpl of LISTENER_TEMPLATES) {
      expect(templateTag(tpl.id)).toBe(`tpl-${tpl.id}`);
    }
  });

  it('builds a VLESS reality vision payload with the camouflage target', () => {
    const tpl = LISTENER_TEMPLATES.find((t) => t.id === 'reality-vision')!;
    const payload = tpl.build(ctx(23456));
    expect(payload.protocol).toBe('vless');
    expect(payload.tag).toBe('tpl-reality-vision');
    const settings = asObject(payload.settings);
    expect(settings.decryption).toBe('none');
    const clients = settings.clients as { flow: string; id: string }[];
    expect(clients[0].flow).toBe('xtls-rprx-vision');
    const stream = asObject(payload.streamSettings);
    const reality = stream.realitySettings as Record<string, unknown>;
    expect(reality.target).toBe('127.0.0.1:7443');
    expect(reality.serverNames).toEqual(['panel.example.com']);
    expect(reality.privateKey).toBe('priv');
  });

  it('marks the mldsa65 template with post-quantum seed and verify', () => {
    const tpl = LISTENER_TEMPLATES.find((t) => t.id === 'reality-mldsa-vision')!;
    const stream = asObject(tpl.build(ctx(23456)).streamSettings);
    const reality = stream.realitySettings as Record<string, unknown>;
    expect(reality.mldsa65Seed).toBe('seed');
    expect((reality.settings as Record<string, unknown>).mldsa65Verify).toBe('verify');
  });

  it('uses VLESS encryption mlkem768 on the xhttp CDN templates', () => {
    for (const id of ['tls-pqc-xhttp', 'tls-pqc-vision-xhttp']) {
      const tpl = LISTENER_TEMPLATES.find((t) => t.id === id)!;
      const settings = asObject(tpl.build(ctx(8443)).settings);
      expect(settings.decryption).toContain('mlkem768x25519plus');
      const stream = asObject(tpl.build(ctx(8443)).streamSettings);
      expect(stream.network).toBe('xhttp');
      expect(stream.security).toBe('tls');
    }
  });

  it('marks the hysteria2 template for the singbox core with salamander obfs', () => {
    const tpl = LISTENER_TEMPLATES.find((t) => t.id === 'hysteria2-salamander')!;
    expect(tpl.udp).toBe(true);
    const settings = asObject(tpl.build(ctx(23456)).settings);
    expect(settings.version).toBe(2);
    expect(settings.core).toBe('singbox');
    expect((settings.obfs as Record<string, unknown>).type).toBe('salamander');
  });

  it('builds the TUIC template with bbr congestion control', () => {
    const tpl = LISTENER_TEMPLATES.find((t) => t.id === 'tuic-bbr')!;
    expect(tpl.core).toBe('embedded');
    const settings = asObject(tpl.build(ctx(23456)).settings);
    const server = settings.server as Record<string, unknown>;
    expect(server.congestion_control).toBe('bbr');
    const clients = settings.clients as { uuid: string; password: string }[];
    expect(clients[0].uuid).toBe(keys.clientUuid);
  });

  it('generates url-safe 16-byte ss2022 passwords', () => {
    const pw = generateSs2022Password();
    expect(pw).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(pw).not.toContain('=');
  });

  it('keeps the SS2022 method constant', () => {
    expect(SS2022_METHOD).toBe('2022-blake3-aes-128-gcm');
  });

  it('picks ports outside the used set', () => {
    const used = new Set<number>([20000, 20001]);
    const port = pickListenerPort(used);
    expect(port).not.toBe(20000);
    expect(port).toBeGreaterThanOrEqual(10000);
    expect(port).toBeLessThanOrEqual(60000);
    expect(pickListenerPort(new Set())).not.toBeNaN();
    expect(pickListenerPort(undefined)).toBeGreaterThanOrEqual(10000);
  });

  it('finds overwrite candidates by tag and target', () => {
    const inbound = (tag: string, nodeId: number | null) =>
      ({ id: 1, tag, nodeId, remark: tag }) as unknown as DBInbound;
    const rows = [
      inbound('tpl-reality-vision', null),
      inbound('tpl-reality-vision', 3),
      inbound('tpl-anytls-tls', null),
      inbound('other', null),
    ];
    expect(findOverwrites(['reality-vision'], rows, null)).toHaveLength(1);
    expect(findOverwrites(['reality-vision'], rows, 3)).toHaveLength(1);
    expect(findOverwrites(['anytls-tls'], rows, null)).toHaveLength(1);
    expect(findOverwrites(['naive-tcp'], rows, null)).toHaveLength(0);
  });
});
