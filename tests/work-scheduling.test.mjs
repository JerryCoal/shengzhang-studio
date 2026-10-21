import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRetryAfter, providerAdmission, planWorkBackoff, workWaitStatus, isWorkWaitReady, hasWorkDispatchEvidence } from '../server/work-scheduling.mjs';

const clock = Date.parse('2026-10-21T08:00:00Z');
const busy = { code: 'WORK_RESOURCE_BUSY', noCharge: true, dispatched: false };
const gate = { code: 'WORK_RATE_GATE', noCharge: true, dispatched: false };
const run = () => ({ id: 'run-a', status: 'queued', input: { modelRoute: { provider: 'qwen' } }, attempts: [] });

test('Retry-After parses bounded seconds, fractional delays and exact HTTP dates without moving earlier', () => {
  assert.deepEqual(parseRetryAfter('12', { nowMs: clock }), { valid: true, delayMs: 12000, retryAt: clock + 12000, source: 'seconds', exceedsMax: false });
  assert.equal(parseRetryAfter('0.0011', { nowMs: clock }).delayMs, 2);
  const date = new Date(clock + 24000).toUTCString(); assert.equal(parseRetryAfter(date, { nowMs: clock }).retryAt, clock + 24000);
  assert.equal(parseRetryAfter(new Date(clock - 1000).toUTCString(), { nowMs: clock }).delayMs, 0);
  const long = parseRetryAfter('3600', { nowMs: clock, maxDelayMs: 10000 }); assert.equal(long.exceedsMax, true); assert.equal(long.delayMs, 3600000);
});

test('Retry-After rejects injection, locale dates, invalid dates and nonfinite values', () => {
  for (const value of [null, undefined, {}, '', '-1', 'Infinity', '1e9', '2026-10-21T08:00:00Z', 'Wed, 31 Feb 2026 08:00:00 GMT', '12\r\nAuthorization: secret', '9'.repeat(101)]) assert.equal(parseRetryAfter(value, { nowMs: clock }).valid, false, String(value));
});

test('provider admission shares limits between planning and business runs and ignores other providers or finished runs', () => {
  const activeRuns = [{ status: 'running', kind: 'planning', input: { modelRoute: { provider: 'qwen' } } }, { status: 'running', provider: 'qwen' }, { status: 'running', provider: 'openai' }, { status: 'succeeded', provider: 'qwen' }];
  assert.equal(providerAdmission({ provider: 'qwen', activeRuns, limits: { qwen: 2 } }).allowed, false);
  assert.equal(providerAdmission({ provider: 'openai', activeRuns, limits: { openai: 2 } }).allowed, true);
  assert.equal(providerAdmission({ provider: 'qwen', activeRuns, limits: { qwen: 3 } }).active, 2);
  assert.equal(providerAdmission({ provider: 'qwen', limits: { qwen: 0 } }).allowed, false);
  for (const limit of [-1, Infinity, 1.2, 33]) assert.equal(providerAdmission({ provider: 'qwen', limits: { qwen: limit } }).invalid, true);
});

test('persisted pre-dispatch backoff survives JSON roundtrip and is bounded exponentially', () => {
  const original = run(), a = planWorkBackoff({ run: original, error: busy, nowMs: clock });
  assert.equal(a.action, 'wait'); assert.equal(a.wait.attempt, 1); assert.equal(a.wait.nextEligibleAt, clock + 1000); assert.equal(original.wait, undefined);
  const restored = JSON.parse(JSON.stringify({ ...original, wait: a.wait }));
  assert.equal(workWaitStatus(restored.wait, clock), 'waiting'); assert.equal(isWorkWaitReady(restored.wait, clock + 1000), true);
  const b = planWorkBackoff({ run: restored, error: busy, nowMs: clock + 1000 });
  assert.equal(b.wait.attempt, 2); assert.equal(b.wait.nextEligibleAt, clock + 3000); assert.equal(b.wait.deadlineAt, a.wait.deadlineAt);
  const repeatedPoll = planWorkBackoff({ run: { ...original, wait: b.wait }, error: busy, nowMs: clock + 1200 });
  assert.deepEqual(repeatedPoll.wait, b.wait, 'polling must not consume attempts or extend total wait');
});

