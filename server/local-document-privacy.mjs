// These additions are local-only until a separate, explicit web workflow exists.
export const LOCAL_DOCUMENT_KEYS = Object.freeze(['documentContext', 'adoptedDocumentContext', 'documentContextSnapshot', 'styleReferences', 'styleReferencesSnapshot', 'extraction', 'locator', 'locations']);
export function removeLocalDocumentData(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) removeLocalDocumentData(item); return; }
  for (const key of LOCAL_DOCUMENT_KEYS) delete value[key];
  if (typeof value.text === 'string' && (Number.isInteger(value.index) || typeof value.documentId === 'string')) {
    for (const key of ['blockId', 'kind', 'page', 'heading']) delete value[key];
  }
  for (const item of Object.values(value)) removeLocalDocumentData(item);
}
export function hasLocalDocumentData(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasLocalDocumentData);
  return LOCAL_DOCUMENT_KEYS.some(key => Object.hasOwn(value, key)) || Object.values(value).some(hasLocalDocumentData);
}
