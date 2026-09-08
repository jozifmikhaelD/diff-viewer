import { useMemo, useState } from "react";
import type { FileChange, FileStatus } from "../api";
import { buildTree, matchesFilter, type TreeNode } from "./summary";

export type FileView = "tree" | "flat";

interface Props {
  files: FileChange[];
  filter: string;
  onFilterChange: (f: string) => void;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  view: FileView;
  onViewChange: (v: FileView) => void;
}

const STATUS_LABEL: Record<FileStatus, string> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
  U: "conflict",
  "?": "untracked",
};

export function FileList({ files, filter, onFilterChange, selectedPath, onSelect, view, onViewChange }: Props) {
  const visible = useMemo(() => files.filter((f) => matchesFilter(f, filter)), [files, filter]);
  const maxChurn = useMemo(() => Math.max(1, ...files.map((f) => f.additions + f.deletions)), [files]);
  const tree = useMemo(() => (view === "tree" ? buildTree(visible) : []), [view, visible]);

  return (
    <section className="file-list" aria-label="Changed files">
      <div className="file-list-toolbar">
        <input
          type="search"
          placeholder="Filter files…"
          aria-label="Filter files"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
        />
        <div className="segmented" role="radiogroup" aria-label="File view">
          {(["tree", "flat"] as FileView[]).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              className={view === v ? "on" : ""}
              onClick={() => onViewChange(v)}
            >
              {v === "tree" ? "Tree" : "Flat"}
            </button>
          ))}
        </div>
      </div>
      {files.length === 0 && <p className="empty">No changes.</p>}
      {files.length > 0 && visible.length === 0 && <p className="empty">No files match “{filter}”.</p>}
      <ul className="file-tree" role="tree">
        {view === "flat"
          ? visible.map((f) => (
              <FileRow key={f.path} file={f} depth={0} maxChurn={maxChurn} selected={f.path === selectedPath} onSelect={onSelect} showDir />
            ))
          : tree.map((n) => (
              <TreeRow key={n.path} node={n} depth={0} maxChurn={maxChurn} selectedPath={selectedPath} onSelect={onSelect} />
            ))}
      </ul>
    </section>
  );
}

function TreeRow({
  node,
  depth,
  maxChurn,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  maxChurn: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  if (node.kind === "file") {
    return <FileRow file={node.file} depth={depth} maxChurn={maxChurn} selected={node.path === selectedPath} onSelect={onSelect} />;
  }
  return (
    <li role="treeitem" aria-expanded={open} className="dir-item">
      <button type="button" className="dir-row" style={{ paddingLeft: depth * 16 + 8 }} onClick={() => setOpen(!open)}>
        <span className={`chevron${open ? " open" : ""}`} aria-hidden="true" />
        <span className="dir-name">{node.name}</span>
        <span className="dir-count">{node.files}</span>
        <span className="file-stat">
          <span className="stat-add">+{node.additions}</span> <span className="stat-del">−{node.deletions}</span>
        </span>
      </button>
      {open && (
        <ul role="group">
          {node.children.map((c) => (
            <TreeRow key={c.path} node={c} depth={depth + 1} maxChurn={maxChurn} selectedPath={selectedPath} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

function FileRow({
  file,
  depth,
  maxChurn,
  selected,
  onSelect,
  showDir = false,
}: {
  file: FileChange;
  depth: number;
  maxChurn: number;
  selected: boolean;
  onSelect: (path: string) => void;
  showDir?: boolean;
}) {
  const slash = file.path.lastIndexOf("/");
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? file.path.slice(slash + 1) : file.path;
  const churn = file.additions + file.deletions;
  const scale = Math.min(1, churn / maxChurn);
  return (
    <li role="treeitem" aria-selected={selected} className={`file-item${selected ? " selected" : ""}`} data-path={file.path}>
      <button type="button" className="file-row" style={{ paddingLeft: depth * 16 + 8 }} onClick={() => onSelect(file.path)}>
        <span className={`status status-${file.status === "?" ? "untracked" : file.status}`} title={STATUS_LABEL[file.status]}>
          {file.status === "?" ? "U" : file.status}
        </span>
        <span className="file-name" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
          {showDir && <span className="file-dir">{dir}</span>}
          {name}
          {file.oldPath && <span className="file-from"> ← {file.oldPath}</span>}
          {file.submodule && <span className="file-note">submodule</span>}
          {file.binary && <span className="file-note">binary</span>}
        </span>
        <span className="file-stat">
          {!file.binary && (
            <>
              <span className="stat-add">+{file.additions}</span> <span className="stat-del">−{file.deletions}</span>
            </>
          )}
          <span className="churn-mini" aria-hidden="true">
            <span className="churn-add" style={{ width: `${churn ? (file.additions / churn) * scale * 100 : 0}%` }} />
            <span className="churn-del" style={{ width: `${churn ? (file.deletions / churn) * scale * 100 : 0}%` }} />
          </span>
        </span>
      </button>
    </li>
  );
}
