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
 * All tools accept an optional `path` parameter (absolute path to the git repo).
 * This is required when using Claude Desktop — Claude Code sets cwd automatically.
 *
 * ── Setup ────────────────────────────────────────────────────────────────────
 *
 * DXT (Claude Desktop):
 *   Settings → Developer → pr-review-agent.dxt 드래그앤드롭
 *   사용: "C:/my-project 기준으로 main 대비 리뷰해줘"
 *
 * Claude Code (manual):
 *   claude mcp add pr-review-agent -- node /absolute/path/to/mcp-server.mjs
 *   사용: "/review-pr main" (cwd 자동 설정됨)
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
const { loadConfig }               = require('./dist/config.js');
const { getChangedFiles, getDiff } = require('./dist/git.js');
const { runDocCheck }              = require('./dist/doccheck.js');
const { prepareForLlm }            = require('./dist/redact.js');

// ── Server setup ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'pr-review-agent', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Temporarily changes cwd to `projectPath` (if provided), runs `fn()`, then restores.
 * Required because git commands and config loading use process.cwd().
 */
function withCwd(projectPath, fn) {
  if (!projectPath) return fn();
  const original = process.cwd();
  try {
    process.chdir(projectPath);
    return fn();
  } finally {
    process.chdir(original);
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'run_doccheck',
      description:
        'Rule-based documentation-drift check (no LLM, always free). ' +
        'Reads .reviewagent.yml from the project directory. ' +
        'If files matching trigger_globs changed but required docs did not, emits a finding. ' +
        'Provide `path` when using Claude Desktop (absolute path to your git project).',
      inputSchema: {
        type: 'object',
        properties: {
          base: {
            type: 'string',
            description: 'Base branch or commit SHA to compare against (e.g. "main", "HEAD~1")',
          },
          head: {
            type: 'string',
            description: 'Head ref (default: "HEAD")',
          },
          path: {
            type: 'string',
            description: 'Absolute path to the git project (e.g. "C:/Users/me/my-project"). Required in Claude Desktop.',
          },
        },
        required: ['base'],
      },
    },
    {
      name: 'get_pr_diff',
      description:
        'Get the git diff between two refs with secrets automatically redacted. ' +
        'Strips .env, *secret*, *key*, dist/, node_modules/. ' +
        'Masks AWS keys, JWTs, PEM blocks, GitHub PATs, sk- tokens, Bearer headers. ' +
        'Provide `path` when using Claude Desktop (absolute path to your git project).',
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
          path: {
            type: 'string',
            description: 'Absolute path to the git project. Required in Claude Desktop.',
          },
        },
        required: ['base'],
      },
    },
    {
      name: 'get_changed_files',
      description:
        'List files changed between two git refs. ' +
        'Provide `path` when using Claude Desktop (absolute path to your git project).',
      inputSchema: {
        type: 'object',
        properties: {
          base: { type: 'string', description: 'Base branch or commit SHA' },
          head: { type: 'string', description: 'Head ref (default: "HEAD")' },
          path: {
            type: 'string',
            description: 'Absolute path to the git project. Required in Claude Desktop.',
          },
        },
        required: ['base'],
      },
    },
  ],
}));

// ── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const base        = args?.['base'];
  const head        = args?.['head'] ?? 'HEAD';
  const projectPath = args?.['path'] ?? null;

  try {
    if (name === 'run_doccheck') {
      return withCwd(projectPath, () => {
        const config       = loadConfig();
        const changedFiles = getChangedFiles(base, head);
        const result       = runDocCheck(changedFiles, config.doccheck);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      });
    }

    if (name === 'get_pr_diff') {
      return withCwd(projectPath, () => {
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
      });
    }

    if (name === 'get_changed_files') {
      return withCwd(projectPath, () => {
        const files = getChangedFiles(base, head);
        return {
          content: [{ type: 'text', text: JSON.stringify(files, null, 2) }],
        };
      });
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = msg.includes('not a git repository')
      ? '\n\nHint: `path` 파라미터로 git 프로젝트 경로를 지정해주세요.\n예: path = "C:/Users/me/my-project"'
      : '';
    return {
      content: [{ type: 'text', text: `Error: ${msg}${hint}` }],
      isError: true,
    };
  }
});

// ── Connect ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
