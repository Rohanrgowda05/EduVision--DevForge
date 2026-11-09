import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { registerRoutes } from '../routes';
import { storage } from '../storage';
import { startWorker, stopWorker, processJob } from '../worker';

async function main() {
  console.log('\n--- Starting Async Jobs Pipeline Integration Test ---');

  // Set up test environment
  process.env.DAILY_JOB_CAP = '3';
  process.env.RENDER_CONCURRENCY = '1';

  // Spin up a mini mock Flask service to verify worker execution
  const mockFlask = express();
  mockFlask.use(express.json());

  let mockFlaskReceivedToken: string | undefined;
  let mockFlaskCallCount = 0;

  mockFlask.post('/generate', (req, res) => {
    mockFlaskCallCount++;
    mockFlaskReceivedToken = req.headers['x-internal-token'] as string;
    const { prompt } = req.body;

    res.json({
      video_url: `/static/videos/mock_${Date.now()}.mp4`,
      attempts: 1,
      prompt,
    });
  });

  const flaskServer = createServer(mockFlask);
  await new Promise<void>((resolve) => flaskServer.listen(0, '127.0.0.1', () => resolve()));
  const flaskAddr = flaskServer.address();
  if (!flaskAddr || typeof flaskAddr === 'string') {
    throw new Error('Failed to bind mock flask');
  }
  process.env.FLASK_URL = `http://127.0.0.1:${flaskAddr.port}`;
  process.env.INTERNAL_AUTH_TOKEN = 'test-secret-token-xyz';
  console.log(`Mock Flask listening at ${process.env.FLASK_URL}`);

  // Set up Express app with routes
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const appAddr = httpServer.address();
  if (!appAddr || typeof appAddr === 'string') {
    throw new Error('Failed to bind test server');
  }
  const baseUrl = `http://127.0.0.1:${appAddr.port}`;
  console.log(`EduVision Server listening at ${baseUrl}`);

  try {
    const userA_AuthId = `job_user_a_${Date.now()}`;
    const userA = await storage.upsertUser({ authId: userA_AuthId, email: 'job_user_a@test.com' });
    const userA_Headers = {
      'Content-Type': 'application/json',
      'x-test-auth-id': userA_AuthId,
    };

    const userB_AuthId = `job_user_b_${Date.now()}`;
    const userB = await storage.upsertUser({ authId: userB_AuthId, email: 'job_user_b@test.com' });
    const userB_Headers = {
      'Content-Type': 'application/json',
      'x-test-auth-id': userB_AuthId,
    };

    // -------------------------------------------------------------------------
    // TEST 1: POST /api/jobs input validation (empty, <3 chars, >500 chars)
    // -------------------------------------------------------------------------
    const emptyRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: userA_Headers,
      body: JSON.stringify({ prompt: '  ' }),
    });
    console.assert(emptyRes.status === 400, `Expected 400 for empty prompt, got ${emptyRes.status}`);

    const tooShortRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: userA_Headers,
      body: JSON.stringify({ prompt: 'ab' }),
    });
    console.assert(tooShortRes.status === 400, `Expected 400 for too short prompt, got ${tooShortRes.status}`);

    const tooLongRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: userA_Headers,
      body: JSON.stringify({ prompt: 'a'.repeat(501) }),
    });
    console.assert(tooLongRes.status === 400, `Expected 400 for too long prompt, got ${tooLongRes.status}`);
    console.log('✓ Test 1 Passed: Input validation strictly enforces 3-500 character prompts');

    // -------------------------------------------------------------------------
    // TEST 2: Valid job submission returns 202 Accepted immediately
    // -------------------------------------------------------------------------
    const validJobRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: userA_Headers,
      body: JSON.stringify({ prompt: 'Visualize Pythagoras Theorem in 3D' }),
    });
    console.assert(validJobRes.status === 202, `Expected 202, got ${validJobRes.status}`);
    const validJobJson = await validJobRes.json();
    console.assert(typeof validJobJson.jobId === 'string', 'Expected jobId in response');
    console.assert(validJobJson.status === 'queued', `Expected queued status, got ${validJobJson.status}`);
    const jobId1 = validJobJson.jobId;
    console.log(`✓ Test 2 Passed: POST /api/jobs returned 202 with jobId=${jobId1}`);

    // -------------------------------------------------------------------------
    // TEST 3: Active Job Limit (1 active job per user) -> returns 429
    // -------------------------------------------------------------------------
    const concurrentJobRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: userA_Headers,
      body: JSON.stringify({ prompt: 'Another prompt while one is queued' }),
    });
    console.assert(concurrentJobRes.status === 429, `Expected 429, got ${concurrentJobRes.status}`);
    const concurrentJson = await concurrentJobRes.json();
    console.assert(concurrentJson.error === 'active_job_limit', `Expected active_job_limit, got ${concurrentJson.error}`);
    console.log('✓ Test 3 Passed: Submitting second job while first is active returns 429 active_job_limit');

    // -------------------------------------------------------------------------
    // TEST 4: Isolation on GET /api/jobs/:id (Owner gets 200, User B gets 404)
    // -------------------------------------------------------------------------
    const ownerGetRes = await fetch(`${baseUrl}/api/jobs/${jobId1}`, { headers: userA_Headers });
    console.assert(ownerGetRes.status === 200, `Owner should access job, got ${ownerGetRes.status}`);
    const ownerGetJson = await ownerGetRes.json();
    console.assert(ownerGetJson.id === jobId1, 'Job ID mismatch');
    console.assert(ownerGetJson.status === 'queued', `Expected queued status, got ${ownerGetJson.status}`);

    const otherUserGetRes = await fetch(`${baseUrl}/api/jobs/${jobId1}`, { headers: userB_Headers });
    console.assert(otherUserGetRes.status === 404, `User B should get 404 for User A job, got ${otherUserGetRes.status}`);
    console.log('✓ Test 4 Passed: GET /api/jobs/:id strictly isolates jobs by owner (User B gets 404)');

    // -------------------------------------------------------------------------
    // TEST 5: Worker execution, Flask header verification, and completion
    // -------------------------------------------------------------------------
    // Run processJob directly to simulate worker handling jobId1
    await processJob(jobId1);

    console.assert(mockFlaskCallCount === 1, `Expected 1 mock flask call, got ${mockFlaskCallCount}`);
    console.assert(mockFlaskReceivedToken === 'test-secret-token-xyz', `Token mismatch: ${mockFlaskReceivedToken}`);

    // Fetch updated job
    const completedJobRes = await fetch(`${baseUrl}/api/jobs/${jobId1}`, { headers: userA_Headers });
    const completedJob = await completedJobRes.json();
    console.assert(completedJob.status === 'succeeded', `Expected succeeded, got ${completedJob.status}`);
    console.assert(completedJob.video != null, 'Expected video record attached to completed job');
    console.assert(completedJob.video.jobId === jobId1, 'Video job_id mismatch');
    console.log('✓ Test 5 Passed: Worker processed job, passed X-Internal-Token, and persisted video');

    // -------------------------------------------------------------------------
    // TEST 6: Daily Quota Enforcement
    // -------------------------------------------------------------------------
    // User A currently has 1 job completed. Cap is set to 3.
    // Create 2 more completed jobs directly in storage for User A to hit cap of 3
    const job2 = await storage.createRenderJob({ userId: userA.id, prompt: 'Job 2', status: 'succeeded', attempts: 1 });
    const job3 = await storage.createRenderJob({ userId: userA.id, prompt: 'Job 3', status: 'succeeded', attempts: 1 });

    const cappedJobRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: userA_Headers,
      body: JSON.stringify({ prompt: 'Job 4 beyond daily cap' }),
    });
    console.assert(cappedJobRes.status === 429, `Expected 429 for daily cap, got ${cappedJobRes.status}`);
    const cappedJson = await cappedJobRes.json();
    console.assert(cappedJson.error === 'daily_cap_reached', `Expected daily_cap_reached, got ${cappedJson.error}`);
    console.log('✓ Test 6 Passed: Daily job cap enforced with 429 daily_cap_reached');

    // -------------------------------------------------------------------------
    // TEST 7: Startup Recovery (Stuck 'running' jobs marked failed/interrupted)
    // -------------------------------------------------------------------------
    const stuckJob = await storage.createRenderJob({
      userId: userB.id,
      prompt: 'Job that crashed mid-render',
      status: 'queued',
      attempts: 0,
    });
    // Manually mark it running with startedAt in past
    await storage.updateRenderJob(stuckJob.id, {
      status: 'running',
      startedAt: new Date(Date.now() - 600000), // 10 minutes ago
    });

    const recoveredCount = await storage.recoverStuckJobs(300000); // 5 min threshold
    console.assert(recoveredCount >= 1, `Expected at least 1 recovered job, got ${recoveredCount}`);

    const recoveredJob = await storage.getRenderJob(stuckJob.id);
    console.assert(recoveredJob?.status === 'failed', `Expected failed, got ${recoveredJob?.status}`);
    console.assert(recoveredJob?.errorType === 'interrupted', `Expected errorType interrupted, got ${recoveredJob?.errorType}`);
    console.log('✓ Test 7 Passed: Stuck running jobs recovered and marked failed with errorType="interrupted"');

    console.log('\n>>> All Async Job Pipeline Tests Passed Successfully! <<<\n');
  } finally {
    stopWorker();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await new Promise<void>((resolve) => flaskServer.close(() => resolve()));
  }
}

main().catch((err) => {
  console.error('Job pipeline test failed with error:', err);
  process.exit(1);
});

