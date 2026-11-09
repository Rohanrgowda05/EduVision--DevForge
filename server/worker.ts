import { storage } from "./storage";
import { generateNotesWithGemini } from "./routes";
import { getStudyPlan, type StudyPlan } from "./learning/planner";

let isRunning = false;
let activeWorkers = 0;
let workerLoopTimer: NodeJS.Timeout | null = null;

const RENDER_TIMEOUT_MS = 135000; // 135s (sandbox enforces 120s max)
const IDLE_POLL_INTERVAL_MS = 1000;

export async function processJob(jobId: string): Promise<void> {
  const job = await storage.getRenderJob(jobId);
  if (!job) {
    return;
  }

  const flaskUrl = process.env.FLASK_URL || "http://127.0.0.1:5000";
  const internalToken = process.env.INTERNAL_AUTH_TOKEN || "eduvision-internal-secret-token-key";

  // Step 1: Personalization Plan (Adaptive Learning Layer)
  let plan: StudyPlan | null = null;
  try {
    let recentVideo: any = null;
    if (job.topicId) {
      const userVideos = await storage.getGeneratedVideos(job.userId);
      recentVideo = userVideos.find((v) => v.topicId === job.topicId && v.jobId !== job.id) || null;
    }

    plan = await getStudyPlan(job.userId, job.topicId || "", job.prompt, { recentVideo });
    await storage.updateRenderJob(job.id, { plan });
    console.log(`[Worker] Job ${job.id} plan: ${plan.action} (agent=${(plan as any).agentUsed ? "yes" : "no"}) | Focus: ${plan.focusConcepts.join(", ")} | Rationale: ${plan.rationale}`);
  } catch (planErr: any) {
    console.warn(`[Worker] Planning failed for job ${job.id}, falling back to standard generation:`, planErr.message);
  }

  // If plan determines we can reuse an existing visualization from last 24h:
  if (plan?.action === "reuse_existing" && plan.reusedVideoUrl) {
    console.log(`[Worker] Reusing existing visualization for job ${job.id}: ${plan.reusedVideoUrl}`);
    const video = await storage.createGeneratedVideo({
      userId: job.userId,
      jobId: job.id,
      topicId: job.topicId ?? null,
      prompt: job.prompt,
      videoUrl: plan.reusedVideoUrl,
    });

    await storage.updateRenderJob(job.id, {
      status: "succeeded",
      videoUrl: plan.reusedVideoUrl,
      attempts: 1,
      finishedAt: new Date(),
    });

    try {
      const notesText = await generateNotesWithGemini(job.prompt, plan);
      await storage.createNotes({
        videoId: video.id,
        notesText,
        downloaded: false,
      });
    } catch (noteErr: any) {
      console.warn(`[Worker] Note generation failed for reused video ${video.id}:`, noteErr.message);
    }
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);

  try {
    console.log(`[Worker] Starting render for job ${job.id}: "${job.prompt}"`);

    const res = await fetch(`${flaskUrl}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": internalToken,
      },
      body: JSON.stringify({
        prompt: job.prompt,
        focus_concepts: plan?.focusConcepts || [],
        difficulty: plan?.difficulty || "standard",
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.status === 200) {
      const data = await res.json();
      const videoUrl = data.video_url;
      const attempts = data.attempts || 1;

      // 1. Persist video record
      const video = await storage.createGeneratedVideo({
        userId: job.userId,
        jobId: job.id,
        topicId: job.topicId ?? null,
        prompt: job.prompt,
        videoUrl,
      });

      // 2. Mark render job as succeeded
      await storage.updateRenderJob(job.id, {
        status: "succeeded",
        videoUrl,
        attempts,
        finishedAt: new Date(),
      });

      console.log(`[Worker] Job ${job.id} succeeded. Saved video ${video.id}`);

      // 3. Notes generation (Gemini) — with learner context focus concepts
      try {
        console.log(`[Worker] Generating notes for job ${job.id}...`);
        const notesText = await generateNotesWithGemini(job.prompt, plan);
        await storage.createNotes({
          videoId: video.id,
          notesText,
          downloaded: false,
        });
        console.log(`[Worker] Notes generated and saved for video ${video.id}`);
      } catch (noteErr: any) {
        console.warn(`[Worker] Note generation failed for video ${video.id} (video remains intact):`, noteErr.message);
      }

      return;
    }

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const retryAfter = data.retry_after_s || 60;
      await storage.updateRenderJob(job.id, {
        status: "failed",
        errorType: "rate_limited",
        errorMessage: `Generation rate limited. Please try again in ${retryAfter} seconds.`,
        finishedAt: new Date(),
      });
      console.warn(`[Worker] Job ${job.id} rate limited by Flask. Retry after ${retryAfter}s`);
      return;
    }

    // Handle 500 or other errors
    const data = await res.json().catch(() => ({}));
    const errorType = data.error_type || "render_error";
    const errorMessage = data.error || data.stderr_tail || "Rendering failed";
    const attempts = data.attempts || 1;

    await storage.updateRenderJob(job.id, {
      status: "failed",
      errorType,
      errorMessage,
      attempts,
      finishedAt: new Date(),
    });
    console.error(`[Worker] Job ${job.id} failed (${errorType}): ${errorMessage}`);
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === "AbortError";
    const errorType = isTimeout ? "timeout" : "render_error";
    const errorMessage = isTimeout
      ? "Rendering timed out after 120s"
      : `Internal worker error: ${err.message}`;

    await storage.updateRenderJob(job.id, {
      status: "failed",
      errorType,
      errorMessage,
      attempts: 1,
      finishedAt: new Date(),
    });
    console.error(`[Worker] Job ${job.id} caught exception:`, errorMessage);
  }
}

async function workerLoop(): Promise<void> {
  if (!isRunning) {
    return;
  }

  const concurrency = parseInt(process.env.RENDER_CONCURRENCY || "1", 10);

  while (isRunning && activeWorkers < concurrency) {
    try {
      const job = await storage.claimNextQueuedJob();
      if (!job) {
        break; // No queued jobs right now
      }

      activeWorkers++;
      // Process asynchronously without blocking the loop
      processJob(job.id)
        .catch((err) => console.error(`[Worker] Unhandled error in job ${job.id}:`, err))
        .finally(() => {
          activeWorkers--;
          // Immediately check for the next job
          if (isRunning) {
            setImmediate(workerLoop);
          }
        });
    } catch (err: any) {
      console.error("[Worker] Error claiming next job:", err.message);
      break;
    }
  }

  // Schedule next polling tick
  if (isRunning) {
    workerLoopTimer = setTimeout(workerLoop, IDLE_POLL_INTERVAL_MS);
  }
}

export async function startWorker(): Promise<void> {
  if (isRunning) {
    return;
  }
  isRunning = true;
  console.log(`[Worker] Starting background render worker (Concurrency: ${process.env.RENDER_CONCURRENCY || 1})`);

  // Startup recovery: mark any jobs stuck in "running" as failed/interrupted
  try {
    const recovered = await storage.recoverStuckJobs(300000); // 5 min threshold
    if (recovered > 0) {
      console.log(`[Worker] Startup recovery: recovered ${recovered} stuck job(s)`);
    }
  } catch (err: any) {
    console.error("[Worker] Startup recovery failed:", err.message);
  }

  workerLoop();
}

export function stopWorker(): void {
  isRunning = false;
  if (workerLoopTimer) {
    clearTimeout(workerLoopTimer);
    workerLoopTimer = null;
  }
  console.log("[Worker] Stopped background render worker");
}

