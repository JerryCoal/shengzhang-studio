import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { seedState } from './domain.mjs';
import { seal, unseal } from './crypto-box.mjs';
import { normalizeWorkflow } from './workflow.mjs';
import { createWorkStorage } from './work-storage.mjs';

export function createStore(filename = resolve('data', 'studio.sqlite'), options = {}) {
  const key = options.key ? Buffer.from(options.key) : null;
  const scope = options.scope || 'workspace';
  const encode = state => key ? seal(Buffer.from(JSON.stringify(state)), key, scope).toString('base64') : JSON.stringify(state);
  const decode = body => normalizeWorkflow(JSON.parse(key ? unseal(Buffer.from(body, 'base64'), key, scope).toString('utf8') : body));
  const encodeWork = value => key ? seal(Buffer.from(JSON.stringify(value)), key, `${scope}:work-v1`).toString('base64') : JSON.stringify(value);
  const decodeWork = body => JSON.parse(key ? unseal(Buffer.from(body, 'base64'), key, `${scope}:work-v1`).toString('utf8') : body);
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
  const read = db.prepare('SELECT body FROM workspace WHERE id = 1');
  const write = db.prepare('INSERT INTO workspace (id, body) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body');
  if (!read.get()) write.run(encode(seedState()));
  let inTransaction = false;
  const transaction = callback => {
    if (inTransaction) return callback();
    db.exec('BEGIN IMMEDIATE'); inTransaction = true;
    try { const result = callback(); if (result && typeof result.then === 'function') throw new Error('工作区事务必须同步执行'); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { inTransaction = false; }
  };
  const work = createWorkStorage(db, { encode: encodeWork, decode: decodeWork, transaction });
  return {
    work,
    get: () => decode(read.get().body),
    mutate: callback => transaction(() => { const state = decode(read.get().body); const result = callback(state); if (result && typeof result.then === 'function') throw new Error('工作区事务必须同步执行'); write.run(encode(state)); return result; }),
    close: () => { work.close(); db.close(); key?.fill(0); },
  };
}
