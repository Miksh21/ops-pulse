"use client";

import { useState } from "react";

const PLACEHOLDERS: Record<string, string> = {
  vercel: `{
  "projectId": "prj_...",
  "teamId": "team_...",
  "prodUrl": "my-app.vercel.app",
  "tokenEnv": "VERCEL_API_TOKEN"
}`,
  n8n: `{
  "baseUrl": "https://n8n.example.com",
  "apiKeyEnv": "N8N_PERSONAL_API_KEY",
  "workflowId": "workflow-id"
}`,
  supabase: `{
  "url": "https://xxxx.supabase.co",
  "apiKeyEnv": "SUPABASE_ANON_KEY"
}`,
  lemlist: `{ "apiKeyEnv": "LEMLIST_API_KEY" }`,
  http: `{
  "url": "https://example.com/health",
  "expectStatus": 200
}`,
};

export function AddAgentDialog({
  onClose,
  onCreated,
  projects,
}: {
  onClose: () => void;
  onCreated: () => void;
  // Projects already in use, offered as autocomplete. Typing a new one is fine:
  // the column is free-form, so the set grows without a schema change.
  projects: string[];
}) {
  const [name, setName] = useState("");
  const [project, setProject] = useState(projects[0] ?? "personal");
  const [kind, setKind] = useState("pull");
  const [probe, setProbe] = useState("http");
  const [config, setConfig] = useState(PLACEHOLDERS.http);
  const [expected, setExpected] = useState("60");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function pickProbe(next: string) {
    setProbe(next);
    setConfig(PLACEHOLDERS[next] ?? "{}");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let parsed: unknown = {};
    if (kind === "pull") {
      try {
        parsed = JSON.parse(config || "{}");
      } catch {
        setError("Config is not valid JSON");
        return;
      }
    }

    setSaving(true);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        project,
        kind,
        probe,
        platform: kind === "push" ? "http" : probe,
        config: parsed,
        expected_every_min: kind === "push" ? Number(expected) || 60 : null,
      }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Failed (${res.status})`);
      return;
    }
    onCreated();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl p-5"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
      >
        <h2 className="text-base font-semibold">Add agent</h2>
        <p className="mt-1 text-xs" style={{ color: "var(--muted-2)" }}>
          Pull agents are probed by the 5-minute tick. Push agents get ping URLs
          to call themselves — use those for anything behind a VPN.
        </p>

        <div className="mt-4 space-y-3">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Lead Enrichment Flow"
              className="w-full rounded-md px-2.5 py-1.5 text-sm outline-none"
              style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--text)" }}
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Project">
              <input
                value={project}
                onChange={(e) => setProject(e.target.value)}
                list="ops-projects"
                required
                className="w-full rounded-md px-2.5 py-1.5 text-sm outline-none"
                style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--text)" }}
              />
              <datalist id="ops-projects">
                {projects.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>
            <Field label="Mode">
              <Select value={kind} onChange={setKind} options={["pull", "push"]} />
            </Field>
            {kind === "pull" ? (
              <Field label="Probe">
                <Select value={probe} onChange={pickProbe} options={["http", "vercel", "n8n", "supabase", "lemlist"]} />
              </Field>
            ) : (
              <Field label="Expect every (min)">
                <input
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  inputMode="numeric"
                  className="w-full rounded-md px-2.5 py-1.5 text-sm outline-none"
                  style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--text)" }}
                />
              </Field>
            )}
          </div>

          {kind === "pull" && (
            <Field label="Config (JSON)">
              <textarea
                value={config}
                onChange={(e) => setConfig(e.target.value)}
                rows={7}
                spellCheck={false}
                className="w-full rounded-md px-2.5 py-1.5 font-mono text-[11px] outline-none"
                style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--text)" }}
              />
            </Field>
          )}
        </div>

        {error && (
          <p className="mt-3 text-xs" style={{ color: "var(--fail)" }}>
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm"
            style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--muted)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--ok-soft)", color: "#fff" }}
          >
            {saving ? "Adding…" : "Add agent"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold tracking-wide" style={{ color: "var(--muted-2)" }}>
        {label.toUpperCase()}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md px-2.5 py-1.5 text-sm outline-none"
      style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--text)" }}
    >
      {options.map((o) => (
        <option key={o} value={o} style={{ background: "#141920" }}>
          {o}
        </option>
      ))}
    </select>
  );
}
