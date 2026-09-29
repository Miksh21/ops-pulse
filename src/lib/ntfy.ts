import { timedFetch } from "./probes/fetchers";

/**
 * Publish one message to the ntfy topic at NTFY_URL. Returns null when ntfy
 * accepted it, otherwise why not. Never throws: a broken alert channel must
 * not take the tick or a request down with it; the caller records the reason.
 */
export async function publish(msg: {
  title: string;
  body: string;
  priority: 4 | 5;
  tags: string;
}): Promise<string | null> {
  const url = process.env.NTFY_URL;
  const token = process.env.NTFY_TOKEN;
  if (!url || !token) return "NTFY_URL or NTFY_TOKEN is not set";

  const res = await timedFetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      // Header values are byte strings; names with "·" or "—" go in the body.
      title: msg.title.replace(/[^\x20-\x7e]/g, "?"),
      priority: String(msg.priority),
      tags: msg.tags,
    },
    body: msg.body.slice(0, 3_500),
  });
  return res.ok ? null : res.error ?? `ntfy HTTP ${res.status}`;
}
