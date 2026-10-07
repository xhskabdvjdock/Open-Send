'use client';

/* Admin network diagnostics: /webadmin/network (admin session required).
   Shows Server IP / Hostname / Port / mDNS / Firewall / Server status
   plus connection instructions. No secrets are displayed here. */

import { useEffect, useState } from 'react';
import { useT, translateError } from '@/lib/i18n';

type NetInfo = {
  port: number;
  status: string;
  localUrl: string;
  lanUrls: string[];
  primaryUrl: string;
  expectedIp: string;
  hostname: string;
  hostnameUrl: string;
  ipUrl: string;
  detectedIps: string[];
  hasExpectedIp: boolean;
  mdns: string;
  mdnsResolvedIp: string | null;
  firewall: { app: string; mdns: string };
  server: string;
  warning: string | null;
  chat?: { enabled: boolean; transport: string; stream: string };
};

async function api(path: string) {
  const r = await fetch(path, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(translateError(j.error || `Request failed (${r.status})`));
  return j;
}

function Row({ label, ok, value }: { label: string; ok: boolean | null; value: string }) {
  const mark = ok === null ? '○' : ok ? '✓' : '✗';
  const color = ok === null ? 'inherit' : ok ? 'green' : '#b00';
  return (
    <div className="file-item">
      <div className="grow">
        <b>{label}</b>
        <div className="small" dir="ltr">{value}</div>
      </div>
      <span style={{ color, fontWeight: 700 }} aria-hidden>{mark}</span>
    </div>
  );
}

export default function NetworkDiagnosticsPage() {
  const { t } = useT();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [net, setNet] = useState<NetInfo | null>(null);
  const [health, setHealth] = useState<string>('…');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const me = await fetch('/api/admin/me', { cache: 'no-store' });
        if (!me.ok) {
          setAuthed(false);
          return;
        }
        setAuthed(true);
        const [n, h] = await Promise.all([
          api('/api/admin/network'),
          fetch('/api/health', { cache: 'no-store' }).then((r) => r.json().catch(() => ({}))),
        ]);
        setNet(n);
        setHealth(h.ok ? 'Running' : String(h.status || 'Error'));
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, []);

  function copyDiagnostics() {
    if (!net) return;
    const text = [
      `Hostname: ${net.hostname}`,
      ``,
      `Expected IP: ${net.expectedIp}`,
      ``,
      `Detected IP: ${(net.detectedIps || []).join(', ')}`,
      ``,
      `Port: ${net.port}`,
      ``,
      `mDNS: ${net.mdns}`,
      ``,
      `Server: ${net.server || health}`,
    ].join('\n');
    const done = () => {
      setCopied(t('netDiagCopied'));
      setTimeout(() => setCopied(''), 2000);
    };
    try {
      navigator.clipboard.writeText(text).then(done).catch(() => done());
    } catch {
      done();
    }
  }

  if (authed === null) return <div className="card">{t('loading')}</div>;
  if (authed === false) {
    return (
      <div className="center-wrap">
        <div className="card">
          <h2 style={{ margin: '0 0 4px' }}>{t('admTitle')}</h2>
          <p className="muted small">{t('adminLoginNote')}</p>
          <a className="btn btn-primary" href="/webadmin">{t('admLoginBtn')}</a>
        </div>
      </div>
    );
  }

  return (
    <div className="grid">
      {err && <div className="card"><span className="error-box">{err}</span></div>}
      <div className="card">
        <h1 style={{ margin: 0 }}>{t('netDiagTitle')}</h1>
        <p className="muted small">/webadmin/network</p>
        {!net ? (
          <p>{t('loading')}</p>
        ) : (
          <>
            <Row label={t('netServerIp')} ok={net.hasExpectedIp} value={net.expectedIp} />
            <Row label={t('netHostname')} ok={net.mdns === 'Active'} value={net.hostname} />
            <Row label={t('netHttp')} ok={health === 'Running'} value={`${net.server || health} · ${t('netPort')}: ${net.port}`} />
            <Row
              label={t('netMdns')}
              ok={net.mdns === 'Active'}
              value={net.mdns === 'Active' ? `Active (${net.mdnsResolvedIp || ''})` : `Unavailable → ${net.ipUrl}`}
            />
            <Row
              label={t('netFirewall')}
              ok={net.firewall?.app === 'Configured' ? true : net.firewall?.app === 'Missing' ? false : null}
              value={`${net.firewall?.app || 'Unknown'} (TCP ${net.port}, Private)`}
            />
            <Row label={t('netLocalAccess')} ok={health === 'Running'} value={net.hostnameUrl} />
            <Row
              label={`${t('tabChat')} (SSE)`}
              ok={net.chat?.enabled === true}
              value={net.chat?.enabled ? `OK (${net.chat.transport}, ${net.chat.stream})` : 'Disabled'}
            />

            <dl className="kv mt">
              <dt>{t('netExpectedIp')}</dt><dd dir="ltr">{net.expectedIp}</dd>
              <dt>{t('netDetectedIp')}</dt><dd dir="ltr">{(net.detectedIps || []).join(', ')}</dd>
              <dt>{t('netPort')}</dt><dd dir="ltr">{net.port}</dd>
            </dl>

            {net.hasExpectedIp === false && <p className="error-box small">{t('netWarnIp')}</p>}
            {net.mdns !== 'Active' && <p className="hint small">{t('netWarnMdns')}</p>}

            <div className="row mt">
              <button className="btn btn-sm btn-primary" onClick={copyDiagnostics}>{t('netCopyDiag')}</button>
              <a className="btn btn-sm" href="/webadmin">{t('netBackToAdmin')}</a>
            </div>
            {copied && <p className="hint small mt">{copied}</p>}

            <div className="mt">
              <b className="small">{t('netHowTitle')}</b>
              <ol className="small muted">
                <li>{t('netHow1')}</li>
                <li>{t('netHow2')}</li>
                <li>{t('netHow3')} <b dir="ltr">{net.hostnameUrl}</b></li>
              </ol>
              <p className="hint small">{t('syQrHint')}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
