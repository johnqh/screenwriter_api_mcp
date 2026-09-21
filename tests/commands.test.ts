import { describe, expect, it } from "vitest";
import { deleteElement, insertSequence, moveScenes, replaceText, setStyle, setSynopsis } from "../src/commands.ts";

describe("command builders", () => {
  it("replaceText builds a text.replaceRange over one element", () => {
    expect(replaceText("el_A", 2, 5, "hi")).toEqual({
      id: "text.replaceRange",
      params: { range: { anchor: { elementId: "el_A", offset: 2 }, head: { elementId: "el_A", offset: 5 } }, text: "hi" },
    });
  });

  it("insert after an anchor goes in reverse so the final order is right", () => {
    const cmds = insertSequence({ after: "el_A" }, [{ style: "s1", text: "one" }, { style: "s2", text: "two" }, { style: "s3", text: "three" }]);
    expect(cmds.map(c => c.params["text"])).toEqual(["three", "two", "one"]);
    expect(cmds.every(c => c.id === "element.insert" && c.params["after"] === "el_A")).toBe(true);
  });

  it("insert before an anchor goes forward, and appending has no anchor", () => {
    const before = insertSequence({ before: "el_B" }, [{ style: "s1", text: "one" }, { style: "s2", text: "two" }]);
    expect(before.map(c => c.params["text"])).toEqual(["one", "two"]);
    expect(before.every(c => c.params["before"] === "el_B")).toBe(true);
    const end = insertSequence({ end: true }, [{ style: "s1", text: "one" }, { style: "s2" }]);
    expect(end.map(c => c.params["text"])).toEqual(["one", undefined]);
    expect(end.every(c => !("after" in c.params) && !("before" in c.params))).toBe(true);
  });

  it("delete, restyle, move and synopsis map to the right commands", () => {
    expect(deleteElement("el_A")).toEqual({ id: "text.deleteBackward", params: { at: { elementId: "el_A", offset: 0 }, unit: "element" } });
    expect(setStyle(["el_A"], "sty_1")).toEqual({ id: "element.setStyle", params: { elements: ["el_A"], style: "sty_1" } });
    expect(moveScenes(["el_S"], { before: "el_T" })).toEqual({ id: "scene.move", params: { scenes: ["el_S"], to: { before: "el_T" } } });
    expect(setSynopsis("el_S", "x")).toEqual({ id: "scene.setSynopsis", params: { scene: "el_S", value: "x" } });
  });
});
