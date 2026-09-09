import type { Totals } from "../api";
import type { LanguageStat } from "./summary";

interface Props {
  totals: Totals;
  languages: LanguageStat[];
  children?: React.ReactNode;
}

const fmt = new Intl.NumberFormat("en");

export function StatsBanner({ totals, languages, children }: Props) {
  const churn = totals.additions + totals.deletions;
  const addPct = churn ? (totals.additions / churn) * 100 : 0;
  return (
    <section className="stats" aria-label="Changeset totals">
      <div className="stats-numbers">
        <span className="stat" title="Files added, modified, deleted or renamed in this selection">
          <strong data-testid="stat-files">{fmt.format(totals.files)}</strong> {totals.files === 1 ? "file" : "files"} changed
        </span>
        <span className="stat stat-add" data-testid="stat-additions" title="Lines added">
          +{fmt.format(totals.additions)}
        </span>
        <span className="stat stat-del" data-testid="stat-deletions" title="Lines deleted">
          −{fmt.format(totals.deletions)}
        </span>
        {churn > 0 && (
          <span className="churn-bar" role="img" aria-label={`${Math.round(addPct)}% additions`} title={`${Math.round(addPct)}% of changed lines are additions`}>
            <span className="churn-add" style={{ width: `${addPct}%` }} />
          </span>
        )}
      </div>
      {languages.length > 0 && (
        <ul className="lang-chips" aria-label="Languages">
          {languages.slice(0, 6).map((l) => (
            <li key={l.name} className="lang-chip" title={`${l.files} ${l.files === 1 ? "file" : "files"}, +${l.additions} −${l.deletions}`}>
              <span className="lang-dot" style={{ background: l.color }} />
              {l.name}
              <span className="lang-count">{l.files}</span>
            </li>
          ))}
          {languages.length > 6 && <li className="lang-chip lang-more">+{languages.length - 6} more</li>}
        </ul>
      )}
      {children && (
        <>
          <span className="spacer" />
          {children}
        </>
      )}
    </section>
  );
}
