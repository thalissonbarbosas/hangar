import { mapModel } from "../sessions";

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
