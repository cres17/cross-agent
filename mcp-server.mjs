/**
 * mcp-server.mjs — PR Review Agent MCP Server
 *
 * Exposes DocCheck + diff tools so any Claude interface (Desktop, Code, etc.)
 * can call them directly. No ANTHROPIC_API_KEY needed — Claude itself is the LLM.
 *
 * Three tools:
 *   run_doccheck      — rule-based doc-drift check (.reviewagent.yml), always free
 *   get_pr_diff       — redacted git diff, safe to pass directly to Claude
 *   get_changed_files — list of files changed between two refs
 *
 * ── Setup ────────────────────────────────────────────────────────────────────
 *
 * 1. Build the project first (compiles TypeScript to dist/):
 *      npm run build
 *
 * 2. Register with Claude Code (one-time, run from project root):
 *      claude mcp add pr-review-agent -- node /absolute/path/to/mcp-server.mjs
 *
 *    Or add to Claude Desktop config (~/.config/claude/claude_desktop_config.json):
 *      {
 *        "mcpServers": {
 *          "pr-review-agent": {
 *            "command": "node",
 *            "args": ["/absolute/path/to/mcp-server.mjs"]
 *          }
 *        }
 *      }
 *
 * 3. In Claude, use the tools:
 *      "run_doccheck on my PR against main"
 *      "get the pr diff between main and HEAD"
 *      "review the changes since main"
 */

import { Server }               from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { existsSync }    from 'fs';
import path              from 'path';

// ── Resolve compiled TypeScript modules ───────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir   = path.join(__dirname, 'dist');

if (!existsSync(distDir)) {
  process.stderr.write(
    '[mcp-server] dist/ not found. Run "npm run build" first.\n',
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
const { loadConfig }                  = require('./dist/config.js');
const { getChangedFiles, getDiff }    = require('./dist/git.js');
const { runDocCheck }                 = require('./dist/doccheck.js');
const { prepareForLlm }              = require('./dist/redact.js');

// ── Server setup ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'pr-review-agent', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// ── Tool definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'run_doccheck',
      description:
        'Rule-based documentation-drift check (no LLM). ' +
        'Reads .reviewagent.yml from the current working directory. ' +
        'If any file matching trigger_globs changed but no file matching ' +
        'require_any_of_globs changed, emits a finding (BLOCKER/MAJOR/MINOR/NIT). ' +
        'Use this first — it\'s free and instant.',
      inputSchema: {
        type: 'object',
        properties: {
          base: {
            type: 'string',
            description: 'Base branch or commit SHA (e.g. "main", "HEAD~1", "origin/main")',
          },
          head: {
            type: 'string',
            description: 'Head ref (default: "HEAD")',
          },
        },
        required: ['base'],
      },
    },
    {
      name: 'get_pr_diff',
      description:
        'Get the git diff between two refs with secrets automatically redacted. ' +
        'Strips .env files, *secret*, *credential*, *key* paths, dist/, node_modules/. ' +
        'Masks AWS keys, JWTs, PEM blocks, GitHub PATs, sk- tokens, Bearer headers. ' +
        'Safe to read and analyze directly.',
      inputSchema: {
        type: 'object',
        properties: {
          base: {
            type: 'string',
            description: 'Base branch or commit SHA',
          },
          head: {
            type: 'string',
            description: 'Head ref (default: "HEAD")',
          },
        },
        required: ['base'],
      },
    },
    {
      name: 'get_changed_files',
      description: 'List files changed between two git refs.',
      inputSchema: {
        type: 'object',
        properties: {
          base: { type: 'string', description: 'Base branch or commit SHA' },
          head: { type: 'string', description: 'Head ref (default: "HEAD")' },
        },
        required: ['base'],
      },
    },
  ],
}));

// ── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const base = args?.['base'];
  const head = args?.['head'] ?? 'HEAD';

  try {
    if (name === 'run_doccheck') {
      const config       = loadConfig();
      const changedFiles = getChangedFiles(base, head);
      const result       = runDocCheck(changedFiles, config.doccheck);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === 'get_pr_diff') {
      const config       = loadConfig();
      const changedFiles = getChangedFiles(base, head);
      const rawDiff      = getDiff(base, head);
      const { redactedDiff, truncated } = prepareForLlm(
        changedFiles,
        rawDiff,
        config.maxDiffChars,
        {
          extraExcludeGlobs:   config.excludeGlobs,
          extraRedactPatterns: config.extraRedactPatterns,
        },
      );
      const suffix = truncated
        ? `\n\n[diff truncated at ${config.maxDiffChars} chars]`
        : '';
      return {
        content: [{ type: 'text', text: redactedDiff + suffix }],
      };
    }

    if (name === 'get_changed_files') {
      const files = getChangedFiles(base, head);
      return {
        content: [{ type: 'text', text: JSON.stringify(files, null, 2) }],
      };
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (err) {
    return {
      content: [
        { type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ],
      isError: true,
    };
  }
});

// ── Connect ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
