import Link from "next/link";
import type { ReactNode } from "react";

export type FeatureCardProps = {
  title: string;
  description: string;
};

export function FeatureCard({ title, description }: FeatureCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 p-6 shadow-sm dark:border-slate-800">
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{description}</p>
    </div>
  );
}

export type PricingCardProps = {
  name: string;
  price: string;
  features: ReactNode;
  highlight?: boolean;
};

export function PricingCard({ name, price, features, highlight }: PricingCardProps) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 p-6 ${highlight ? "shadow-sm" : ""} dark:border-slate-800`}
    >
      <div className="text-sm font-semibold">{name}</div>
      <div className="mt-2 text-3xl font-bold">{price}</div>
      <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">{features}</div>
      {highlight && (
        <div className="mt-6">
          <Link
            href="/dashboard"
            className="inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white no-underline hover:opacity-90 dark:bg-white dark:text-slate-900"
          >
            はじめる
          </Link>
        </div>
      )}
    </div>
  );
}

export type FaqItemProps = {
  question: string;
  answer: string;
};

export function FaqItem({ question, answer }: FaqItemProps) {
  return (
    <details className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
      <summary className="cursor-pointer text-sm font-semibold">{question}</summary>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{answer}</p>
    </details>
  );
}
