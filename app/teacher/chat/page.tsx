'use client';

/* Teacher student-chat inbox (text + attachment viewing; sending is text-only
 * for now — attachments from students render inline). Teachers never see
 * student↔student threads: every endpoint here is teacher-guarded and scoped
 * to conversations the teacher participates in. */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, ArrowLeft, Search, X, Wifi, WifiOff, File as FileIcon, Download, Trash2, Ban } from 'lucide-react';
import { useT, translateError } from '@/lib/i18n';
import { Loading } from '@/components/feedback';
import { TeacherNav } from '@/components/TeacherNav';
import { Avatar } from '@/components/Avatar';
import { useConfirm } from '@/components/dialogs';
import { formatBytes } from '@/lib/validation';

interface ChatUser { id: string; username: string; displayName: string; className: string | null; hasAvatar?: boolean | number }
interface Convo {
  id: string; updatedAt: string;
  other: ChatUser | null;
  lastMessage: { content: string; createdAt: string; mine: boolean } | null;
  unread: number; online: boolean; lastSeenAt: string | null;
}
interface Msg {
  id: string; conversationId: string; senderId: string; mine: boolean; kind: string;
  content: string; attachment: { name: string; mime: string; size: number } | null;
  deleted?: boolean; clientId?: string; createdAt: string;
}
interface Status {
  userId: string; enabled: boolean; maxLength: number;
  showOnline: boolean; showLastSeen: boolean; unreadTotal: number;
}

function newClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(iso).slice(0, 16).replace('T', ' ');
  }
}

function isInlineImage(mime: string): boolean {
  return mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/gif' || mime === 'image/webp';
}

function isInlineVideo(mime: string): boolean {
  return mime === 'video/mp4' || mime === 'video/webm';
}

