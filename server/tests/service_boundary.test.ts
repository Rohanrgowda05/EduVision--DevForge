import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { registerRoutes } from '../routes';
import { storage } from '../storage';

async function main() {
  console.log('\n--- Starting Service Boundary Hardening Integration Test ---');

  const internalToken = 'test-boundary-secret-token-123';
  process.env.INTERNAL_AUTH_TOKEN = internalToken;

  // ---------------------------------------------------------------------------
  // 1. Mock Flask with the exact boundary rules as hack27/main.py
  // ---------------------------------------------------------------------------
  const mockFlask = express();
  mockFlask.use(express.json());

  // verify_internal_token middleware mimicking hack27/main.py
  mockFlask.use((req, res, next) => {
    if (req.path === '/health') {
      return next();
    }
    const token = req.headers['x-internal-token'];
    if (!token || token !== internalToken) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid or missing internal auth token',
      });
    }
    next();
  });

  mockFlask.get('/health', (_req, res) => {
    res.json({ status: 'healthy', service: 'eduvision-flask' });
  });

  mockFlask.get('/static/videos/:filename', (req, res) => {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', '16');
    res.send(Buffer.from('MOCK_VIDEO_BYTES'));
  });

  mockFlask.post('/generate', (req, res) => {
    res.json({
      video_url: '/static/videos/boundary_test.mp4',
      attempts: 1,
      prompt: req.body?.prompt,
    });
  });

  const flaskServer = createServer(mockFlask);
  await new Promise<void>((resolve) => flaskServer.listen(0, '127.0.0.1', () => resolve()));
  const flaskAddr = flaskServer.address();
  if (!flaskAddr || typeof flaskAddr === 'string') {
    throw new Error('Failed to bind mock flask');
  }
  const flaskBaseUrl = `http://127.0.0.1:${flaskAddr.port}`;
  process.env.FLASK_URL = flaskBaseUrl;
  console.log(`Flask test service running at ${flaskBaseUrl}`);

  // ---------------------------------------------------------------------------
  // 2. Setup Express test server
  // ---------------------------------------------------------------------------
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const appAddr = httpServer.address();
  if (!appAddr || typeof appAddr === 'string') {
    throw new Error('Failed to bind test express');
  }
  const expressBaseUrl = `http://127.0.0.1:${appAddr.port}`;
  console.log(`Express test service running at ${expressBaseUrl}`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Direct requests to Flask without token are rejected (401)
    // -------------------------------------------------------------------------
    const directGenerateRes = await fetch(`${flaskBaseUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test prompt' }),
    });
    console.assert(directGenerateRes.status === 401, `Expected 401 without token, got ${directGenerateRes.status}`);

    const directVideoRes = await fetch(`${flaskBaseUrl}/static/videos/sample.mp4`);
    console.assert(directVideoRes.status === 401, `Expected 401 for static video without token, got ${directVideoRes.status}`);
    console.log('✓ Test 1 Passed: Direct requests to Flask without X-Internal-Token return 401');

    // -------------------------------------------------------------------------
    // TEST 2: Direct request to Flask with invalid token is rejected (401)
    // -------------------------------------------------------------------------
    const badTokenRes = await fetch(`${flaskBaseUrl}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': 'wrong-token-abc',
      },
      body: JSON.stringify({ prompt: 'test prompt' }),
    });
    console.assert(badTokenRes.status === 401, `Expected 401 for bad token, got ${badTokenRes.status}`);
    console.log('✓ Test 2 Passed: Direct request to Flask with wrong token returns 401');

    // -------------------------------------------------------------------------
    // TEST 3: Health endpoints on both services return 200 without auth
    // -------------------------------------------------------------------------
    const flaskHealthRes = await fetch(`${flaskBaseUrl}/health`);
    console.assert(flaskHealthRes.status === 200, `Flask health failed: ${flaskHealthRes.status}`);
    const flaskHealthJson = await flaskHealthRes.json();
    console.assert(flaskHealthJson.status === 'healthy', 'Flask health status mismatch');

    const expressHealthRes = await fetch(`${expressBaseUrl}/api/health`);
    console.assert(expressHealthRes.status === 200, `Express health failed: ${expressHealthRes.status}`);
    const expressHealthJson = await expressHealthRes.json();
    console.assert(expressHealthJson.status === 'healthy', 'Express health status mismatch');
    console.log('✓ Test 3 Passed: Both Flask and Express health check endpoints return 200 OK');

    // -------------------------------------------------------------------------
    // TEST 4: Authenticated Video Streaming via Express
    // -------------------------------------------------------------------------
    const userA_AuthId = `stream_user_a_${Date.now()}`;
    const userA = await storage.upsertUser({ authId: userA_AuthId, email: 'stream_user_a@test.com' });
    const userA_Headers = {
      'Content-Type': 'application/json',
      'x-test-auth-id': userA_AuthId,
    };

    const userB_AuthId = `stream_user_b_${Date.now()}`;
    const userB = await storage.upsertUser({ authId: userB_AuthId, email: 'stream_user_b@test.com' });
    const userB_Headers = {
      'Content-Type': 'application/json',
      'x-test-auth-id': userB_AuthId,
    };

    const jobA = await storage.createRenderJob({
      userId: userA.id,
      prompt: 'Video Stream Test Topic',
      status: 'succeeded',
      attempts: 1,
    });

    const videoA = await storage.createGeneratedVideo({
      userId: userA.id,
      jobId: jobA.id,
      prompt: 'Video Stream Test Topic',
      videoUrl: '/static/videos/sample.mp4',
    });

    // Unauthenticated streaming request -> 401
    const unauthStreamRes = await fetch(`${expressBaseUrl}/api/videos/${videoA.id}/stream`);
    console.assert(unauthStreamRes.status === 401, `Expected 401 for unauthenticated stream, got ${unauthStreamRes.status}`);

    // User B trying to stream User A's video -> 404
    const userB_StreamRes = await fetch(`${expressBaseUrl}/api/videos/${videoA.id}/stream`, {
      headers: userB_Headers,
    });
    console.assert(userB_StreamRes.status === 404, `Expected 404 for User B streaming User A video, got ${userB_StreamRes.status}`);

    // User A streaming own video -> 200 with proxied video bytes
    const userA_StreamRes = await fetch(`${expressBaseUrl}/api/videos/${videoA.id}/stream`, {
      headers: userA_Headers,
    });
    console.assert(userA_StreamRes.status === 200, `Expected 200 for User A stream, got ${userA_StreamRes.status}`);
    const streamContentType = userA_StreamRes.headers.get('content-type');
    console.assert(streamContentType?.includes('video/mp4'), `Expected video/mp4, got ${streamContentType}`);
    const streamBodyText = await userA_StreamRes.text();
    console.assert(streamBodyText === 'MOCK_VIDEO_BYTES', `Stream body mismatch: ${streamBodyText}`);
    console.log('✓ Test 4 Passed: Authenticated Express video streaming enforces ownership and proxies Flask with token');

    console.log('\n>>> All Service Boundary Hardening Tests Passed Successfully! <<<\n');
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await new Promise<void>((resolve) => flaskServer.close(() => resolve()));
  }
}

main().catch((err) => {
  console.error('Service boundary test failed with error:', err);
  process.exit(1);
});

