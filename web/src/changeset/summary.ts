import type { FileChange } from "../api";
import { languageOf, type Language } from "../lib/languages";

export interface LanguageStat extends Language {
  files: number;
  additions: number;
  deletions: number;
}

/** Per-language totals, largest change first. */
export function languageBreakdown(files: readonly FileChange[]): LanguageStat[] {
  const map = new Map<string, LanguageStat>();
  for (const f of files) {
    const lang = languageOf(f.path);
    const cur = map.get(lang.name) ?? { ...lang, files: 0, additions: 0, deletions: 0 };
    cur.files++;
    cur.additions += f.additions;
    cur.deletions += f.deletions;
    map.set(lang.name, cur);
  }
  return [...map.values()].sort(
    (a, b) => b.additions + b.deletions - (a.additions + a.deletions) || b.files - a.files || a.name.localeCompare(b.name),
  );
}

export interface TreeDir {
  kind: "dir";
  /** Display name; may contain slashes when single-child dirs are collapsed. */
  name: string;
  path: string;
  children: TreeNode[];
  additions: number;
  deletions: number;
  files: number;
}

export interface TreeFile {
  kind: "file";
  name: string;
  path: string;
  file: FileChange;
}

export type TreeNode = TreeDir | TreeFile;

/**
 * Builds a directory tree from changed files. Directories with a single
 * child directory are collapsed into one node ("src/components"). Dirs sort
 * before files; both alphabetically.
 */
export function buildTree(files: readonly FileChange[]): TreeNode[] {
  const root: TreeDir = { kind: "dir", name: "", path: "", children: [], additions: 0, deletions: 0, files: 0 };
  for (const f of files) {
    const parts = f.path.split("/");
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = dir.children.find((c): c is TreeDir => c.kind === "dir" && c.path === path);
      if (!next) {
        next = { kind: "dir", name: parts[i], path, children: [], additions: 0, deletions: 0, files: 0 };
        dir.children.push(next);
      }
      next.additions += f.additions;
      next.deletions += f.deletions;
      next.files++;
      dir = next;
    }
    dir.children.push({ kind: "file", name: parts[parts.length - 1], path: f.path, file: f });
  }
  return finish(root).children;
}

function finish(dir: TreeDir): TreeDir {
  dir.children = dir.children.map((c) => {
    if (c.kind !== "dir") return c;
    let d = finish(c);
    while (d.children.length === 1 && d.children[0].kind === "dir") {
      const only = d.children[0] as TreeDir;
      d = { ...only, name: `${d.name}/${only.name}` };
    }
    return d;
  });
  dir.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return dir;
}

/** Case-insensitive substring match on the path (and old path for renames). */
export function matchesFilter(f: FileChange, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  return f.path.toLowerCase().includes(q) || (f.oldPath?.toLowerCase().includes(q) ?? false);
}
