import { Clock, CheckCircle2, XCircle, TimerOff, DownloadCloud, Ban } from 'lucide-react';
import { useT } from '@/lib/i18n';

export function StatusBadge({ status }: { status: string }) {
  const { t } = useT();
  const s = (status || 'PENDING').toUpperCase();
  const map: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    PENDING: { cls: 'status-pending', icon: <Clock size={13} />, label: t('pending') },
    ACCEPTED: { cls: 'status-accepted', icon: <CheckCircle2 size={13} />, label: t('accepted') },
    DECLINED: { cls: 'status-declined', icon: <XCircle size={13} />, label: t('declined') },
    EXPIRED: { cls: 'status-expired', icon: <TimerOff size={13} />, label: t('expired') },
    DOWNLOADED: { cls: 'status-downloaded', icon: <DownloadCloud size={13} />, label: t('downloaded') },
    CANCELLED: { cls: 'status-cancelled', icon: <Ban size={13} />, label: t('cancelled') },
  };
  const m = map[s] || map.PENDING;
  return (
    <span className={`status ${m.cls}`}>
      {m.icon} {m.label} · {s}
    </span>
  );
}
