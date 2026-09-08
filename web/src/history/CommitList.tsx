import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
import { api, type Commit, type Worktree } from "../api";
import { ROW_HEIGHT } from "./CommitGraph";
import { CommitRow } from "./CommitRow";
import { layoutLanes } from "./lanes";
import { WorkingTreeRow } from "./WorkingTreeRow";

export type Selection = { kind: "commit"; sha: string } | { kind: "worktree" } | null;

interface Props {
  worktree: Worktree;
  ref?: string;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  pageSize?: number;
  /** Test hook: jsdom cannot measure elements, so tests supply a fixed scroll rect. */
  testRect?: { width: number; height: number };
}

export function CommitList({ worktree, ref, selection, onSelect, pageSize = 200, testRect }: Props) {
  const query = useInfiniteQuery({
    queryKey: ["log", worktree.path, ref ?? "", pageSize],
    queryFn: ({ pageParam }) => api.log({ wt: worktree.path, ref, skip: pageParam, limit: pageSize }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.skip + last.commits.length : undefined),
  });

  const commits: Commit[] = useMemo(() => query.data?.pages.flatMap((p) => p.commits) ?? [], [query.data]);
  const { rows, laneCount } = useMemo(() => {
    const { rows } = layoutLanes(commits);
    return { rows, laneCount: rows.reduce((m, r) => Math.max(m, r.width), 1) };
  }, [commits]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: query.hasNextPage ? commits.length + 1 : commits.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    ...(testRect && {
      initialRect: testRect,
      observeElementRect: (_: unknown, cb: (rect: { width: number; height: number }) => void) => {
        cb(testRect);
        return () => {};
      },
    }),
  });

  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length > 0 ? items[items.length - 1].index : -1;
  useEffect(() => {
    if (lastIndex >= commits.length - 1 && query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [lastIndex, commits.length, query]);

  return (
    <div className="commit-list" role="listbox" aria-label="History">
      <WorkingTreeRow
        worktree={worktree}
        selected={selection?.kind === "worktree"}
        onSelect={() => onSelect({ kind: "worktree" })}
      />
      {query.isError && (
        <p role="alert" className="error">
          Could not load history: {query.error.message}
        </p>
      )}
      {query.isPending && <p role="status">Loading history…</p>}
      {query.isSuccess && commits.length === 0 && <p className="empty">No commits.</p>}
      <div ref={parentRef} className="commit-scroll">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {items.map((item) => {
            const commit = commits[item.index];
            const style: React.CSSProperties = {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${item.start}px)`,
            };
            if (!commit) {
              return (
                <div key="loader" className="commit-row loader" style={{ ...style, height: ROW_HEIGHT }} role="status">
                  Loading more…
                </div>
              );
            }
            return (
              <CommitRow
                key={commit.sha}
                commit={commit}
                lane={rows[item.index]}
                laneCount={laneCount}
                selected={selection?.kind === "commit" && selection.sha === commit.sha}
                onSelect={(sha) => onSelect({ kind: "commit", sha })}
                style={style}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
