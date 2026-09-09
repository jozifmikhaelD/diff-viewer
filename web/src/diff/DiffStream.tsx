import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangesetSelector, FileChange, Worktree } from "../api";
import { DiffBody, type DiffMode } from "./DiffView";
import { useHunkKeys } from "./useHunkKeys";

/** scrollTo is missing in some environments (jsdom); fall back to scrollTop. */
function scrollContainerTo(c: HTMLElement, top: number) {
  if (typeof c.scrollTo === "function") c.scrollTo({ top, behavior: "auto" });
  else c.scrollTop = top;
}

interface Props {
  worktree: Worktree;
  selector: ChangesetSelector;
  /** Files in display order. */
  files: FileChange[];
  selectedPath: string | null;
  /** Fired by the scroll-spy (as you scroll) and mirrored back for clicks. */
  onSelectPath: (path: string) => void;
  scheme?: "light" | "dark";
  mode: DiffMode;
  onModeChange: (m: DiffMode) => void;
  ignoreWhitespace: boolean;
  onIgnoreWhitespaceChange: (v: boolean) => void;
  onWholeFile?: (path: string) => void;
}

/** Offset from the container top at which a file counts as "current". */
const SPY_OFFSET = 56;

/**
 * Every changed file's diff in one scrolling column. Sections mount their
 * diff when they come near the viewport, the file under the sticky header
 * is reported through onSelectPath as you scroll, and a selection made
 * elsewhere (tree click, n/p) scrolls its section into view.
 */
export function DiffStream({ worktree, selector, files, selectedPath, onSelectPath, scheme, mode, onModeChange, ignoreWhitespace, onIgnoreWhitespaceChange, onWholeFile }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const spied = useRef<string | null>(null);
  useHunkKeys(scrollRef);

  // Scroll-spy: the last section whose top is above the offset line.
  const spy = useCallback(() => {
    const c = scrollRef.current;
    if (!c) return;
    const top = c.getBoundingClientRect().top + SPY_OFFSET;
    const sections = [...c.querySelectorAll<HTMLElement>("section[data-path]")];
    let current: HTMLElement | undefined = sections[0];
    for (const s of sections) if (s.getBoundingClientRect().top <= top) current = s;
    const path = current?.dataset.path ?? null;
    if (path && path !== spied.current) {
      spied.current = path;
      if (path !== selectedPath) onSelectPath(path);
    }
  }, [onSelectPath, selectedPath]);

  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        spy();
      });
    };
    c.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      c.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [spy]);

  // Selection made elsewhere: scroll to it.
  useEffect(() => {
    if (!selectedPath || selectedPath === spied.current) return;
    const c = scrollRef.current;
    const el = c?.querySelector<HTMLElement>(`section[data-path="${CSS.escape(selectedPath)}"]`);
    if (!c || !el) return;
    spied.current = selectedPath;
    scrollContainerTo(c, el.offsetTop - c.offsetTop);
  }, [selectedPath]);

  // Reset spy when the file set changes (new selection).
  const key = useMemo(() => files.map((f) => f.path).join("\n"), [files]);
  useEffect(() => {
    spied.current = null;
    if (scrollRef.current) scrollContainerTo(scrollRef.current, 0);
  }, [key]);

  return (
    <section className="diff diff-stream" aria-label="All diffs">
      <header className="diff-toolbar">
        <h3 className="diff-path">
          {files.length} {files.length === 1 ? "file" : "files"}
        </h3>
        <span className="deps-summary" title="The file you are reading is highlighted in the file list as you scroll">scroll to read; the list follows</span>
        <span className="spacer" />
        <label className="check" title="Hide changes that only add or remove whitespace (git diff -w)">
          <input type="checkbox" checked={ignoreWhitespace} onChange={(e) => onIgnoreWhitespaceChange(e.target.checked)} /> Ignore whitespace
        </label>
        <div className="segmented" role="radiogroup" aria-label="Diff layout">
          {(["unified", "split"] as DiffMode[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => onModeChange(m)} title={m === "unified" ? "Old and new lines in one column" : "Old on the left, new on the right"}>
              {m === "unified" ? "Unified" : "Side by side"}
            </button>
          ))}
        </div>
      </header>
      <div className="diff-scroll" ref={scrollRef} data-testid="diff-stream-scroll">
        {files.length === 0 && <p className="diff-notice">Nothing to show.</p>}
        {files.map((f) => (
          <FileSection key={f.path} file={f} root={scrollRef} selected={f.path === selectedPath} onWholeFile={onWholeFile}>
            <DiffBody worktree={worktree} selector={selector} file={f} scheme={scheme} mode={mode} ignoreWhitespace={ignoreWhitespace} expandAllSignal={0} />
          </FileSection>
        ))}
      </div>
    </section>
  );
}

function FileSection({ file, root, selected, onWholeFile, children }: { file: FileChange; root: React.RefObject<HTMLDivElement | null>; selected: boolean; onWholeFile?: (path: string) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || near || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { root: root.current, rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, root]);
  const estimate = Math.min(600, 48 + (file.additions + file.deletions) * 20);
  return (
    <section ref={ref} className={`file-section${selected ? " current" : ""}`} data-path={file.path} aria-label={`Diff for ${file.path}`}>
      <header className="file-section-header">
        <span className={`status status-${file.status === "?" ? "untracked" : file.status}`}>{file.status === "?" ? "U" : file.status}</span>
        <h4 className="diff-path" title={file.path}>
          {file.oldPath && (
            <>
              <span className="file-from">{file.oldPath}</span> →{" "}
            </>
          )}
          {file.path}
        </h4>
        <span className="file-stat" title="Lines added and deleted in this file">
          <span className="stat-add">+{file.additions}</span> <span className="stat-del">−{file.deletions}</span>
        </span>
        <span className="spacer" />
        {onWholeFile && !file.binary && (
          <button type="button" className="ghost small" onClick={() => onWholeFile(file.path)} title="Read the whole file with inline blame">
            Whole file
          </button>
        )}
      </header>
      {near ? children : <div className="file-placeholder" style={{ height: estimate }} aria-hidden="true" />}
    </section>
  );
}
