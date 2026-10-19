import { api, LOCAL_DATA } from './api';
import { changeLocalState, readLocalState } from './local-vault';
import { readContentEditDraft, saveContentEditDraft, removeContentEditDraft, type ContentEditDraft, type ContentEditInput } from '../server/content-edit-drafts.mjs';

export async function readEditDraft(key: string): Promise<ContentEditDraft | null> {
  return LOCAL_DATA ? readContentEditDraft(await readLocalState(), key) : api('/content-edit-drafts/' + encodeURIComponent(key));
}
export async function saveEditDraft(key: string, draft: ContentEditInput, expectedRevision: string | null): Promise<ContentEditDraft> {
  const input = { expectedRevision, draft };
  return LOCAL_DATA ? (await changeLocalState(state => saveContentEditDraft(state, key, input))).result : api('/content-edit-drafts/' + encodeURIComponent(key), 'PUT', input);
}
export async function removeEditDraft(key: string, expectedRevision: string | null) {
  const input = { expectedRevision };
  return LOCAL_DATA ? changeLocalState(state => removeContentEditDraft(state, key, input)) : api('/content-edit-drafts/' + encodeURIComponent(key), 'DELETE', input);
}
