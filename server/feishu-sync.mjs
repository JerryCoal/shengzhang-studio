import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assert, touch } from './domain.mjs';
import { canUseCredentials } from './ai-routes.mjs';
import { createFeishuClient, parseFeishuTarget, feishuCredentialsSchema, FEISHU_FIELDS, MANAGED_FIELDS, schemaReport, canonicalFields, planFields } from './feishu.mjs';

const tableLocks = new Set();
const stamp = () => new Date().toISOString();
const digest = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const targetKey = t => `${t.appId}:${t.appToken}:${t.tableId}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const failure = (message, status = 400, rest = {}) => Object.assign(new Error(message), { status, ...rest });
const difference = (a, b) => MANAGED_FIELDS.filter(k => a?.[k] !== b?.[k]);
export function feishuRecordStatus(project, publication, target) {
  if (publication.sample) return 'sample';
  if (!target?.tableId) return 'unlinked';
  const sync = publication.feishuSync;
  if (!sync || sync.targetKey !== targetKey(target)) return 'pending';
  if (['error', 'conflict', 'syncing'].includes(sync.status)) return sync.status;
  return sync.sentHash === digest(canonicalFields(planFields(project, publication))) ? 'synced' : 'pending';
}

export function mountFeishuSync(app, store, config, { project, activeJobs }) {
  const vault = config.feishuVault;
  let busy = false, closed = false;
  const client = createFeishuClient({ fetcher: config.feishuFetcher || fetch, credentials: async () => {
    let value; try { value = JSON.parse(await vault.getKey()); } catch { throw failure('请先保存飞书应用凭证；如保险箱不可用，请使用原 Windows 账户登录。'); }
    const parsed = feishuCredentialsSchema.safeParse(value);
    assert(parsed.success && value.appId === store.get().feishu?.appId, '应用凭证与连接不匹配，请重新保存连接'); return parsed.data;
  } });
  const local = req => assert(canUseCredentials(req, config), '请在本机已解锁的工作区配置和同步飞书', 403);
  const status = () => {
    const v = vault?.status(); const connection = store.get().feishu || { revision: 0 };
    return { supported: !!v?.supported, configured: !!v?.configured && !v.problem && !!connection.appId, connection, fields: FEISHU_FIELDS, problem: v?.problem || '', busy };
  };
  const requireTarget = () => {
    const t = store.get().feishu;
    assert(vault?.status().supported && vault.status().configured, '请先在“团队协作”中保存飞书连接');
    assert(t?.appId && t?.tableId, '请先连接飞书多维表格'); return t;
  };
  async function exclusive(fn) {
    assert(!closed && !busy, '飞书同步正在处理，请稍后再操作', 409);
    busy = true; const job = `feishu:${randomUUID()}`; activeJobs.add(job);
    try { return await fn(); } finally { activeJobs.delete(job); busy = false; }
  }
  async function tableWork(fn) {
    return exclusive(async () => {
      const t = requireTarget(), lock = `${t.appToken}:${t.tableId}`;
      assert(!tableLocks.has(lock), '这张飞书表格正在由另一个工作区同步，请稍后重试', 409);
      tableLocks.add(lock); try { return await fn(t); } finally { tableLocks.delete(lock); }
    });
  }
  function saveSync(pid, rid, update) {
    store.mutate(state => {
      const p = project(state, pid), record = p.publications.find(r => r.id === rid);
      assert(record, '发布计划不存在', 404);
      record.feishuSync = { ...record.feishuSync, ...update }; touch(p);
    });
  }
  async function check(t) {
    const report = schemaReport(await client.fields(t));
    store.mutate(state => { state.feishu.check = { ...report, checkedAt: stamp() }; });
    return report;
  }
  async function syncOne(t, pid, rid, options = {}) {
    const p = project(store.get(), pid), record = p.publications.find(r => r.id === rid);
    assert(record && !record.sample && !p.sample, '示例项目和示例记录不会上传，请使用自己的项目');
    const desired = planFields(p, record), desiredCanonical = canonicalFields(desired);
    let entry = record.feishuSync?.targetKey === targetKey(t) ? record.feishuSync : { targetKey: targetKey(t), attempts: 0 };
    if (options.automatic && ['error','conflict'].includes(entry.status) && (!entry.retryable || entry.attempts >= 3 || entry.nextAttemptAt > Date.now())) return;
    if (!options.automatic && entry.status === 'conflict' && !options.overwriteConflict) throw failure('飞书中的同一字段已被修改，请打开表格核对，或明确选择“按 App 更新”', 409);
    // Freeze an uncertain request across restarts and local edits. Never reuse its idempotency key with a different body.
    const pending = entry.pending || { fields: desired, createFields: { ...desired, ...(p.feishuPlan?.owner ? { '负责人': p.feishuPlan.owner } : {}) }, hash: digest(desiredCanonical), clientToken: randomUUID() };
    saveSync(pid, rid, { ...entry, pending, status: 'syncing', error: '', attemptedAt: stamp() });
    try {
      let remote;
      if (entry.recordId) {
        try { remote = await client.get(t, entry.recordId); }
        catch (error) { if (!error.missingRecord) throw error; }
        if (!remote) throw failure('原飞书记录已删除或不可见。为避免重新创建已删除的计划，请先在飞书恢复记录后重试。', 409, { conflict: true });
      } else remote = await client.find(t, desired['计划编号']);
      const pendingCanonical = canonicalFields(pending.fields);
      if (remote) {
        assert(/^rec[A-Za-z0-9]+$/.test(remote.record_id || ''), '飞书未返回有效记录编号', 502);
        const current = canonicalFields(remote.fields || {});
        assert(current['计划编号'] === desired['计划编号'], '飞书记录的计划编号已改变，停止更新以保护其他记录', 409);
        const matchesPending = same(current, pendingCanonical);
        if (!matchesPending) {
          const changed = entry.sentFields ? difference(current, entry.sentFields) : MANAGED_FIELDS;
          if (changed.length) {
            if (!(options.overwriteConflict && options.expectedRemoteHash === digest(current) && options.expectedRemoteHash === entry.remoteHash)) {
              throw failure(`飞书中的${changed.map(k => `“${k}”`).join('、')}与 App 不一致，请核对后决定是否覆盖。`, 409, { conflict: true, remoteHash: digest(current), conflicts: changed });
            }
          }
          await client.update(t, remote.record_id, pending.fields);
        }
      } else {
        remote = await client.create(t, pending.createFields, pending.clientToken);
        assert(/^rec[A-Za-z0-9]+$/.test(remote?.record_id || ''), '飞书未返回有效记录编号，请稍后重试核对', 502);
      }
      saveSync(pid, rid, { status: 'synced', recordId: remote.record_id, sentHash: pending.hash, sentFields: pendingCanonical, pending: null, error: '', attempts: 0, retryable: false, remoteHash: '', conflicts: [], syncedAt: stamp() });
      return { id: rid, status: 'synced' };
    } catch (error) {
      const attempts = options.automatic ? (entry.attempts || 0) + 1 : 1;
      saveSync(pid, rid, { status: error.conflict ? 'conflict' : 'error', error: error.status ? error.message : '同步未完成，本地计划已保留', retryable: !!error.retryable, attempts, nextAttemptAt: Date.now() + [60000, 300000, 900000][Math.min(attempts - 1, 2)], conflicts: error.conflicts || [], remoteHash: error.remoteHash || '' });
      if (!options.automatic) throw error;
      return { id: rid, status: 'error' };
    }
  }
  async function syncProject(pid, options = {}) {
    return tableWork(async t => {
      const p = project(store.get(), pid); assert(!p.sample, '请在自己的项目中启用同步，示例项目不会上传');
      const report = await check(t);
      assert(report.ready, '飞书字段尚未准备好，请先检查连接并初始化标准字段');
      const candidates = p.publications.filter(r => {
        if (r.sample || (options.recordId && options.recordId !== r.id)) return false;
        const status = feishuRecordStatus(p, r, t), sync = r.feishuSync;
        if (options.automatic) return status === 'pending' || (status === 'error' && sync?.retryable && sync.attempts < 3 && sync.nextAttemptAt <= Date.now());
        return options.recordId || status !== 'synced';
      });
      if (options.recordId) assert(candidates.length, '发布计划不存在', 404);
      const results = [];
      for (const record of candidates.slice(0, options.automatic ? 5 : 50)) {
        // User can disable automatic sync while the current request is completing.
        if (options.automatic && !project(store.get(), pid).feishuPlan?.autoSync) break;
        results.push(await syncOne(t, pid, record.id, options));
      }
      return results.filter(Boolean);
    });
  }
  app.get('/api/team/feishu', (req, res) => { local(req); res.json(status()); });
  app.put('/api/team/feishu', async (req, res) => {
    local(req);
    const input = z.object({ appId: feishuCredentialsSchema.shape.appId, appSecret: feishuCredentialsSchema.shape.appSecret.optional(), tableUrl: z.string().max(2000), expectedRevision: z.number().int().min(0) }).strict().parse(req.body);
    const target = parseFeishuTarget(input.tableUrl);
    await exclusive(async () => {
      assert(vault?.status().supported, '此运行方式没有可用的本地凭证保险箱，请使用 Windows 完整版');
      const before = store.get().feishu;
      assert((before?.revision || 0) === input.expectedRevision, '连接已在另一处修改，请刷新后重试', 409);
      assert(input.appSecret || (vault.status().configured && before?.appId === input.appId), '首次连接或更换应用时，请填写 App Secret');
      if (input.appSecret) await vault.save(JSON.stringify({ appId: input.appId, appSecret: input.appSecret }));
      client.clear();
      store.mutate(state => {
        const changed = !before || targetKey({ ...target, appId: input.appId }) !== targetKey(before);
        state.feishu = { appId: input.appId, ...target, revision: input.expectedRevision + 1, ...(changed ? {} : { check: before.check }) };
        // A new destination always needs a fresh explicit opt-in for each project's automatic uploads.
        if (changed) for (const p of state.projects) if (p.feishuPlan) { p.feishuPlan.autoSync = false; touch(p); }
      });
    });
    res.json(status());
  });
  app.delete('/api/team/feishu', async (req, res) => {
    local(req); await exclusive(async () => {
      vault?.remove(); client.clear();
      store.mutate(state => { state.feishu = { revision: (state.feishu?.revision || 0) + 1 }; for (const p of state.projects) if (p.feishuPlan) { p.feishuPlan.autoSync = false; touch(p); } });
    }); res.json(status());
  });
  app.post('/api/team/feishu/check', async (req, res) => { local(req); await tableWork(check); res.json(status()); });
  app.post('/api/team/feishu/initialize', async (req, res) => {
    local(req); assert(req.body.confirmed === true, '请确认在目标飞书表格添加标准字段');
    await tableWork(async t => {
      const fields = await client.fields(t), report = schemaReport(fields);
      assert(!report.incompatible.length, `这些字段类型不匹配：${report.incompatible.join('、')}。请在飞书调整，或使用新的空白数据表。`);
      for (const field of FEISHU_FIELDS) if (report.missing.includes(field.field_name)) await client.createField(t, field);
      await check(t);
    }); res.json(status());
  });
  app.put('/api/projects/:id/feishu-plan', (req, res) => {
    local(req);
    const data = z.object({ autoSync: z.boolean(), owner: z.string().trim().max(80), confirmed: z.boolean().optional() }).strict().parse(req.body);
    if (data.autoSync) { const t = requireTarget(); assert(t.check?.ready, '请先检查并初始化飞书标准字段'); assert(data.confirmed === true, '请确认将本项目发布计划同步到飞书'); }
    store.mutate(state => { const p = project(state, req.params.id); assert(!p.sample, '示例项目不会上传，请创建自己的项目'); p.feishuPlan = { autoSync: data.autoSync, owner: data.owner }; touch(p); });
    res.json({ state: store.get() });
  });
  app.post('/api/projects/:id/feishu-sync', async (req, res) => {
    local(req);
    const options = z.object({ confirmed: z.literal(true), recordId: z.string().max(100).optional(), overwriteConflict: z.boolean().default(false), expectedRemoteHash: z.string().max(100).optional() }).strict().parse(req.body);
    assert(!options.overwriteConflict || (options.recordId && options.expectedRemoteHash), '请先查看这条记录的冲突再确认覆盖');
    const result = await syncProject(req.params.id, options); res.json({ result, state: store.get() });
  });
  return {
    async tick() {
      if (closed || busy || !vault?.status().configured) return;
      const state = store.get(), t = state.feishu;
      if (!t?.check?.ready) return;
      const p = state.projects.find(p => !p.sample && p.feishuPlan?.autoSync && p.publications.some(r => {
        const status = feishuRecordStatus(p, r, t), s = r.feishuSync;
        return status === 'pending' || (status === 'error' && s?.retryable && s.attempts < 3 && s.nextAttemptAt <= Date.now());
      }));
      const pId = p?.id;
      if (p) try { await syncProject(p.id, { automatic: true }); }
      catch (error) {
        if (error.status === 409) return;
        // Pause schema/auth failures rather than issuing failing requests every tick.
        if (!busy) store.mutate(state => { const p = project(state, pId); p.feishuPlan.autoSync = false; p.feishuPlan.error = '自动同步已暂停，请检查连接后重新开启'; touch(p); });
      }
    },
    recover() {
      store.mutate(state => { for (const p of state.projects) for (const r of p.publications) if (r.feishuSync?.status === 'syncing') { r.feishuSync.status = 'pending'; touch(p); } });
    },
    close() { closed = true; client.clear(); },
  };
}