export default function TeacherChatPage() {
  const router = useRouter();
  const { t } = useT();
  const { dialog: confirmDialog, ask: askConfirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [convos, setConvos] = useState<Convo[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [conn, setConn] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [q, setQ] = useState('');
  const [students, setStudents] = useState<ChatUser[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState('');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [frozen, setFrozen] = useState(false);
  const [showPeerMenu, setShowPeerMenu] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, { name: string }>>({});
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sendingRef = useRef(false);
  const myIdRef = useRef('');
  const threadRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef<string | null>(null);
  openRef.current = openId;
  const openOtherRef = useRef<{ id: string; name: string } | null>(null);
  const lastTypingSent = useRef(0);
  const hadError = useRef(false);

  const withMine = useCallback(
    (m: Msg): Msg => ({ ...m, mine: !!myIdRef.current && m.senderId === myIdRef.current }),
    []
  );

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/teacher/chat/status', { cache: 'no-store' });
      if (r.status === 401) {
        router.replace('/teacher/login');
        return;
      }
      if (r.ok) {
        const j = await r.json();
        if (j.userId) myIdRef.current = j.userId;
        setStatus(j);
      }
    } catch {}
  }, [router]);

  const loadConvos = useCallback(async () => {
    try {
      const r = await fetch('/api/teacher/chat/conversations', { cache: 'no-store' });
      if (r.status === 401) {
        router.replace('/teacher/login');
        return;
      }
      if (r.ok) setConvos((await r.json()).conversations || []);
    } catch {}
  }, [router]);

  useEffect(() => {
    (async () => {
      await loadStatus();
      await loadConvos();
      setLoading(false);
    })();
  }, [loadStatus, loadConvos]);

  const isNearBottom = (): boolean => {
    const el = threadRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };
  const scrollToBottom = (smooth: boolean): void => {
    setTimeout(() => {
      const el = threadRef.current;
      if (!el) return;
      try {
        el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      } catch {
        el.scrollTop = el.scrollHeight;
      }
    }, 30);
  };

  async function loadBlocks(): Promise<void> {
    try {
      const r = await fetch('/api/teacher/chat/blocks', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        setBlocks((j.blocked || []).map((b: { userId: string }) => b.userId));
      }
    } catch {}
  }

  async function openConvo(id: string) {
    setOpenId(id);
    setMessages([]);
    setTypingUsers({});
    setText('');
    setFrozen(false);
    loadBlocks();
    setLoadingMsgs(true);
    try {
      const r = await fetch(`/api/teacher/chat/conversations/${id}/messages?limit=30`, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        setMessages((j.messages || []).map(withMine));
        setHasMore(!!j.hasMore);
        scrollToBottom(false);
      }
      await fetch(`/api/teacher/chat/conversations/${id}/read`, { method: 'POST' });
      loadConvos();
    } catch {
    } finally {
      setLoadingMsgs(false);
    }
  }

  useEffect(() => {
    if (loading || !status?.enabled) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/teacher/chat/stream');
    } catch {
      setConn('closed');
      return;
    }
    setConn('connecting');
    es.onopen = () => {
      setConn('open');
      if (hadError.current) {
        hadError.current = false;
        loadConvos();
        const id = openRef.current;
        if (id) openConvo(id);
      }
    };
    es.onerror = () => {
      hadError.current = true;
      setConn('closed');
    };
    es.addEventListener('message', (ev) => {
      try {
        const j = JSON.parse((ev as MessageEvent).data) as { conversationId: string; message: Msg };
        if (!j || !j.message) return;
        if (j.conversationId === openRef.current) {
          const fixed = withMine(j.message);
          const near = isNearBottom();
          setMessages((prev) => (prev.some((m) => m.id === fixed.id) ? prev : [...prev, fixed]));
          if (near) scrollToBottom(true);
          fetch(`/api/teacher/chat/conversations/${j.conversationId}/read`, { method: 'POST' }).catch(() => {});
          loadConvos();
        } else {
          loadConvos();
          setToast(t('chat'));
          setTimeout(() => setToast(''), 4000);
        }
      } catch {}
    });
    es.addEventListener('typing', (ev) => {
      try {
        const j = JSON.parse((ev as MessageEvent).data) as { conversationId: string; userId: string; displayName: string; typing: boolean };
        if (!j || j.conversationId !== openRef.current || j.userId === myIdRef.current) return;
        const other = openOtherRef.current;
        if (!other || j.userId !== other.id) return;
        const uid = j.userId;
        if (typingTimers.current[uid]) clearTimeout(typingTimers.current[uid]);
        if (j.typing) {
          setTypingUsers((prev) => ({ ...prev, [uid]: { name: other.name } }));
          typingTimers.current[uid] = setTimeout(() => {
            setTypingUsers((prev) => {
              const n = { ...prev };
              delete n[uid];
              return n;
            });
          }, 1000);
        } else {
          setTypingUsers((prev) => {
            const n = { ...prev };
            delete n[uid];
            return n;
          });
        }
      } catch {}
    });
    es.addEventListener('message-deleted', (ev) => {
      try {
        const j = JSON.parse((ev as MessageEvent).data) as { conversationId: string; messageId: string };
        if (j.conversationId === openRef.current) {
          setMessages((prev) => prev.map((m) => (m.id === j.messageId ? { ...m, deleted: true, content: '' } : m)));
        }
      } catch {}
    });
    return () => {
      try {
        es?.close();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, status?.enabled]);

  useEffect(() => {
    if (loading || !status?.enabled) return;
    const beat = () => fetch('/api/teacher/chat/ping', { method: 'POST' }).catch(() => {});
    beat();
    const id = setInterval(beat, 60_000);
    return () => clearInterval(id);
  }, [loading, status?.enabled]);

  useEffect(() => {
    if (!showNew) return;
    (async () => {
      try {
        const r = await fetch('/api/teacher/students', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          setStudents(j.students || []);
        }
      } catch {}
    })();
  }, [showNew]);

  function sendTyping(typing: boolean): void {
    if (!openId) return;
    if (typing) {
      const now = Date.now();
      if (lastTypingSent.current && now - lastTypingSent.current < 800) return;
      lastTypingSent.current = now;
    } else {
      lastTypingSent.current = 0;
    }
    fetch(`/api/teacher/chat/conversations/${openId}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typing }),
    }).catch(() => {});
  }

  async function deleteChat() {
    if (!openId) return;
    setShowPeerMenu(false);
    const ok = await askConfirm({ title: t('chDeleteChat'), message: t('chDeleteChatConfirm'), okLabel: t('del'), danger: true });
    if (!ok) return;
    try {
      const r = await fetch(`/api/teacher/chat/conversations/${openId}`, { method: 'DELETE' });
      if (r.ok) {
        setOpenId(null);
        setMessages([]);
        loadConvos();
      }
    } catch {}
  }

  async function toggleBlock() {
    if (!openId || !open) return;
    const otherId = open.other?.id;
    if (!otherId) return;
    if (blocks.includes(otherId)) {
      try {
        await fetch(`/api/teacher/chat/blocks/${otherId}`, { method: 'DELETE' });
        setFrozen(false);
        setShowPeerMenu(false);
        loadBlocks();
      } catch {}
      return;
    }
    setShowPeerMenu(false);
    const ok = await askConfirm({ title: t('chBlockUser'), message: t('chBlockConfirm'), okLabel: t('chBlockUser'), danger: true });
    if (!ok) return;
    try {
      const r = await fetch('/api/teacher/chat/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: otherId }),
      });
      if (r.ok) {
        setFrozen(false);
        loadBlocks();
      }
    } catch {}
  }

  async function send() {
    const content = text.trim();
    if (!content || busy || sendingRef.current || !openId || chatFrozen) return;
    sendingRef.current = true;
    setBusy(true);
    sendTyping(false);
    sendTyping(false);
    const clientId = newClientId();
    try {
      const r = await fetch(`/api/teacher/chat/conversations/${openId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, clientId }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 201 && j.message) {
        setText('');
        const fixed = withMine(j.message);
        setMessages((prev) => (prev.some((m) => m.id === fixed.id) ? prev : [...prev, fixed]));
        scrollToBottom(true);
        loadConvos();
      } else if (j.error === 'CHAT_BLOCKED') {
        if (j.blockedByMe) loadBlocks();
        else setFrozen(true);
      } else if (!r.ok) {
        setToast(j.error ? translateError(j.error) : t('errFailed'));
        setTimeout(() => setToast(''), 4000);
      }
    } catch {
      setToast(t('errOffline'));
      setTimeout(() => setToast(''), 4000);
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!openId || messages.length === 0 || !hasMore) return;
    const el = threadRef.current;
    const prevTop = el ? el.scrollTop : 0;
    const prevH = el ? el.scrollHeight : 0;
    try {
      const r = await fetch(`/api/teacher/chat/conversations/${openId}/messages?limit=30&before=${messages[0].id}`, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        setMessages((prev) => [...(j.messages || []).map(withMine), ...prev]);
        setHasMore(!!j.hasMore);
        setTimeout(() => {
          if (el) el.scrollTop = prevTop + (el.scrollHeight - prevH);
        }, 30);
      }
    } catch {}
  }

  async function delMessage(id: string) {
    if (!openId) return;
    const ok = await askConfirm({ title: t('chatDelMsg'), message: t('chatDelMsg'), okLabel: t('del'), danger: true });
    if (!ok) return;
    try {
      const r = await fetch(`/api/teacher/chat/conversations/${openId}/messages/${id}`, { method: 'DELETE' });
      if (r.ok) setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, deleted: true, content: '' } : m)));
    } catch {}
  }

  async function startChat(userId: string) {
    try {
      const r = await fetch('/api/teacher/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setToast(j.error ? translateError(j.error) : t('errFailed'));
        setTimeout(() => setToast(''), 4000);
        return;
      }
      setQ('');
      setShowNew(false);
      await loadConvos();
      openConvo(j.conversationId);
    } catch {
      setToast(t('errOffline'));
      setTimeout(() => setToast(''), 4000);
    }
  }

  if (loading) return <Loading label={t('loading')} />;

  if (!status?.enabled) {
    return (
      <div>
        <TeacherNav />
        <div className="center-wrap">
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="logo-big" style={{ marginInline: 'auto' }}>
              <MessageCircle size={28} />
            </div>
            <h2>{t('chat')}</h2>
            <p className="muted">{t('chatDisabled')}</p>
          </div>
        </div>
      </div>
    );
  }

  const open = convos.find((c) => c.id === openId) || null;
  openOtherRef.current = open?.other ? { id: open.other.id, name: open.other.displayName } : null;
  const blockedByMe = !!(open?.other && blocks.includes(open.other.id));
  const chatFrozen = frozen || blockedByMe;
  const maxLen = status?.maxLength || 2000;
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? students.filter((u) => u.displayName.toLowerCase().includes(needle) || u.username.toLowerCase().includes(needle))
    : students;

  return (
    <div>
      <TeacherNav />
      {confirmDialog}
      <div className={`chat-wrap${openId ? ' thread-open' : ''}`}>
        <div className="card chat-list-pane">
          <div className="space">
            <h3 style={{ margin: 0 }}>
              <MessageCircle size={16} style={{ verticalAlign: -3 }} /> {t('chat')}
            </h3>
            <button className="btn btn-sm btn-primary" onClick={() => setShowNew((v) => !v)}>
              {t('chatNew')}
            </button>
          </div>
          <div className="small muted mt">
            {conn === 'open' ? t('chatConnected') : conn === 'connecting' ? t('chatConnecting') : t('chatReconnecting')}
          </div>
          {showNew && (
            <div className="mt">
              <div className="row">
                <Search size={15} />
                <input className="input" placeholder={t('chatSearchPh')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('chatSearchPh')} />
              </div>
              <div className="grid mt">
                {filtered.map((u) => (
                  <div key={u.id} className="file-item">
                    <Avatar userId={u.id} name={u.displayName} size={36} hasAvatar={u.hasAvatar} />
                    <div className="grow">
                      <b>{u.displayName}</b>
                      <div className="small muted">
                        @{u.username} · {u.className || '—'}
                      </div>
                    </div>
                    <button className="btn btn-sm btn-primary" onClick={() => startChat(u.id)}>
                      {t('chatStart')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid mt">
            {convos.length === 0 ? (
              <p className="muted small">{t('chatNoConv')}</p>
            ) : (
              convos.map((c) => (
                <button
                  key={c.id}
                  className={`chat-convo${c.id === openId ? ' active' : ''}`}
                  onClick={() => openConvo(c.id)}
                  aria-label={c.other ? c.other.displayName : t('chat')}
                >
                  {c.other ? (
                    <Avatar userId={c.other.id} name={c.other.displayName} size={42} hasAvatar={c.other.hasAvatar} />
                  ) : (
                    <span className="chat-avatar" aria-hidden>?</span>
                  )}
                  <span className="grow">
                    <span className="space" style={{ margin: 0 }}>
                      <b>{c.other?.displayName || '—'}</b>
                      <span className="small muted">{c.lastMessage ? fmtTime(c.lastMessage.createdAt) : ''}</span>
                    </span>
                    <span className="small muted ellipsis" dir="auto">
                      {c.lastMessage ? (c.lastMessage.mine ? '✓ ' : '') + c.lastMessage.content : '—'}
                    </span>
                    <span className="small">
                      {status?.showOnline !== false && (
                        <span className={c.online ? 'chat-on' : 'chat-off'}>
                          ● {c.online ? t('chatOnline') : t('chatOffline')}
                        </span>
                      )}
                    </span>
                  </span>
                  {c.unread > 0 && <span className="badge-count">{c.unread > 99 ? '99+' : c.unread}</span>}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="card chat-thread-pane">
          {!open ? (
            <p className="muted">{t('chatNoMsgs')}</p>
          ) : (
            <>
              <div className="space">
                <div className="row">
                  <button className="btn btn-sm chat-back-btn" onClick={() => setOpenId(null)} aria-label={t('chatBack')}>
                    <ArrowLeft size={15} /> {t('chatBack')}
                  </button>
                  {open.other && (
                    <Avatar userId={open.other.id} name={open.other.displayName} size={36} hasAvatar={open.other.hasAvatar} />
                  )}
                  <button
                    type="button"
                    onClick={() => setShowPeerMenu(true)}
                    aria-label={open.other?.displayName || t('chat')}
                    title={open.other?.displayName || ''}
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', textAlign: 'start' }}
                  >
                    <b>{open.other?.displayName || '—'}</b>
                    <div className="small muted">
                      {status?.showOnline !== false &&
                        (open.online
                          ? t('chatOnline')
                          : status?.showLastSeen !== false && open.lastSeenAt
                            ? `${t('chatLastSeen')}: ${fmtTime(open.lastSeenAt)}`
                            : t('chatOffline'))}
                    </div>
                  </button>
                </div>
              </div>
              {blockedByMe && (
                <div className="card mt" role="status">
                  <span className="small">{t('chBlockedByMe')}</span>
                  <div className="row mt">
                    <button className="btn btn-sm btn-primary" onClick={toggleBlock}>
                      {t('chUnblockUser')}
                    </button>
                  </div>
                </div>
              )}
              {frozen && !blockedByMe && (
                <p className="error-box mt" role="alert">
                  {t('chBlockedNotice')}
                </p>
              )}
              <div className="chat-thread mt" ref={threadRef} role="log" aria-live="polite" aria-label={t('chat')}>
                {hasMore && (
                  <button className="btn btn-sm" onClick={loadMore}>
                    {t('chatLoadMore')}
                  </button>
                )}
                {loadingMsgs ? (
                  <p className="muted small">{t('loading')}</p>
                ) : messages.length === 0 ? (
                  <p className="muted small">{t('chatNoMsgs')}</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`chat-msg${m.mine ? ' mine' : ''}`}>
                      <div className="chat-bubble">
                        {m.deleted ? (
                          <span className="muted small">{t('chatDeletedMsg')}</span>
                        ) : m.kind === 'attachment' && m.attachment ? (
                          <>
                            {isInlineImage(m.attachment.mime) ? (
                              <a href={`/api/chat/attachments/${m.id}`} target="_blank" rel="noopener">
                                <img src={`/api/chat/attachments/${m.id}`} alt={m.attachment.name} className="chat-media" loading="lazy" />
                              </a>
                            ) : isInlineVideo(m.attachment.mime) ? (
                              <video controls preload="metadata" src={`/api/chat/attachments/${m.id}`} className="chat-media" />
                            ) : (
                              <a className="chat-filecard" href={`/api/chat/attachments/${m.id}`} download>
                                <FileIcon size={18} />
                                <span className="grow">
                                  <b dir="auto">{m.attachment.name}</b>
                                  <span className="small muted">{formatBytes(m.attachment.size)}</span>
                                </span>
                                <Download size={15} />
                              </a>
                            )}
                            {m.content && <div dir="auto" style={{ marginTop: 6 }}>{m.content}</div>}
                          </>
                        ) : (
                          <span dir="auto">{m.content}</span>
                        )}
                        <div className="small muted chat-time">
                          {fmtTime(m.createdAt)}
                          {m.mine && !m.deleted && (
                            <button
                              className="btn btn-sm btn-ghost chat-del"
                              onClick={() => delMessage(m.id)}
                              aria-label={t('chatDelMsg')}
                              title={t('chatDelMsg')}
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {Object.values(typingUsers).length > 0 && (
                <p className="small muted mt" role="status" style={{ marginBottom: 0 }}>
                  <span className="typing-dots" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>{' '}
                  <b dir="auto">{Object.values(typingUsers).map((u) => u.name).join('، ')}</b> {t('chatTyping')}
                </p>
              )}
              <div className="row mt">
                <textarea
                  className="textarea chat-composer"
                  rows={2}
                  placeholder={t('chatTypeMsg')}
                  value={text}
                  maxLength={maxLen}
                  disabled={busy || chatFrozen}
                  onChange={(e) => {
                    setText(e.target.value);
                    sendTyping(e.target.value.trim().length > 0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  aria-label={t('chatTypeMsg')}
                />
                <button className="btn btn-primary" onClick={send} disabled={busy || !text.trim() || chatFrozen} aria-label={t('chatSend')}>
                  {busy ? <span className="spinner" /> : <Send size={16} />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {showPeerMenu && open?.other && (
        <div className="modal-overlay" onClick={() => setShowPeerMenu(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="space" style={{ marginBottom: 8 }}>
              <Avatar userId={open.other.id} name={open.other.displayName} size={52} hasAvatar={open.other.hasAvatar} />
              <div>
                <h3 style={{ margin: 0 }} dir="auto">{open.other.displayName}</h3>
                <div className="small muted" dir="ltr">
                  @{open.other.username}
                </div>
              </div>
            </div>
            <div className="grid">
              <button type="button" className="btn btn-block" onClick={toggleBlock}>
                <Ban size={15} /> {blockedByMe ? t('chUnblockUser') : t('chBlockUser')}
              </button>
              <button type="button" className="btn btn-block btn-danger" onClick={deleteChat}>
                <Trash2 size={15} /> {t('chDeleteChat')}
              </button>
              <button type="button" className="btn btn-block" onClick={() => setShowPeerMenu(false)}>
                {t('dlgCancel')}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="card mt" role="status">
          <span className="small">{toast}</span>
        </div>
      )}
    </div>
  );
}
