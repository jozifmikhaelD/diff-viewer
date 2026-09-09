import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

afterEach(() => vi.unstubAllGlobals());

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: initial,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mql));
  return { set: (m: boolean) => act(() => { mql.matches = m; listeners.forEach((fn) => fn()); }) };
}

describe("useMediaQuery", () => {
  it("tracks the query and updates on change", () => {
    const mm = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(max-width: 760px)"));
    expect(result.current).toBe(false);
    mm.set(true);
    expect(result.current).toBe(true);
  });
  it("is false without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useMediaQuery("(max-width: 1px)"));
    expect(result.current).toBe(false);
  });
});
