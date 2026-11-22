import { signWorkerCapability } from '../lib/integrations/security.ts';

const [baseUrl, caseId, jobId] = process.argv.slice(2);
if (!baseUrl || !caseId || !jobId || !/^[A-Za-z0-9_-]{1,100}$/.test(caseId) || !/^[A-Za-z0-9_-]{1,100}$/.test(jobId)) throw new Error('Usage: node --experimental-strip-types scripts/run-integration-job.mts BASE_URL CASE_ID JOB_ID');
const url = new URL(baseUrl);
if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS or a loopback development URL.');
const secret = process.env.HARNESS_WORKER_SECRET;
if (!secret || secret.length < 32) throw new Error('Set HARNESS_WORKER_SECRET in the process environment using your secret manager.');
const token = await signWorkerCapability({ case_id: caseId, job_id: jobId, expires_at: Date.now() + 5 * 60_000 }, secret);
const response = await fetch(new URL(`/v1/internal/cases/${caseId}/jobs/${jobId}/execute`, url), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, redirect: 'error' });
const result = await response.json() as { state?: string; stage?: string; code?: string; error?: { code: string } };
console.log(JSON.stringify({ status: response.status, job_id: jobId, state: result.state, stage: result.stage, code: result.code || result.error?.code }));
if (!response.ok || result.state === 'failed') process.exitCode = 1;
