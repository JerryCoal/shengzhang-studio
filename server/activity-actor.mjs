// domain.mjs is also reused by the offline browser build. Only the server
// installs a request-local resolver; no Node runtime is pulled into the browser.
let resolveActor = () => null;
export const currentActivityActor = () => resolveActor();
export function setActivityActorResolver(resolver) { resolveActor = resolver; }
