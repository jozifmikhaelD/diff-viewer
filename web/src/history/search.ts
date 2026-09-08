/**
 * Parses the history search box. Supported forms:
 *   plain words            -> message search (case-insensitive regexp)
 *   author:name            -> author name/email search
 *   7+ hex chars           -> jump to that commit (history from it)
 *   ref:name / branch:name -> history of that ref
 * Terms combine: `author:ann fix login` searches Ann's commits mentioning "fix login".
 */
export interface SearchQuery {
  grep?: string;
  author?: string;
  ref?: string;
}

const HEX = /^[0-9a-f]{7,40}$/i;

export function parseSearch(input: string): SearchQuery {
  const q: SearchQuery = {};
  const words: string[] = [];
  for (const tok of input.trim().split(/\s+/).filter(Boolean)) {
    const m = /^(author|ref|branch|sha):(.+)$/i.exec(tok);
    if (m) {
      const key = m[1].toLowerCase();
      if (key === "author") q.author = m[2];
      else q.ref = m[2];
      continue;
    }
    if (HEX.test(tok) && words.length === 0 && !q.ref) {
      q.ref = tok.toLowerCase();
      continue;
    }
    words.push(tok);
  }
  if (words.length) q.grep = escapeRegex(words.join(" "));
  return q;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isEmptySearch(q: SearchQuery): boolean {
  return !q.grep && !q.author && !q.ref;
}
