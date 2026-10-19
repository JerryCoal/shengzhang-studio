import { currentActor } from './request-actor.mjs';

const personalFields = ['activeCreationAccounts', 'mcpActiveAccounts', 'projectDrafts', 'appearance', 'guide', 'agentWorkspace', 'taskJournal', 'contentEditDrafts'];
function projectView(state, actor) {
  const preferences = state.teamPreferences?.[actor?.userId] || {};
  delete state.teamPreferences;
  state.briefImports = [...(state.briefImports || []).filter(job => job.editorKey !== 'new'), ...structuredClone(preferences.newBriefImports || [])];
  for (const field of personalFields) {
    delete state[field];
    if (preferences[field] !== undefined) state[field] = structuredClone(preferences[field]);
  }
  for (const project of state.projects) {
    delete project.creationSelections;
    if (preferences.creationSelections?.[project.id]) project.creationSelections = structuredClone(preferences.creationSelections[project.id]);
  }
  return state;
}

// Shared content has one transactional store. UI choices and unfinished forms
// are projected per authenticated member and are never sent to other members.
export function createTeamStore(base) {
  base.mutate(state => {
    for (const preferences of Object.values(state.teamPreferences || {})) for (const job of preferences.newBriefImports || []) if (job.status === 'running') Object.assign(job, { status: 'uncertain', finishedAt: new Date().toISOString(), error: '主机上次运行中断，已保留预留费用，请核对账单后重试。', note: '运行中断，费用待核对；未自动重试' });
  });
  return {
    get: () => projectView(base.get(), currentActor()),
    mutate(callback) {
      const actor = currentActor();
      return base.mutate(state => {
        const allPreferences = state.teamPreferences || {};
        projectView(state, actor);
        const result = callback(state);
        if (result && typeof result.then === 'function') throw new Error('工作区事务必须同步执行');
        const response = result === undefined ? undefined : structuredClone(result);
        if (actor?.userId) {
          const preferences = { ...allPreferences[actor.userId], creationSelections: {}, newBriefImports: (state.briefImports || []).filter(job => job.editorKey === 'new') };
          for (const field of personalFields) {
            if (state[field] !== undefined) preferences[field] = structuredClone(state[field]);
            else delete preferences[field];
          }
          for (const project of state.projects) if (project.creationSelections) preferences.creationSelections[project.id] = structuredClone(project.creationSelections);
          allPreferences[actor.userId] = preferences;
        }
        for (const field of personalFields) delete state[field];
        state.briefImports = (state.briefImports || []).filter(job => job.editorKey !== 'new');
        for (const project of state.projects) delete project.creationSelections;
        state.teamPreferences = allPreferences;
        state.teamRevision = (state.teamRevision || 0) + 1;
        return response;
      });
    },
    close: () => base.close(),
  };
}
