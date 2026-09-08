/**
 * Intra-line diff: splits both strings into word/space tokens and marks the
 * tokens that differ using an LCS. Returns segments for each side with a
 * `changed` flag; equal segments are merged so rendering stays cheap.
 */
export interface Segment {
  text: string;
  changed: boolean;
}

const MAX_TOKENS = 300;

export function tokenize(s: string): string[] {
  return s.match(/\w+|\s+|[^\w\s]/g) ?? [];
}

export function wordDiff(a: string, b: string): { a: Segment[]; b: Segment[] } {
  if (a === b) return { a: [{ text: a, changed: false }], b: [{ text: b, changed: false }] };
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length > MAX_TOKENS || tb.length > MAX_TOKENS || ta.length === 0 || tb.length === 0) {
    return { a: [{ text: a, changed: a.length > 0 }], b: [{ text: b, changed: b.length > 0 }] };
  }
  // LCS table
  const n = ta.length;
  const m = tb.length;
  const dp: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const sa: Segment[] = [];
  const sb: Segment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) {
      push(sa, ta[i], false);
      push(sb, tb[j], false);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(sa, ta[i++], true);
    } else {
      push(sb, tb[j++], true);
    }
  }
  while (i < n) push(sa, ta[i++], true);
  while (j < m) push(sb, tb[j++], true);
  // If nearly everything changed, highlighting adds noise; fall back to whole-line.
  const changedRatio = (segs: Segment[], total: string) =>
    total.length === 0 ? 0 : segs.filter((s) => s.changed).reduce((acc, s) => acc + s.text.length, 0) / total.length;
  if (changedRatio(sa, a) > 0.8 && changedRatio(sb, b) > 0.8) {
    return { a: [{ text: a, changed: true }], b: [{ text: b, changed: true }] };
  }
  return { a: sa, b: sb };
}

function push(segs: Segment[], text: string, changed: boolean) {
  const last = segs[segs.length - 1];
  if (last && last.changed === changed) last.text += text;
  else segs.push({ text, changed });
}
