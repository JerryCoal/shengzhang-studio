import { createHash } from 'node:crypto';
import { z } from 'zod';
import { currentActor } from './request-actor.mjs';
import { createKnowledge, updateKnowledge } from './content-workflow.mjs';

const identifier = z.string().trim().min(1).max(160);
const content = length => z.string().trim().min(1).max(length);
const requestSchema = z.object({
  requestId: z.string().uuid(), confirmed: z.literal(true), scope: z.enum(['project', 'account']),
  accountId: z.string().trim().max(100).default(''),
  items: z.array(z.object({ candidateId: identifier.optional(), title: content(200), text: content(12000) }).strict()).min(1).max(8)
    .refine(items => new Set(items.map(item => JSON.stringify([item.title, item.text]))).size === items.length, '请勿重复采纳相同内容')
    .refine(items => { const selected = items.flatMap(item => item.candidateId ? [item.candidateId] : []); return new Set(selected).size === selected.length; }, '请勿重复勾选同一候选'),
}).strict();
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status, noCharge: true }); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sentence = (value, maximum = 1200) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const notice = '这里只保存用户选定的表达偏好或待验证建议，不代表效果已证实；不读取任务私聊，不调用 AI。项目共享经验默认停用，需在资料与经验库明确启用。';
function requestUUID(value) {
  const hex = hash(value).slice(0, 32).split(''); hex[12] = '5'; hex[16] = (parseInt(hex[16], 16) & 3 | 8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function suggestions(artifact) {
  const candidates = [], seen = new Set();
  const add = (path, title, text) => {
    if (!title || !text || seen.has(text) || candidates.length >= 20) return;
    seen.add(text); candidates.push({ id: `suggestion-${hash([path, title, text]).slice(0, 24)}`, title: title.slice(0, 200), text: text.slice(0, 12000) });
  };
  // An edited artifact retains its old structured packet for provenance. Do
  // not pretend those old model suggestions describe the user's revised text.
  if (artifact.source === 'user') return candidates;
  if (artifact.kind === 'research') {
    for (const [index, analysis] of (Array.isArray(artifact.structured?.analyses) ? artifact.structured.analyses.slice(0, 6) : []).entries()) {
      if (!analysis || typeof analysis !== 'object') continue;
      const title = sentence(analysis.title, 180), limitations = sentence(analysis.limitations);
      const advice = Array.isArray(analysis.growthAdvice) ? analysis.growthAdvice.slice(0, 6) : [];
      let found = false;
      for (const [adviceIndex, item] of advice.entries()) {
        const action = sentence(item?.action, 800); if (!action) continue;
        const reason = sentence(item.reason, 800), validation = sentence(item.validation, 800);
        const text = [`待验证建议：${action}`, reason && `来源中的解释：${reason}`, validation && `建议验证方式：${validation}`, limitations && `适用限制：${limitations}`, '状态：未验证，不承诺流量或教学效果。'].filter(Boolean).join('\n');
        add(['research', index, adviceIndex], title || '研究中的待验证建议', text); found = true;
      }
      if (!found && sentence(analysis.application)) add(['research', index, 'application'], title || '研究中的应用建议', [`待验证建议：${sentence(analysis.application)}`, limitations && `适用限制：${limitations}`, '状态：未验证，不承诺流量或教学效果。'].filter(Boolean).join('\n'));
    }
  }
  // Only explicit saved suggestions are candidates. A generated copy body,
  // prompt, clean review status or popularity number is not an experience.
  for (const [index, item] of (Array.isArray(artifact.structured?.experienceSuggestions) ? artifact.structured.experienceSuggestions.slice(0, 20) : []).entries()) {
    const text = sentence(item?.text, 11000); if (text) add(['explicit', index], sentence(item.title, 200) || '待用户核对的建议', `${text}\n状态：未验证，仅作待确认的表达偏好或假设。`);
  }
  return candidates;
}

export function createWorkExperience({ store, config = {} }) {
  const db = store.work;
  if (!db) throw Error('经验闭环需要后台成果存储');
  async function authorize() {
    const session = currentActor();
    if (!session && config.teamMode) fail('请先登录当前工作区', 401);
    const actor = session || { userId: config.workOwnerId || 'personal', role: 'admin' };
    if (!actor.userId || config.teamMode && typeof config.authorizeWorkActor !== 'function') fail('无法核对当前成员权限', 403);
    if (typeof config.authorizeWorkActor === 'function') { if (await config.authorizeWorkActor(actor) !== true) fail('当前成员权限已撤销', 403); }
    else if (actor.userId !== (config.workOwnerId || 'personal')) fail('当前成员不属于本地工作区', 403);
    return actor;
  }
  function sourceOf(artifactId, version, actor) {
    identifier.parse(artifactId); version = z.coerce.number().int().positive().parse(version);
    const artifact = db.get('artifact', `${artifactId}:${version}`);
    const owned = row => row && row.ownerId === actor.userId;
    if (!owned(artifact)) fail('成果不存在或当前用户无权访问', 404);
    const run = db.get('run', artifact.runId), task = db.get('task', artifact.taskId);
    if (!owned(run) || !owned(task) || run.taskId !== task.id || artifact.projectId !== run.projectId || task.projectId !== run.projectId || (artifact.artifactId || artifactId) !== artifactId || artifact.version !== version) fail('成果来源归属无法核对', 409);
    if (!['research', 'copy', 'script'].includes(artifact.kind)) fail('只有已交付研究或文案成果可整理经验', 409);
    if (artifact.candidate || run.status !== 'succeeded') fail('请先明确采用这份候选成果，再整理经验', 409);
    if ((artifact.accountId || '') !== (run.node?.accountId || '') || (artifact.accountId || '') !== (task.accountId || '')) fail('成果账号与来源任务不一致', 409);
    if (!store.get().projects.some(project => project.id === artifact.projectId)) fail('成果所属项目已不存在', 404);
    const source = { projectId: artifact.projectId, taskId: task.id, runId: run.id, artifactId, artifactVersion: version, kind: artifact.kind, accountId: artifact.accountId || '', title: sentence(artifact.title, 200) };
    const allowedScopes = artifact.kind === 'research' && !source.accountId ? ['project', 'account'] : ['account'];
    return { artifact, source, allowedScopes, candidates: suggestions(artifact) };
  }
  async function candidates(artifactId, version) {
    const actor = await authorize(), { source, candidates, allowedScopes } = sourceOf(artifactId, version, actor);
    return { source, candidates, allowedScopes, manualAllowed: true, notice };
  }
  async function adopt(artifactId, version, body) {
    const data = requestSchema.parse(body), actor = await authorize();
    return db.transaction(() => {
      const { source, allowedScopes, candidates } = sourceOf(artifactId, version, actor);
      if (!allowedScopes.includes(data.scope)) fail('账号专属成果不能自动转为全项目共享经验', 409);
      if (data.scope === 'project' && data.accountId || data.scope === 'account' && !data.accountId) fail('请选择清晰的项目共享或单一目标账号范围');
      if (source.accountId && data.accountId !== source.accountId) fail('此成果经验只能归入原目标账号，不能串用其他账号', 409);
      const known = new Set(candidates.map(item => item.id));
      if (data.items.some(item => item.candidateId && !known.has(item.candidateId))) fail('所选候选不属于当前成果版本，请重新核对', 409);
      const commandId = `${actor.userId}:experience:${data.requestId}`, fingerprint = hash({ source, ...data }), command = db.get('command', commandId);
      if (command && (command.ownerId !== actor.userId || command.fingerprint !== fingerprint)) fail('保存编号已用于不同来源或内容，请重新确认', 409);
      return store.mutate(state => {
        const project = state.projects.find(row => row.id === source.projectId);
        if (!project) fail('成果所属项目已不存在', 404);
        if (data.accountId && !state.accounts.some(account => account.id === data.accountId)) fail('目标账号已不存在，请重新选择', 409);
        if (command) {
          const items = command.result.knowledgeIds.map(id => project.knowledge?.find(row => row.id === id));
          if (items.some(item => !item || item.workSource?.ownerId !== actor.userId || item.kind !== 'experience' || item.accountId !== data.accountId)) fail('经验已移除或归属变化，未重复创建', 409);
          return { items, reused: true };
        }
        let reused = true;
        const adoptedAt = new Date().toISOString(), items = data.items.map((item, index) => {
          const adoptionKey = hash({ ownerId: actor.userId, source, scope: data.scope, accountId: data.accountId, title: item.title, text: item.text });
          const previous = project.knowledge?.find(row => row.workSource?.adoptionKey === adoptionKey && row.workSource.ownerId === actor.userId);
          if (previous) { if (previous.kind !== 'experience' || previous.accountId !== data.accountId) fail('已采纳经验的使用范围发生变化，请先核对原记录', 409); return previous; }
          reused = false;
          const entry = createKnowledge(state, project, { requestId: requestUUID([actor.userId, data.requestId, artifactId, source.artifactVersion, index]), kind: 'experience', title: item.title, text: item.text, accountId: data.accountId, sourceId: `${artifactId}@${source.artifactVersion}`, sourceType: 'work-artifact' });
          if (data.scope === 'project') updateKnowledge(state, project, entry.id, { expectedRevision: entry.revision, active: false });
          entry.workSource = { ...source, ownerId: actor.userId, scope: data.scope, targetAccountId: data.accountId, candidateId: item.candidateId || '', requestId: data.requestId, adoptionKey, adoptedBy: actor.userId, adoptedAt, verification: 'unverified', edited: !item.candidateId || candidates.find(candidate => candidate.id === item.candidateId)?.text !== item.text };
          return entry;
        });
        db.put('command', { id: commandId, ownerId: actor.userId, fingerprint, result: { projectId: project.id, knowledgeIds: items.map(item => item.id) }, at: adoptedAt });
        return { items, reused };
      });
    });
  }
  function mount(app) {
    app.get('/api/artifacts/:id/versions/:version/experience-candidates', async (req, res) => res.json(await candidates(req.params.id, req.params.version)));
    app.post('/api/artifacts/:id/versions/:version/experiences', async (req, res) => { const result = await adopt(req.params.id, req.params.version, req.body); res.status(result.reused ? 200 : 201).json(result); });
  }
  return { candidates, adopt, mount };
}

export function mountWorkExperienceRoutes({ app, store, config = {} }) {
  const service = createWorkExperience({ store, config }); service.mount(app); return service;
}
