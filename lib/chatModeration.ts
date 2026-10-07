// Chat moderation core — PURE functions, zero dependencies.
// scripts/test-chat.mjs imports this file directly (Node type-stripping),
// so keep it free of Node/Next APIs, enums and namespaces.

export type ChatMatchType = 'whole' | 'contains' | 'phrase';

export interface ChatBannedRule {
  id: string;
  word: string;
  matchType: string;
  suspensionMinutes: number;
}

export interface ChatRuleHit {
  rule: ChatBannedRule;
  matchedText: string;
}

const TASHKEEL_RE = /[ً-ٰٟ]/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Conservative normalization for fair matching without over-blocking:
 * NFKC + lowercase + tashkeel stripping + alef unification.
 * Deliberately NOT done: teh-marbuta/heh merging, repeated-letter collapsing,
 * leet-speak mapping — those cause false positives on innocent words.
 */
export function normalizeChatText(s: string): string {
  let t = (s || '').normalize('NFKC').toLowerCase();
  t = t.replace(TASHKEEL_RE, '');
  t = t.replace(/[أإآ]/g, 'ا');
  return t;
}

/** Unicode-aware tokens (letters + numbers). */
export function tokenizeChatText(normalized: string): string[] {
  return normalized.match(/[\p{L}\p{N}]+/gu) || [];
}

export function normalizeMatchType(v: string): ChatMatchType {
  if (v === 'contains') return 'contains';
  if (v === 'phrase') return 'phrase';
  return 'whole';
}

export function matchBannedRule(normalized: string, tokens: string[], rule: ChatBannedRule): ChatRuleHit | null {
  const raw = normalizeChatText(rule.word).trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  const type = normalizeMatchType(rule.matchType);
  if (type === 'contains') {
    return normalized.includes(raw) ? { rule, matchedText: rule.word } : null;
  }
  if (type === 'phrase' || raw.includes(' ')) {
    // Exact phrase bounded by non-word chars (or string edges).
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(raw)}([^\\p{L}\\p{N}]|$)`, 'u');
    return re.test(normalized) ? { rule, matchedText: rule.word } : null;
  }
  return tokens.includes(raw) ? { rule, matchedText: rule.word } : null;
}

/** All matching enabled rules for a message. */
export function findBannedHits(content: string, rules: ChatBannedRule[]): ChatRuleHit[] {
  const normalized = normalizeChatText(content);
  if (!normalized.trim()) return [];
  const tokens = tokenizeChatText(normalized);
  const hits: ChatRuleHit[] = [];
  for (const rule of rules) {
    const hit = matchBannedRule(normalized, tokens, rule);
    if (hit) hits.push(hit);
  }
  return hits;
}

/** Longest suspension wins on multiple hits (§18); ties keep the first rule. */
export function choosePenaltyHit(hits: ChatRuleHit[], fallbackMinutes: number): ChatRuleHit | { rule: ChatBannedRule; matchedText: string } | null {
  if (hits.length === 0) return null;
  let best = hits[0];
  for (const h of hits) {
    if (h.rule.suspensionMinutes > best.rule.suspensionMinutes) best = h;
  }
  void fallbackMinutes;
  return best;
}

export function suspensionRemainingMs(endsAtISO: string, nowMs = Date.now()): number {
  const end = new Date(endsAtISO).getTime();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, end - nowMs);
}

/** Adaptive countdown: MM:SS under an hour, "Xh Ym" / "Xd Xh" above. */
export function formatRemainingMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }
  const h = Math.floor(s / 3600);
  if (h < 48) {
    const m = Math.floor((s % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

export function sanitizeChatContent(s: string, maxLength: number): string {
  // Trim + strip control chars (keep \n \t). Rendering layer (React text)
  // guarantees no HTML/JS execution; links stay plain text.
  return (s || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}
