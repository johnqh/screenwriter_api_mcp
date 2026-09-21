import { describe, expect, it } from "vitest";
import {
  compactJson,
  dropEmpty,
  isFullHash,
  nextFooter,
  renderElementLine,
  renderOutlineLine,
  renderScene,
  shortHash,
  shortTime,
  truncateItems,
} from "../src/compact.ts";

const FULL = "v1:" + "3f9c1a2b7d0e".padEnd(64, "a");

describe("compaction", () => {
  it("shortens hashes to the version plus 12 hex", () => {
    expect(shortHash(FULL)).toBe("v1:3f9c1a2b7d0e");
    expect(shortHash("v1:3f9c1a2b7d0e")).toBe("v1:3f9c1a2b7d0e");
    expect(isFullHash(FULL)).toBe(true);
    expect(isFullHash("v1:3f9c1a2b7d0e")).toBe(false);
  });

  it("shortens timestamps to the minute", () => {
    expect(shortTime("2026-09-15T14:03:27.123Z")).toBe("2026-09-15T14:03Z");
    expect(shortTime(null)).toBe("");
  });

  it("drops null, empty and default fields recursively, and minifies", () => {
    const v = { a: 1, b: null, c: [], d: { e: undefined, f: false, g: "" }, h: [{ i: null }, { j: 2 }], k: 0 };
    expect(dropEmpty(v)).toEqual({ a: 1, h: [{ j: 2 }], k: 0 });
    expect(compactJson(v)).toBe('{"a":1,"h":[{"j":2}],"k":0}');
    expect(compactJson({})).toBe("{}");
  });

  it("renders an element line with soft returns continued on indented lines", () => {
    const id = "el_01M31NTM0AY2JD8RVE0ZJXPJTJ";
    const out = renderElementLine({ id, styleName: "Dialogue", text: "one\ntwo" }, false);
    const [first, second] = out.split("\n");
    expect(first).toBe(`${id} Dialogue      | one`);
    expect(second).toMatch(/^ +\| two$/);
    expect(second!.indexOf("|")).toBe(first!.indexOf("|"));
    expect(renderElementLine({ id, styleName: "Action", text: "x", contentHash: FULL }, true)).toContain("[v1:3f9c1a2b7d0e]");
  });

  it("renders a scene like a screenplay with the id in the header and elements listed with ids", () => {
    const sid = "el_01M31NTM0AEC2K4PWZZ1XPS50Q";
    const out = renderScene({
      id: sid,
      number: "2",
      heading: "INT. DINER - DAY",
      synopsis: "Miller waits.",
      contentHash: FULL,
      elements: [
        { id: sid, styleName: "Scene Heading", text: "INT. DINER - DAY" },
        { id: "el_A", styleName: "Character", text: "MILLER" },
        { id: "el_B", styleName: "Dialogue", text: "Late." },
      ],
    });
    const lines = out.split("\n");
    expect(lines[0]).toBe(`SCENE ${sid} #2 hash=v1:3f9c1a2b7d0e "INT. DINER - DAY"`);
    expect(lines[1]).toBe("  synopsis: Miller waits.");
    expect(lines).toHaveLength(4); // heading not repeated as a row
    expect(lines[2]).toMatch(/^el_A Character +\| MILLER$/);
    expect(lines[3]).toMatch(/^el_B Dialogue +\| Late\.$/);
  });

  it("marks omitted scenes", () => {
    const line = renderOutlineLine({ id: "el_X", number: "5", heading: "H", omitted: true, synopsis: "", elementCount: 0, contentHash: FULL }, 4);
    expect(line).toBe("5 el_X OMITTED");
    const row = renderOutlineLine({ id: "el_X", number: null, heading: "INT. A - DAY", omitted: false, synopsis: "s", elementCount: 3, contentHash: FULL }, 0);
    expect(row).toBe('1 el_X "INT. A - DAY" v1:3f9c1a2b7d0e 3 els | s');
  });

  it("truncates at item boundaries with a correct next index", () => {
    const items = ["aaaa", "bbbb", "cccc", "dddd"];
    const t = truncateItems(items, 10, "\n", 100);
    expect(t.text).toBe("aaaa\nbbbb");
    expect(t.shown).toBe(2);
    expect(t.total).toBe(4);
    expect(t.next).toBe(102);
    expect(truncateItems(items, 1000).next).toBeNull();
    // Always shows at least one item, never cuts it.
    const big = truncateItems(["x".repeat(50), "y"], 10);
    expect(big.text).toBe("x".repeat(50));
    expect(big.next).toBe(1);
  });

  it("tells the model how to fetch the rest", () => {
    expect(nextFooter("get_outline", { documentId: "doc_1", from: 5 }, 5, 9)).toBe(
      '-- truncated: showing 5 of 9. Fetch the rest with get_outline {"documentId":"doc_1","from":5} --'
    );
  });
});
