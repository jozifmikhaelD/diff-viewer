import { useEffect, useRef, useState } from "react";

const SHORTCUTS: [string, string][] = [
  ["j / k", "next / previous hunk"],
  ["n / p", "next / previous file"],
  ["/", "focus the file filter"],
  ["m", "toggle the dependency map"],
  ["f", "toggle the flow diagram"],
  ["shift + click", "select a commit range"],
  ["double-click a file", "whole file with blame"],
  ["? ", "this list"],
];

/** "?" button with a popover listing keyboard shortcuts; also opens on the ? key. */
export function Shortcuts() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (e.key === "?" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, []);
  return (
    <div className="repo-switcher shortcuts" ref={ref}>
      <button type="button" className="ghost" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
        ?
      </button>
      {open && (
        <div className="popover shortcuts-popover" role="dialog" aria-label="Keyboard shortcuts">
          <table>
            <tbody>
              {SHORTCUTS.map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k.trim()}</kbd>
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
