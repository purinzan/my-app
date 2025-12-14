export default function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 dark:border-slate-800">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <div className="text-sm font-semibold">My App</div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Next.js + TypeScript + Tailwind の堅めスターター。
              ここから認証・DB・課金を載せてSaaS化できます。
            </p>
          </div>

          <div className="text-sm">
            <div className="font-semibold">Links</div>
            <ul className="mt-2 space-y-2 text-slate-600 dark:text-slate-300">
              <li><a className="no-underline hover:underline" href="#features">特長</a></li>
              <li><a className="no-underline hover:underline" href="#pricing">料金</a></li>
              <li><a className="no-underline hover:underline" href="#faq">FAQ</a></li>
            </ul>
          </div>

          <div className="text-sm">
            <div className="font-semibold">Status</div>
            <p className="mt-2 text-slate-600 dark:text-slate-300">
              API確認: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-900">/api/health</code>
            </p>
          </div>
        </div>

        <div className="mt-10 text-xs text-slate-500 dark:text-slate-400">
          © {new Date().getFullYear()} My App
        </div>
      </div>
    </footer>
  );
}
