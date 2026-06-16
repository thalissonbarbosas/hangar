import os from "os";
import path from "path";
import { expandHome, boardPaths } from "../config";

describe("expandHome", () => {
  it("expands a leading ~", () => {
    expect(expandHome("~")).toBe(os.homedir());
    expect(expandHome("~/dev/repo")).toBe(path.join(os.homedir(), "dev/repo"));
  });

  it("leaves absolute and relative paths untouched", () => {
    expect(expandHome("/abs/path")).toBe("/abs/path");
    expect(expandHome("relative/path")).toBe("relative/path");
  });
});

describe("boardPaths", () => {
  it("returns [] for a missing board", () => {
    expect(boardPaths(undefined)).toEqual([]);
  });

  it("prefers repoPaths and home-expands each", () => {
    expect(boardPaths({ repoPaths: ["~/a", "/b"], repoPath: "~/legacy" })).toEqual([
      path.join(os.homedir(), "a"),
      "/b",
    ]);
  });

  it("falls back to the legacy single repoPath", () => {
    expect(boardPaths({ repoPath: "~/x" })).toEqual([path.join(os.homedir(), "x")]);
  });
});
