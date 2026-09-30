import { json } from '@/lib/api';
import { getPublicSettings } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return json({ settings: getPublicSettings() });
}
