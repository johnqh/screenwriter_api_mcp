# screenwriter_api_mcp

MCP server (stdio) that lets a writer's own AI assistant (Claude Code, Claude Desktop, any stdio MCP client) read and edit their Fadewright scripts. A thin local client over the `screenwriter_api` REST API with a personal API key (`fwk_...`). Spec: `../screenwriter_plans/specs/07-mcp-and-skills.md`. Reference implementation: `../shapeshyft_api_mcp`.

## Tech stack

Bun, TypeScript, `@modelcontextprotocol/sdk`, `zod` (imported as `zod/v4`), vitest. No database, no Yjs, no `writing_core`, no `screenwriter_client/lib`, no `writing_ui`: it talks to the API over HTTP only.

## Project structure

```
src/
  index.ts          config -> configure(client) -> register tools/resources -> StdioServerTransport (stdout = protocol, logs to stderr)
  client.ts         fetch wrapper: Bearer key, X-Client: fadewright-mcp/<version> on EVERY request, envelope unwrap, ApiError, NETWORK_ERROR
  config-file.ts    env > ~/.fadewright/config.json (read-only) > defaults; empty env counts as unset
  api.ts            typed reads, style cache, key-scope probe, hash expansion, applyBatch (THE write path)
  commands.ts       builders for writing_core command JSON (text.replaceRange, element.insert, ...) - pure
  refs.ts           scene refs (id, number, #n, @ordinal, heading text) and style refs (id, name, code) - pure
  compact.ts        LLM output shaping: lines format, short hashes, minute timestamps, empty-field drop, truncation
  errors.ts         ApiError -> model-actionable messages (EPOCH_MISMATCH, CONTENT_CHANGED, COMMAND_INVALID, read-only)
  resources.ts      fadewright://documents/{id}/outline and .../scene/{sceneId}
  tools/            discovery, read, write, snapshots, files, util
skills/fadewright-screenplay-format/SKILL.md
scripts/smoke.ts    real API + real stdio MCP end-to-end
tests/              vitest: compact, errors, refs, commands, client/config
```

## Commands

- `bun run start` - run the server (needs `FADEWRIGHT_API_KEY`, `FADEWRIGHT_API_URL`)
- `bun run typecheck` (`bunx tsc --noEmit`; tsconfig has `noEmit: true`, never run an emitting tsc)
- `bunx vitest run` - unit tests (compact, error mapping, refs, command builders, client headers). Never `bun test`.
- `bun run smoke` - boots `../screenwriter_api` on a free port against `screenwriter_test` (`AI_TEST_MODE=1`, pepper set), imports Fountain, creates keys, launches this server as a stdio child and drives every tool, including a read-only key. Run `DATABASE_URL=postgres://localhost:5432/screenwriter_test PUBLIC_APP_URL=http://localhost:5173 bun run db:init` in the API repo first. Never uses port 8042 or `screenwriter_dev` (it refuses any other DB).

## Patterns

- **Every write is ONE command batch** to `POST /documents/:did/commands` with the current `baseEpoch` (fetched per write). The `X-Client` header makes the API record the origin as MCP. Write tools translate intent into commands in `commands.ts`; the API executes them, so permissions, locks and Track Changes cannot be bypassed.
- **Edit guard.** `expectedHash(es)` come from read tools. Reads show short hashes (`v1:` + 12 hex); `expandHashes` matches them by prefix against the current hash and refuses locally with CONTENT_CHANGED if none matches, then sends the full hash so the server re-checks atomically. `replace_element_text` guards with the just-read hash even when the caller gave none.
- **Insert ordering.** New element ids are unknown inside a batch, so `insertSequence` inserts in reverse after an anchor, forward before an anchor, forward for append.
- **Scope.** The API has no key-introspection route; `getScope()` probes with a write to a non-existent document (403 = read key, 404 = read_write) and caches it. Write tools check it first and return the read-only message; a raw 403 on a write is also mapped to it. `dryRun` is allowed for read keys.
- **Output.** Script text uses the `lines` format (`el_id Style | text`); outlines are one line per scene; JSON is minified with empties dropped; results are capped at `FADEWRIGHT_MAX_OUTPUT_CHARS` (60000) at item boundaries with a footer giving the args for the next page.
- **Withheld on purpose:** `open_snapshot` and version restore (they replace the writer's live content). `fork_snapshot` creates a new document instead.
- Tool names follow spec 07: `search_document`, `move_scenes`, `change_element_style`, `set_scene_properties`, `import_file`. `read_script`, `insert_scene`, `apply_commands` are additions.

## Gotchas

- `@sudobility/screenwriter_types` resolves by path only through subpaths (`tsconfig` `paths` `@sudobility/screenwriter_types/*`, mirrored in `vitest.config.ts`): the barrel imports `writing_core`, so only `keys` (constants) is imported. Other response shapes are local mirrors in `api.ts`.
- The API has no search, locator-resolve, title-page, entity, or scene-length routes yet: search runs client-side over the scenes; scene refs resolve client-side against the outline; outline shows `elementCount`, not length.
- Export supports fountain, fdx, json only; import supports fountain, fdx, fade in (content detected, filename is a hint).
- `insert_scene` sets a synopsis in a second batch (the new heading id is unknown inside the first).
- `bunx vitest run` runs under Node; the smoke test needs Bun (spawns the API and this server).

## Related projects

`screenwriter_api` (the REST API) · `screenwriter_types` · `screenwriter_plans` (specs) · `shapeshyft_api_mcp` (reference)
