import { agentWorkspace, saveAgentWorkspace, createAgentHandoff } from './agent-workspace.mjs';
import { MODELS } from './models.mjs';
import { rulesOf } from './workflow.mjs';
import { registerReviewWork } from './review-work.mjs';

export function mountAgentWorkspaceRoutes(app, store, { mutate }) {
  app.get('/api/agent-workspace', (_req, res) => res.json(agentWorkspace(store.get())));
  app.put('/api/agent-workspace', (req, res) => res.json(store.mutate(state => saveAgentWorkspace(state, req.body))));
  app.post('/api/projects/:id/agent-handoffs', (req, res) => mutate(req, res, (project, state) => createAgentHandoff(state, project, req.body, rulesOf(state), MODELS)));
  app.post('/api/projects/:id/review-works', (req, res) => mutate(req, res, (project, state) => registerReviewWork(state, project, req.body)));
}
