/**
 * Stdio smoke test (spec 07 section 11.1) against a REAL screenwriter_api.
 *
 * Boots screenwriter_api on a free port against `screenwriter_test` (never 8036 / screenwriter_dev), makes
 * a user + workspace + project, imports a small Fountain script through the API, creates read_write and
 * read keys, launches THIS MCP server as a stdio child with the SDK client, and drives every tool.
 *
 *   bun run smoke            (run `bun run db:init` in ../screenwriter_api first, against screenwriter_test)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

const ROOT = new URL("..", import.meta.url).pathname;
const API_DIR = join(ROOT, "..", "screenwriter_api");
const TEST_DB = process.env["SMOKE_DATABASE_URL"] ?? "postgres://localhost:5432/screenwriter_test";
if (!/^postgres:\/\/localhost[:/]/.test(TEST_DB) || !TEST_DB.includes("screenwriter_test")) {
  throw new Error(`Refusing to run against ${TEST_DB}: smoke only uses localhost screenwriter_test`);
}

// ---- tiny assertion helpers ----
let checks = 0;
const failures: string[] = [];
function check(cond: unknown, label: string, detail?: string) {
  checks++;
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? `\n       ${detail.slice(0, 600)}` : ""}`);
  }
}
const section = (s: string) => console.log(`\n== ${s}`);

// ---- boot the real API ----
async function freePort(): Promise<number> {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const p = s.port!;
  await s.stop(true);
  if (p === 8036) throw new Error("got port 8036");
  return p;
}

let apiProc: ChildProcess | null = null;
async function bootApi(port: number) {
  apiProc = spawn("bun", ["run", "src/index.ts"], {
    cwd: API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: TEST_DB,
      PUBLIC_APP_URL: "http://localhost:5143",
      AI_TEST_MODE: "1",
      API_KEY_PEPPER: "smoke-pepper-not-a-secret",
      SKIP_DB_INIT: "1",
      LOG_LEVEL: "error",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/v1/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("API did not start");
}
async function stopApi() {
  const p = apiProc;
  if (!p) return;
  apiProc = null;
  const exited = new Promise(r => p.once("exit", r));
  p.kill("SIGTERM");
  await Promise.race([exited, new Promise(r => setTimeout(r, 5000))]);
  if (p.exitCode === null) p.kill("SIGKILL");
}

// ---- direct REST helper (as the writer, dev bypass) ----
let BASE = "";
const uid = `smoke${Date.now().toString(36)}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rest(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer dev:${uid}:${uid}@smoke.test`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json()) as { success: boolean; data?: unknown; error?: string };
  if (!j.success) throw new Error(`${method} ${path}: ${r.status} ${j.error}`);
  return j.data;
}

const FOUNTAIN = `Title: Smoke Test
Author: Fadewright MCP

INT. SFPD BRIEFING ROOM - DAY

Detectives file in. MILLER drops a folder on the desk.

MILLER
(not looking up)
You're late.

REYES
Traffic.

EXT. PARKING LOT - NIGHT

Rain hammers the asphalt. REYES lights a cigarette.

REYES
Always traffic.

INT. DINER - LATER

A waitress pours coffee. Nobody thanks her.

MILLER
You should have called.

REYES
I did.
`;

// ---- MCP client helper ----
type Tool = { name: string; description?: string };
async function connectMcp(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/index.ts"],
    cwd: ROOT,
    env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "smoke", version: "0.0.0" });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
    return { text: r.content.map(c => c.text).join("\n"), isError: r.isError === true };
  };
  return { client, call };
}

const resText = (r: { contents: unknown[] }): string => String((r.contents[0] as { text?: unknown } | undefined)?.text ?? "");

/** Best effort: remove this run's rows from screenwriter_test (workspace delete cascades). */
function cleanupRows() {
  const sql = `DELETE FROM workspaces WHERE created_by = '${uid}'; DELETE FROM users WHERE id = '${uid}';`;
  const r = Bun.spawnSync(["psql", TEST_DB, "-q", "-c", sql]);
  if (r.exitCode !== 0) console.log("  (cleanup skipped: psql not available or failed)");
}

