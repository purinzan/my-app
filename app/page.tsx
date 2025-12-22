import Header from "@/components/Header";
import { FaqItem, FeatureCard, PricingCard } from "@/components/home/cards";
import SiteFooter from "@/components/site-footer";
import Link from "next/link";

const HERO_TAGS = ["App Router", "TypeScript", "Tailwind"];

const FEATURES = [
  {
    title: "App Router前提",
    description: "layout/page/api で役割が明確あとから増やしても破綻しにくい。",
  },
  {
    title: "ダークモード",
    description: "依存なしでON/OFF。見た目の完成度が上がる。",
  },
  {
    title: "ダッシュボード枠",
    description: "アプリ側のレイアウトを先に用意。機能追加が速い。",
  },
];

const PRICING_PLANS = [
  {
    name: "Free",
    price: "$0",
    features: (
      <ul>
        <li>・基本機能</li>
        <li>・低めの上限</li>
      </ul>
    ),
  },
  {
    name: "Pro",
    price: "$9",
    features: (
      <ul>
        <li>・上限アップ</li>
        <li>・優先サポート</li>
      </ul>
    ),
    highlight: true,
  },
  {
    name: "Team",
    price: "$29",
    features: (
      <ul>
        <li>・チーム管理</li>
        <li>・請求書対応</li>
      </ul>
    ),
  },
];

const FAQS = [
  {
    question: "これは本番でも使える？",
    answer: "使えます。次のPhaseで認証/DB/課金/制限を積むと、SaaSの形になります。",
  },
  {
    question: "APIは動いてる？",
    answer: "/api/health にアクセスするとJSONが返ります。",
  },
];

function HeroPreview() {
  return (
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
  );
}

function HeroBadge() {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
      {HERO_TAGS.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen">
      <Header />

      <main className="mx-auto max-w-6xl px-4">
        <section className="py-16 md:py-24">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <HeroBadge />

              <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">
                ちゃんとした“土台”から作る
                <span className="block text-slate-500 dark:text-slate-400">Web版スターター</span>
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

            <HeroPreview />
          </div>
        </section>

        <section id="features" className="py-16">
          <h2 className="text-2xl font-bold">特長</h2>
          <p className="mt-2 text-slate-600 dark:text-slate-300">
            “後から育てやすい”ための最小セットを最初から入れています。
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <FeatureCard key={feature.title} title={feature.title} description={feature.description} />
            ))}
          </div>
        </section>

        <section id="pricing" className="py-16">
          <h2 className="text-2xl font-bold">料金（ダミー）</h2>
          <p className="mt-2 text-slate-600 dark:text-slate-300">
            Stripeを載せるPhaseで実際の価格に置き換えます。
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {PRICING_PLANS.map((plan) => (
              <PricingCard
                key={plan.name}
                name={plan.name}
                price={plan.price}
                features={plan.features}
                highlight={plan.highlight}
              />
            ))}
          </div>
        </section>

        <section id="faq" className="py-16">
          <h2 className="text-2xl font-bold">FAQ</h2>
          <div className="mt-6 space-y-4">
            {FAQS.map((faq) => (
              <FaqItem key={faq.question} question={faq.question} answer={faq.answer} />
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
