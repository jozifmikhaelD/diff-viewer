import type { LaneRow } from "./lanes";
import { laneColor } from "./lanes";

export const LANE_WIDTH = 14;
export const ROW_HEIGHT = 30;

/** SVG for one row of the commit graph. */
export function CommitGraph({ row, laneCount }: { row: LaneRow; laneCount: number }) {
  const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
  const cx = x(row.lane);
  const mid = ROW_HEIGHT / 2;
  const width = Math.max(laneCount, row.width) * LANE_WIDTH;
  return (
    <svg
      className="commit-graph"
      width={width}
      height={ROW_HEIGHT}
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      aria-hidden="true"
    >
      {row.through.map((lane) => (
        <line key={`t${lane}`} x1={x(lane)} y1={0} x2={x(lane)} y2={ROW_HEIGHT} stroke={laneColor(lane)} strokeWidth={2} />
      ))}
      {row.incoming.map((lane) => (
        <path
          key={`i${lane}`}
          d={`M ${x(lane)} 0 C ${x(lane)} ${mid} ${cx} 0 ${cx} ${mid}`}
          fill="none"
          stroke={laneColor(lane)}
          strokeWidth={2}
        />
      ))}
      {row.outgoing.map((lane) => (
        <path
          key={`o${lane}`}
          d={`M ${cx} ${mid} C ${cx} ${ROW_HEIGHT} ${x(lane)} ${mid} ${x(lane)} ${ROW_HEIGHT}`}
          fill="none"
          stroke={laneColor(lane)}
          strokeWidth={2}
        />
      ))}
      <circle cx={cx} cy={mid} r={4} fill={laneColor(row.lane)} stroke="var(--bg)" strokeWidth={1.5} />
    </svg>
  );
}
