import { AsyncLocalStorage } from 'node:async_hooks';
import { setActivityActorResolver } from './activity-actor.mjs';

const actors = new AsyncLocalStorage();
setActivityActorResolver(() => actors.getStore() || null);
export const currentActor = () => actors.getStore() || null;
export const runWithActor = (actor, work) => actors.run(actor ? Object.freeze({ userId: actor.userId, username: actor.username, role: actor.role }) : null, work);
