// Chat unit tests: moderation core (no I/O, no server).
// Run from project root: node scripts/test-chat.mjs   (Node strips types)
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register(pathToFileURL('scripts/chat-test-loader.mjs'));
const {
  normalizeChatText, tokenizeChatText, matchBannedRule, findBannedHits,
  choosePenaltyHit, suspensionRemainingMs, formatRemainingMs, sanitizeChatContent,
} = await import('../lib/chatModeration.ts');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got:  ${a}\n  want: ${b}`); }
}
const R = (word, matchType = 'whole', minutes = 10) => ({ id: 'r', word, matchType, suspensionMinutes: minutes });
const hit = (content, rule) => {
  const n = normalizeChatText(content);
  return matchBannedRule(n, tokenizeChatText(n), rule);
};

// --- normalization ---
eq('lowercase', normalizeChatText('HeLLo'), 'hello');
eq('arabic tashkeel stripped', normalizeChatText('مَدرَسة'), 'مدرسة');
eq('alef unification', normalizeChatText('أحمد إلى'), 'احمد الى'); // ى untouched, ة untouched
eq('teh-marbuta preserved (not aggressive)', normalizeChatText('مدرسة'), 'مدرسة');
eq('NFKC width', normalizeChatText('Ｈｅｌｌｏ'), 'hello');

// --- whole word ---
eq('whole hit', !!hit('this is badword here', R('badword')), true);
eq('whole no-substring', !!hit('this is badwordish here', R('badword')), false);
eq('whole case-insensitive', !!hit('Say HELLO now', R('hello')), true);
eq('whole punctuation', !!hit('hey,badword!', R('badword')), true);
eq('whole arabic', !!hit('هذه كلمة ممنوعة هنا', R('ممنوعة')), true);
eq('whole arabic no-substring', !!hit('كلمات ممنوعات كثيرة', R('ممنوعة')), false);

// --- contains ---
eq('contains inside longer', !!hit('xxbadwordyy', R('badword', 'contains')), true);
eq('contains arabic inside', !!hit('الكلمةممنوعةX', R('ممنوعة', 'contains')), true);

// --- phrase ---
eq('phrase exact', !!hit('meet me at noon sharp', R('at noon', 'phrase')), true);
eq('phrase bounded (no partial)', !!hit('beat noone sharp', R('at noon', 'phrase')), false);
eq('phrase arabic', !!hit('تم إرسال كلمة ممنوعة اليوم', R('كلمة ممنوعة', 'phrase')), true);

// --- find + penalty ---
const rules = [R('aaa', 'whole', 5), R('bbb', 'contains', 30)];
const hits = findBannedHits('aaa and xxbbbyy', rules);
eq('two hits', hits.length, 2);
eq('longest wins', choosePenaltyHit(hits, 10).rule.suspensionMinutes, 30);
eq('single hit', choosePenaltyHit(findBannedHits('aaa', rules), 10).rule.word, 'aaa');
eq('no hits', findBannedHits('clean message here', rules).length, 0);
eq('empty content', findBannedHits('   ', rules).length, 0);

// --- suspension math ---
eq('remaining future', suspensionRemainingMs(new Date(Date.now() + 60000).toISOString(), Date.now()) > 59000, true);
eq('remaining past', suspensionRemainingMs(new Date(Date.now() - 1000).toISOString()), 0);
eq('fmt MM:SS', formatRemainingMs(582000), '09:42');
eq('fmt hour', formatRemainingMs(2 * 3600000 + 5 * 60000), '2h 5m');
eq('fmt day', formatRemainingMs(3 * 86400000), '3d');

// --- sanitize/validate ---
eq('trim', sanitizeChatContent('  hi  ', 2000), 'hi');
eq('max length', sanitizeChatContent('abcdef', 4), 'abcd');
eq('control chars stripped', sanitizeChatContent('ab', 10), 'ab');
eq('newline kept', sanitizeChatContent('a\nb', 10), 'a\nb');

console.log(`\nchat unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
