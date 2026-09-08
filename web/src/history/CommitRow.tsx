import type { Commit, Ref } from "../api";
import { CommitGraph } from "./CommitGraph";
import { ROW_HEIGHT } from "./lanes";
import type { LaneRow } from "./lanes";
import { relativeTime } from "../lib/time";

interface Props {
  commit: Commit;
  /** Omitted when the list is filtered (not a connected graph): a plain dot is drawn instead. */
  lane?: LaneRow;
  laneCount: number;
  selected: boolean;
  inRange?: boolean;
  onSelect: (sha: string, shift: boolean) => void;
  style?: React.CSSProperties;
}

export function CommitRow({ commit, lane, laneCount, selected, inRange = false, onSelect, style }: Props) {
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      className={`commit-row${selected ? " selected" : ""}${inRange ? " in-range" : ""}`}
      style={{ ...style, height: ROW_HEIGHT }}
      title="Click to select · Shift+click to select a range"
      onClick={(e) => onSelect(commit.sha, e.shiftKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(commit.sha, e.shiftKey);
      }}
      data-sha={commit.sha}
    >
      {lane ? <CommitGraph row={lane} laneCount={laneCount} /> : <span className="commit-dot" aria-hidden="true" />}
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
