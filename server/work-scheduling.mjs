// Pure admission/backoff policy. This module never starts a timer, invokes a
// provider, mutates a run, or grants permission to replay a sent request.
export const DEFAULT_WORK_WAIT_POLICY = Object.freeze({ baseDelayMs: 1000, maxDelayMs: 30000, maxWaitMs: 120000, maxAttempts: 6 });
const time = value => Number.isSafeInteger(value) && value >= 0;
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'paused', 'waiting_user', 'needs_reconciliation', 'completed']);
const safeCodes = new Set(['WORK_RESOURCE_BUSY', 'WORK_RATE_GATE']);
const providerOf = run => run?.provider || run?.input?.modelRoute?.provider || run?.modelRoute?.provider || 'default';
const safeProvider = value => typeof value === 'string' && /^[a-z0-9_-]{1,80}$/.test(value);

export function parseRetryAfter(value, { nowMs = Date.now(), maxDelayMs = DEFAULT_WORK_WAIT_POLICY.maxWaitMs } = {}) {
  if (!time(nowMs) || !Number.isSafeInteger(maxDelayMs) || maxDelayMs < 0) throw new TypeError('Invalid scheduling clock or maximum delay');
  const invalid = { valid: false, delayMs: null, retryAt: null, source: 'invalid', exceedsMax: false };
  if (typeof value !== 'string' && typeof value !== 'number') return invalid;
  const text = String(value).trim(); if (!text || text.length > 100) return invalid;
  let retryAt, source;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const seconds = Number(text); if (!Number.isFinite(seconds)) return invalid;
    const delay = Math.ceil(seconds * 1000); if (!Number.isSafeInteger(delay) || !time(nowMs + delay)) return invalid;
    retryAt = nowMs + delay; source = 'seconds';
  } else {
    // Require the HTTP IMF-fixdate form, not Date.parse's permissive local/ISO
    // spellings. Invalid dates and weekday mismatches cannot silently normalize.
    if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) return invalid;
    const parsed = Date.parse(text); if (!time(parsed) || new Date(parsed).toUTCString() !== text) return invalid;
    retryAt = Math.max(nowMs, parsed); source = 'http-date';
  }
  const delayMs = retryAt - nowMs;
  // Never shorten a service's requested delay to fit our local wait budget.
  return { valid: true, delayMs, retryAt, source, exceedsMax: delayMs > maxDelayMs };
}

export function providerAdmission({ provider, activeRuns = [], limits = {}, defaultLimit = 2 } = {}) {
  if (!safeProvider(provider) || !Array.isArray(activeRuns)) return { allowed: false, active: 0, limit: 0, reason: '供应商或执行队列格式无效', invalid: true };
  const configured = Object.hasOwn(limits || {}, provider) ? limits[provider] : defaultLimit;
  if (!Number.isSafeInteger(configured) || configured < 0 || configured > 32) return { allowed: false, active: 0, limit: 0, reason: '供应商并发配置无效', invalid: true };
  // Callers pass currently executing entries from all work types, including
  // controller planning. Queued tasks and unresolved historical receipts are
  // not active local HTTP requests; they retain their separate budget holds.
  const active = activeRuns.filter(run => providerOf(run) === provider && !terminal.has(run?.status) && (!run?.status || ['running', 'claimed', 'dispatching'].includes(run.status))).length;
  return { allowed: active < configured, active, limit: configured, reason: configured === 0 ? '该供应商已暂停派发' : active >= configured ? '等待供应商并发名额' : '', invalid: false };
}

export function hasWorkDispatchEvidence(run = {}) {
  if (run.sent || run.sentAt || run.dispatchedAt || run.externalId || run.externalRequestId || run.checkpoint || run.artifact || run.status === 'needs_reconciliation') return true;
  return [...(Array.isArray(run.attempts) ? run.attempts : []), run.attempt].filter(Boolean).some(attempt => attempt.sent || attempt.sentAt || attempt.dispatchedAt || attempt.receivedAt || attempt.externalId || (Array.isArray(attempt.invocations) && attempt.invocations.length));
}

