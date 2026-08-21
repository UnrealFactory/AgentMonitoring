#!/usr/bin/env node
// agentmon MCP server — a stdio wrapper over the agentmon CLI.
//
// Identity (project folder, agent) is configuration, not conversation: it is given once
// on this command line so that no tool call has to spend tokens repeating it. --dir is
// required and is never inferred; the CLI's own walk-up discovery would make the target
// of a write depend on the working directory an MCP client happened to start us in.
//
//   node server.mjs --dir <folder> [--agent <handle>] [--bin <agentmon>]

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

  node server.mjs --dir <folder> [--agent <handle>] [--bin <agentmon>]

  --dir      required; the project folder to read and write — the AgentMonitoring
             directory, or the folder that contains one. Never discovered.
  --agent    default agent handle written onto records (a call can override it).
  --bin      path to the agentmon binary; else $AGENTMON_BIN, else target/release.
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { help: true };
    const m = /^--(dir|agent|bin)(?:=(.*))?$/.exec(a);
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

/** The AgentMonitoring directory for what the human passed: itself, or its child. */
export function dataDirFor(dir) {
  if (existsSync(path.join(dir, "project.json"))) return dir;
  return path.join(dir, "AgentMonitoring");
}

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
  if (!args.dir || !String(args.dir).trim()) {
    note(`--dir <folder> is required — this server never guesses a project, because a guess\n  would write real records into whichever directory the client started us in.\n\n${USAGE}`);
    process.exit(2);
  }

  const dir = dataDirFor(path.resolve(String(args.dir).trim()));
  const { bin, found } = resolveBinary(args.bin);
  const ctx = { dir, bin, agent: args.agent?.trim() || "" };

  if (!existsSync(path.join(dir, "project.json"))) {
    note(`no project.json in ${dir} — every call will fail until you run \`agentmon init --dir "${path.dirname(dir)}" --name "<project name>"\`.`);
  }
  if (!found) note(`agentmon binary not found; trying '${bin}' on PATH. Build it with \`cargo build --release -p agentmon-cli\` or pass --bin.`);

  const server = new Server(
    { name: "agentmon", version: version() },
    // Tools only. No resources or prompts: each would be another list the client fetches
    // and keeps, and neither would say anything the seven tools do not. The instructions
    // carry the one session-level rule no single tool description can: read the shared
    // notes before working — they, not any model-side memory, are the project's memory.
    {
      capabilities: { tools: {} },
      instructions:
        "Start every session with note(action=\"list\") and read the essential notes it surfaces first — the shared notes are the project's memory across sessions and agents; keep knowledge there, not in any private memory of your own.",
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await callTool(name, args, ctx);
    if (!result) throw new McpError(ErrorCode.MethodNotFound, `unknown tool '${name}'`);
    return result;
  });

  await server.connect(new StdioServerTransport());
  note(`ready · project ${dir}${ctx.agent ? ` · agent ${ctx.agent}` : ""}`);
}

main().catch((err) => {
  note(`fatal: ${err?.stack ?? err}`);
  process.exit(1);
});
