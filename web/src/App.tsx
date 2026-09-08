import { useEffect, useState } from "react";
import { api, type Health, type RepoInfo } from "./api";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; health: Health; repo: RepoInfo };

export default function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.health(), api.repo()])
      .then(([health, repo]) => {
        if (!cancelled) setState({ status: "ready", health, repo });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="app">
      <header className="app-header">
        <h1>void</h1>
        {state.status === "ready" && <span className="version">v{state.health.version}</span>}
      </header>
      {state.status === "loading" && <p role="status">Connecting…</p>}
      {state.status === "error" && (
        <p role="alert" className="error">
          Could not reach the void server: {state.message}
        </p>
      )}
      {state.status === "ready" && (
        <section aria-label="repository">
          <dl>
            <dt>Repository</dt>
            <dd data-testid="repo-root">{state.repo.root}</dd>
            {state.repo.linkedWorktree && (
              <>
                <dt>Worktree of</dt>
                <dd>{state.repo.commonDir}</dd>
              </>
            )}
          </dl>
        </section>
      )}
    </main>
  );
}
