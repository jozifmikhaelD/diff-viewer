/**
 * Lazy Shiki syntax highlighting. Grammars and themes are loaded on demand so
 * the initial bundle stays small; unsupported languages return no tokens and
 * the renderer falls back to plain text.
 */
import type { Segment } from "./wordDiff";

export interface Token {
  text: string;
  color?: string;
}

export type LineTokens = Token[];

interface Highlighter {
  codeToTokensBase(code: string, opts: { lang: string; theme: string }): { content: string; color?: string }[][];
  loadLanguage(...langs: unknown[]): Promise<void>;
  loadTheme(...themes: unknown[]): Promise<void>;
  getLoadedLanguages(): string[];
  getLoadedThemes(): string[];
}

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  py: "python",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  rs: "rust",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  swift: "swift",
  css: "css",
  scss: "scss",
  html: "html",
  vue: "vue",
  svelte: "svelte",
  md: "markdown",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  sql: "sql",
  xml: "xml",
  tf: "terraform",
  proto: "proto",
  dockerfile: "dockerfile",
  makefile: "makefile",
};

// Explicit imports so the bundler emits one lazy chunk per grammar.
const GRAMMARS: Record<string, () => Promise<unknown>> = {
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  python: () => import("@shikijs/langs/python"),
  go: () => import("@shikijs/langs/go"),
  java: () => import("@shikijs/langs/java"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  rust: () => import("@shikijs/langs/rust"),
  ruby: () => import("@shikijs/langs/ruby"),
  php: () => import("@shikijs/langs/php"),
  csharp: () => import("@shikijs/langs/csharp"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  swift: () => import("@shikijs/langs/swift"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  html: () => import("@shikijs/langs/html"),
  vue: () => import("@shikijs/langs/vue"),
  svelte: () => import("@shikijs/langs/svelte"),
  markdown: () => import("@shikijs/langs/markdown"),
  json: () => import("@shikijs/langs/json"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  xml: () => import("@shikijs/langs/xml"),
  terraform: () => import("@shikijs/langs/terraform"),
  proto: () => import("@shikijs/langs/proto"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  makefile: () => import("@shikijs/langs/makefile"),
};

const THEMES: Record<"light" | "dark", { id: string; load: () => Promise<unknown> }> = {
  light: { id: "github-light", load: () => import("@shikijs/themes/github-light") },
  dark: { id: "github-dark", load: () => import("@shikijs/themes/github-dark") },
};

/** Shiki language id for a path, or null when unsupported. */
export function languageFor(path: string): string | null {
  const base = path.split("/").pop() ?? path;
  const lower = base.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "dockerfile";
  if (lower === "makefile" || lower === "gnumakefile") return "makefile";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  return LANG_BY_EXT[base.slice(dot + 1).toLowerCase()] ?? null;
}

let highlighterPromise: Promise<Highlighter> | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([import("shiki/core"), import("shiki/engine/javascript")]);
      return (await createHighlighterCore({ themes: [], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) })) as unknown as Highlighter;
    })();
  }
  return highlighterPromise;
}

const loading = new Map<string, Promise<void>>();
async function ensure(hl: Highlighter, kind: "lang" | "theme", id: string, load: () => Promise<unknown>) {
  const loaded = kind === "lang" ? hl.getLoadedLanguages() : hl.getLoadedThemes();
  if (loaded.includes(id)) return;
  const key = `${kind}:${id}`;
  if (!loading.has(key)) {
    loading.set(
      key,
      load().then(async (mod) => {
        const grammar = (mod as { default: unknown }).default;
        if (kind === "lang") await hl.loadLanguage(grammar);
        else await hl.loadTheme(grammar);
      }),
    );
  }
  await loading.get(key);
}

/**
 * Tokenizes whole-file content line by line for `lang` in the given scheme.
 * Resolves to null when the language is unsupported or highlighting fails.
 */
export async function tokenizeLines(lines: readonly string[], lang: string | null, scheme: "light" | "dark"): Promise<LineTokens[] | null> {
  if (!lang || !GRAMMARS[lang] || lines.length === 0) return null;
  try {
    const hl = await getHighlighter();
    await Promise.all([ensure(hl, "lang", lang, GRAMMARS[lang]), ensure(hl, "theme", THEMES[scheme].id, THEMES[scheme].load)]);
    const raw = hl.codeToTokensBase(lines.join("\n"), { lang, theme: THEMES[scheme].id });
    return raw.map((line) => line.map((t) => ({ text: t.content, color: t.color })));
  } catch {
    return null;
  }
}

export interface Piece {
  text: string;
  color?: string;
  changed: boolean;
}

/**
 * Splits syntax tokens at word-diff boundaries so each rendered span carries
 * one colour and one changed flag. Without segments every token is unchanged.
 */
export function mergePieces(tokens: LineTokens | undefined, segments: Segment[] | undefined, text: string): Piece[] {
  if (!tokens || tokens.length === 0) {
    if (!segments) return [{ text, changed: false }];
    return segments.map((s) => ({ text: s.text, changed: s.changed }));
  }
  if (!segments) return tokens.map((t) => ({ text: t.text, color: t.color, changed: false }));
  const out: Piece[] = [];
  let ti = 0;
  let tOff = 0; // offset within current token
  for (const seg of segments) {
    let remaining = seg.text.length;
    while (remaining > 0 && ti < tokens.length) {
      const tok = tokens[ti];
      const take = Math.min(remaining, tok.text.length - tOff);
      out.push({ text: tok.text.slice(tOff, tOff + take), color: tok.color, changed: seg.changed });
      remaining -= take;
      tOff += take;
      if (tOff >= tok.text.length) {
        ti++;
        tOff = 0;
      }
    }
    if (remaining > 0) out.push({ text: seg.text.slice(seg.text.length - remaining), changed: seg.changed });
  }
  return out;
}
