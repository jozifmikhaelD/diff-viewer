import { describe, expect, it } from "vitest";
import { relativeTime } from "./time";

describe("relativeTime", () => {
  const now = 1_700_000_000;
  it.each([
    [now - 5, "just now"],
    [now - 60, "1 minute ago"],
    [now - 3 * 3600, "3 hours ago"],
    [now - 86400, "yesterday"],
    [now - 3 * 86400, "3 days ago"],
    [now - 2 * 604800, "2 weeks ago"],
    [now - 40 * 86400, "last month"],
    [now - 3 * 31536000, "3 years ago"],
    [now + 7200, "in 2 hours"],
  ])("formats %i as %s", (t, want) => {
    expect(relativeTime(t, now)).toBe(want);
  });
});
