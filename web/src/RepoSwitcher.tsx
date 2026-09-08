import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fsApi, repoApi } from "./api";

interface Props {
  current: string;
  onOpened: () => void;
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

  const entries = path.trim() ? suggestions.data?.entries ?? [] : [];
  const accept = (i: number) => {
    const e = entries[i];
    if (!e) return;
    // A repo can be opened straight away; a plain directory descends into it.
    if (e.repo) mutation.mutate(e.path);
    else setPath(e.path + "/");
    setActive(-1);
  };

  const others = (recent.data?.recent ?? []).filter((r) => r.path !== current);
  return (
    <div className="repo-switcher" ref={ref}>
      <button type="button" className="ghost" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
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
              placeholder="/path/to/repo  (Tab completes)"
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
            <ul className="suggestions" id="path-suggestions" role="listbox" aria-label="Directories">
              {entries.map((e, i) => (
                <li
                  key={e.path}
                  id={`path-suggestion-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "active" : ""}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => accept(i)}
                >
                  <span className={`fs-icon${e.repo ? " repo" : ""}`} aria-hidden="true">
                    {e.repo ? "◆" : "▸"}
                  </span>
                  <span className="recent-name">{e.name}</span>
                  {e.repo && <span className="fs-tag">git repo</span>}
                </li>
              ))}
              {suggestions.data?.more && <li className="empty">…more; keep typing</li>}
            </ul>
          )}
          {mutation.isError && (
            <p role="alert" className="error">
              {mutation.error.message}
            </p>
          )}
          {recent.isPending && <p role="status" className="empty">Loading recent…</p>}
          {recent.data && others.length === 0 && entries.length === 0 && <p className="empty">No other recent repositories.</p>}
          {others.length > 0 && entries.length === 0 && (
            <ul className="recent-list" aria-label="Recent repositories">
              {others.map((r) => (
                <li key={r.path}>
                  <button type="button" onClick={() => mutation.mutate(r.path)} title={r.path} disabled={mutation.isPending}>
                    <span className="recent-name">{r.path.split("/").filter(Boolean).pop()}</span>
                    <span className="recent-path">{r.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
