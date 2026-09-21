import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_HEADER, MCP_CLIENT_NAME } from "@sudobility/screenwriter_types/keys";
import { ApiError, NoKeyError, clientHeaderValue, configure, get, post, seg } from "../src/client.ts";
import { resolveConfig } from "../src/config-file.ts";

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("client", () => {
  it("sends the Bearer key and X-Client on every request, and unwraps the envelope", async () => {
    const fetchMock = vi.fn(async () => ok({ hello: "world" }));
    vi.stubGlobal("fetch", fetchMock);
    configure({ apiUrl: "http://api.test/", apiKey: "fwk_abc", version: "1.2.3", maxOutputChars: 1000 });
    expect(await get("/me")).toEqual({ hello: "world" });
    await post("/documents/doc_1/commands", { body: { a: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls as unknown as [URL, RequestInit][]) {
      const h = call[1].headers as Record<string, string>;
      expect(h["Authorization"]).toBe("Bearer fwk_abc");
      expect(h[CLIENT_HEADER]).toBe("fadewright-mcp/1.2.3");
    }
    expect(String((fetchMock.mock.calls as unknown as [URL][])[0]![0])).toBe("http://api.test/api/v1/me");
    expect(CLIENT_HEADER).toBe("X-Client");
    expect(clientHeaderValue("9.9.9").startsWith(`${MCP_CLIENT_NAME}/`)).toBe(true);
  });

  it("throws ApiError with code, status and details from a failure envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, error: "stale", code: "CONTENT_CHANGED", details: { ids: ["el_A"] } }), { status: 409 })));
    configure({ apiUrl: "http://api.test", apiKey: "fwk_abc", version: "1", maxOutputChars: 1000 });
    const err = await post("/x").catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "CONTENT_CHANGED", details: { ids: ["el_A"] } });
  });

  it("maps a network failure to NETWORK_ERROR and refuses without a key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    configure({ apiUrl: "http://api.test", apiKey: "fwk_abc", version: "1", maxOutputChars: 1000 });
    await expect(get("/me")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
    configure({ apiUrl: "http://api.test", apiKey: undefined, version: "1", maxOutputChars: 1000 });
    await expect(get("/me")).rejects.toBeInstanceOf(NoKeyError);
  });

  it("encodes path segments", () => {
    expect(seg("a/b c")).toBe("a%2Fb%20c");
  });
});

describe("config resolution", () => {
  it("env beats file beats default; empty env counts as unset", () => {
    const stored = { apiUrl: "http://file", apiKey: "fwk_file", maxOutputChars: 5000 };
    expect(resolveConfig({}, {})).toMatchObject({ apiUrl: "http://localhost:8042", apiKey: undefined, maxOutputChars: 60000 });
    expect(resolveConfig({}, stored)).toMatchObject({ apiUrl: "http://file", apiKey: "fwk_file", maxOutputChars: 5000 });
    expect(resolveConfig({ FADEWRIGHT_API_URL: "http://env", FADEWRIGHT_API_KEY: "fwk_env", FADEWRIGHT_MAX_OUTPUT_CHARS: "100" }, stored)).toMatchObject({
      apiUrl: "http://env", apiKey: "fwk_env", maxOutputChars: 100,
    });
    expect(resolveConfig({ FADEWRIGHT_API_URL: "", FADEWRIGHT_API_KEY: "" }, stored)).toMatchObject({ apiUrl: "http://file", apiKey: "fwk_file" });
  });
});
