// Read-only shell utilities that are safe to auto-run in gated permission mode. Anything not
// here (or any command with file-writing redirection / command substitution) prompts for approval.
const SAFE_BASH = new Set([
  "ls",
  "cd",
  "pwd",
  "cat",
  "bat",
  "head",
  "tail",
  "wc",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "find",
  "fd",
  "echo",
  "printf",
  "which",
  "type",
  "whereis",
  "file",
  "stat",
  "du",
  "df",
  "tree",
  "sort",
  "uniq",
  "cut",
  "tr",
  "comm",
  "join",
  "paste",
  "fold",
  "nl",
  "tac",
  "xxd",
  "od",
  "strings",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "date",
  "whoami",
  "id",
  "hostname",
  "uname",
  "jq",
  "yq",
  "column",
  "sha1sum",
  "sha256sum",
  "md5sum",
  "cksum",
  "true",
  "false",
  "test",
  "[",
  "seq",
  "expand",
  "diff",
  "cmp",
  "less",
  "more",
]);
const GIT_READ = new Set([
  "diff",
  "log",
  "show",
  "status",
  "blame",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "cat-file",
  "describe",
  "shortlog",
  "whatchanged",
  "grep",
]);
const GH_READ = new Set([
  "pr view",
  "pr diff",
  "pr list",
  "pr checks",
  "pr status",
  "repo view",
  "issue view",
  "issue list",
]);

function isSafeSegment(seg: string): boolean {
  const tokens = seg.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++; // skip VAR=val
  const c = tokens[i];
  if (!c) return false;
  const args = tokens.slice(i + 1);
  if (c === "git") {
    const sub = args.find((a) => !a.startsWith("-"));
    return !sub || GIT_READ.has(sub);
  }
  if (c === "gh") {
    const nf = args.filter((a) => !a.startsWith("-"));
    return GH_READ.has(`${nf[0] ?? ""} ${nf[1] ?? ""}`.trim());
  }
  if (c === "sed") return !args.some((a) => a === "-i" || a.startsWith("-i")); // sed -i writes
  return SAFE_BASH.has(c);
}

/** Conservative: a Bash command is "safe" only if every piece is a known read-only command. */
export function isSafeBashCommand(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  if (cmd.includes("$(") || cmd.includes("`")) return false; // command substitution — unknown contents
  if (/>\s*(?!&)/.test(cmd)) return false; // file-writing redirection (2>&1 is fine)
  const segments = cmd
    .replace(/&&|\|\|/g, "\n")
    .split(/[\n;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return segments.length > 0 && segments.every(isSafeSegment);
}
