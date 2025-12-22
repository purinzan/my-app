import DashboardClient from "./dashboard-client";

export default function DashboardPage() {
  return (
    <div className="space-y-8">


      {/* ここから動く部分 */}
      <div className="min-w-0">
        <DashboardClient />
      </div>
    </div>
  );
}
