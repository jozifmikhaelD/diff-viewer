import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

vi.mock("../diff/highlight", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../diff/highlight")>();
  return { ...mod, tokenizeLines: async () => null };
});
