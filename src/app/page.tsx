import { Pulse } from "@/components/Pulse";
import { loadDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function Page() {
  try {
    const initial = await loadDashboard();
    return <Pulse initial={initial} />;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <main className="flex h-dvh items-center justify-center p-8">
        <div
          className="max-w-md rounded-xl p-5"
          style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
        >
          <h1 className="text-base font-semibold" style={{ color: "var(--fail)" }}>
            Cannot reach the ops database
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            Check that <code>DATABASE_URL</code> is set and that the schema in{" "}
            <code>sql/001_init.sql</code> has been applied.
          </p>
          <pre
            className="mt-3 overflow-x-auto rounded-md p-3 font-mono text-[11px]"
            style={{ background: "var(--panel-2)", color: "var(--muted-2)" }}
          >
            {message}
          </pre>
        </div>
      </main>
    );
  }
}
