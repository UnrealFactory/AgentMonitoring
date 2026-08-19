#!/usr/bin/env node
// agentmon MCP server — a stdio wrapper over the agentmon CLI.
//
// Identity (vault, project, agent) is configuration, not conversation: it is given once
// on this command line so that no tool call has to spend tokens repeating it. --vault is
// required and is never inferred; the CLI's own `./vault` discovery would make the target
// of a write depend on the working directory an MCP client happened to start us in.
//
//   node server.mjs --vault <dir> [--project <slug>] [--agent <handle>] [--bin <agentmon>]

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";

import { resolveBinary } from "./lib/cli.mjs";
import { TOOLS, callTool } from "./lib/tools.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const USAGE = `agentmon MCP server

  node server.mjs --vault <dir> [--project <slug>] [--agent <handle>] [--bin <agentmon>]

  --vault    required; the vault directory to read and write. Never discovered.
  --project  default project slug for every tool (a call can override it).
  --agent    default agent handle written onto records (a call can override it).
  --bin      path to the agentmon binary; else $AGENTMON_BIN, else target/release.
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { help: true };
    const m = /^--(vault|project|agent|bin)(?:=(.*))?$/.exec(a);
    if (!m) return { bad: a };
    out[m[1]] = m[2] !== undefined ? m[2] : argv[++i];
    if (out[m[1]] === undefined) return { bad: `${a} needs a value` };
  }
  return out;
}

function version() {
  try {
    return JSON.parse(readFileSync(path.join(here, "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// stderr only: stdout is the JSON-RPC channel and a stray line would corrupt it.
const note = (s) => process.stderr.write(`agentmon-mcp: ${s}\n`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stderr.write(USAGE);
    process.exit(0);
  }
  if (args.bad) {
    note(`unknown option ${args.bad}\n\n${USAGE}`);
    process.exit(2);
  }
  if (!args.vault || !String(args.vault).trim()) {
    note(`--vault <dir> is required — this server never guesses a vault, because a guess\n  would write real records into whichever directory the client started us in.\n\n${USAGE}`);
    process.exit(2);
  }

  const vault = path.resolve(String(args.vault).trim());
  const { bin, found } = resolveBinary(args.bin);
  const ctx = { vault, bin, project: args.project?.trim() || "", agent: args.agent?.trim() || "" };

  if (!existsSync(path.join(vault, "vault.json"))) {
    note(`no vault.json in ${vault} — every call will fail until you run \`agentmon init --vault "${vault}"\`.`);
  }
  if (!found) note(`agentmon binary not found; trying '${bin}' on PATH. Build it with \`cargo build --release -p agentmon-cli\` or pass --bin.`);

  const server = new Server(
    { name: "agentmon", version: version() },
    // Tools only. No resources or prompts: each would be another list the client fetches
    // and keeps, and neither would say anything the five tools do not.
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await callTool(name, args, ctx);
    if (!result) throw new McpError(ErrorCode.MethodNotFound, `unknown tool '${name}'`);
    return result;
  });

  await server.connect(new StdioServerTransport());
  note(`ready · vault ${vault}${ctx.project ? ` · project ${ctx.project}` : ""}${ctx.agent ? ` · agent ${ctx.agent}` : ""}`);
}

main().catch((err) => {
  note(`fatal: ${err?.stack ?? err}`);
  process.exit(1);
});
