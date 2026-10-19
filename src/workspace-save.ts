// Desktop shutdown awaits every mounted editor, including hidden Agent pages.
const savers = new Set<() => Promise<unknown>>();
export function registerWorkspaceSaver(save: () => Promise<unknown>) { savers.add(save); return () => { savers.delete(save); }; }
export async function flushWorkspaceSavers() { await Promise.all([...savers].map(save => save())); }
