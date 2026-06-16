import { isSafeBashCommand, mapModel } from "../sessions";

describe("isSafeBashCommand", () => {
  it("allows read-only commands", () => {
    expect(isSafeBashCommand("ls -la")).toBe(true);
    expect(isSafeBashCommand("cat file.txt")).toBe(true);
    expect(isSafeBashCommand("grep -r foo src")).toBe(true);
    expect(isSafeBashCommand("git status")).toBe(true);
    expect(isSafeBashCommand("git diff | grep foo")).toBe(true);
    expect(isSafeBashCommand("gh pr diff")).toBe(true);
    expect(isSafeBashCommand("FOO=bar ls")).toBe(true); // leading VAR=val is skipped
    expect(isSafeBashCommand("cat file 2>&1")).toBe(true); // 2>&1 is not file-writing
  });

  it("blocks mutating, unknown, or injectable commands", () => {
    expect(isSafeBashCommand("rm -rf /")).toBe(false);
    expect(isSafeBashCommand("npm install")).toBe(false);
    expect(isSafeBashCommand("git push")).toBe(false);
    expect(isSafeBashCommand("gh pr create")).toBe(false);
    expect(isSafeBashCommand("sed -i 's/a/b/' f")).toBe(false); // -i writes in place
    expect(isSafeBashCommand("echo hi > out.txt")).toBe(false); // file-writing redirection
    expect(isSafeBashCommand("cat $(whoami)")).toBe(false); // command substitution
    expect(isSafeBashCommand("cat `whoami`")).toBe(false); // backtick substitution
    expect(isSafeBashCommand("")).toBe(false);
  });

  it("requires every segment to be safe", () => {
    expect(isSafeBashCommand("ls && rm file")).toBe(false);
    expect(isSafeBashCommand("git status && git diff")).toBe(true);
  });
});

describe("mapModel", () => {
  it("maps short aliases to current model ids", () => {
    expect(mapModel("opus")).toBe("claude-opus-4-8");
    expect(mapModel("sonnet")).toBe("claude-sonnet-4-6");
    expect(mapModel("haiku")).toBe("claude-haiku-4-5");
    expect(mapModel("OPUS")).toBe("claude-opus-4-8"); // case-insensitive
  });

  it("passes through full ids and handles undefined", () => {
    expect(mapModel("claude-custom-1")).toBe("claude-custom-1");
    expect(mapModel(undefined)).toBeUndefined();
  });
});
