import { vi } from "vitest";

export interface Route {
  status?: number;
  body: unknown;
}

/**
 * Stubs global fetch. Routes are matched by pathname first, then by full
 * `pathname?search`; the most specific match wins.
 */
export function mockFetch(routes: Record<string, Route | ((url: URL) => Route)>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const raw = typeof input === "string" ? input : input.toString();
      const url = new URL(raw, "http://test");
      calls.push(url.pathname + url.search);
      const entry = routes[url.pathname + url.search] ?? routes[url.pathname];
      if (!entry) throw new Error(`unexpected fetch ${raw}`);
      const route = typeof entry === "function" ? entry(url) : entry;
      const status = route.status ?? 200;
      return new Response(JSON.stringify(route.body), {
        status,
        statusText: status === 200 ? "OK" : "Error",
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}