export function workWaitStatus(wait, nowMs = Date.now()) {
  if (!time(nowMs) || !wait || !time(wait.firstWaitAt) || !time(wait.deadlineAt) || !time(wait.nextEligibleAt) || !Number.isSafeInteger(wait.attempt) || wait.attempt < 1 || wait.firstWaitAt > wait.nextEligibleAt || wait.nextEligibleAt > wait.deadlineAt) return 'invalid';
  if (nowMs < wait.firstWaitAt) return 'clock_changed';
  if (nowMs >= wait.deadlineAt) return 'expired';
  return nowMs >= wait.nextEligibleAt ? 'ready' : 'waiting';
}
export const isWorkWaitReady = (wait, nowMs = Date.now()) => workWaitStatus(wait, nowMs) === 'ready';

export function planWorkBackoff({ run = {}, error = {}, nowMs = Date.now(), policy: override = {} } = {}) {
  if (!time(nowMs)) return { action: 'reject', reason: '调度时间无效' };
  if (hasWorkDispatchEvidence(run)) return { action: 'reject', reason: '已有外部派发或回执证据，禁止自动重试；请核对结果与费用' };
  if (run.requestedAction || terminal.has(run.status)) return { action: 'reject', reason: '任务已停止或需要用户处理，不能自动恢复' };
  if (!safeCodes.has(error.code) || error.noCharge !== true || error.dispatched !== false) return { action: 'reject', reason: '没有确证请求尚未派发且无费用，不能自动退避重试' };
  const policy = { ...DEFAULT_WORK_WAIT_POLICY, ...override };
  if (!['baseDelayMs', 'maxDelayMs', 'maxWaitMs', 'maxAttempts'].every(key => Number.isSafeInteger(policy[key]) && policy[key] > 0) || policy.baseDelayMs > policy.maxDelayMs || policy.maxDelayMs > policy.maxWaitMs || policy.maxAttempts > 100 || policy.maxWaitMs > 86400000) return { action: 'reject', reason: '调度等待配置无效' };
  const previous = run.wait;
  const previousStatus = previous ? workWaitStatus(previous, nowMs) : null;
  if (previous && ['invalid', 'clock_changed', 'expired'].includes(previousStatus)) return { action: 'manual', reason: previousStatus === 'expired' ? '自动等待已到时限，请核对后手动继续' : '已保存的等待时间无效或系统时间变化，请人工核对' };
  const firstWaitAt = previous?.firstWaitAt ?? nowMs;
  const deadlineAt = Math.min(previous?.deadlineAt ?? firstWaitAt + policy.maxWaitMs, firstWaitAt + policy.maxWaitMs);
  const remaining = deadlineAt - nowMs;
  if (remaining <= 0) return { action: 'manual', reason: '自动等待已达到总时限，请核对后手动继续' };
  const header = parseRetryAfter(error.retryAfter ?? error.retryAfterSeconds, { nowMs, maxDelayMs: remaining });
  if (header.exceedsMax) return { action: 'manual', reason: '服务要求的等待超过本任务自动等待上限；未提前重发', retryAt: header.retryAt };
  if (previousStatus === 'waiting') {
    const nextEligibleAt = Math.max(previous.nextEligibleAt, header.valid ? header.retryAt : 0);
    if (nextEligibleAt >= deadlineAt) return { action: 'manual', reason: '下次可派发时间已超出等待窗口，需人工继续' };
    return { action: 'wait', wait: { ...previous, deadlineAt, nextEligibleAt }, reason: previous.reason };
  }
  const attempt = (previous?.attempt || 0) + 1;
  if (attempt > policy.maxAttempts) return { action: 'manual', reason: '已达到自动等待次数上限，请核对资源或服务限制' };
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.min(attempt - 1, 30));
  const nextEligibleAt = Math.max(nowMs + exponential, header.valid ? header.retryAt : 0);
  if (nextEligibleAt >= deadlineAt) return { action: 'manual', reason: '下次可派发时间已超出等待窗口，需人工继续' };
  const provider = providerOf(run), reason = error.code === 'WORK_RESOURCE_BUSY' ? '等待共享资源释放；尚未派发外部请求' : '等待供应商预派发窗口；尚未派发外部请求';
  return { action: 'wait', reason, wait: { version: 1, provider: safeProvider(provider) ? provider : 'default', attempt, firstWaitAt, deadlineAt, nextEligibleAt, reason, code: error.code } };
}
