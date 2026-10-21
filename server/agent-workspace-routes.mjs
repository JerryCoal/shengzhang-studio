import { agentWorkspace, saveAgentWorkspace, createAgentHandoff } from './agent-workspace.mjs';
import { MODELS } from './models.mjs';
import { rulesOf } from './workflow.mjs';
import { registerReviewWork } from './review-work.mjs';
import { recoverInspirationTurns } from './inspiration-conversation.mjs';

export function mountAgentWorkspaceRoutes(app, store, { mutate }) {
  const activeAttempts = app.locals.inspirationActiveAttempts ||= new Set();
  app.get('/api/agent-workspace', (_req, res) => {
    const snapshot = store.get();
    if (Object.values(snapshot.agentWorkspace?.inspirationReceipts || {}).some(receipt => receipt.status === 'pending' && !activeAttempts.has(receipt.attemptId))) store.mutate(state => recoverInspirationTurns(state, activeAttempts));
    res.json(agentWorkspace(store.get()));
  });
  app.put('/api/agent-workspace', (req, res) => res.json(store.mutate(state => saveAgentWorkspace(state, req.body))));
  app.post('/api/projects/:id/agent-handoffs', (req, res) => mutate(req, res, (project, state) => createAgentHandoff(state, project, req.body, rulesOf(state), MODELS)));
  app.post('/api/projects/:id/review-works', (req, res) => mutate(req, res, (project, state) => registerReviewWork(state, project, req.body)));
}
