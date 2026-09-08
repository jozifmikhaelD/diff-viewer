import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export interface ChangeEvent {
  worktree: string;
  kind: "worktree" | "refs";
}

/**
 * Decides which queries a change event stales.
 * - refs (commit, checkout, stage): repo/worktree list, history, and everything
 *   about that worktree's uncommitted state.
 * - worktree (files edited): repo status counts plus uncommitted changesets and diffs.
 */
export function invalidateFor(client: QueryClient, ev: ChangeEvent): void {
  void client.invalidateQueries({ queryKey: ["repo"] });
  if (ev.kind === "refs") void client.invalidateQueries({ queryKey: ["log", ev.worktree] });
  void client.invalidateQueries({
    predicate: (q) => {
      const [name, wt, selector] = q.queryKey as [string, string, unknown];
      if (wt !== ev.worktree) return false;
      if (name !== "changeset" && name !== "diff") return false;
      return typeof selector === "object" && selector !== null && "worktree" in selector;
    },
  });
}

/** Subscribes to /api/events and invalidates affected queries. */
export function useLiveUpdates(enabled = true): void {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/events");
    const onChange = (e: MessageEvent<string>) => {
      try {
        invalidateFor(client, JSON.parse(e.data) as ChangeEvent);
      } catch {
        // malformed event; ignore
      }
    };
    es.addEventListener("change", onChange);
    return () => {
      es.removeEventListener("change", onChange);
      es.close();
    };
  }, [client, enabled]);
}