const tmp = mkdtempSync(join(tmpdir(), "fw-mcp-smoke-"));
let exitCode = 0;
try {
  const port = await freePort();
  BASE = `http://localhost:${port}`;
  console.log(`API on :${port}, db ${TEST_DB}`);
  await bootApi(port);

  section("setup through the API");
  const me = await rest("GET", "/me");
  const wid: string = me.personalWorkspaceId;
  const project = await rest("POST", `/workspaces/${wid}/projects`, { name: "Smoke project" });
  const imp = await rest("POST", `/projects/${project.id}/documents/import`, {
    filename: "smoke.fountain",
    contentB64: Buffer.from(FOUNTAIN).toString("base64"),
    title: "Smoke script",
  });
  const docId: string = imp.document.id;
  check(docId?.startsWith("doc_"), "imported a Fountain script", JSON.stringify(imp).slice(0, 300));
  const rwKey = await rest("POST", "/api-keys", { name: "smoke rw", workspaceId: wid, scope: "read_write" });
  const roKey = await rest("POST", "/api-keys", { name: "smoke ro", workspaceId: wid, scope: "read" });
  check(String(rwKey.key).startsWith("fwk_") && String(roKey.key).startsWith("fwk_"), "created read_write and read keys");

  const baseEnv = { FADEWRIGHT_API_URL: BASE, FADEWRIGHT_CONFIG_PATH: join(tmp, "none.json") };

  // ---------------------------------------------------------------- no key
  section("no key configured");
  {
    const { client, call } = await connectMcp({ ...baseEnv, FADEWRIGHT_API_KEY: "" });
    const r = await call("list_projects");
    check(r.isError && /No Fadewright API key/.test(r.text), "tools return a clear no-key error", r.text);
    await client.close();
  }

  // ---------------------------------------------------------------- read_write key
  section("read_write key: discovery and reading");
  const { client, call } = await connectMcp({ ...baseEnv, FADEWRIGHT_API_KEY: rwKey.key });
  const info = client.getServerVersion();
  check(info?.name === "fadewright-api" && info?.version === pkg.version, "initialize reports name and version", JSON.stringify(info));

  const tools = (await client.listTools()).tools as Tool[];
  const names = tools.map(t => t.name).sort();
  const expected = [
    "whoami", "list_projects", "list_documents", "get_document", "get_outline", "get_scene", "get_scenes", "get_elements",
    "read_script", "search_document", "replace_element_text", "insert_elements", "delete_elements", "change_element_style",
    "move_scenes", "set_scene_properties", "insert_scene", "apply_commands", "list_snapshots", "create_snapshot",
    "fork_snapshot", "export_document", "import_file",
  ];
  check(expected.every(n => names.includes(n)), "tools/list has every expected tool", `missing: ${expected.filter(n => !names.includes(n)).join(",")}`);
  check(!names.some(n => /open_snapshot|restore/.test(n)), "open_snapshot / restore are withheld");
  check(tools.every(t => (t.description ?? "").length > 40), "every tool has a description");
  const resources = await client.listResourceTemplates();
  check(resources.resourceTemplates.some(t => t.uriTemplate === "fadewright://documents/{id}/outline"), "resource templates registered");

  const who = await call("whoami");
  check(!who.isError && /"scope":"read_write"/.test(who.text) && new RegExp(wid).test(who.text), "whoami: workspace and scope read_write", who.text);

  const projects = await call("list_projects");
  check(projects.text.includes(project.id) && projects.text.includes("Smoke project"), "list_projects", projects.text);
  const docs = await call("list_documents", { projectId: project.id });
  check(docs.text.includes(docId), "list_documents", docs.text);
  const gd = await call("get_document", { documentId: docId });
  check(/"scenes":3/.test(gd.text) && /Scene Heading/.test(gd.text) && /"epoch":0/.test(gd.text), "get_document: 3 scenes, styles, epoch", gd.text);

  const outline = await call("get_outline", { documentId: docId });
  const outlineLines = outline.text.split("\n").filter(l => /^\S+ el_/.test(l));
  check(outlineLines.length === 3, "get_outline: 3 scenes", outline.text);
  check(/SFPD BRIEFING ROOM/.test(outlineLines[0] ?? "") && /DINER/.test(outlineLines[2] ?? ""), "get_outline: order and headings");
  check(/v1:[0-9a-f]{12}(?![0-9a-f])/.test(outline.text), "get_outline: short hashes");
  console.log(outline.text.split("\n").map(l => "       " + l).join("\n"));

  const scene1 = await call("get_scene", { documentId: docId, sceneRef: "@1" });
  console.log(scene1.text.split("\n").map(l => "       " + l).join("\n"));
  const lateMatch = /(el_[0-9A-Z]{26}) Dialogue\s*\| You're late\./.exec(scene1.text);
  check(scene1.text.startsWith("SCENE el_") && /INT\. SFPD BRIEFING ROOM - DAY/.test(scene1.text), "get_scene: compact header", scene1.text);
  check(!!lateMatch && /Character\s*\| MILLER/.test(scene1.text) && /Action\s*\|/.test(scene1.text), "get_scene: element ids, styles, text", scene1.text);
  const lateId = lateMatch![1]!;
  const sceneOneId = /^SCENE (el_[0-9A-Z]{26})/.exec(scene1.text)![1]!;

  const byNumber = await call("get_scene", { documentId: docId, sceneRef: "#2" });
  check(/PARKING LOT/.test(byNumber.text), "get_scene by number '#2'");
  const byHeading = await call("get_scene", { documentId: docId, sceneRef: "diner" });
  check(/DINER/.test(byHeading.text), "get_scene by heading text");
  const jsonScene = await call("get_scene", { documentId: docId, sceneRef: "@3", format: "json" });
  check(/"elements":\[/.test(jsonScene.text) && !/\n {2}/.test(jsonScene.text), "get_scene json is minified", jsonScene.text.slice(0, 200));
  const two = await call("get_scenes", { documentId: docId, sceneRefs: ["@2", "@3"] });
  check(/PARKING LOT/.test(two.text) && /DINER/.test(two.text), "get_scenes");
  const els = await call("get_elements", { documentId: docId, elementIds: [lateId] });
  const lateHashShort = /\[(v1:[0-9a-f]{12})\]/.exec(els.text)?.[1];
  check(/You're late/.test(els.text) && !!lateHashShort, "get_elements: text and short hash", els.text);

  const script = await call("read_script", { documentId: docId });
  check(/scenes 1-3 of 3/.test(script.text) && /nextCursor: null/.test(script.text) && /I did\./.test(script.text), "read_script: whole script, nextCursor null", script.text.slice(0, 300));
  const paged = await call("read_script", { documentId: docId, maxScenes: 2 });
  check(/nextCursor: "2"/.test(paged.text) && !/I did\./.test(paged.text), "read_script: paginates with nextCursor", paged.text.slice(-200));
  const page2 = await call("read_script", { documentId: docId, maxScenes: 2, cursor: "2" });
  check(/I did\./.test(page2.text) && /nextCursor: null/.test(page2.text), "read_script: second page");

  const found = await call("search_document", { documentId: docId, query: "reyes" });
  check(/4 matches/.test(found.text) && /Character \| REYES/.test(found.text), "search_document", found.text);

  section("read_write key: writing");
  const rep = await call("replace_element_text", { documentId: docId, elementId: lateId, text: "You're early.", expectedHash: lateHashShort });
  check(!rep.isError && /APPLIED 1 command/.test(rep.text) && new RegExp(lateId).test(rep.text), "replace_element_text (guarded by the read hash)", rep.text);
  const after = await call("get_scene", { documentId: docId, sceneRef: sceneOneId });
  check(/You're early\./.test(after.text) && !/You're late\./.test(after.text), "re-read shows the change", after.text);
  const epochAfter = /epoch (\d+)/.exec(rep.text)?.[1];
  check(epochAfter !== undefined, "reports the epoch", rep.text);

  const stale = await call("replace_element_text", { documentId: docId, elementId: lateId, text: "You're never here.", expectedHash: lateHashShort });
  check(stale.isError && /CONTENT_CHANGED/.test(stale.text) && /Re-read/.test(stale.text) && stale.text.includes(lateId), "stale-hash edit refused with a helpful message", stale.text);
  const still = await call("get_scene", { documentId: docId, sceneRef: sceneOneId });
  check(/You're early\./.test(still.text), "refused edit changed nothing");

  const ins = await call("insert_elements", {
    documentId: docId,
    position: { afterElementId: lateId },
    elements: [
      { style: "Character", text: "REYES" },
      { style: "Dialogue", text: "Two accidents on the bridge." },
      { style: "Action", text: "Miller finally looks up." },
    ],
  });
  check(!ins.isError && /created \(3\)/.test(ins.text), "insert_elements: 3 created", ins.text);
  const s1b = await call("get_scene", { documentId: docId, sceneRef: sceneOneId });
  const order = s1b.text.split("\n").map(l => l.split("|")[1]?.trim()).filter(Boolean);
  const ia = order.indexOf("You're early.");
  check(order[ia + 1] === "REYES" && order[ia + 2] === "Two accidents on the bridge." && order[ia + 3] === "Miller finally looks up.", "insert_elements: order preserved after the anchor", s1b.text);

  const eventual = /el_[0-9A-Z]{26}(?= Action\s*\| Miller finally looks up\.)/.exec(s1b.text)?.[0];
  const del = await call("delete_elements", { documentId: docId, elementIds: [eventual!] });
  check(!del.isError && /deleted \(1\)/.test(del.text), "delete_elements", del.text);
  const restyle = await call("change_element_style", { documentId: docId, elementIds: [lateId], style: "Action" });
  check(!restyle.isError && /style is now Action/.test(restyle.text), "change_element_style", restyle.text);
  await call("change_element_style", { documentId: docId, elementIds: [lateId], style: "Dialogue" });

  const syn = await call("set_scene_properties", { documentId: docId, sceneRef: "@2", synopsis: "Reyes smokes in the rain." });
  check(!syn.isError && /synopsis set/.test(syn.text), "set_scene_properties (synopsis)", syn.text);
  const outline2 = await call("get_outline", { documentId: docId });
  check(/Reyes smokes in the rain\./.test(outline2.text), "synopsis visible in outline", outline2.text);

  const ns = await call("insert_scene", {
    documentId: docId,
    heading: "INT. ELEVATOR - DAY",
    elements: [{ style: "Action", text: "The doors close on both of them." }],
    position: { afterSceneRef: "@1" },
    synopsis: "A silent ride.",
  });
  check(!ns.isError && /new scene id: el_/.test(ns.text), "insert_scene", ns.text);
  const outline3 = (await call("get_outline", { documentId: docId })).text;
  const heads3 = outline3.split("\n").filter(l => /^\S+ el_/.test(l)).map(l => /"(.*?)"/.exec(l)?.[1]);
  check(heads3.length === 4 && heads3[1] === "INT. ELEVATOR - DAY", "insert_scene: 4 scenes, new one is second", outline3);
  check(/A silent ride\./.test(outline3), "insert_scene: synopsis set");
  const elev = await call("get_scene", { documentId: docId, sceneRef: "elevator" });
  check(/The doors close on both of them\./.test(elev.text), "insert_scene: first element present");

  const mv = await call("move_scenes", { documentId: docId, sceneRefs: ["diner"], to: { beforeSceneRef: "@1" } });
  check(!mv.isError && /APPLIED/.test(mv.text), "move_scenes", mv.text);
  const outline4 = (await call("get_outline", { documentId: docId })).text;
  const heads4 = outline4.split("\n").filter(l => /^\S+ el_/.test(l)).map(l => /"(.*?)"/.exec(l)?.[1]);
  check(heads4[0] === "INT. DINER - LATER" && heads4.length === 4, "move_scenes: diner is now first", outline4);
  const dinerScene = await call("get_scene", { documentId: docId, sceneRef: "diner" });
  check(/A waitress pours coffee/.test(dinerScene.text) && /I did\./.test(dinerScene.text), "moved scene kept its elements");

  const dry = await call("apply_commands", { documentId: docId, dryRun: true, commands: [{ id: "scene.setSynopsis", params: { scene: sceneOneId, value: "dry" } }] });
  check(!dry.isError && /DRY RUN/.test(dry.text), "apply_commands dryRun", dry.text);
  const bad = await call("apply_commands", { documentId: docId, commands: [{ id: "scene.setSynopsis", params: { scene: "el_00000000000000000000000000", value: "x" } }] });
  check(bad.isError && /COMMAND_INVALID/.test(bad.text) && /command #0/.test(bad.text) && /notFound/.test(bad.text), "COMMAND_INVALID mapped with index and reason", bad.text);
  const unknownStyle = await call("insert_elements", { documentId: docId, position: { atEndOfDocument: true }, elements: [{ style: "Bogus", text: "x" }] });
  check(unknownStyle.isError && /STYLE_UNKNOWN/.test(unknownStyle.text) && /Action/.test(unknownStyle.text), "unknown style refused locally with the valid list", unknownStyle.text);

  section("snapshots");
  const snap = await call("create_snapshot", { documentId: docId, name: "Smoke branch point", note: "before the risky rewrite" });
  const snapId = /"snapshotId":"(snap_[0-9A-Z]+)"/.exec(snap.text)?.[1];
  check(!snap.isError && !!snapId, "create_snapshot", snap.text);
  const snaps = await call("list_snapshots", { documentId: docId });
  check(snaps.text.includes(snapId!) && /Smoke branch point/.test(snaps.text), "list_snapshots shows it", snaps.text);
  const fork = await call("fork_snapshot", { snapshotId: snapId, title: "Smoke fork" });
  const forkId = /"documentId":"(doc_[0-9A-Z]+)"/.exec(fork.text)?.[1];
  check(!fork.isError && !!forkId && forkId !== docId, "fork_snapshot creates a NEW document", fork.text);
  const forkOutline = await call("get_outline", { documentId: forkId });
  check(/4 scenes/.test(forkOutline.text) && /ELEVATOR/.test(forkOutline.text), "the fork has the snapshot's content", forkOutline.text);
  await call("replace_element_text", { documentId: docId, elementId: lateId, text: "Edited after the snapshot." });
  const forkAgain = await call("get_scene", { documentId: forkId, sceneRef: "@2" });
  check(!/Edited after the snapshot\./.test(forkAgain.text), "editing the original does not touch the fork");

  section("export / import");
  const exp = await call("export_document", { documentId: docId, format: "fountain" });
  check(!exp.isError && /Edited after the snapshot\./.test(exp.text) && /INT\. ELEVATOR - DAY/.test(exp.text), "export_document fountain contains the edits", exp.text.slice(0, 400));
  const imp2 = await call("import_file", { projectId: project.id, filename: "tiny.fountain", content: "INT. LAB - DAY\n\nDust floats.\n", title: "Imported via MCP" });
  check(!imp2.isError && /"documentId":"doc_/.test(imp2.text) && /"scenes":1/.test(imp2.text), "import_file (content)", imp2.text);

  section("resources");
  const oRes = await client.readResource({ uri: `fadewright://documents/${docId}/outline` });
  check(/OUTLINE/.test(resText(oRes)) && /ELEVATOR/.test(resText(oRes)), "resource: outline");
  const sRes = await client.readResource({ uri: `fadewright://documents/${docId}/scene/${sceneOneId}` });
  check(/SCENE el_/.test(resText(sRes)), "resource: scene");

  section("missing things");
  const nf = await call("get_scene", { documentId: docId, sceneRef: "el_00000000000000000000000000" });
  check(nf.isError && /LOCATOR_NOT_FOUND/.test(nf.text), "unknown scene id is a clear error", nf.text);
  const nd = await call("get_outline", { documentId: "doc_00000000000000000000000000" });
  check(nd.isError && /NOT_FOUND/.test(nd.text), "unknown document is a clear error", nd.text);
  await client.close();

  // ---------------------------------------------------------------- read key
  section("read key: reads work, writes are refused clearly");
  {
    const ro = await connectMcp({ ...baseEnv, FADEWRIGHT_API_KEY: roKey.key });
    const w = await ro.call("whoami");
    check(/"scope":"read"/.test(w.text), "whoami reports scope read", w.text);
    const o = await ro.call("get_outline", { documentId: docId });
    check(!o.isError && /OUTLINE/.test(o.text), "get_outline works with a read key");
    const sc = await ro.call("get_scene", { documentId: docId, sceneRef: "@1" });
    check(!sc.isError && /SCENE el_/.test(sc.text), "get_scene works with a read key");
    const e = await ro.call("export_document", { documentId: docId });
    check(!e.isError && /Fountain|INT\./i.test(e.text), "export_document works with a read key", e.text.slice(0, 200));
    for (const [name, args] of [
      ["replace_element_text", { documentId: docId, elementId: lateId, text: "nope" }],
      ["insert_elements", { documentId: docId, position: { atEndOfDocument: true }, elements: [{ style: "Action", text: "nope" }] }],
      ["delete_elements", { documentId: docId, elementIds: [lateId] }],
      ["move_scenes", { documentId: docId, sceneRefs: ["@2"], to: { afterSceneRef: "@3" } }],
      ["create_snapshot", { documentId: docId, name: "nope" }],
    ] as const) {
      const r = await ro.call(name, args as Record<string, unknown>);
      check(r.isError && /read-only/.test(r.text) && !/403|Forbidden/i.test(r.text), `${name}: clear read-only error`, r.text);
    }
    const d = await ro.call("apply_commands", { documentId: docId, dryRun: true, commands: [{ id: "scene.setSynopsis", params: { scene: sceneOneId, value: "dry" } }] });
    check(!d.isError && /DRY RUN/.test(d.text), "dryRun preview is allowed with a read key", d.text);
    const still2 = await ro.call("get_scene", { documentId: docId, sceneRef: sceneOneId });
    check(!/nope/.test(still2.text), "nothing was written by the read key");
    await ro.client.close();
  }

  // ---------------------------------------------------------------- bad key
  section("bad key");
  {
    const bk = await connectMcp({ ...baseEnv, FADEWRIGHT_API_KEY: "fwk_aaaaaaaa_" + "A".repeat(43) });
    const r = await bk.call("list_projects");
    check(r.isError && /UNAUTHORIZED|rejected/.test(r.text), "an invalid key gives a clear message", r.text);
    await bk.client.close();
  }
} catch (error) {
  console.error("smoke crashed:", error);
  exitCode = 1;
} finally {
  await stopApi();
  cleanupRows();
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  console.log("FAILED:\n  " + failures.join("\n  "));
  exitCode = 1;
}
process.exit(exitCode);
