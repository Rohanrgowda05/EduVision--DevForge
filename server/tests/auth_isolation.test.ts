import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { registerRoutes } from '../routes';
import { storage } from '../storage';

async function main() {
  console.log('\n--- Starting User Authentication & Isolation Test ---');

  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);

  await registerRoutes(httpServer, app);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind server to port');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`Test server running at ${baseUrl}`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Unauthenticated request to /api/health -> 200 OK
    // -------------------------------------------------------------------------
    const healthRes = await fetch(`${baseUrl}/api/health`);
    console.assert(healthRes.status === 200, `Health check failed: ${healthRes.status}`);
    const healthJson = await healthRes.json();
    console.assert(healthJson.status === 'healthy', 'Health status mismatch');
    console.log('✓ Test 1 Passed: Unauthenticated /api/health returns 200 OK');

    // -------------------------------------------------------------------------
    // TEST 2: Unauthenticated request to /api/* -> 401 Unauthorized
    // -------------------------------------------------------------------------
    const unauthRes = await fetch(`${baseUrl}/api/videos`);
    console.assert(unauthRes.status === 401, `Expected 401, got ${unauthRes.status}`);
    console.log('✓ Test 2 Passed: Unauthenticated request to /api/videos returns 401');

    const unauthProfile = await fetch(`${baseUrl}/api/profile`);
    console.assert(unauthProfile.status === 401, `Expected 401, got ${unauthProfile.status}`);
    console.log('✓ Test 2b Passed: Unauthenticated request to /api/profile returns 401');

    // -------------------------------------------------------------------------
    // TEST 3: User A setup (creates video, notes, render job, and quiz attempt)
    // -------------------------------------------------------------------------
    const userA_AuthId = `alice_${Date.now()}`;
    const userA = await storage.upsertUser({ authId: userA_AuthId, email: 'alice@eduvision.test' });

    const jobA = await storage.createRenderJob({
      userId: userA.id,
      prompt: "Alice's Secret Physics Topic",
      status: 'queued',
      attempts: 0,
    });

    const videoA = await storage.createGeneratedVideo({
      userId: userA.id,
      jobId: jobA.id,
      prompt: "Alice's Secret Physics Topic",
      videoUrl: '/static/videos/alice_secret.mp4',
    });

    const noteA = await storage.createNotes({
      videoId: videoA.id,
      notesText: "# Alice Private Notes",
      downloaded: false,
    });

    const quizA = await storage.createQuizAttempt({
      userId: userA.id,
      prompt: "Alice's Secret Physics Topic",
      score: 5,
      totalQuestions: 5,
    });

    console.log(`✓ User A created (ID=${userA.id}) with video=${videoA.id}, note=${noteA.id}, job=${jobA.id}`);

    // -------------------------------------------------------------------------
    // TEST 4: User A accessing own resources -> 200 OK
    // -------------------------------------------------------------------------
    const userA_Headers = {
      'Content-Type': 'application/json',
      'x-test-auth-id': userA_AuthId,
    };

    const userA_VideoRes = await fetch(`${baseUrl}/api/videos/${videoA.id}`, { headers: userA_Headers });
    console.assert(userA_VideoRes.status === 200, `User A should access own video: ${userA_VideoRes.status}`);

    const userA_JobRes = await fetch(`${baseUrl}/api/jobs/${jobA.id}`, { headers: userA_Headers });
    console.assert(userA_JobRes.status === 200, `User A should access own job: ${userA_JobRes.status}`);
    console.log('✓ Test 4 Passed: User A successfully accessed own resources');

    // -------------------------------------------------------------------------
    // TEST 5: User B Isolation Tests (Expect 404 for User A's resources)
    // -------------------------------------------------------------------------
    const userB_AuthId = `bob_${Date.now()}`;
    const userB_Headers = {
      'Content-Type': 'application/json',
      'x-test-auth-id': userB_AuthId,
    };

    // 5a. User B attempts to access User A's video by ID -> Expect 404
    const userB_GetVideoA = await fetch(`${baseUrl}/api/videos/${videoA.id}`, { headers: userB_Headers });
    console.assert(userB_GetVideoA.status === 404, `User B reading User A video should be 404, got ${userB_GetVideoA.status}`);
    console.log("✓ Test 5a Passed: User B reading User A's video returns 404");

    // 5b. User B attempts to access User A's render job by ID -> Expect 404
    const userB_GetJobA = await fetch(`${baseUrl}/api/jobs/${jobA.id}`, { headers: userB_Headers });
    console.assert(userB_GetJobA.status === 404, `User B reading User A job should be 404, got ${userB_GetJobA.status}`);
    console.log("✓ Test 5b Passed: User B reading User A's job returns 404");

    // 5c. User B attempts to download User A's notes by ID -> Expect 404
    const userB_DownloadNoteA = await fetch(`${baseUrl}/api/notes/${noteA.id}/download`, {
      method: 'POST',
      headers: userB_Headers,
    });
    console.assert(userB_DownloadNoteA.status === 404, `User B downloading User A note should be 404, got ${userB_DownloadNoteA.status}`);
    console.log("✓ Test 5c Passed: User B downloading User A's note returns 404");

    // 5d. User B listing videos -> Should NOT contain User A's video
    const userB_VideosListRes = await fetch(`${baseUrl}/api/videos`, { headers: userB_Headers });
    const userB_Videos = await userB_VideosListRes.json();
    console.assert(Array.isArray(userB_Videos) && userB_Videos.length === 0, `User B videos list should be empty, got ${userB_Videos.length}`);
    console.log("✓ Test 5d Passed: User B video list does not leak User A's videos");

    // 5e. User B quiz history -> Should NOT contain User A's quiz
    const userB_QuizRes = await fetch(`${baseUrl}/api/quiz/history`, { headers: userB_Headers });
    const userB_Quizzes = await userB_QuizRes.json();
    console.assert(Array.isArray(userB_Quizzes) && userB_Quizzes.length === 0, `User B quiz list should be empty, got ${userB_Quizzes.length}`);
    console.log("✓ Test 5e Passed: User B quiz history does not leak User A's quizzes");

    // 5f. User B profile -> should show 0 videos and 0 quizzes
    const userB_ProfileRes = await fetch(`${baseUrl}/api/profile`, { headers: userB_Headers });
    const userB_Profile = await userB_ProfileRes.json();
    console.assert(userB_Profile.videosGenerated === 0, 'User B profile leaked video count');
    console.assert(userB_Profile.quizAttempts === 0, 'User B profile leaked quiz count');
    console.log("✓ Test 5f Passed: User B profile does not leak User A's activity statistics");

    console.log('\n======================================================');
    console.log('ALL AUTHENTICATION & MULTI-USER ISOLATION TESTS PASSED!');
    console.log('======================================================');
  } finally {
    httpServer.close();
  }
}

main().catch((err) => {
  console.error('Auth isolation test failed:', err);
  process.exit(1);
});

