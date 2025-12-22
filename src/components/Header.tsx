import Link from "next/link";
import ThemeToggle from "./theme-toggle";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="no-underline">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-slate-900 dark:bg-slate-50" />
            <div className="leading-tight">
              <div className="text-sm font-semibold">My App</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Documentation
              </div>
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          <a href="#features" className="text-sm text-slate-600 no-underline hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
            特長
          </a>
          <a href="#pricing" className="text-sm text-slate-600 no-underline hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
            料金
          </a>
          <a href="#faq" className="text-sm text-slate-600 no-underline hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
            FAQ
          </a>
          <Link
            href="/dashboard"
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white no-underline hover:opacity-90 dark:bg-white dark:text-slate-900"
          >
            ダッシュボード
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/dashboard"
            className="md:hidden rounded-full bg-slate-900 px-3 py-2 text-sm font-medium text-white no-underline hover:opacity-90 dark:bg-white dark:text-slate-900"
          >
            開く
          </Link>
        </div>
      </div>
    </header>
  );
}
