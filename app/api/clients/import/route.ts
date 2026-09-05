import readXlsxFile from 'read-excel-file/web-worker';
import { normalizePhone } from '../../../../core/phone.ts';
import { getRawDb } from '../../../../db/index.ts';
import { requireCrmOrInternalAuth } from '../../../../lib/internal-auth.ts';

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"' && quoted && input[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function headerIndex(headers: string[], names: string[]) {
  return headers.findIndex((header) =>
    names.includes(header.toLocaleLowerCase('pt-BR').trim()),
  );
}

function cellString(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return String(value);
  if (value instanceof Date) return value.toISOString();
  return '';
}

export async function POST(request: Request) {
  const unauthorized = await requireCrmOrInternalAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File))
      return Response.json({ error: 'file is required' }, { status: 400 });
    if (file.size > 5 * 1024 * 1024)
      return Response.json(
        { error: 'File exceeds 5 MB limit' },
        { status: 400 },
      );
    const extension = file.name.split('.').pop()?.toLocaleLowerCase();
    let rows: unknown[][];
    if (extension === 'csv') rows = parseCsv(await file.text());
    else if (extension === 'xlsx' || extension === 'xls')
      rows = await readXlsxFile(await file.arrayBuffer());
    else
      return Response.json(
        { error: 'Only CSV, XLSX and XLS files are supported' },
        { status: 400 },
      );
    if (rows.length < 2)
      return Response.json(
        { error: 'The file has no data rows' },
        { status: 400 },
      );
    const headerRow = rows
      .slice(0, 10)
      .findIndex(
        (row) =>
          headerIndex(row.map(cellString), [
            'telefone',
            'phone',
            'whatsapp',
            'celular',
          ]) >= 0,
      );
    if (headerRow < 0)
      return Response.json(
        {
          error:
            'Phone column not found (use telefone, phone, whatsapp or celular)',
        },
        { status: 400 },
      );
    const dataRows = rows.slice(headerRow + 1);
    if (dataRows.length > 5000)
      return Response.json(
        { error: 'Import limit is 5,000 rows' },
        { status: 400 },
      );

    const headers = rows[headerRow].map(cellString);
    const phoneColumn = headerIndex(headers, [
      'telefone',
      'phone',
      'whatsapp',
      'celular',
    ]);
    const nameColumn = headerIndex(headers, ['nome', 'name', 'cliente']);
    const sourceColumn = headerIndex(headers, [
      'origem',
      'source',
      'lead_source',
    ]);
    const db = getRawDb();
    let imported = 0;
    let skipped = 0;
    const errors: Array<{ row: number; error: string }> = [];
    for (const [offset, values] of dataRows.entries()) {
      const phone = normalizePhone(cellString(values[phoneColumn]));
      if (!phone) {
        skipped += 1;
        errors.push({ row: offset + headerRow + 2, error: 'Invalid phone' });
        continue;
      }
      const timestamp = new Date().toISOString();
      const name =
        nameColumn >= 0 ? cellString(values[nameColumn]).trim() || null : null;
      const source =
        sourceColumn >= 0
          ? cellString(values[sourceColumn]).trim() || 'UNKNOWN'
          : 'UNKNOWN';
      await db
        .prepare(
          `INSERT INTO clients (id, phone_e164, name, name_source, lead_source, promotional_opt_out, created_at, updated_at)
         VALUES (?, ?, ?, 'IMPORT', ?, 0, ?, ?)
         ON CONFLICT(phone_e164) DO UPDATE SET
         name = COALESCE(clients.name, excluded.name),
         lead_source = CASE WHEN clients.lead_source = 'UNKNOWN' THEN excluded.lead_source ELSE clients.lead_source END,
         updated_at = excluded.updated_at`,
        )
        .bind(crypto.randomUUID(), phone, name, source, timestamp, timestamp)
        .run();
      imported += 1;
    }
    return Response.json({ imported, skipped, errors: errors.slice(0, 50) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 },
    );
  }
}
