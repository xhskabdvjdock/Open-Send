import QRCode from 'qrcode';
import { err } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Offline QR code for the LAN URL (no external service).
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const text = (new URL(req.url).searchParams.get('text') || '').slice(0, 500);
  if (!text) return err('Missing text.', 400);
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, width: 220 });
    return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=300' } });
  } catch {
    return err('QR generation failed.', 500);
  }
}
