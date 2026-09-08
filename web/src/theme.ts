import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";
export type Scheme = "light" | "dark";

const KEY = "void.theme";

export function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function systemScheme(): Scheme {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Resolves a theme choice to the concrete scheme in effect. */
export function resolveScheme(theme: Theme, system: Scheme): Scheme {
  return theme === "system" ? system : theme;
}

/** Theme preference with persistence; applies data-theme on <html>. */
export function useTheme(): { theme: Theme; scheme: Scheme; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  const [system, setSystem] = useState<Scheme>(systemScheme);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  const scheme = resolveScheme(theme, system);
  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
  }, [scheme]);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // storage unavailable
    }
  };
  return { theme, scheme, setTheme };
}
