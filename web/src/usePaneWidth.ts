import { useCallback, useState } from "react";

interface Options {
  key: string; // localStorage key
  initial: number;
  min: number;
  max: number;
}

/** A persisted pane width in pixels, clamped to [min, max]. */
export function usePaneWidth({ key, initial, min, max }: Options): [number, (w: number) => void, () => void] {
  const clamp = useCallback((w: number) => Math.round(Math.min(max, Math.max(min, w))), [min, max]);
  const [width, setWidthState] = useState(() => {
    try {
      const v = Number(localStorage.getItem(key));
      return v > 0 ? clamp(v) : initial;
    } catch {
      return initial;
    }
  });
  const setWidth = useCallback(
    (w: number) => {
      const c = clamp(w);
      setWidthState(c);
      try {
        localStorage.setItem(key, String(c));
      } catch {
        // storage unavailable
      }
    },
    [clamp, key],
  );
  const reset = useCallback(() => {
    setWidthState(initial);
    try {
      localStorage.removeItem(key);
    } catch {
      // storage unavailable
    }
  }, [initial, key]);
  return [width, setWidth, reset];
}
