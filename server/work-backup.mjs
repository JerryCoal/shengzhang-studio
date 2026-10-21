import { createHash } from 'node:crypto';
import { currentActor } from './request-actor.mjs';
import { normalizeWorkflow } from './workflow.mjs';

// Portable owner backups contain private business content, not authentication
// secrets. They are JSON, NOT encrypted archives or authorization signatures.
// Keep the file private. For a full encrypted database rollback, stop every
// writer and preserve the matching users/key/vault files separately; an older
// application must NEVER write the upgraded database. This service only restores
// to a distinct, explicitly empty store and never opens files or starts workers.
export const WORK_BACKUP_FORMAT = 'shengzhang.work-backup';
export const WORK_BACKUP_VERSION = 1;
const KINDS = ['plan', 'task', 'run', 'artifact', 'artifact-head', 'notification', 'view', 'controller-view', 'message', 'migration', 'command', 'backup-command', 'backup-restore'];
const SECRET_KEY = /password|cookie|authorization|api[_-]?key|secret|credential|(?:access|refresh|session|bearer)[_-]?token|^token$|master[_-]?key|protected[_-]?key/i;
const MAX_BYTES = 64 * 1024 * 1024;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const clone = value => structuredClone(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 600;
function clean(value, paths = [], path = '$', depth = 0) {
  if (depth > 70) fail('备份对象嵌套过深');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const result = value.replace(/Bearer\s+[\w.\-+/=]+/gi, 'Bearer [已移除]').replace(/(?:sk-|sess-)[a-zA-Z0-9_-]{12,}/g, '[已移除]').replace(/([?&](?:access_token|token|key|secret|xsec_token|signature)=)[^\s&#]+/gi, '$1[已移除]');
    if (result !== value) paths.push(path); return result;
  }
  if (Array.isArray(value)) return value.map((item, index) => clean(item, paths, `${path}[${index}]`, depth + 1));
  if (!isObject(value)) fail('备份仅支持普通 JSON 数据');
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('备份包含不安全对象字段');
    if (SECRET_KEY.test(key)) { paths.push(`${path}.${key}`); continue; }
    result[key] = clean(item, paths, `${path}.${key}`, depth + 1);
  }
  return result;
}
function visibleWorkspace(store, ownerId) {
  const state = clone(store.get());
  // Raw stores and team-projected stores are both supported. Never include a
  // different member's unfinished forms, private chat or personal selections.
  if (state.teamPreferences) {
    const preferences = state.teamPreferences[ownerId] || {};
    for (const field of ['activeCreationAccounts', 'mcpActiveAccounts', 'projectDrafts', 'appearance', 'guide', 'agentWorkspace', 'taskJournal', 'contentEditDrafts']) {
      delete state[field]; if (preferences[field] !== undefined) state[field] = clone(preferences[field]);
    }
    state.briefImports = [...(state.briefImports || []).filter(job => job.editorKey !== 'new'), ...clone(preferences.newBriefImports || [])];
    for (const project of state.projects || []) { delete project.creationSelections; if (preferences.creationSelections?.[project.id]) project.creationSelections = clone(preferences.creationSelections[project.id]); }
    delete state.teamPreferences;
  }
  delete state.teamRevision;
  return state;
}
function ensureEmpty(store) {
  const expected = normalizeWorkflow({ schemaVersion: 1, projects: [], accounts: [], activities: [] }), actual = store.get();
  if (canonical(actual) !== canonical(expected) || store.work.counts().records || store.work.counts().events) fail('只能恢复到全新、明确清空示例内容的独立数据库；不能覆盖现有工作区', 409);
}

export function validateWorkBackup(input) {
  let value;
  try {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    if (Buffer.byteLength(text || '') > MAX_BYTES) fail('备份超过 64 MB，请使用受保护的完整数据库副本');
    value = JSON.parse(text);
  } catch (error) { if (error.status) throw error; fail('备份不是有效 JSON'); }
  if (!isObject(value) || value.format !== WORK_BACKUP_FORMAT || value.version !== WORK_BACKUP_VERSION || value.scope !== 'owner' || !id(value.ownerId)) fail('备份格式或版本不受支持');
  const { sha256, ...content } = value;
  if (typeof sha256 !== 'string' || digest(content) !== sha256) fail('备份校验值不匹配，文件可能不完整');
  const redactions = []; clean(content.workspace, redactions); clean(content.records, redactions); clean(content.events, redactions);
  if (redactions.length) fail('备份仍含凭据类数据，请重新导出安全备份');
  if (!isObject(value.workspace) || !Array.isArray(value.workspace.projects) || !Array.isArray(value.workspace.accounts) || value.workspace.teamPreferences) fail('工作区结构不正确或含其他成员偏好');
  for (const rows of [value.workspace.projects, value.workspace.accounts]) if (rows.some(row => !isObject(row) || !id(row.id)) || new Set(rows.map(row => row.id)).size !== rows.length) fail('项目或账号 ID 无效或重复');
  if (!Array.isArray(value.records) || value.records.length > 50000 || !Array.isArray(value.events) || value.events.length > 250000) fail('备份记录数量不受支持');
  const tables = new Map(KINDS.map(kind => [kind, new Map()])); tables.set('archive', new Map());
  for (const record of value.records) {
    if (!isObject(record) || !tables.has(record.kind) || !isObject(record.value) || !id(record.value.id)) fail('备份含不受支持的记录');
    const row = record.value, table = tables.get(record.kind);
    if (table.has(row.id)) fail('备份含重复记录 ID');
    if (record.kind !== 'archive' && row.ownerId !== value.ownerId) fail('备份混入其他成员记录', 403);
    table.set(row.id, row);
  }
  const tasks = tables.get('task'), runs = tables.get('run'), artifacts = tables.get('artifact'), eventIds = new Set(), cursors = new Map();
  for (const run of runs.values()) {
    const task = tasks.get(run.taskId);
    if (!task || task.projectId !== run.projectId || !isObject(run.node) || !Array.isArray(run.attempts)) fail('运行与所属任务关系不完整');
    if (!['waiting_dependencies', 'queued', 'running', 'waiting_user', 'paused', 'succeeded', 'failed', 'cancelled', 'needs_reconciliation'].includes(run.status)) fail('运行状态不受支持');
    if ((run.dependencyRuns || []).some(key => !runs.has(key))) fail('运行依赖不在当前成员备份中');
  }
  for (const task of tasks.values()) if (task.latestRunId && runs.get(task.latestRunId)?.taskId !== task.id) fail('任务最新运行关系不完整');
  for (const row of artifacts.values()) if (!Number.isSafeInteger(row.version) || row.version < 1 || row.id !== `${row.artifactId || row.taskId}:${row.version}` || runs.get(row.runId)?.taskId !== row.taskId) fail('成果版本与运行关系不完整');
  for (const run of runs.values()) if (run.artifact && artifacts.get(`${run.artifact.id}:${run.artifact.version}`)?.runId !== run.id) fail('运行引用的成果版本不存在');
  for (const head of tables.get('artifact-head').values()) if (!tasks.has(head.id) || !Number.isSafeInteger(head.version) || head.version < 0 || head.version && !artifacts.has(`${head.id}:${head.version}`)) fail('成果当前版本不存在');
  function checkEvent(event) {
    if (!isObject(event) || !id(event.id) || !runs.has(event.runId) || event.taskId !== runs.get(event.runId).taskId || eventIds.has(event.id) || event.sequence !== (cursors.get(event.runId) || 0) + 1) fail('活动 ID、归属或连续序列不正确');
    eventIds.add(event.id); cursors.set(event.runId, event.sequence);
  }
  for (const archive of tables.get('archive').values()) {
    if (!runs.has(archive.id) || !Array.isArray(archive.chunks)) fail('归档没有对应运行');
    for (const chunk of archive.chunks) { if (!Array.isArray(chunk)) fail('活动归档结构不正确'); for (const event of chunk) { if (event.runId !== archive.id) fail('归档混入其他运行'); checkEvent(event); } }
    if (archive.through !== cursors.get(archive.id)) fail('归档游标不一致');
  }
  for (const event of value.events) checkEvent(event);
  for (const row of tables.get('notification').values()) {
    if (!row.target || runs.get(row.target.runId)?.taskId !== row.target.taskId || row.target.artifactId && !artifacts.has(`${row.target.artifactId}:${row.target.artifactVersion}`)) fail('通知目标不完整');
  }
  for (const row of tables.get('message').values()) if (!tasks.has(row.taskId) || runs.get(row.runId)?.taskId !== row.taskId) fail('任务对话归属不完整');
  return { backup: value, ownerId: value.ownerId, sha256, counts: { projects: value.workspace.projects.length, accounts: value.workspace.accounts.length, legacyCheckpoints: (value.workspace.taskJournal || []).length, records: value.records.length, liveEvents: value.events.length, allEvents: eventIds.size } };
}

export function createWorkBackup(store, options = {}) {
  if (!store?.work) fail('工作区不支持任务备份');
  const authorize = ownerId => { const actor = currentActor(); if (!id(ownerId) || (actor ? actor.userId !== ownerId : options.ownerId !== ownerId)) fail('只能备份或恢复当前已验证成员的数据', 403); };
  function exportForOwner(ownerId) {
    authorize(ownerId);
    return store.work.transaction(() => {
      const records = KINDS.flatMap(kind => store.work.all(kind, ownerId).map(value => ({ kind, value }))), events = [];
      for (const { value: run } of records.filter(row => row.kind === 'run')) {
        const archive = store.work.get('archive', run.id); if (archive) records.push({ kind: 'archive', value: archive });
        let cursor = archive?.through || 0;
        for (;;) { const page = store.work.events(run.id, cursor, 1000); if (!page.length) break; events.push(...page); cursor = page.at(-1).sequence; if (events.length > 250000) fail('活动过多，请使用受保护的完整数据库副本'); }
      }
      const redactions = [], workspace = clean(visibleWorkspace(store, ownerId), redactions, '$.workspace'), safeRecords = clean(records, redactions, '$.records'), safeEvents = clean(events, redactions, '$.events');
      const content = { format: WORK_BACKUP_FORMAT, version: WORK_BACKUP_VERSION, scope: 'owner', ownerId, exportedAt: new Date().toISOString(), workspace, records: safeRecords, events: safeEvents, redactions, warnings: ['本文件包含私人业务内容，请妥善保管；它不是加密文件。', '不包含登录凭据或授权。恢复记录只供核对，必须重新建立并批准计划才可执行。', '恢复必须使用新的独立数据库；旧程序不能写新版数据库。'] };
      const backup = { ...content, sha256: digest(content) }; validateWorkBackup(backup); return backup;
    });
  }
  function importIntoEmptyStore(input, { ownerId = options.ownerId } = {}) {
    authorize(ownerId); const checked = validateWorkBackup(input);
    if (checked.ownerId !== ownerId) fail('备份成员与恢复目标不一致；不能在恢复时更换所有者', 403);
    const backup = clone(checked.backup), restoredAt = new Date().toISOString();
    return store.work.transaction(() => {
      ensureEmpty(store);
      store.mutate(state => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, backup.workspace); });
      for (const entry of backup.records) {
        let kind = entry.kind; const row = entry.value;
        if (kind === 'run') {
          row.restore = { at: restoredAt, backupSha256: backup.sha256, previousStatus: row.status, previousSource: row.source || '', requiresNewApproval: true };
          // Restored approval/commands are historical evidence, never execution
          // authority. Existing legacy-checkpoint command guards block resends.
          row.source = 'legacy-checkpoint'; row.restoredApproval = row.approval; delete row.approval; delete row.lease; delete row.requestedAction;
          if (['queued', 'waiting_dependencies', 'running'].includes(row.status)) row.status = row.sent || row.checkpoint?.type === 'result_ready' ? 'needs_reconciliation' : 'paused';
          row.waitReason = ['succeeded', 'failed', 'cancelled'].includes(row.status) ? row.waitReason || '' : '从备份恢复的只读检查点；请核对回执、费用和输入，并建立新计划重新批准。';
        }
        if (kind === 'task') { row.restore = { at: restoredAt, backupSha256: backup.sha256, previousSource: row.source || '' }; row.source = 'restored-backup'; const run = backup.records.find(item => item.kind === 'run' && item.value.id === row.latestRunId)?.value; if (run) row.status = ['queued', 'waiting_dependencies', 'running'].includes(run.status) ? run.sent || run.checkpoint?.type === 'result_ready' ? 'needs_reconciliation' : 'paused' : run.status; }
        if (kind === 'plan') for (const version of row.versions || []) { version.restoredStatus = version.status; version.status = 'restored'; }
        if (kind === 'command') { kind = 'backup-command'; row.originalId = row.id; row.originalKind = 'command'; row.id = `${backup.sha256}:${row.id}`; }
        store.work.put(kind, row);
      }
      for (const event of backup.events) { const saved = store.work.append(event); if (saved.sequence !== event.sequence) fail('恢复活动游标不一致'); }
      store.work.put('backup-restore', { id: backup.sha256, ownerId, at: restoredAt, counts: checked.counts, executionDisabled: true, note: '原 ID、活动序列、旧快照和用量已保留；历史批准不作为新执行授权。' });
      return { restored: true, ownerId, sha256: backup.sha256, counts: checked.counts, executionDisabled: true, requiresNewPlanApproval: true };
    });
  }
  return { exportForOwner, validate: validateWorkBackup, importIntoEmptyStore };
}
