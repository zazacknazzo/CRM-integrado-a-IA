import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeD1ExportRestorable,
  splitSqlScript,
} from '../scripts/d1-export.mjs';

test('SQL splitter preserves semicolons and escaped quotes inside values', () => {
  const statements = splitSqlScript(
    "INSERT INTO `clients` VALUES('Ana; D''Ávila'); CREATE TABLE `clients` (`name` text);",
  );
  assert.equal(statements.length, 2);
  assert.match(statements[0], /Ana; D''Ávila/);
});

test('D1 export is reordered so foreign-key parents and data exist first', () => {
  const source = [
    'PRAGMA defer_foreign_keys=TRUE;',
    'CREATE TABLE `audit_events` (`conversation_id` text REFERENCES conversations(id));',
    "INSERT INTO `audit_events` VALUES('conversation-1');",
    'CREATE TABLE `conversations` (`id` text PRIMARY KEY, `client_id` text REFERENCES clients(id));',
    "INSERT INTO `conversations` VALUES('conversation-1', 'client-1');",
    'CREATE TABLE `clients` (`id` text PRIMARY KEY);',
    "INSERT INTO `clients` VALUES('client-1');",
    'CREATE INDEX `idx_audit` ON `audit_events` (`conversation_id`);',
  ].join('\n');
  const ordered = makeD1ExportRestorable(source);
  assert.ok(
    ordered.indexOf('CREATE TABLE `clients`') <
      ordered.indexOf('INSERT INTO `clients`'),
  );
  assert.ok(
    ordered.indexOf('INSERT INTO `clients`') <
      ordered.indexOf('INSERT INTO `conversations`'),
  );
  assert.ok(
    ordered.indexOf('INSERT INTO `conversations`') <
      ordered.indexOf('INSERT INTO `audit_events`'),
  );
  assert.ok(
    ordered.indexOf('INSERT INTO `audit_events`') <
      ordered.indexOf('CREATE INDEX `idx_audit`'),
  );
});
