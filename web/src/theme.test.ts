import { describe, expect, it } from "vitest";
import { loadTheme, resolveScheme } from "./theme";

describe("theme", () => {
  it("resolves system to the OS scheme and explicit choices to themselves", () => {
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", "light")).toBe("light");
    expect(resolveScheme("light", "dark")).toBe("light");
    expect(resolveScheme("dark", "light")).toBe("dark");
  });
  it("falls back to system for missing or bogus stored values", () => {
    localStorage.removeItem("void.theme");
    expect(loadTheme()).toBe("system");
    localStorage.setItem("void.theme", "bogus");
    expect(loadTheme()).toBe("system");
    localStorage.setItem("void.theme", "dark");
    expect(loadTheme()).toBe("dark");
    localStorage.removeItem("void.theme");
  });
});
