import { useEffect } from "react";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * j / k move between hunks inside a scroll container, across every file
 * mounted in it. Hunk starts are marked with data-hunk-start.
 */
export function useHunkKeys(containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (e.key !== "j" && e.key !== "k") return;
      const c = containerRef.current;
      if (!c) return;
      const marks = [...c.querySelectorAll<HTMLElement>("[data-hunk-start]")];
      if (marks.length === 0) return;
      e.preventDefault();
      const top = c.getBoundingClientRect().top + 8;
      const rel = (el: HTMLElement) => el.getBoundingClientRect().top - top;
      const target = e.key === "j" ? marks.find((m) => rel(m) > 4) : [...marks].reverse().find((m) => rel(m) < -4);
      target?.scrollIntoView({ block: "start" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [containerRef]);
}

