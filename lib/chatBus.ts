// In-process SSE fan-out for student chat (single-server LAN app — same as the
// existing in-memory rate limiter; no external broker, works fully offline).
// Same-origin EventSource carries the HttpOnly session cookie, so no tokens in
// URLs and no CORS changes are needed for btec-send.local.

type Sender = (chunk: string) => void;

const clients = new Map<string, Set<Sender>>();

export const CHAT_SSE_HEARTBEAT_MS = 25000;

const encoder = new TextEncoder();

export function chatCreateStream(userId: string): { stream: ReadableStream<Uint8Array>; dispose: () => void } {
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let live = true;
  const getSet = (): Set<Sender> => {
    let set = clients.get(userId);
    if (!set) {
      set = new Set();
      clients.set(userId, set);
    }
    return set;
  };
  const entry: Sender = (chunk: string) => {
    try {
      ctrl?.enqueue(encoder.encode(chunk));
    } catch {
      dispose();
    }
  };
  function dispose(): void {
    if (!live) return;
    live = false;
    if (timer) clearInterval(timer);
    timer = null;
    const set = clients.get(userId);
    if (set) {
      set.delete(entry);
      if (set.size === 0) clients.delete(userId);
    }
    try {
      ctrl?.close();
    } catch {}
    ctrl = null;
  }
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      getSet().add(entry);
    },
    cancel() {
      dispose();
    },
  });
  timer = setInterval(() => {
    entry(':hb\n\n');
  }, CHAT_SSE_HEARTBEAT_MS);
  return { stream, dispose };
}

/** Push a named event to every open stream of the given users. Never throws. */
export function chatPush(userIds: string[], event: string, data: unknown): void {
  let payload: string;
  try {
    payload = `event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`;
  } catch {
    return;
  }
  for (const id of userIds) {
    const set = clients.get(id);
    if (!set) continue;
    for (const send of [...set]) {
      try {
        send(payload);
      } catch {}
    }
  }
}

export function chatStreamCount(): number {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}
