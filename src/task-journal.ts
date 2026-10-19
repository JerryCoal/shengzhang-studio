import { api, LOCAL_DATA } from './api';
import { changeLocalState, readLocalState } from './local-vault';
import { removeTaskJournal, saveTaskJournal, taskJournal } from '../server/task-journal.mjs';
import type { BackgroundTask } from './components/BackgroundTasks';

// Uses the same encrypted, per-user vault as projects. No task content goes to
// localStorage, diagnostic logs or the stateless web relay.
export async function readTasks(): Promise<BackgroundTask[]> {
  return LOCAL_DATA ? taskJournal(await readLocalState()) as BackgroundTask[] : api<BackgroundTask[]>('/task-journal');
}
export async function saveTask(task: BackgroundTask) {
  if (LOCAL_DATA) await changeLocalState(state => saveTaskJournal(state, task.id, task));
  else await api(`/task-journal/${encodeURIComponent(task.id)}`, 'PUT', task);
}
export async function removeTask(id: string) {
  if (LOCAL_DATA) await changeLocalState(state => removeTaskJournal(state, id));
  else await api(`/task-journal/${encodeURIComponent(id)}`, 'DELETE');
}
