/**
 * writer.js
 * 리뷰 결과를 out/ 디렉토리에 기록한다.
 * - out/review_result.json  (필수, contract 3.1)
 * - out/review_report.md    (권장, contract 3.2)
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'out');

function ensureOutDir() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
}

function writeJSON(result) {
  const filePath = path.join(OUT_DIR, 'review_result.json');
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`[writer] Written: ${filePath}`);
}

function severityBadge(s) {
  return { HIGH: '🔴 HIGH', MEDIUM: '🟡 MEDIUM', LOW: '🟢 LOW' }[s] || s;
}

function writeMarkdown(result) {
  const meta = result.metadata || {};
  const lines = [
    `# PR Review Report`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Verdict | **${result.verdict}** |`,
    `| PR | #${meta.pr_number ?? 'N/A'} |`,
    `| SHA | \`${meta.sha ?? 'N/A'}\` |`,
    `| Reviewed at | ${meta.reviewed_at ?? 'N/A'} |`,
    ``,
    `---`,
    ``,
  ];

  for (const expert of result.experts || []) {
    lines.push(`## Expert: ${expert.name}`);
    lines.push('');

    if (!expert.findings?.length) {
      lines.push('_No findings._');
      lines.push('');
      continue;
    }

    for (const f of expert.findings) {
      lines.push(`### ${severityBadge(f.severity)} — ${f.title}`);
      lines.push('');
      lines.push(f.description);
      lines.push('');
      if (f.evidence?.length) {
        lines.push('**Evidence:**');
        f.evidence.forEach(e => lines.push(`- \`${e}\``));
        lines.push('');
      }
      lines.push(`**Recommendation:** ${f.recommendation}`);
      lines.push('');
    }
  }

  if (result.doc_updates_needed?.length) {
    lines.push('---');
    lines.push('');
    lines.push('## Documentation Updates Needed');
    lines.push('');
    for (const d of result.doc_updates_needed) {
      lines.push(`### ${d.doc_path}`);
      lines.push(`**Reason:** ${d.reason}`);
      if (d.evidence?.length) {
        d.evidence.forEach(e => lines.push(`- \`${e}\``));
      }
      lines.push('');
    }
  }

  if (result.questions?.length) {
    lines.push('---');
    lines.push('');
    lines.push('## Open Questions (UNCLEAR)');
    lines.push('');
    result.questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
    lines.push('');
  }

  const filePath = path.join(OUT_DIR, 'review_report.md');
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  console.log(`[writer] Written: ${filePath}`);
}

function writeOutputs(result) {
  ensureOutDir();
  writeJSON(result);
  writeMarkdown(result);
}

module.exports = { writeOutputs };
