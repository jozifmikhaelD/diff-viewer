import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { invalidateFor } from "./live";

function seeded() {
  const client = new QueryClient();
  const keys: unknown[][] = [
    ["repo"],
    ["log", "/w", "", 200],
    ["log", "/other", "", 200],
    ["changeset", "/w", { worktree: "all" }],
    ["changeset", "/w", { commit: "abc" }],
    ["changeset", "/other", { worktree: "all" }],
    ["diff", "/w", { worktree: "staged" }, "a.ts", "", false],
    ["diff", "/w", { from: "a", to: "b" }, "a.ts", "", false],
  ];
  for (const k of keys) client.setQueryData(k, { seeded: true });
  return { client, keys };
}

const stale = (client: QueryClient, key: unknown[]) => client.getQueryState(key)?.isInvalidated === true;

describe("invalidateFor", () => {
  it("a worktree event stales repo status and uncommitted changesets/diffs of that worktree only", () => {
    const { client } = seeded();
    invalidateFor(client, { worktree: "/w", kind: "worktree" });
    expect(stale(client, ["repo"])).toBe(true);
    expect(stale(client, ["changeset", "/w", { worktree: "all" }])).toBe(true);
    expect(stale(client, ["diff", "/w", { worktree: "staged" }, "a.ts", "", false])).toBe(true);
    expect(stale(client, ["changeset", "/w", { commit: "abc" }])).toBe(false);
    expect(stale(client, ["diff", "/w", { from: "a", to: "b" }, "a.ts", "", false])).toBe(false);
    expect(stale(client, ["changeset", "/other", { worktree: "all" }])).toBe(false);
    expect(stale(client, ["log", "/w", "", 200])).toBe(false);
  });

  it("a refs event additionally stales that worktree's history", () => {
    const { client } = seeded();
    invalidateFor(client, { worktree: "/w", kind: "refs" });
    expect(stale(client, ["log", "/w", "", 200])).toBe(true);
    expect(stale(client, ["log", "/other", "", 200])).toBe(false);
    expect(stale(client, ["changeset", "/w", { worktree: "all" }])).toBe(true);
  });
});
