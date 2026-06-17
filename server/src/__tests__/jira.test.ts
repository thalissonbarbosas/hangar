import {
  buildJql,
  fetchTickets,
  testConnection,
  listProjects,
  listStatuses,
  listTransitions,
  transitionIssue,
  fetchTicketPr,
} from "../jira";
import type { JiraEnv } from "../config";
import type { BoardConfig } from "../types";

const env: JiraEnv = {
  baseUrl: "https://x.atlassian.net",
  email: "a@b.com",
  token: "tok",
  myTicketsOnly: false,
};

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}
function errResponse(status: number, text = "boom"): Response {
  return { ok: false, status, json: async () => ({}), text: async () => text } as Response;
}

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("buildJql", () => {
  const board: BoardConfig = { key: "PP", name: "PracticePal", statuses: ["To Do", "In Progress"] };
  it("filters by project and statuses, ordered by Rank", () => {
    expect(buildJql(board, false)).toBe(
      'project = "PP" AND status in ("To Do", "In Progress") ORDER BY Rank ASC',
    );
  });
  it("adds the current-user clause when myTicketsOnly", () => {
    expect(buildJql(board, true)).toContain("assignee = currentUser()");
  });
  it("escapes quotes in status names", () => {
    const jql = buildJql({ key: "X", name: "X", statuses: ['Needs "review"'] }, false);
    expect(jql).toContain('status in ("Needs \\"review\\"")');
  });
});

describe("fetchTickets", () => {
  it("maps issues to tickets across boards and sends the auth header", async () => {
    fetchMock.mockResolvedValue(
      okJson({
        issues: [
          {
            key: "PP-1",
            fields: {
              summary: "Fix login",
              status: { name: "In Progress" },
              assignee: { displayName: "Alex", avatarUrls: { "24x24": "a24", "32x32": "a32" } },
              issuetype: { name: "Bug" },
              priority: { name: "High" },
            },
          },
          { key: "PP-2", fields: {} }, // exercises all the ?? fallbacks
        ],
      }),
    );
    const boards: BoardConfig[] = [{ key: "PP", name: "PracticePal", statuses: ["In Progress"] }];
    const tickets = await fetchTickets(env, boards);
    expect(tickets).toHaveLength(2);
    expect(tickets[0]).toMatchObject({
      key: "PP-1",
      summary: "Fix login",
      status: "In Progress",
      assignee: "Alex",
      assigneeAvatar: "a24",
      issuetype: "Bug",
      priority: "High",
      boardKey: "PP",
      url: "https://x.atlassian.net/browse/PP-1",
    });
    expect(tickets[1]).toMatchObject({
      summary: "(no summary)",
      status: "Unknown",
      assignee: null,
      assigneeAvatar: null,
      issuetype: null,
      priority: null,
    });
    // POST to the new /search/jql endpoint with Basic auth
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x.atlassian.net/rest/api/3/search/jql");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });

  it("falls back to 32x32 avatar when 24x24 is absent", async () => {
    fetchMock.mockResolvedValue(
      okJson({
        issues: [
          { key: "PP-9", fields: { assignee: { displayName: "Sam", avatarUrls: { "32x32": "a32" } } } },
        ],
      }),
    );
    const tickets = await fetchTickets(env, [{ key: "PP", name: "PP", statuses: ["x"] }]);
    expect(tickets[0].assigneeAvatar).toBe("a32");
  });

  it("defaults issues to [] when missing", async () => {
    fetchMock.mockResolvedValue(okJson({}));
    const tickets = await fetchTickets(env, [{ key: "PP", name: "PP", statuses: ["x"] }]);
    expect(tickets).toEqual([]);
  });

  it("throws on a non-ok board response", async () => {
    fetchMock.mockResolvedValue(errResponse(500, "server error"));
    await expect(fetchTickets(env, [{ key: "PP", name: "PP", statuses: ["x"] }])).rejects.toThrow(
      /Jira 500 for board PP/,
    );
  });
});

describe("testConnection", () => {
  it("returns the display name", async () => {
    fetchMock.mockResolvedValue(okJson({ displayName: "Alex Chen" }));
    expect(await testConnection(env)).toEqual({ displayName: "Alex Chen" });
  });
  it("defaults to (unknown) and throws on error", async () => {
    fetchMock.mockResolvedValueOnce(okJson({}));
    expect(await testConnection(env)).toEqual({ displayName: "(unknown)" });
    fetchMock.mockResolvedValueOnce(errResponse(401));
    await expect(testConnection(env)).rejects.toThrow(/Jira 401/);
  });
});

describe("listProjects", () => {
  it("maps project values; defaults to []", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ values: [{ key: "PP", name: "PracticePal" }] }));
    expect(await listProjects(env)).toEqual([{ key: "PP", name: "PracticePal" }]);
    fetchMock.mockResolvedValueOnce(okJson({}));
    expect(await listProjects(env)).toEqual([]);
  });
});

describe("listStatuses", () => {
  it("returns distinct status names in first-seen order", async () => {
    fetchMock.mockResolvedValue(
      okJson([
        { statuses: [{ name: "To Do" }, { name: "In Progress" }] },
        { statuses: [{ name: "In Progress" }, { name: "Done" }] },
        {}, // no statuses key
      ]),
    );
    expect(await listStatuses(env, "PP")).toEqual(["To Do", "In Progress", "Done"]);
  });
  it("defaults to [] for empty data", async () => {
    fetchMock.mockResolvedValue(okJson(null));
    expect(await listStatuses(env, "PP")).toEqual([]);
  });
});

