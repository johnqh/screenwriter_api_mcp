/**
 * @fileoverview Builders for the writing_core command invocations the write tools emit. A small local
 * mirror of the parameter shapes (this package does not import writing_core); every command runs on
 * the API. Pure and unit tested.
 */

export interface Command {
  id: string;
  params: Record<string, unknown>;
}

export type Anchor = { after: string } | { before: string } | { end: true };

export const replaceText = (elementId: string, start: number, end: number, text: string): Command => ({
  id: "text.replaceRange",
  params: {
    range: { anchor: { elementId, offset: start }, head: { elementId, offset: end } },
    text,
  },
});

export const insertElement = (o: { after?: string; before?: string; style: string; text?: string }): Command => ({
  id: "element.insert",
  params: {
    ...(o.after !== undefined ? { after: o.after } : {}),
    ...(o.before !== undefined ? { before: o.before } : {}),
    style: o.style,
    ...(o.text ? { text: o.text } : {}),
  },
});

/**
 * Insert a run of elements at an anchor so they end up in the given order. New ids are not known
 * inside a batch, so chaining on the previous new element is impossible. Instead: `after A` inserts in
 * REVERSE (each lands directly after A, pushing the earlier ones down), `before B` inserts forward
 * (each lands directly before B), and appending inserts forward.
 */
export function insertSequence(anchor: Anchor, items: { style: string; text?: string }[]): Command[] {
  if ("after" in anchor) {
    return [...items].reverse().map(i => insertElement({ after: anchor.after, style: i.style, ...(i.text ? { text: i.text } : {}) }));
  }
  if ("before" in anchor) {
    return items.map(i => insertElement({ before: anchor.before, style: i.style, ...(i.text ? { text: i.text } : {}) }));
  }
  return items.map(i => insertElement({ style: i.style, ...(i.text ? { text: i.text } : {}) }));
}

/** Delete one whole element (one command per element, so non-contiguous ids work). */
export const deleteElement = (elementId: string): Command => ({
  id: "text.deleteBackward",
  params: { at: { elementId, offset: 0 }, unit: "element" },
});

export const setStyle = (elementIds: string[], style: string): Command => ({
  id: "element.setStyle",
  params: { elements: elementIds, style },
});

export const moveScenes = (sceneIds: string[], to: { after: string } | { before: string }): Command => ({
  id: "scene.move",
  params: { scenes: sceneIds, to },
});

export const setSynopsis = (sceneId: string, value: string): Command => ({
  id: "scene.setSynopsis",
  params: { scene: sceneId, value },
});
