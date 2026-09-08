import type { Commit, Ref } from "../api";
import { CommitGraph, ROW_HEIGHT } from "./CommitGraph";
import type { LaneRow } from "./lanes";
import { relativeTime } from "../lib/time";

interface Props {
  commit: Commit;
  lane: LaneRow;
  laneCount: number;
  selected: boolean;
  onSelect: (sha: string) => void;
  style?: React.CSSProperties;
}

export function CommitRow({ commit, lane, laneCount, selected, onSelect, style }: Props) {
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      className={`commit-row${selected ? " selected" : ""}`}
      style={{ ...style, height: ROW_HEIGHT }}
      onClick={() => onSelect(commit.sha)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(commit.sha);
      }}
      data-sha={commit.sha}
    >
      <CommitGraph row={lane} laneCount={laneCount} />
      <span className="commit-refs">
        {commit.refs?.map((r) => <RefBadge key={`${r.kind}:${r.name}`} ref_={r} />)}
      </span>
      <span className="commit-subject" title={commit.subject}>
        {commit.subject}
      </span>
      <span className="commit-meta">
        <span className="commit-author">{commit.author.name}</span>
        <time dateTime={new Date(commit.author.time * 1000).toISOString()} title={new Date(commit.author.time * 1000).toLocaleString()}>
          {relativeTime(commit.author.time)}
        </time>
        <code className="commit-sha">{commit.sha.slice(0, 7)}</code>
      </span>
    </div>
  );
}

function RefBadge({ ref_ }: { ref_: Ref }) {
  return (
    <span className={`ref ref-${ref_.kind}${ref_.head ? " ref-head" : ""}`} title={`${ref_.kind}: ${ref_.name}`}>
      {ref_.name}
    </span>
  );
}
