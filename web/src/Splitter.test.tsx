import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Splitter } from "./Splitter";
import { usePaneWidth } from "./usePaneWidth";

function Harness({ initial = 300 }: { initial?: number }) {
  const [width, setWidth, reset] = usePaneWidth({ key: "test.width", initial, min: 200, max: 600 });
  return (
    <div>
      <span data-testid="w">{width}</span>
      <Splitter width={width} onChange={setWidth} onReset={reset} label="Resize test" min={200} max={600} />
    </div>
  );
}

afterEach(() => localStorage.clear());

describe("Splitter", () => {
  it("drags to resize, clamps, persists, and resets on double-click", () => {
    render(<Harness />);
    const handle = screen.getByRole("separator", { name: "Resize test" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 300 });
    fireEvent.pointerMove(document, { clientX: 380 });
    expect(screen.getByTestId("w")).toHaveTextContent("380");
    fireEvent.pointerMove(document, { clientX: 2000 });
    expect(screen.getByTestId("w")).toHaveTextContent("600"); // clamped to max
    fireEvent.pointerUp(document);
    expect(localStorage.getItem("test.width")).toBe("600");
    expect(handle).toHaveAttribute("aria-valuenow", "600");
    fireEvent.doubleClick(handle);
    expect(screen.getByTestId("w")).toHaveTextContent("300");
    expect(localStorage.getItem("test.width")).toBeNull();
  });

  it("restores a persisted width and supports keyboard adjustment", () => {
    localStorage.setItem("test.width", "450");
    render(<Harness />);
    expect(screen.getByTestId("w")).toHaveTextContent("450");
    const handle = screen.getByRole("separator", { name: "Resize test" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(screen.getByTestId("w")).toHaveTextContent("434");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(screen.getByTestId("w")).toHaveTextContent("200");
    fireEvent.keyDown(handle, { key: "End" });
    expect(screen.getByTestId("w")).toHaveTextContent("600");
  });

  it("ignores stored values outside the range by clamping", () => {
    localStorage.setItem("test.width", "50");
    render(<Harness />);
    expect(screen.getByTestId("w")).toHaveTextContent("200");
  });
});
