import { describe, expect, it } from "vitest";
import { createAnalystRunner, READ_ONLY_TOOLS, readPathFrom } from "../src/analysis/analyst.js";
import type { Config } from "../src/config.js";

describe("READ_ONLY_TOOLS", () => {
  it("is read, search, and list, and nothing that could change the evidence", () => {
    expect([...READ_ONLY_TOOLS]).toEqual(["read", "grep", "glob", "ls"]);
    for (const banned of ["write", "edit", "shell", "bash", "web", "task"]) {
      expect([...READ_ONLY_TOOLS]).not.toContain(banned);
    }
  });
});

describe("readPathFrom", () => {
  const readStep = {
    type: "toolCall",
    message: { type: "read", args: { path: "pages/docs-experiments/managing-lifecycle.md" } },
  };

  it("takes the path off a file read, which is what the coverage gate rests on", () => {
    expect(readPathFrom(readStep)).toBe("pages/docs-experiments/managing-lifecycle.md");
  });

  it("ignores a grep, because knowing a page exists is not knowing what it says", () => {
    const grep = { type: "toolCall", message: { type: "grep", args: { pattern: "schedule" } } };
    expect(readPathFrom(grep)).toBeNull();
  });

  it("ignores an ls for the same reason", () => {
    const ls = { type: "toolCall", message: { type: "ls", args: { path: "pages" } } };
    expect(readPathFrom(ls)).toBeNull();
  });

  it("ignores everything that is not a tool call", () => {
    expect(readPathFrom({ type: "assistant", message: { type: "read" } })).toBeNull();
    expect(readPathFrom({ type: "toolCall" })).toBeNull();
    expect(readPathFrom(null)).toBeNull();
    expect(readPathFrom("read pages/x.md")).toBeNull();
  });

  it("ignores a read with no usable path", () => {
    expect(readPathFrom({ type: "toolCall", message: { type: "read", args: {} } })).toBeNull();
    expect(
      readPathFrom({ type: "toolCall", message: { type: "read", args: { path: "  " } } }),
    ).toBeNull();
  });
});

describe("createAnalystRunner", () => {
  it("returns nothing without an API key, which is what puts the run on the fallback", () => {
    expect(createAnalystRunner({ cursorApiKey: undefined } as Config)).toBeNull();
  });

  it("names the model and the runtime it will use, for the run log", () => {
    const runner = createAnalystRunner({
      cursorApiKey: "key",
      cursorModel: "claude-opus-5",
      cursorRuntime: "local",
    } as Config);

    expect(runner?.model).toBe("claude-opus-5");
    expect(runner?.description).toBe("claude-opus-5 via cursor local");
  });
});
