import { describe, expect, it } from "vitest";
import { STAGES } from "@reel/core";
import { STAGE_ORDER } from "./workflows.ts";

describe("temporal workflow", () => {
  it("runs the same stages, in the same order, as the core runner", () => {
    expect([...STAGE_ORDER]).toEqual([...STAGES]);
  });
});
