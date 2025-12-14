"use client";

import { useEffect, useMemo, useState } from "react";

function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") return saved;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  return prefersDark ? "dark" : "light";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const label = useMemo(() => (theme === "dark" ? "Dark" : "Light"), [theme]);

  useEffect(() => {
    const t = getInitialTheme();
    setTheme(t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    window.localStorage.setItem("theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-sm
                 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
      aria-label="Toggle theme"
    >
      <span className="h-2 w-2 rounded-full bg-slate-900 dark:bg-slate-50" />
      {label}
    </button>
  );
}
