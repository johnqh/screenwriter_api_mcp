# @sudobility/screenwriter_api_mcp

An [MCP](https://modelcontextprotocol.io) server that lets your own AI assistant (Claude Code, Claude Desktop, or any MCP client that launches stdio servers) read and edit your ViaInk scripts. It runs locally, talks to the ViaInk REST API with a personal API key, and sends every edit as a single atomic command batch marked as coming from an AI assistant.

## Connect it

You need [Bun](https://bun.sh), this repo, and a running ViaInk API.

1. Install dependencies: `bun install`
2. Create an API key. In the ViaInk app use Settings, API keys. Or against a local API (dev sign-in bypass shown):

   ```sh
   curl -s -X POST http://localhost:8036/api/v1/api-keys \
     -H "Authorization: Bearer dev:me:me@example.com" -H "Content-Type: application/json" \
     -d '{"name":"my assistant","workspaceId":"<your workspace id>","scope":"read_write"}'
   ```

   The key (`fwk_...`) is shown once. It is tied to one workspace. Use `"scope":"read"` for a key that can only read.
3. Add the server to Claude Code:

   ```sh
   claude mcp add fadewright \
     -e FADEWRIGHT_API_KEY=fwk_xxxxxxxx_xxxxxxxx \
     -e FADEWRIGHT_API_URL=http://localhost:8036 \
     -- bun run /path/to/screenwriter_api_mcp/src/index.ts
   ```

   Claude Desktop (`claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "fadewright": {
         "command": "bun",
         "args": ["run", "/path/to/screenwriter_api_mcp/src/index.ts"],
         "env": {
           "FADEWRIGHT_API_KEY": "fwk_xxxxxxxx_xxxxxxxx",
           "FADEWRIGHT_API_URL": "http://localhost:8036"
         }
       }
     }
   }
   ```
4. Ask your assistant: "Call whoami on ViaInk", then "list my projects and outline the first script".

## Configuration

| Env var | Config file key | Default | Meaning |
|---|---|---|---|
| `FADEWRIGHT_API_KEY` | `apiKey` | none | Personal API key (`fwk_...`) |
| `FADEWRIGHT_API_URL` | `apiUrl` | `http://localhost:8036` | API base URL |
| `FADEWRIGHT_MAX_OUTPUT_CHARS` | `maxOutputChars` | `60000` | Ceiling per tool result |
| `FADEWRIGHT_CONFIG_PATH` | | `~/.fadewright/config.json` | Config file location |

Environment variables win over the file. Without a key the server still starts and every tool says how to fix that.

## Tools

| Group | Tools |
|---|---|
| Discovery | `whoami`, `list_projects`, `list_documents`, `get_document` |
| Reading | `get_outline`, `get_scene`, `get_scenes`, `get_elements`, `read_script`, `search_document` |
| Writing | `replace_element_text`, `insert_elements`, `delete_elements`, `change_element_style`, `move_scenes`, `set_scene_properties`, `insert_scene`, `apply_commands` |
| Snapshots | `list_snapshots`, `create_snapshot`, `fork_snapshot` |
| Files | `export_document` (fountain, fdx, json), `import_file` (fountain, fdx, fade in) |

Resources: `fadewright://documents/{id}/outline` and `fadewright://documents/{id}/scene/{sceneId}`.

Scenes are addressed by id (the scene heading's `el_...`), number (`3`, `#12A`), ordinal (`@3`), or heading text. Reading returns compact screenplay text with element ids, not JSON. Write tools accept `expectedHash(es)` from the read tools: a stale edit is refused (`CONTENT_CHANGED`) instead of overwriting the writer's newer text. A `read` key gets a clear "this key is read-only" error from write tools; `dryRun` previews still work.

`open_snapshot` and version restore are deliberately not offered: they replace the writer's live content. Use `fork_snapshot` to try a different branch as a new document.

## Development

```sh
bun run typecheck   # tsc --noEmit
bunx vitest run     # unit tests
bun run smoke       # real API + stdio MCP end to end (see CLAUDE.md for the one-time db:init)
```

The skill `skills/fadewright-screenplay-format/SKILL.md` teaches an assistant the element styles and Enter/Tab flow.

## License

BUSL-1.1
