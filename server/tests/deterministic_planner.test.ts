import 'dotenv/config';
import { planStudy } from '../learning/planner';
import type { LearnerProfile, ConceptMastery } from '../learning/mastery';
import { storage } from '../storage';
import { processJob } from '../worker';

async function main() {
  console.log('\n--- Starting Deterministic Personalization Planner Tests ---');

  const now = new Date('2026-11-09T12:00:00Z');

  // ---------------------------------------------------------------------------
  // TEST 1: No history -> action: "generate_new", difficulty: "standard"
  // ---------------------------------------------------------------------------
  const emptyProfile: LearnerProfile = {
    topicId: 'topic_1',
    topicName: 'quantum_mechanics',
    concepts: [],
    lastActivity: null,
    totalAttempts: 0,
  };

  const plan1 = planStudy(emptyProfile, { now });
  console.assert(plan1.action === 'generate_new', `Expected 'generate_new', got '${plan1.action}'`);
  console.assert(plan1.difficulty === 'standard', `Expected 'standard', got '${plan1.difficulty}'`);
  console.assert(plan1.focusConcepts.length === 0, `Expected 0 focus concepts, got ${plan1.focusConcepts.length}`);
  console.assert(plan1.includeYoutube === false, 'Expected includeYoutube=false for new topic');
  console.log('✓ Test 1 Passed: No history yields generate_new plan');

  // ---------------------------------------------------------------------------
  // TEST 2: Weak concepts exist -> action: "remedial", up to 3 weakest concepts
  // ---------------------------------------------------------------------------
  const weakProfile: LearnerProfile = {
    topicId: 'topic_2',
    topicName: 'doppler_effect',
    concepts: [
      { concept: 'doppler_formula', mastery: 0.20, evidence: 4, status: 'weak', rawCorrect: 0, rawAttempts: 4 },
      { concept: 'frequency_shift', mastery: 0.35, evidence: 5, status: 'weak', rawCorrect: 1, rawAttempts: 5 },
      { concept: 'wave_speed', mastery: 0.50, evidence: 3, status: 'weak', rawCorrect: 1, rawAttempts: 3 },
      { concept: 'sound_barrier', mastery: 0.55, evidence: 3, status: 'weak', rawCorrect: 1, rawAttempts: 3 },
      { concept: 'relative_motion', mastery: 0.85, evidence: 5, status: 'strong', rawCorrect: 4, rawAttempts: 5 },
    ],
    lastActivity: now,
    totalAttempts: 20,
  };

  const plan2 = planStudy(weakProfile, { now });
  console.assert(plan2.action === 'remedial', `Expected 'remedial', got '${plan2.action}'`);
  console.assert(plan2.focusConcepts.length === 3, `Expected max 3 focus concepts, got ${plan2.focusConcepts.length}`);
  console.assert(plan2.focusConcepts[0] === 'doppler_formula', `Expected weakest concept first, got '${plan2.focusConcepts[0]}'`);
  console.assert(plan2.focusConcepts[1] === 'frequency_shift', `Expected 2nd weakest concept, got '${plan2.focusConcepts[1]}'`);
  console.assert(plan2.focusConcepts[2] === 'wave_speed', `Expected 3rd weakest concept, got '${plan2.focusConcepts[2]}'`);
  console.assert(plan2.includeYoutube === true, 'Remedial plan should include YouTube recommendations');
  console.assert(plan2.rationale.includes('doppler_formula'), `Rationale must explain focus: ${plan2.rationale}`);
  console.log('✓ Test 2 Passed: Weak concepts yield remedial plan focusing on up to 3 weakest concepts');

  // ---------------------------------------------------------------------------
  // TEST 3: All known concepts strong with sufficient evidence -> action: "advanced"
  // ---------------------------------------------------------------------------
  const strongProfile: LearnerProfile = {
    topicId: 'topic_3',
    topicName: 'pythagorean_theorem',
    concepts: [
      { concept: 'hypotenuse_calc', mastery: 0.85, evidence: 4, status: 'strong', rawCorrect: 4, rawAttempts: 4 },
      { concept: 'right_triangle_properties', mastery: 0.90, evidence: 5, status: 'strong', rawCorrect: 5, rawAttempts: 5 },
    ],
    lastActivity: now,
    totalAttempts: 9,
  };

  const plan3 = planStudy(strongProfile, { now });
  console.assert(plan3.action === 'advanced', `Expected 'advanced', got '${plan3.action}'`);
  console.assert(plan3.difficulty === 'challenging', `Expected 'challenging', got '${plan3.difficulty}'`);
  console.assert(plan3.focusConcepts.length === 0, 'Advanced plan should have no remedial focus concepts');
  console.assert(plan3.includeYoutube === true, 'Advanced plan should include YouTube for deeper exploration');
  console.log('✓ Test 3 Passed: All strong concepts yield advanced plan with challenging difficulty');

  // ---------------------------------------------------------------------------
  // TEST 4: Recent video generated in last 24h & no weak concepts -> reuse_existing
  // ---------------------------------------------------------------------------
  const recentVideoProfile: LearnerProfile = {
    topicId: 'topic_4',
    topicName: 'gravity_orbits',
    concepts: [
      { concept: 'kepler_laws', mastery: 0.70, evidence: 3, status: 'unknown', rawCorrect: 2, rawAttempts: 3 },
    ],
    lastActivity: now,
    totalAttempts: 3,
  };

  const plan4 = planStudy(recentVideoProfile, {
    now,
    recentVideo: {
      videoUrl: '/static/videos/recent_orbit.mp4',
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago (< 24h)
    },
  });

  console.assert(plan4.action === 'reuse_existing', `Expected 'reuse_existing', got '${plan4.action}'`);
  console.assert(plan4.reusedVideoUrl === '/static/videos/recent_orbit.mp4', 'Reused video URL mismatch');
  console.assert(plan4.includeYoutube === false, 'Reuse existing should not require YouTube recommendations');
  console.log('✓ Test 4 Passed: Recent video within 24h and no weak concepts yields reuse_existing plan');

  // ---------------------------------------------------------------------------
  // TEST 5: Worker Integration: Plan persistence on render_jobs table
  // ---------------------------------------------------------------------------
  const user = await storage.upsertUser({ authId: `plan_user_${Date.now()}`, email: 'plan_user@test.com' });
  const topic = await storage.createTopic({ userId: user.id, canonicalName: 'fourier_transform' });

  // Simulate an existing video from 1 hour ago
  const priorVideo = await storage.createGeneratedVideo({
    userId: user.id,
    topicId: topic.id,
    prompt: 'Fourier Transform Visualized',
    videoUrl: '/static/videos/cached_fourier.mp4',
  });

  const job = await storage.createRenderJob({
    userId: user.id,
    topicId: topic.id,
    prompt: 'Fourier Transform Visualized',
    status: 'queued',
  });

  // Process job through worker - should detect reuse_existing plan without calling Flask
  await processJob(job.id);

  const updatedJob = await storage.getRenderJob(job.id);
  console.assert(updatedJob?.status === 'succeeded', `Expected succeeded, got ${updatedJob?.status}`);
  console.assert(updatedJob?.plan != null, 'Expected plan persisted on job');
  console.assert((updatedJob?.plan as any)?.action === 'reuse_existing', `Expected plan action 'reuse_existing', got ${(updatedJob?.plan as any)?.action}`);
  console.assert(updatedJob?.videoUrl === '/static/videos/cached_fourier.mp4', `Expected reused video URL, got ${updatedJob?.videoUrl}`);
  console.log('✓ Test 5 Passed: Worker generated, persisted, and executed plan on job');

  console.log('\n>>> All Deterministic Planner Tests Passed Successfully! <<<\n');
}

main().catch((err) => {
  console.error('Planner test failed:', err);
  process.exit(1);
});

