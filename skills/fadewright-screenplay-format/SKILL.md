---
name: fadewright-screenplay-format
description: Use when writing, fixing, or converting script text in Fadewright so it follows the document's template. Trigger on "format this scene", "is this formatted right", "turn my notes into a scene", "fix the sluglines", "what element should this be", or before any insert_elements, insert_scene, or change_element_style call.
---

# Fadewright screenplay format

A Fadewright script is a flat list of **elements**, each with a **style** from the document's template. Scenes are not containers: a scene is a Scene Heading element plus the elements after it until the next Scene Heading. The heading's element id is the scene id.

## Before you write

1. Call `get_document` and read `template.styles`. Use those exact style names in `style`. Never assume screenplay styles for a stage play or other template.
2. Read the surrounding scene with `get_scene` so your elements match its voice and structure.
3. Pass the hashes from `get_elements` (or the scene hash from `get_outline`) as `expectedHash` / `expectedHashes` when editing existing text, so you never overwrite something the writer changed since you read it.

## The screenplay styles (Screenplay Standard template)

| Style | Use for | Enter goes to | Tab (empty / with text) goes to |
|---|---|---|---|
| Scene Heading | `INT. DINER - NIGHT` slugline | Action | Action |
| Action | description, what we see and hear | Action | Character |
| Character | speaker name cue | Dialogue | Transition / Parenthetical |
| Parenthetical | short direction inside dialogue | Dialogue | Dialogue |
| Dialogue | what the character says | Action | Parenthetical |
| Transition | `CUT TO:`, `SMASH CUT TO:` | Scene Heading | Action |
| Shot | a specific camera or insert shot | Action | Action |

Enter and Tab describe how the editor flows while typing. Use them to pick the next style when you write a run of elements: a speech is `Character`, then `Dialogue` (optionally `Parenthetical` between), then back to `Action` or another `Character`.

## Rules

- **Text is stored as typed.** Capitals come from the style: write `MILLER` for a Character cue only if that is the name, but do not shout in Dialogue, and never hand-upper-case to fake a style. Scene Heading, Character and Transition display in capitals by themselves.
- **Never type generated things**: `(MORE)`, `(CONT'D)`, page numbers and scene numbers are produced by the app.
- **One idea per element.** A paragraph of action is one Action element; do not put a Character cue and its dialogue in the same element.
- **Slugline shape:** `INT.` or `EXT.` (or `INT./EXT.`), a location, ` - `, then a time such as `DAY`, `NIGHT`, `LATER`.
- **Extensions** go on the Character cue: `MILLER (V.O.)`, `REYES (O.S.)`.
- **Parentheticals** are short, lower case, in parentheses: `(not looking up)`. Longer business belongs in Action.
- **Do not direct on the page.** Avoid camera moves and music cues in Action unless the writer's script already does.

## Tools

- New scene: `insert_scene` with the heading and first elements.
- Add lines inside a scene: `insert_elements` with `position.afterElementId` (or `atEndOfScene`).
- Fix a wrong style: `change_element_style`.
- Rewrite text: `replace_element_text` with `expectedHash`.
- After writing, re-read with `get_scene` and check the elements look like the ones around them.
- Take a `create_snapshot` before a large rewrite; `fork_snapshot` to try an alternative without touching the original.
