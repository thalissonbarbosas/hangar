import { isSafeBashCommand } from "../safe-shell";

describe("isSafeBashCommand", () => {
  it("allows read-only commands", () => {
    expect(isSafeBashCommand("ls -la")).toBe(true);
    expect(isSafeBashCommand("cat file.txt")).toBe(true);
    expect(isSafeBashCommand("grep -r foo src")).toBe(true);
    expect(isSafeBashCommand("git status")).toBe(true);
    expect(isSafeBashCommand("git")).toBe(true); // git with no subcommand
    expect(isSafeBashCommand("git diff | grep foo")).toBe(true);
    expect(isSafeBashCommand("gh pr diff")).toBe(true);
    expect(isSafeBashCommand("FOO=bar ls")).toBe(true); // leading VAR=val is skipped
    expect(isSafeBashCommand("cat file 2>&1")).toBe(true); // 2>&1 is not file-writing
    expect(isSafeBashCommand("sed 's/a/b/' f")).toBe(true); // sed without -i only reads
    expect(isSafeBashCommand("git status && git diff")).toBe(true); // every segment safe
  });

  it("blocks mutating, unknown, or injectable commands", () => {
    expect(isSafeBashCommand("rm -rf /")).toBe(false);
    expect(isSafeBashCommand("npm install")).toBe(false);
    expect(isSafeBashCommand("git push")).toBe(false);
    expect(isSafeBashCommand("gh pr create")).toBe(false);
    expect(isSafeBashCommand("gh")).toBe(false); // gh with no subcommand
    expect(isSafeBashCommand("gh pr")).toBe(false); // gh with only one token
    expect(isSafeBashCommand("sed -i 's/a/b/' f")).toBe(false); // -i writes in place
    expect(isSafeBashCommand("echo hi > out.txt")).toBe(false); // file-writing redirection
    expect(isSafeBashCommand("cat $(whoami)")).toBe(false); // command substitution
    expect(isSafeBashCommand("cat `whoami`")).toBe(false); // backtick substitution
    expect(isSafeBashCommand("ls && rm file")).toBe(false); // one unsafe segment taints all
  });

  it("rejects empty or command-less input", () => {
    expect(isSafeBashCommand("")).toBe(false);
    expect(isSafeBashCommand("   ")).toBe(false);
    expect(isSafeBashCommand(";")).toBe(false); // splits to no real segments
    expect(isSafeBashCommand("FOO=bar")).toBe(false); // only an assignment, no command
  });
});
