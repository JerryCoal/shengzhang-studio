// Work records use the workspace database/key, but never rewrite its JSON blob
// for an activity event. Transactions may include a legacy workspace mutation.
export function createWorkStorage(db, { encode, decode, transaction }) {
  const closers = new Set();
  db.exec(`CREATE TABLE IF NOT EXISTS work_records (
    kind TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL, body TEXT NOT NULL,
    PRIMARY KEY(kind,id));
    CREATE INDEX IF NOT EXISTS work_records_owner ON work_records(kind,owner);
    CREATE TABLE IF NOT EXISTS work_events (
      run_id TEXT NOT NULL, sequence INTEGER NOT NULL, id TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL, PRIMARY KEY(run_id,sequence));
    CREATE TABLE IF NOT EXISTS work_schema (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT OR IGNORE INTO work_schema VALUES(1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
  const read = db.prepare('SELECT body FROM work_records WHERE kind=? AND id=?');
  const put = db.prepare('INSERT INTO work_records(kind,id,owner,body) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET owner=excluded.owner,body=excluded.body');
  return {
    transaction,
    onClose(callback) { closers.add(callback); return () => closers.delete(callback); },
    close() { for (const callback of closers) callback(); closers.clear(); },
    get(kind, id) { const row = read.get(kind, id); return row ? decode(row.body) : null; },
    put(kind, value) { put.run(kind, value.id, value.ownerId || '', encode(value)); return structuredClone(value); },
    all(kind, ownerId) {
      const rows = ownerId === undefined ? db.prepare('SELECT body FROM work_records WHERE kind=? ORDER BY rowid').all(kind)
        : db.prepare('SELECT body FROM work_records WHERE kind=? AND owner=? ORDER BY rowid').all(kind, ownerId);
      return rows.map(row => decode(row.body));
    },
    append(event) {
      const sequence = Math.max(Number(db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM work_events WHERE run_id=?').get(event.runId).n), this.get('archive', event.runId)?.through || 0) + 1;
      const record = { ...event, sequence };
      db.prepare('INSERT INTO work_events(run_id,sequence,id,body) VALUES(?,?,?,?)').run(record.runId, sequence, record.id, encode(record));
      return record;
    },
    events(runId, after = 0, limit = 100) {
      return db.prepare('SELECT body FROM work_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(runId, after, limit).map(row => decode(row.body));
    },
    cursor(runId) { return Math.max(Number(db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM work_events WHERE run_id=?').get(runId).n), this.get('archive', runId)?.through || 0); },
    counts() { return { records: Number(db.prepare('SELECT count(*) AS n FROM work_records').get().n), events: Number(db.prepare('SELECT count(*) AS n FROM work_events').get().n) }; },
    // Explicit archive only; execution and notifications never trigger retention.
    archiveEvents(runId, through) {
      return transaction(() => {
        const record = this.get('archive', runId) || { id: runId, through: 0, chunks: [] };
        const events = this.events(runId, record.through, 10001).filter(event => event.sequence <= through);
        if (events.length > 10000) throw new Error('每次最多归档 10000 条活动');
        if (!events.length) return record;
        record.chunks.push(events); record.through = events.at(-1).sequence;
        this.put('archive', record);
        db.prepare('DELETE FROM work_events WHERE run_id=? AND sequence<=?').run(runId, record.through);
        return record;
      });
    },
  };
}
