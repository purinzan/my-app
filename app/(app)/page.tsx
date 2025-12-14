import SiteHeader from "@/components/site-header";
import SiteFooter from "@/components/site-footer";
import Link from "next/link";

function Card({
  title,
  desc,
}: {
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 p-6 shadow-sm dark:border-slate-800">
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{desc}</p>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-4">
        {/* Hero */}
        <section className="py-16 md:py-24">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <p className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
                App Router / TypeScript / Tailwind
              </p>

              <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">
                ちゃんとした“土台”から作る
                <span className="block text-slate-500 dark:text-slate-400">
                  Web版スターター
                </span>
              </h1>

              <p className="mt-4 text-lg text-slate-600 dark:text-slate-300">
                まずはWeb版を最短で公開できる形に。
                次のPhaseで認証・DB・課金・レート制限を載せてSaaSにしていく。
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/dashboard"
                  className="rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white no-underline hover:opacity-90 dark:bg-white dark:text-slate-900"
                >
                  ダッシュボードへ
                </Link>
                <a
                  href="#features"
                  className="rounded-full border border-slate-200 px-5 py-3 text-sm font-medium text-slate-900 no-underline hover:bg-slate-50 dark:border-slate-800 dark:text-white dark:hover:bg-slate-900"
                >
                  特長を見る
                </a>
              </div>

              <div className="mt-6 text-xs text-slate-500 dark:text-slate-400">
                ローカル確認: <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-900">http://localhost:3000</code>
              </div>
            </div>

            {/* Hero visual */}
            <div className="rounded-3xl border border-slate-200 p-6 shadow-sm dark:border-slate-800">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Preview</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">v0</div>
              </div>
              <div className="mt-4 space-y-3">
                <div className="h-10 rounded-xl bg-slate-100 dark:bg-slate-900" />
                <div className="h-10 rounded-xl bg-slate-100 dark:bg-slate-900" />
                <div className="h-24 rounded-2xl bg-slate-100 dark:bg-slate-900" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="h-20 rounded-2xl bg-slate-100 dark:bg-slate-900" />
                  <div className="h-20 rounded-2xl bg-slate-100 dark:bg-slate-900" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-16">
          <h2 className="text-2xl font-bold">特長</h2>
          <p className="mt-2 text-slate-600 dark:text-slate-300">
            “後から育てやすい”ための最小セットを最初から入れています。
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <Card title="App Router前提" desc="layout/page/api で役割が明確。あとから増やしても破綻しにくい。" />
            <Card title="ダークモード" desc="依存なしでON/OFF。見た目の完成度が上がる。" />
            <Card title="ダッシュボード枠" desc="アプリ側のレイアウトを先に用意。機能追加が速い。" />
          </div>
        </section>

        {/* Pricing (ダミー) */}
        <section id="pricing" className="py-16">
          <h2 className="text-2xl font-bold">料金（ダミー）</h2>
          <p className="mt-2 text-slate-600 dark:text-slate-300">
            Stripeを載せるPhaseで実際の価格に置き換えます。
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 p-6 dark:border-slate-800">
              <div className="text-sm font-semibold">Free</div>
              <div className="mt-2 text-3xl font-bold">$0</div>
              <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <li>・基本機能</li>
                <li>・低めの上限</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200 p-6 shadow-sm dark:border-slate-800">
              <div className="text-sm font-semibold">Pro</div>
              <div className="mt-2 text-3xl font-bold">$9</div>
              <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <li>・上限アップ</li>
                <li>・優先サポート</li>
              </ul>
              <div className="mt-6">
                <Link
                  href="/dashboard"
                  className="inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white no-underline hover:opacity-90 dark:bg-white dark:text-slate-900"
                >
                  はじめる
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-6 dark:border-slate-800">
              <div className="text-sm font-semibold">Team</div>
              <div className="mt-2 text-3xl font-bold">$29</div>
              <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <li>・チーム管理</li>
                <li>・請求書対応</li>
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="py-16">
          <h2 className="text-2xl font-bold">FAQ</h2>
          <div className="mt-6 space-y-4">
            <details className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
              <summary className="cursor-pointer text-sm font-semibold">
                これは本番でも使える？
              </summary>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                使えます。次のPhaseで認証/DB/課金/制限を積むと、SaaSの形になります。
              </p>
            </details>

            <details className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
              <summary className="cursor-pointer text-sm font-semibold">
                APIは動いてる？
              </summary>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-900">/api/health</code> にアクセスするとJSONが返ります。
              </p>
            </details>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
