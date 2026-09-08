import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Commit, type Worktree } from "../api";
import { ROW_HEIGHT } from "./CommitGraph";
import { CommitRow } from "./CommitRow";
import { layoutLanes } from "./lanes";
import { isEmptySearch, parseSearch } from "./search";
import { anchorOf, rangeFromClick, type Selection } from "./selection";
import { WorkingTreeRow } from "./WorkingTreeRow";

export type { Selection } from "./selection";

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
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 250);
  const sq = useMemo(() => parseSearch(debounced), [debounced]);
  const effectiveRef = sq.ref ?? ref;
  const query = useInfiniteQuery({
    queryKey: ["log", worktree.path, effectiveRef ?? "", pageSize, sq.author ?? "", sq.grep ?? ""],
    queryFn: ({ pageParam }) => api.log({ wt: worktree.path, ref: effectiveRef, author: sq.author, grep: sq.grep, skip: pageParam, limit: pageSize }),
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

  const order = useMemo(() => commits.map((c) => c.sha), [commits]);
  const inRange = useMemo(() => {
    if (selection?.kind !== "range") return new Set<string>();
    const to = order.indexOf(selection.to);
    const from = order.indexOf(selection.from);
    if (to === -1 || from === -1) return new Set<string>();
    return new Set(order.slice(to, from + 1));
  }, [selection, order]);
  const handleSelect = (sha: string, shift: boolean) => {
    const anchor = anchorOf(selection);
    if (shift && anchor) {
      const range = rangeFromClick(anchor, sha, order);
      if (range) {
        onSelect(range);
        return;
      }
    }
    onSelect({ kind: "commit", sha });
  };

  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length > 0 ? items[items.length - 1].index : -1;
  useEffect(() => {
    if (lastIndex >= commits.length - 1 && query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [lastIndex, commits.length, query]);

  return (
    <div className="commit-list">
      <div className="commit-search">
        <input
          type="search"
          aria-label="Search commits"
          placeholder="Search commits…  author:name · sha · branch:name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="commit-rows" role="listbox" aria-label="History">
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
      {query.isSuccess && commits.length === 0 && <p className="empty">{isEmptySearch(sq) ? "No commits." : "No commits match."}</p>}
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
                selected={
                  (selection?.kind === "commit" && selection.sha === commit.sha) ||
                  (selection?.kind === "range" && (selection.from === commit.sha || selection.to === commit.sha))
                }
                inRange={inRange.has(commit.sha)}
                onSelect={handleSelect}
                style={style}
              />
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
