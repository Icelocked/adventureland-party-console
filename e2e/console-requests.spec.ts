import { test, expect } from './fixtures';

// Request efficiency (docs/efficiency.md § Requests and logs) against the real
// coordinator behind the hosting gateway.

test('readiness route answers without building the state payload', async ({ app }, info) => {
  const started = performance.now();
  const response = await fetch(`${app.url}/party-api/ready`);
  const body = await response.text();
  const elapsed = performance.now() - started;
  await info.attach('ready-response', { body: JSON.stringify({ status: response.status, body, bytes: body.length, ms: elapsed }), contentType: 'application/json' });
  expect(response.status).toBe(200);
  expect(JSON.parse(body)).toEqual({ ready: true });
});
