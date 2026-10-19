// Existing whole-project callers retain their exclusive lock. Text generation
// can acquire a narrower resource without releasing another job's reservation.
export function createActiveJobs() {
  const exclusive = new Set(), scoped = new Map();
  const resources = projectId => scoped.get(projectId);
  return {
    get size() { return exclusive.size + [...scoped.values()].reduce((sum, entries) => sum + entries.size, 0); },
    has(projectId) { return exclusive.has(projectId) || !!resources(projectId)?.size; },
    add(projectId) { exclusive.add(projectId); return this; },
    delete(projectId) { return exclusive.delete(projectId); },
    clear() { exclusive.clear(); scoped.clear(); },
    canAcquire(projectId, resourceKey) { return !exclusive.has(projectId) && !resources(projectId)?.has(resourceKey); },
    acquire(projectId, resourceKey) {
      if (!this.canAcquire(projectId, resourceKey)) return null;
      const token = Symbol(resourceKey), entries = resources(projectId) || new Map();
      entries.set(resourceKey, token); scoped.set(projectId, entries);
      return token;
    },
    release(projectId, resourceKey, token) {
      const entries = resources(projectId);
      if (!entries || entries.get(resourceKey) !== token) return false;
      entries.delete(resourceKey); if (!entries.size) scoped.delete(projectId); return true;
    },
  };
}

export function textTaskResource(stage, assetId) {
  if (stage === 'copy') return `asset:${assetId}`;
  if (stage === 'classification' || stage === 'analysis') return 'comments';
  if (stage === 'strategy' || stage === 'planning') return 'strategy';
  return `stage:${stage}`;
}

export function acquireTaskResource(jobs, projectId, resourceKey) {
  const available = jobs.canAcquire ? jobs.canAcquire(projectId, resourceKey) : !jobs.has(projectId);
  if (!available) { const error = new Error('这项内容正在执行任务，请等当前阶段完成；其他内容可同时工作。'); error.status = 409; throw error; }
  const token = jobs.acquire ? jobs.acquire(projectId, resourceKey) : jobs.add(projectId);
  return () => { if (jobs.release) jobs.release(projectId, resourceKey, token); else jobs.delete(projectId); };
}
