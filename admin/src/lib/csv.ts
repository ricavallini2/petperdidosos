// Exportação CSV no cliente — sem dependências. Gera e baixa um arquivo a
// partir das linhas já carregadas na tela.

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function escapeCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  // Aspas e separadores → envolve em aspas duplas e escapa as internas
  if (/[";\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportToCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]) {
  const head = columns.map((c) => escapeCell(c.header)).join(';');
  const body = rows
    .map((r) => columns.map((c) => escapeCell(c.value(r))).join(';'))
    .join('\n');
  // BOM para o Excel reconhecer UTF-8 (acentos)
  const csv = '﻿' + head + '\n' + body;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
