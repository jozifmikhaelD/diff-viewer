import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fsApi, repoApi } from "./api";

interface Props {
  current: string;
  onOpened: () => void;
}

interface Suggestion {
  name: string;
  path: string;
  repo: boolean;
  recent?: boolean;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** "Open" menu: recent repositories plus a path field with directory completion. */
export function RepoSwitcher({ current, onOpened }: Props) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [active, setActive] = useState(-1);
  const client = useQueryClient();
  const recent = useQuery({ queryKey: ["recent"], queryFn: repoApi.recent, enabled: open });
  const debouncedPath = useDebounced(path, 120);
  const suggestions = useQuery({
    queryKey: ["fs", debouncedPath],
    queryFn: () => fsApi.complete(debouncedPath),
    enabled: open && debouncedPath.trim().length > 0,
    staleTime: 10_000,
  });
  const mutation = useMutation({
    mutationFn: repoApi.open,
    onSuccess: async () => {
      setOpen(false);
      setPath("");
      await client.invalidateQueries();
      onOpened();
    },
  });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Suggestions: matching recent repositories first (all of them when the
  // field is empty), then directory completions for the typed path.
  const others = (recent.data?.recent ?? []).filter((r) => r.path !== current);
  const q = path.trim().toLowerCase();
  const recentEntries: Suggestion[] = others
    .filter((r) => !q || r.path.toLowerCase().includes(q) || (r.path.split("/").pop() ?? "").toLowerCase().includes(q))
    .map((r) => ({ name: r.path.split("/").filter(Boolean).pop() ?? r.path, path: r.path, repo: true, recent: true }));
  const fsEntries: Suggestion[] = q ? (suggestions.data?.entries ?? []).filter((e) => !recentEntries.some((r) => r.path === e.path)) : [];
  const entries: Suggestion[] = [...recentEntries, ...fsEntries];
  const accept = (i: number) => {
    const e = entries[i];
    if (!e) return;
    // A repo can be opened straight away; a plain directory descends into it.
    if (e.repo) mutation.mutate(e.path);
    else setPath(e.path + "/");
    setActive(-1);
  };
  return (
    <div className="repo-switcher" ref={ref}>
      <button type="button" className="ghost" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} title="Open another repository: pick a recent one or type a path">
        Open…
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Open repository">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (active >= 0) accept(active);
              else if (path.trim()) mutation.mutate(path.trim());
            }}
          >
            <input
              type="text"
              aria-label="Repository path"
              placeholder="Recent repos, or type a path (Tab completes)"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setActive(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && entries.length) {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, entries.length - 1));
                } else if (e.key === "ArrowUp" && entries.length) {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, -1));
                } else if (e.key === "Tab" && entries.length && !e.shiftKey) {
                  e.preventDefault();
                  const i = active >= 0 ? active : 0;
                  setPath(entries[i].path + (entries[i].repo ? "" : "/"));
                  setActive(-1);
                }
              }}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={entries.length > 0}
              aria-controls="path-suggestions"
              aria-activedescendant={active >= 0 ? `path-suggestion-${active}` : undefined}
              autoFocus
              spellCheck={false}
            />
            <button type="submit" className="ghost" disabled={mutation.isPending || !path.trim()}>
              {mutation.isPending ? "Opening…" : "Open"}
            </button>
          </form>
          {entries.length > 0 && (
            <ul className="suggestions" id="path-suggestions" role="listbox" aria-label="Repositories and directories">
              {entries.map((e, i) => (
                <li
                  key={e.path}
                  id={`path-suggestion-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "active" : ""}
                  title={e.path}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => accept(i)}
                >
                  <span className={`fs-icon${e.repo ? " repo" : ""}`} aria-hidden="true">
                    {e.recent ? "↺" : e.repo ? "◆" : "▸"}
                  </span>
                  <span className="recent-name">{e.name}</span>
                  {e.recent && <span className="recent-path">{e.path}</span>}
                  <span className="fs-tag">{e.recent ? "recent" : e.repo ? "git repo" : ""}</span>
                </li>
              ))}
              {q && suggestions.data?.more && <li className="empty">…more; keep typing</li>}
            </ul>
          )}
          {mutation.isError && (
            <p role="alert" className="error">
              {mutation.error.message}
            </p>
          )}
          {recent.isPending && <p role="status" className="empty">Loading recent…</p>}
          {recent.data && entries.length === 0 && !q && <p className="empty">No other recent repositories yet. Type a path to browse.</p>}
        </div>
      )}
    </div>
  );
}
