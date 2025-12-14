import DashboardClient from "./dashboard-client";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold">ダッシュボード</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          ここに次のPhase（認証/DB/Stripe/Upstash）を載せていきます。
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="text-sm font-semibold">Phase 1</div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">ログイン（認証）</div>
          </div>
          <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="text-sm font-semibold">Phase 2</div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">DB（Turso/Drizzle）</div>
          </div>
          <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="text-sm font-semibold">Phase 5</div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">Stripe課金</div>
          </div>
        </div>
      </section>

      {/* ここから動く部分 */}
      <DashboardClient />
    </div>
  );
}
