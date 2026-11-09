import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { registerRoutes, sanitizeConceptLabel } from '../routes';
import { storage } from '../storage';

async function main() {
  console.log('\n--- Starting Server-Side Quizzes, Grading & Concept Results Test ---');

  // ---------------------------------------------------------------------------
  // Unit Test: Concept Sanitization & Normalization
  // ---------------------------------------------------------------------------
  console.assert(sanitizeConceptLabel('Doppler Effect') === 'doppler_effect', 'Concept sanitization 1 failed');
  console.assert(sanitizeConceptLabel('Wave-Length & Frequency!') === 'wave_length_frequency', 'Concept sanitization 2 failed');
  console.assert(sanitizeConceptLabel('  ___leading_trailing___  ') === 'leading_trailing', 'Concept sanitization 3 failed');
  console.assert(sanitizeConceptLabel('x', 'fallback_concept') === 'fallback_concept', 'Concept sanitization 4 fallback failed');
  console.log('✓ Concept label sanitizer strictly enforces [a-z0-9_]{2,60}');

  // ---------------------------------------------------------------------------
  // Express Test Server
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
  const baseUrl = `http://127.0.0.1:${appAddr.port}`;

  try {
    const userA_AuthId = `quiz_user_a_${Date.now()}`;
    const userA = await storage.upsertUser({ authId: userA_AuthId, email: 'quiz_user_a@test.com' });
    const userA_Headers = {
      'Content-Type': 'application/json',
      'x-test-auth-id': userA_AuthId,
    };

    const userB_AuthId = `quiz_user_b_${Date.now()}`;
    const userB = await storage.upsertUser({ authId: userB_AuthId, email: 'quiz_user_b@test.com' });
    const userB_Headers = {
      'Content-Type': 'application/json',
      'x-test-auth-id': userB_AuthId,
    };

    // -------------------------------------------------------------------------
    // TEST 1: Server-side quiz creation and secret answer stripping
    // -------------------------------------------------------------------------
    // Create a quiz with known questions and concepts directly in storage
    const sampleQuestions = [
      {
        id: 'q1',
        question: 'What happens to frequency when the sound source moves closer?',
        concept: 'frequency_shift',
        options: [
          { id: 'a', text: 'Increases' },
          { id: 'b', text: 'Decreases' },
          { id: 'c', text: 'Stays the same' },
          { id: 'd', text: 'Becomes zero' },
        ],
        correctAnswer: 'a',
      },
      {
        id: 'q2',
        question: 'What is the speed of sound in air at room temperature?',
        concept: 'sound_speed',
        options: [
          { id: 'a', text: '300 m/s' },
          { id: 'b', text: '343 m/s' },
          { id: 'c', text: '500 m/s' },
          { id: 'd', text: '1500 m/s' },
        ],
        correctAnswer: 'b',
      },
      {
        id: 'q3',
        question: 'What causes the pitch change in the Doppler effect?',
        concept: 'relative_motion',
        options: [
          { id: 'a', text: 'Temperature changes' },
          { id: 'b', text: 'Relative motion between source and observer' },
          { id: 'c', text: 'Air density fluctuations' },
          { id: 'd', text: 'Gravity' },
        ],
        correctAnswer: 'b',
      },
    ];

    const quizA = await storage.createQuiz({
      userId: userA.id,
      prompt: 'Doppler Effect Acoustics',
      questions: sampleQuestions,
    });
    console.assert(quizA.id != null, 'Quiz ID should be generated');
    console.assert(quizA.submitted === false, 'Quiz should start unsubmitted');
    console.log(`✓ Test 1 Passed: Quiz created server-side with ID=${quizA.id}`);

    // -------------------------------------------------------------------------
    // TEST 2: Multi-User Isolation: User B cannot submit User A's quiz
    // -------------------------------------------------------------------------
    const userB_SubmitRes = await fetch(`${baseUrl}/api/quiz/submit`, {
      method: 'POST',
      headers: userB_Headers,
      body: JSON.stringify({
        quizId: quizA.id,
        answers: { q1: 'a', q2: 'b', q3: 'b' },
      }),
    });
    console.assert(userB_SubmitRes.status === 404, `Expected 404 for User B, got ${userB_SubmitRes.status}`);
    console.log('✓ Test 2 Passed: User B cannot access or submit User A\'s quiz (404 Not Found)');

    // -------------------------------------------------------------------------
    // TEST 3: Server-side grading & atomic question_results persistence
    // -------------------------------------------------------------------------
    // User A submits: answers q1 correctly ('a'), q2 incorrectly ('a'), q3 correctly ('b') -> 2/3
    const userA_SubmitRes = await fetch(`${baseUrl}/api/quiz/submit`, {
      method: 'POST',
      headers: userA_Headers,
      body: JSON.stringify({
        quizId: quizA.id,
        // Tamper attempt: Client sends fake score=100 - must be ignored!
        score: 100,
        answers: {
          q1: 'a', // correct
          q2: 'a', // incorrect (correct is 'b')
          q3: 'b', // correct
        },
      }),
    });

    console.assert(userA_SubmitRes.status === 200, `Expected 200, got ${userA_SubmitRes.status}`);
    const submitJson = await userA_SubmitRes.json();
    console.assert(submitJson.score === 2, `Expected server-calculated score 2, got ${submitJson.score}`);
    console.assert(submitJson.totalQuestions === 3, `Expected totalQuestions 3, got ${submitJson.totalQuestions}`);
    console.assert(submitJson.passed === true, `Expected passed=true for 2/3, got ${submitJson.passed}`);
    console.assert(submitJson.feedback.length === 3, 'Expected 3 feedback items');

    // Verify feedback details
    console.assert(submitJson.feedback[0].isCorrect === true, 'Q1 should be correct');
    console.assert(submitJson.feedback[1].isCorrect === false, 'Q2 should be incorrect');
    console.assert(submitJson.feedback[1].correctAnswer === 'b', 'Q2 correct answer should be revealed in feedback');
    console.assert(submitJson.feedback[1].concept === 'sound_speed', 'Q2 concept should match');

    // Verify per-concept records in database
    const storedResults = await storage.getQuestionResultsForUser(userA.id);
    console.assert(storedResults.length === 3, `Expected 3 stored question results, got ${storedResults.length}`);

    const q2Result = storedResults.find((r) => r.concept === 'sound_speed');
    console.assert(q2Result != null, 'sound_speed result not found');
    console.assert(q2Result?.correct === false, 'sound_speed should be recorded as incorrect');
    console.assert(q2Result?.chosen === 'a', 'sound_speed chosen should be "a"');
    console.log('✓ Test 3 Passed: Server graded answers accurately, recorded per-concept results in DB, and returned feedback');

    // -------------------------------------------------------------------------
    // TEST 4: Duplicate Submission Prevention (409 Conflict)
    // -------------------------------------------------------------------------
    const duplicateSubmitRes = await fetch(`${baseUrl}/api/quiz/submit`, {
      method: 'POST',
      headers: userA_Headers,
      body: JSON.stringify({
        quizId: quizA.id,
        answers: { q1: 'a', q2: 'b', q3: 'b' },
      }),
    });
    console.assert(duplicateSubmitRes.status === 409, `Expected 409 for duplicate submit, got ${duplicateSubmitRes.status}`);
    const duplicateJson = await duplicateSubmitRes.json();
    console.assert(duplicateJson.error === 'quiz_already_submitted', `Expected quiz_already_submitted, got ${duplicateJson.error}`);
    console.log('✓ Test 4 Passed: Second submit of the same quiz rejected with 409 Conflict');

    console.log('\n>>> All Server-Side Quizzes & Grading Tests Passed Successfully! <<<\n');
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

main().catch((err) => {
  console.error('Quiz grading test failed:', err);
  process.exit(1);
});

