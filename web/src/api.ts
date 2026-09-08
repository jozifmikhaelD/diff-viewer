export interface Health {
  ok: boolean;
  version: string;
}

export interface RepoInfo {
  root: string;
  gitDir: string;
  commonDir: string;
  linkedWorktree: boolean;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body; keep status text
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => getJSON<Health>("/api/health"),
  repo: () => getJSON<RepoInfo>("/api/repo"),
};
