import { useEffect, useState } from "react";

/** True while the media query matches; false when matchMedia is unavailable. */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof matchMedia !== "undefined" && matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [query]);
  return matches;
}

/** Layout breakpoints shared by CSS and components. */
export const BREAKPOINTS = {
  /** Below this the file list stacks above the diff. */
  tablet: "(max-width: 1100px)",
  /** Below this the history stacks above the content. */
  phone: "(max-width: 760px)",
};
