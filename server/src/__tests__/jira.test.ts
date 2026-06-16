import { buildJql } from "../jira";

describe("buildJql", () => {
  const board = { key: "PP", name: "PracticePal", statuses: ["To Do", "In Progress"] };

  it("filters by project and the board's statuses, ordered by Rank", () => {
    expect(buildJql(board, false)).toBe(
      'project = "PP" AND status in ("To Do", "In Progress") ORDER BY Rank ASC',
    );
  });

  it("adds the current-user clause when myTicketsOnly is set", () => {
    expect(buildJql(board, true)).toContain("assignee = currentUser()");
  });

  it("escapes quotes in status names", () => {
    const jql = buildJql({ key: "X", name: "X", statuses: ['Needs "review"'] }, false);
    expect(jql).toContain('status in ("Needs \\"review\\"")');
  });
});