test('a pre-dispatch rate gate obeys Retry-After and never shortens excessive provider waits', () => {
  const a = planWorkBackoff({ run: run(), error: { ...gate, retryAfter: '15' }, nowMs: clock }); assert.equal(a.wait.nextEligibleAt, clock + 15000);
  const excessive = planWorkBackoff({ run: run(), error: { ...gate, retryAfter: '3600' }, nowMs: clock }); assert.equal(excessive.action, 'manual'); assert.equal(excessive.retryAt, clock + 3600000);
  const laterGate = planWorkBackoff({ run: { ...run(), wait: a.wait }, error: { ...gate, retryAfter: '30' }, nowMs: clock + 1000 });
  assert.equal(laterGate.wait.nextEligibleAt, clock + 31000); assert.equal(laterGate.wait.attempt, 1); assert.equal(laterGate.wait.deadlineAt, a.wait.deadlineAt);
});

test('bounded attempts and total wait require manual continuation, never perpetual queue polling', () => {
  const a = planWorkBackoff({ run: run(), error: busy, nowMs: clock, policy: { maxAttempts: 1 } });
  assert.equal(planWorkBackoff({ run: { ...run(), wait: a.wait }, error: busy, nowMs: a.wait.nextEligibleAt, policy: { maxAttempts: 1 } }).action, 'manual');
  assert.equal(workWaitStatus(a.wait, a.wait.deadlineAt), 'expired');
  assert.equal(planWorkBackoff({ run: { ...run(), wait: a.wait }, error: busy, nowMs: a.wait.deadlineAt }).action, 'manual');
  assert.equal(workWaitStatus(a.wait, clock - 1), 'clock_changed');
  assert.equal(planWorkBackoff({ run: { ...run(), wait: a.wait }, error: busy, nowMs: clock - 1 }).action, 'manual');
});

test('all dispatch or receipt evidence overrides safe-looking error flags and forbids automatic replay', () => {
  const evidence = [{ sent: true }, { sentAt: 'recorded' }, { externalRequestId: 'request-1' }, { checkpoint: { type: 'result_ready' } }, { status: 'needs_reconciliation' }, { attempts: [{ sentAt: 'recorded' }] }, { attempts: [{ invocations: [{}] }] }, { attempt: { receivedAt: 'recorded' } }];
  for (const item of evidence) { const candidate = { ...run(), ...item }; assert.equal(hasWorkDispatchEvidence(candidate), true); assert.equal(planWorkBackoff({ run: candidate, error: busy, nowMs: clock }).action, 'reject'); }
});

test('a 429/timeout or noCharge flag alone cannot authorize retry, and explicit stop is respected', () => {
  for (const error of [{ status: 429, noCharge: true }, { code: 'WORK_RATE_GATE', noCharge: true }, { code: 'WORK_RESOURCE_BUSY', dispatched: false }, { code: 'ETIMEDOUT', noCharge: true, dispatched: false }, { ...gate, dispatched: true }]) assert.equal(planWorkBackoff({ run: run(), error, nowMs: clock }).action, 'reject');
  assert.equal(planWorkBackoff({ run: { ...run(), requestedAction: 'pause' }, error: busy, nowMs: clock }).action, 'reject');
  assert.equal(planWorkBackoff({ run: { ...run(), status: 'cancelled' }, error: busy, nowMs: clock }).action, 'reject');
});

test('corrupt persisted waits and oversized policies do not unlock dispatch', () => {
  assert.equal(workWaitStatus({ attempt: 0, firstWaitAt: clock, nextEligibleAt: clock, deadlineAt: clock + 10 }, clock), 'invalid');
  assert.equal(planWorkBackoff({ run: { ...run(), wait: { attempt: 1 } }, error: busy, nowMs: clock }).action, 'manual');
  assert.equal(planWorkBackoff({ run: run(), error: busy, nowMs: clock, policy: { maxWaitMs: 999999999 } }).action, 'reject');
});
