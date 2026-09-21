import { describe, expect, it } from "vitest";
import { ApiError, NoKeyError } from "../src/client.ts";
import { formatError, READ_ONLY_MESSAGE } from "../src/errors.ts";

describe("error mapping", () => {
  it("EPOCH_MISMATCH says to re-read and retry", () => {
    const m = formatError(new ApiError("baseEpoch does not match", 409, "EPOCH_MISMATCH", { epoch: 4 }), { write: true });
    expect(m).toContain("the script changed while you were working");
    expect(m).toContain("epoch is now 4");
    expect(m).toContain("Re-read");
  });

  it("CONTENT_CHANGED lists the stale ids and says nothing was applied", () => {
    const m = formatError(new ApiError("x", 409, "CONTENT_CHANGED", { ids: ["el_A", "el_B"] }));
    expect(m).toContain("el_A, el_B");
    expect(m).toContain("nothing was applied");
    expect(m).toContain("get_elements");
  });

  it("COMMAND_INVALID carries the index and a plain-English reason", () => {
    const m = formatError(new ApiError("x", 422, "COMMAND_INVALID", { index: 2, reason: "notFound" }));
    expect(m).toContain("command #2");
    expect(m).toContain("notFound");
    expect(m).toContain("does not exist");
    const whole = formatError(new ApiError("x", 422, "COMMAND_INVALID", { index: -1, reason: "exception" }));
    expect(whole).toContain("the batch");
  });

  it("a 403 on a write tool is the read-only message, not a raw 403", () => {
    const m = formatError(new ApiError("Forbidden", 403, "FORBIDDEN"), { write: true });
    expect(m).toBe(READ_ONLY_MESSAGE);
    expect(m).toContain("read-only");
    expect(m).toContain("read_write");
    expect(formatError(new ApiError("Forbidden", 403, "FORBIDDEN"))).toContain("FORBIDDEN");
  });

  it("maps 401, 404, network and validation errors", () => {
    expect(formatError(new ApiError("x", 401, "UNAUTHORIZED"))).toContain("rejected");
    expect(formatError(new ApiError("x", 404, "NOT_FOUND", { ids: ["el_Z"] }))).toContain("el_Z");
    expect(formatError(new ApiError("down", 0, "NETWORK_ERROR"))).toContain("FADEWRIGHT_API_URL");
    expect(formatError(new ApiError("Invalid", 400, "VALIDATION", { issues: [{ path: ["name"], message: "too short" }] }))).toContain("name: too short");
  });

  it("no key and plain errors", () => {
    expect(formatError(new NoKeyError())).toContain("No Fadewright API key");
    expect(formatError(new Error("boom"))).toBe("boom");
  });
});
