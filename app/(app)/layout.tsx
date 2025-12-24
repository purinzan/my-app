import Link from "next/link";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="flex items-center justify-between">
          
          <div className="flex items-center gap-3">
            <Link className="text-sm text-slate-600 no-underline hover:underline dark:text-slate-300" href="/">
              ← 戻る
            </Link>
          </div>
        </div>

        <div className="mt-6 rounded-3xl  border-slate-200 p-6 shadow-sm dark:border-slate-800">
          {children}
        </div>
      </div>
    </div>
  );
}
