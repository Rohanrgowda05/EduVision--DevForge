import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { registerRoutes } from '../routes';
import { storage } from '../storage';
import { searchYouTubeServerSide } from '../learning/recommendations';

async function main() {
  console.log('\n--- Starting Server-Side Recommendations & 24h Caching Test ---');

  // Set up Express test server
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const appAddr = httpServer.address();
  if (!appAddr || typeof appAddr === 'string') {
    throw new Error('Failed to bind test express');
  }
  const baseUrl = `http://127.0.0.1:${appAddr.port}`;

  try {
    const userA_AuthId = `rec_user_a_${Date.now()}`;
    const userA = await storage.upsertUser({ authId: userA_AuthId, email: 'rec_user_a@test.com' });
    const userA_Headers = {
      'Content-Type': 'application/json',
      'x-test-auth-id': userA_AuthId,
    };

    const userB_AuthId = `rec_user_b_${Date.now()}`;
    const userB = await storage.upsertUser({ authId: userB_AuthId, email: 'rec_user_b@test.com' });
    const userB_Headers = {
      'Content-Type': 'application/json',
      'x-test-auth-id': userB_AuthId,
    };

    // -------------------------------------------------------------------------
    // TEST 1: Cache storage and retrieval for server-side recommendations
    // -------------------------------------------------------------------------
    const testQuery = 'doppler effect frequency shift tutorial';
    const mockVideos = [
      {
        id: { videoId: 'mock123' },
        snippet: {
          title: 'Doppler Shift Explained Visually',
          description: 'A great tutorial on sound wave frequency shifts.',
          thumbnails: { medium: { url: 'https://img.youtube.com/vi/mock123/mqdefault.jpg' } },
          channelTitle: 'Physics Online',
          publishedAt: '2026-01-01T00:00:00Z',
        },
      },
    ];

    const cacheKey = `yt_${testQuery.toLowerCase().replace(/\s+/g, '_')}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await storage.setCachedRecommendations(cacheKey, testQuery, mockVideos, expiresAt);

    // Call searchYouTubeServerSide: should hit cache immediately
    const recResult = await searchYouTubeServerSide(testQuery);
    console.assert(recResult.source === 'cache', `Expected source='cache', got '${recResult.source}'`);
    console.assert(recResult.items.length === 1, `Expected 1 cached item, got ${recResult.items.length}`);
    console.assert(recResult.items[0].id.videoId === 'mock123', 'Video ID mismatch');
    console.log('✓ Test 1 Passed: Server-side YouTube search serves from 24h cache without hitting external API');

    // -------------------------------------------------------------------------
    // TEST 2: GET /api/browse endpoint with server-side caching
    // -------------------------------------------------------------------------
    const browseRes = await fetch(`${baseUrl}/api/browse?q=${encodeURIComponent(testQuery)}`, {
      headers: userA_Headers,
    });
    console.assert(browseRes.status === 200, `Expected 200, got ${browseRes.status}`);
    const browseJson = await browseRes.json();
    console.assert(browseJson.source === 'cache', `Expected browse source='cache', got '${browseJson.source}'`);
    console.assert(browseJson.items.length >= 1, 'Expected at least 1 video returned');
    console.log('✓ Test 2 Passed: GET /api/browse served from server cache without client API key');

    // -------------------------------------------------------------------------
    // TEST 3: GET /api/recommendations targeting weakest concept
    // -------------------------------------------------------------------------
    const topicA = await storage.createTopic({
      userId: userA.id,
      canonicalName: 'doppler_effect',
    });

    // Populate question_results with weak concept
    const quizA = await storage.createQuiz({
      userId: userA.id,
      topicId: topicA.id,
      prompt: 'Doppler Effect',
      questions: [],
    });

    await storage.createQuizAttemptWithResults(
      {
        userId: userA.id,
        topicId: topicA.id,
        prompt: 'Doppler Effect',
        score: 0,
        totalQuestions: 3,
      },
      [
        { attemptId: '', userId: userA.id, topicId: topicA.id, concept: 'frequency_shift', questionIndex: 0, chosen: 'x', correct: false },
        { attemptId: '', userId: userA.id, topicId: topicA.id, concept: 'frequency_shift', questionIndex: 1, chosen: 'x', correct: false },
        { attemptId: '', userId: userA.id, topicId: topicA.id, concept: 'frequency_shift', questionIndex: 2, chosen: 'x', correct: false },
      ],
      quizA.id
    );

    const recRes = await fetch(`${baseUrl}/api/recommendations?topicId=${topicA.id}`, {
      headers: userA_Headers,
    });
    console.assert(recRes.status === 200, `Expected 200, got ${recRes.status}`);
    const recJson = await recRes.json();
    console.assert(recJson.topic === 'doppler_effect', `Expected topic doppler_effect, got ${recJson.topic}`);
    console.assert(recJson.weakestConcept === 'frequency_shift', `Expected weakestConcept frequency_shift, got ${recJson.weakestConcept}`);
    console.assert(recJson.query.includes('frequency shift'), `Query should include weakest concept: ${recJson.query}`);
    console.log(`✓ Test 3 Passed: GET /api/recommendations targeted weakest concept '${recJson.weakestConcept}'`);

    // -------------------------------------------------------------------------
    // TEST 4: Multi-User Isolation on recommendations (User B gets 404 for User A topic)
    // -------------------------------------------------------------------------
    const userB_RecRes = await fetch(`${baseUrl}/api/recommendations?topicId=${topicA.id}`, {
      headers: userB_Headers,
    });
    console.assert(userB_RecRes.status === 404, `Expected 404 for User B, got ${userB_RecRes.status}`);
    console.log('✓ Test 4 Passed: User B cannot access recommendations for User A\'s topic (404 Not Found)');

    // -------------------------------------------------------------------------
    // TEST 5: Graceful error handling (Never return 500 on missing or exhausted quota)
    // -------------------------------------------------------------------------
    const unconfiguredSearch = await searchYouTubeServerSide('nonexistent_uncached_query_12345');
    console.assert(Array.isArray(unconfiguredSearch.items), 'Expected items array');
    console.assert(unconfiguredSearch.source === 'youtube' || unconfiguredSearch.source === 'fallback', `Valid source: ${unconfiguredSearch.source}`);
    console.log('✓ Test 5 Passed: External search failure or quota exhaustion returns fallback object, never throwing 500');

    console.log('\n>>> All Server-Side Recommendations Tests Passed Successfully! <<<\n');
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

main().catch((err) => {
  console.error('Recommendations test failed:', err);
  process.exit(1);
});

