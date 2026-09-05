export function splitSqlScript(script) {
  const statements = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < script.length; index += 1) {
    const character = script[index];
    if (quote) {
      const closing = quote === '[' ? ']' : quote;
      if (character === closing) {
        if (quote !== '[' && script[index + 1] === closing) index += 1;
        else quote = null;
      }
      continue;
    }
    if (["'", '"', '`', '['].includes(character)) {
      quote = character;
      continue;
    }
    if (character !== ';') continue;
    const statement = script.slice(start, index + 1).trim();
    if (statement) statements.push(statement);
    start = index + 1;
  }
  const remainder = script.slice(start).trim();
  if (remainder)
    statements.push(remainder.endsWith(';') ? remainder : `${remainder};`);
  return statements;
}

export function makeD1ExportRestorable(script) {
  const statements = splitSqlScript(script);
  const createTables = statements.filter((statement) =>
    /^CREATE\s+TABLE\b/i.test(statement),
  );
  const deletes = statements.filter((statement) =>
    /^DELETE\s+FROM\b/i.test(statement),
  );
  const inserts = statements.filter((statement) =>
    /^INSERT\s+INTO\b/i.test(statement),
  );
  const trailingSchema = statements.filter(
    (statement) =>
      !/^PRAGMA\b|^CREATE\s+TABLE\b|^DELETE\s+FROM\b|^INSERT\s+INTO\b/i.test(
        statement,
      ),
  );
  const dependencyOrder = [
    'd1_migrations',
    'clients',
    'conversations',
    'messages',
    'whatsapp_templates',
    'webhook_events',
    'integration_status',
    'auth_login_attempts',
    'opportunities',
    'handoffs',
    'follow_ups',
    'appointments',
    'audit_events',
    'sqlite_sequence',
  ];
  const rank = new Map(dependencyOrder.map((table, index) => [table, index]));
  const tableName = (statement) => {
    const token = statement.match(/^INSERT\s+INTO\s+(\S+)/i)?.[1] ?? '';
    return token
      .replaceAll('"', '')
      .replaceAll('`', '')
      .replaceAll('[', '')
      .replaceAll(']', '');
  };
  inserts.sort(
    (left, right) =>
      (rank.get(tableName(left)) ?? 50) - (rank.get(tableName(right)) ?? 50),
  );
  return (
    [...createTables, ...deletes, ...inserts, ...trailingSchema].join('\n') +
    '\n'
  );
}
