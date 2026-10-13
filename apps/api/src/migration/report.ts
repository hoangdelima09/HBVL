import type { RunSummary } from './runner';

/** Human-readable report. Contains counts, legacy ids and issue codes only — never e-mail addresses, names, passwords or message bodies. */
export function renderMarkdown(s: RunSummary): string {
  const lines: string[] = [];
  lines.push(`# Báo cáo migration WordPress — ${s.mode}`, '');
  lines.push(
    `- Run: \`${s.runId}\``,
    `- Trạng thái: **${s.status}**${s.resumed ? ' (tiếp tục từ run trước)' : ''}`,
    `- Nguồn (sha256 nội dung): \`${s.fingerprint}\``,
    `- Thời gian: ${(s.durationMs / 1000).toFixed(1)} s`,
    `- Phases: ${s.phases.join(' → ')}`,
    `- Lỗi (ERROR): ${s.errorCount}`,
    '',
  );
  if (s.mode === 'DRY_RUN') lines.push('> DRY_RUN: toàn bộ thay đổi dữ liệu đã được rollback; các số liệu dưới đây là những gì **sẽ** xảy ra khi apply.', '');
  lines.push('## Số liệu theo thực thể', '');
  for (const [entity, counters] of Object.entries(s.stats)) {
    lines.push(`### ${entity}`, '', '| Chỉ số | Số lượng |', '|---|---:|');
    for (const [k, v] of Object.entries(counters)) lines.push(`| ${k} | ${v} |`);
    lines.push('');
  }
  lines.push('## Đối soát nguồn ↔ đích', '', '| Nguồn WordPress | Số dòng nguồn |', '|---|---:|');
  for (const [k, v] of Object.entries(s.reconciliation.source)) lines.push(`| ${k} | ${v} |`);
  lines.push('', '| Loại truy vết được (legacy_id_map) | Số bản ghi |', '|---|---:|');
  for (const [k, v] of Object.entries(s.reconciliation.mapped)) lines.push(`| ${k} | ${v} |`);
  if (s.reconciliation.mismatches.length) {
    lines.push('', '**Sai lệch:**');
    for (const m of s.reconciliation.mismatches) lines.push(`- ${m.type}: mong đợi ${m.expected}, thực tế ${m.actual}`);
  }
  lines.push('', '## Vấn đề (theo mã)', '', '| Mức | Mã | Số lần |', '|---|---|---:|');
  for (const i of s.issues) lines.push(`| ${i.severity} | ${i.code} | ${i.count} |`);
  lines.push('');
  return lines.join('\n');
}
