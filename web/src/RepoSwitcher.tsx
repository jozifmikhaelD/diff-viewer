import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { repoApi } from "./api";

interface Props {
  current: string;
  onOpened: () => void;
}

/** "Open" menu: recent repositories plus a path field. */
export function RepoSwitcher({ current, onOpened }: Props) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const client = useQueryClient();
  const recent = useQuery({ queryKey: ["recent"], queryFn: repoApi.recent, enabled: open });
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
              if (path.trim()) mutation.mutate(path.trim());
            }}
          >
            <input
              type="text"
              aria-label="Repository path"
              placeholder="/path/to/repo"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              autoFocus
              spellCheck={false}
            />
            <button type="submit" className="ghost" disabled={mutation.isPending || !path.trim()}>
              {mutation.isPending ? "Opening…" : "Open"}
            </button>
          </form>
          {mutation.isError && (
            <p role="alert" className="error">
              {mutation.error.message}
            </p>
          )}
          {recent.isPending && <p role="status" className="empty">Loading recent…</p>}
          {recent.data && others.length === 0 && <p className="empty">No other recent repositories.</p>}
          {others.length > 0 && (
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
