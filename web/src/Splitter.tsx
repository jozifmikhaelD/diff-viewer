import { useEffect, useRef, useState } from "react";

interface Props {
  /** Current width of the pane to the left of the handle. */
  width: number;
  onChange: (w: number) => void;
  onReset: () => void;
  label: string;
  min: number;
  max: number;
}

const KEY_STEP = 16;

/** Vertical drag handle; also adjustable with arrow keys, double-click resets. */
export function Splitter({ width, onChange, onReset, label, min, max }: Props) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      if (!start.current) return;
      onChange(start.current.width + (e.clientX - start.current.x));
    };
    const onUp = () => {
      start.current = null;
      setDragging(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, onChange]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={`splitter${dragging ? " dragging" : ""}`}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        start.current = { x: e.clientX, width };
        setDragging(true);
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(width - KEY_STEP);
        else if (e.key === "ArrowRight") onChange(width + KEY_STEP);
        else if (e.key === "Home") onChange(min);
        else if (e.key === "End") onChange(max);
        else return;
        e.preventDefault();
      }}
    />
  );
}