describe("listTransitions", () => {
  it("returns transitions; defaults to []", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ transitions: [{ id: "11", name: "Start", to: { name: "In Progress" } }] }),
    );
    expect(await listTransitions(env, "PP-1")).toEqual([
      { id: "11", name: "Start", to: { name: "In Progress" } },
    ]);
    fetchMock.mockResolvedValueOnce(okJson({}));
    expect(await listTransitions(env, "PP-1")).toEqual([]);
  });
});

describe("transitionIssue", () => {
  it("matches by target status name and POSTs the transition", async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({ transitions: [{ id: "21", name: "Begin", to: { name: "In Progress" } }] }),
      )
      .mockResolvedValueOnce(okJson({}));
    await transitionIssue(env, "PP-1", "in progress");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://x.atlassian.net/rest/api/3/issue/PP-1/transitions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ transition: { id: "21" } });
  });

  it("falls back to matching the transition name", async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ transitions: [{ id: "5", name: "Done", to: { name: "Closed" } }] }))
      .mockResolvedValueOnce(okJson({}));
    await transitionIssue(env, "PP-1", "Done");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ transition: { id: "5" } });
  });

  it("throws when no legal transition exists, listing available ones", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ transitions: [{ id: "1", name: "Foo", to: { name: "Bar" } }] }));
    await expect(transitionIssue(env, "PP-1", "Nowhere")).rejects.toThrow(
      /No legal transition to "Nowhere"\. Available from here: Bar\./,
    );
  });

  it("reports (none) when there are no transitions at all", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ transitions: [] }));
    await expect(transitionIssue(env, "PP-1", "X")).rejects.toThrow(/\(none\)/);
  });

  it("propagates a POST error", async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ transitions: [{ id: "1", name: "Go", to: { name: "Go" } }] }))
      .mockResolvedValueOnce(errResponse(400, "bad transition"));
    await expect(transitionIssue(env, "PP-1", "Go")).rejects.toThrow(/Jira 400/);
  });
});

describe("fetchTicketPr", () => {
  const issueBase = { id: "10001", fields: { comment: { comments: [] } } };

  it("returns the first PR URL from the dev-status API", async () => {
    fetchMock.mockResolvedValueOnce(okJson(issueBase)).mockResolvedValueOnce(
      okJson({
        detail: [{ pullRequests: [{ url: "https://github.com/org/repo/pull/1", status: "MERGED" }] }],
      }),
    );
    expect(await fetchTicketPr(env, "PP-1")).toBe("https://github.com/org/repo/pull/1");
  });

  it("prefers the OPEN PR when a ticket has both a closed and an open PR", async () => {
    fetchMock.mockResolvedValueOnce(okJson(issueBase)).mockResolvedValueOnce(
      okJson({
        detail: [
          {
            pullRequests: [
              { url: "https://github.com/org/repo/pull/10", status: "DECLINED" },
              { url: "https://github.com/org/repo/pull/11", status: "OPEN" },
            ],
          },
        ],
      }),
    );
    expect(await fetchTicketPr(env, "PP-1")).toBe("https://github.com/org/repo/pull/11");
  });

  it("falls back to remote links when dev-status returns nothing", async () => {
    fetchMock
      .mockResolvedValueOnce(okJson(issueBase))
      .mockResolvedValueOnce(okJson({ detail: [] })) // dev-status: no PRs
      .mockResolvedValueOnce(okJson([{ object: { url: "https://github.com/org/repo/pull/2" } }]));
    expect(await fetchTicketPr(env, "PP-1")).toBe("https://github.com/org/repo/pull/2");
  });

  it("falls back to comments when dev-status and remote links yield nothing", async () => {
    const issue = {
      id: "10001",
      fields: {
        comment: { comments: [{ body: { text: "see https://github.com/org/repo/pull/3 for fix" } }] },
      },
    };
    fetchMock
      .mockResolvedValueOnce(okJson(issue))
      .mockResolvedValueOnce(okJson({ detail: [] }))
      .mockResolvedValueOnce(okJson([]));
    expect(await fetchTicketPr(env, "PP-1")).toBe("https://github.com/org/repo/pull/3");
  });

  it("returns null when no PR URL is found anywhere", async () => {
    fetchMock
      .mockResolvedValueOnce(okJson(issueBase))
      .mockResolvedValueOnce(okJson({ detail: [] }))
      .mockResolvedValueOnce(okJson([]));
    expect(await fetchTicketPr(env, "PP-1")).toBeNull();
  });

  it("skips dev-status when it throws and continues to remote links", async () => {
    fetchMock
      .mockResolvedValueOnce(okJson(issueBase))
      .mockRejectedValueOnce(new Error("not available"))
      .mockResolvedValueOnce(okJson([{ object: { url: "https://github.com/org/repo/pull/4" } }]));
    expect(await fetchTicketPr(env, "PP-1")).toBe("https://github.com/org/repo/pull/4");
  });

  it("skips remote links when they throw and continues to comments", async () => {
    const issue = {
      id: "10001",
      fields: {
        comment: { comments: [{ body: "PR at https://github.com/org/repo/pull/5" }] },
      },
    };
    fetchMock
      .mockResolvedValueOnce(okJson(issue))
      .mockResolvedValueOnce(okJson({ detail: [] }))
      .mockRejectedValueOnce(new Error("forbidden")); // remote links throws
    expect(await fetchTicketPr(env, "PP-1")).toBe("https://github.com/org/repo/pull/5");
  });
});
