/** Maps a file path to a display language and a stable colour. */
export interface Language {
  name: string;
  color: string;
}

const BY_EXT: Record<string, Language> = {
  ts: { name: "TypeScript", color: "#3178c6" },
  tsx: { name: "TypeScript", color: "#3178c6" },
  mts: { name: "TypeScript", color: "#3178c6" },
  js: { name: "JavaScript", color: "#f1e05a" },
  jsx: { name: "JavaScript", color: "#f1e05a" },
  mjs: { name: "JavaScript", color: "#f1e05a" },
  cjs: { name: "JavaScript", color: "#f1e05a" },
  py: { name: "Python", color: "#3572a5" },
  go: { name: "Go", color: "#00add8" },
  java: { name: "Java", color: "#b07219" },
  kt: { name: "Kotlin", color: "#a97bff" },
  rs: { name: "Rust", color: "#dea584" },
  rb: { name: "Ruby", color: "#701516" },
  php: { name: "PHP", color: "#4f5d95" },
  cs: { name: "C#", color: "#178600" },
  c: { name: "C", color: "#555555" },
  h: { name: "C", color: "#555555" },
  cpp: { name: "C++", color: "#f34b7d" },
  hpp: { name: "C++", color: "#f34b7d" },
  swift: { name: "Swift", color: "#f05138" },
  css: { name: "CSS", color: "#663399" },
  scss: { name: "SCSS", color: "#c6538c" },
  html: { name: "HTML", color: "#e34c26" },
  vue: { name: "Vue", color: "#41b883" },
  svelte: { name: "Svelte", color: "#ff3e00" },
  md: { name: "Markdown", color: "#083fa1" },
  json: { name: "JSON", color: "#292929" },
  yml: { name: "YAML", color: "#cb171e" },
  yaml: { name: "YAML", color: "#cb171e" },
  toml: { name: "TOML", color: "#9c4221" },
  sh: { name: "Shell", color: "#89e051" },
  bash: { name: "Shell", color: "#89e051" },
  zsh: { name: "Shell", color: "#89e051" },
  sql: { name: "SQL", color: "#e38c00" },
  xml: { name: "XML", color: "#0060ac" },
  tf: { name: "Terraform", color: "#7b42bc" },
  proto: { name: "Protobuf", color: "#5c6bc0" },
};

const BY_NAME: Record<string, Language> = {
  Makefile: { name: "Makefile", color: "#427819" },
  Dockerfile: { name: "Dockerfile", color: "#384d54" },
};

export const OTHER: Language = { name: "Other", color: "#8b8b8b" };

export function languageOf(path: string): Language {
  const base = path.split("/").pop() ?? path;
  if (BY_NAME[base]) return BY_NAME[base];
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return OTHER;
  return BY_EXT[base.slice(dot + 1).toLowerCase()] ?? OTHER;
}
