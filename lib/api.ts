import { NextResponse } from 'next/server';

export function json(data: unknown, status = 200, headers?: Record<string, string>): NextResponse {
  return NextResponse.json(data, { status, headers });
}

export function err(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...(extra || {}) }, { status });
}

export function clientIp(req: Request): string {
  const h = (name: string) => req.headers.get(name) || '';
  const fwd = h('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim().slice(0, 80);
  return (h('x-real-ip') || '').slice(0, 80);
}

export function userAgent(req: Request): string {
  return (req.headers.get('user-agent') || '').slice(0, 200);
}
