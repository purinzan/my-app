"use client";

import { useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  const saved = window.localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") return saved;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  return prefersDark ? "dark" : "light";
}

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setMounted(true);
    const t = getInitialTheme();
    setTheme(t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, []);

  const label = useMemo(() => (theme === "dark" ? "Dark" : "Light"), [theme]);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    window.localStorage.setItem("theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  // ★ これが肝：SSRと最初のクライアント描画を一致させる
  if (!mounted) {
    return (
      <span className="inline-flex h-[34px] w-[92px] rounded-full border border-slate-200 dark:border-slate-800" />
    );
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
