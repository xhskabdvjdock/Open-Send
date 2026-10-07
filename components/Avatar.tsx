'use client';

import { useState } from 'react';

/* Round avatar with initial-letter fallback. Served by /api/avatars/[id]
 * (ETag-cached, auth-gated). Falls back silently if the picture is missing. */
export function Avatar({
  userId,
  name,
  size = 42,
  hasAvatar,
}: {
  userId: string;
  name: string;
  size?: number;
  hasAvatar?: boolean | number;
}) {
  const [failed, setFailed] = useState(false);
  const px = `${size}px`;
  const fontSize = `${Math.max(12, Math.round(size * 0.42))}px`;
  if (hasAvatar && !failed) {
    return (
      <img
        src={`/api/avatars/${encodeURIComponent(userId)}`}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: px, height: px, borderRadius: '50%', objectFit: 'cover', flex: 'none', fontSize }}
      />
    );
  }
  return (
    <span className="chat-avatar" aria-hidden style={{ width: px, height: px, fontSize }}>
      {(name || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}
