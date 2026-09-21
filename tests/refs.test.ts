import { describe, expect, it } from "vitest";
import { findSceneHeadingStyle, normalizeId, resolveSceneRef, resolveStyle } from "../src/refs.ts";
import type { OutlineSceneView } from "../src/compact.ts";

const S = (id: string, number: string | null, heading: string, omitted = false): OutlineSceneView => ({
  id, number, heading, omitted, synopsis: "", elementCount: 1, contentHash: "v1:" + "0".repeat(64),
});
const A = "el_01M31NTM0AEC2K4PWZZ1XPS50Q";
const B = "el_01M31NTM0AZFPZE2XN1HRSKVA9";
const C = "el_01M31NTM0AKQDVAPKYH5WMQBW1";
const scenes = [S(A, "1", "INT. DINER - DAY"), S(B, "1A", "EXT. ROOF - NIGHT"), S(C, "2", "INT. DINER - LATER", true)];

describe("scene refs", () => {
  it("resolves ids case-insensitively", () => {
    expect(resolveSceneRef(scenes, A.toLowerCase().replace("el_", "el_")).id).toBe(A);
    expect(normalizeId("EL_abc")).toBe("el_ABC");
  });
  it("resolves numbers, #numbers and ordinals", () => {
    expect(resolveSceneRef(scenes, "1A").id).toBe(B);
    expect(resolveSceneRef(scenes, "#2").id).toBe(C);
    expect(resolveSceneRef(scenes, "scene 1").id).toBe(A);
    expect(resolveSceneRef(scenes, "@2").id).toBe(B);
    expect(() => resolveSceneRef(scenes, "@3")).toThrow(/only 2 non-omitted/);
  });
  it("resolves unnumbered documents by ordinal", () => {
    const un = scenes.map(s => ({ ...s, number: null }));
    expect(resolveSceneRef(un, "2").id).toBe(B);
  });
  it("resolves heading text, and never guesses when ambiguous", () => {
    expect(resolveSceneRef(scenes, "roof").id).toBe(B);
    expect(resolveSceneRef(scenes, '"INT. DINER - DAY"').id).toBe(A);
    expect(() => resolveSceneRef(scenes, "diner")).toThrow(/LOCATOR_AMBIGUOUS/);
    expect(() => resolveSceneRef(scenes, "nowhere")).toThrow(/LOCATOR_NOT_FOUND/);
    expect(() => resolveSceneRef(scenes, "el_00000000000000000000000000")).toThrow(/LOCATOR_NOT_FOUND/);
  });
});

describe("styles", () => {
  const styles = [
    { id: "sty_A", name: "Scene Heading", code: 1 },
    { id: "sty_B", name: "Action", code: 2 },
  ];
  it("resolves by id, name (case-insensitive) or code", () => {
    expect(resolveStyle(styles, "sty_B").name).toBe("Action");
    expect(resolveStyle(styles, "scene heading").id).toBe("sty_A");
    expect(resolveStyle(styles, "2").id).toBe("sty_B");
  });
  it("lists valid styles when unknown", () => {
    expect(() => resolveStyle(styles, "Bogus")).toThrow(/STYLE_UNKNOWN.*Scene Heading, Action/);
  });
  it("finds the scene heading style", () => {
    expect(findSceneHeadingStyle(styles).id).toBe("sty_A");
    expect(() => findSceneHeadingStyle([styles[1]!])).toThrow(/no scene heading style/);
  });
});
