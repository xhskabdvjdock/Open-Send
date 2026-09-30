import os from 'node:os';

export function getLanUrls(port: number): { local: string; lan: string[] } {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const n of list) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
  }
  return { local: `http://localhost:${port}`, lan: ips.map((ip) => `http://${ip}:${port}`) };
}

export function getPrimaryLanIp(): string | null {
  const { lan } = getLanUrls(3000);
  return lan[0] ?? null;
}
