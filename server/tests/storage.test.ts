import 'dotenv/config';
import { DatabaseStorage, InMemoryStorage } from '../storage';
import { calculateStreak } from '../streak';

async function testStorage(storageName: string, store: DatabaseStorage | InMemoryStorage) {
  console.log(`\n--- Testing ${storageName} ---`);

  const testAuthId = `test_auth_${Date.now()}`;
  const testEmail = `test_${Date.now()}@eduvision.local`;

  // 1. User Upsert
  const user = await store.upsertUser({ authId: testAuthId, email: testEmail });
  console.assert(user.authId === testAuthId, "User authId mismatch");
  console.assert(user.email === testEmail, "User email mismatch");
  console.log(`✓ User created/upserted: ID=${user.id}`);

  // 2. Render Job creation
  const job = await store.createRenderJob({
    userId: user.id,
    prompt: "Visualize Brownian Motion",
    status: "queued",
    attempts: 0,
  });
  console.assert(job.id !== undefined, "Job ID missing");
  console.assert(job.status === "queued", "Job status should be queued");
  console.log(`✓ Render job created: ID=${job.id}, status=${job.status}`);

  // 3. Render Job update
  const updatedJob = await store.updateRenderJob(job.id, {
    status: "succeeded",
    videoUrl: "/static/videos/test.mp4",
    attempts: 1,
  });
  console.assert(updatedJob?.status === "succeeded", "Job status should be succeeded");
  console.log(`✓ Render job updated to succeeded`);

  // 4. Video creation
  const video = await store.createGeneratedVideo({
    userId: user.id,
    jobId: job.id,
    prompt: "Visualize Brownian Motion",
    videoUrl: "/static/videos/test.mp4",
  });
  console.assert(video.id !== undefined, "Video ID missing");
  console.log(`✓ Generated video stored: ID=${video.id}`);

  // 5. Notes creation
  const note = await store.createNotes({
    videoId: video.id,
    notesText: "# Brownian Motion\nNotes content...",
    downloaded: false,
  });
  console.assert(note.downloaded === false, "Note should initially not be downloaded");
  console.log(`✓ Notes created: ID=${note.id}`);

  // 6. Mark notes downloaded
  const downloadedNote = await store.markNotesDownloaded(note.id);
  console.assert(downloadedNote?.downloaded === true, "Note should be marked downloaded");
  const count = await store.getNotesDownloadCount(user.id);
  console.assert(count === 1, `Download count should be 1, got ${count}`);
  console.log(`✓ Notes marked downloaded, user download count: ${count}`);

  // 7. Quiz attempt creation
  const quiz = await store.createQuizAttempt({
    userId: user.id,
    prompt: "Visualize Brownian Motion",
    score: 4,
    totalQuestions: 5,
  });
  console.assert(quiz.score === 4, "Quiz score should be 4");
  console.log(`✓ Quiz attempt recorded: ID=${quiz.id}, score=${quiz.score}/${quiz.totalQuestions}`);

  // 8. Streak calculation
  const streak = await store.getUserActivityStreak(user.id);
  console.assert(streak >= 1, `Streak should be at least 1, got ${streak}`);
  console.log(`✓ Computed active learning streak from real activity: ${streak} day(s)`);

  console.log(`All operations for ${storageName} passed successfully!`);
}

async function main() {
  // Test in-memory storage
  const memoryStore = new InMemoryStorage();
  await testStorage("InMemoryStorage", memoryStore);

  // Test database storage
  const dbStore = new DatabaseStorage();
  await testStorage("DatabaseStorage", dbStore);
}

main().catch((err) => {
  console.error("Storage test failed:", err);
  process.exit(1);
});

