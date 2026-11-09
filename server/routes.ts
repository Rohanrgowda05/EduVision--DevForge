import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { requireUser } from "./auth";
import { calculateStreak } from "./streak";
import type { InsertQuestionResult } from "@shared/schema";
import { normalizeTopicForUser } from "./learning/normalize";
import type { StudyPlan } from "./learning/planner";
import { getLearnerProfile } from "./learning/mastery";
import { searchYouTubeServerSide } from "./learning/recommendations";

export function sanitizeConceptLabel(label: unknown, fallback: string = "core_concept"): string {
  if (typeof label !== "string") return fallback;
  const cleaned = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  if (cleaned.length >= 2 && /^[a-z0-9_]{2,60}$/.test(cleaned)) {
    return cleaned;
  }
  return fallback;
}

export async function generateNotesWithGemini(
  prompt: string,
  plan?: StudyPlan | null
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const system = `You are EduVision, an expert educational notes generator for a visual learning platform. Produce concise (300–500 words), accurate Markdown with sections: Title (H1), Key Concepts, Intuition, Equations (inline), Real-World Applications, Suggested Animation Storyboard (numbered steps), Summary. No code fences.`;

  const learnerContext =
    plan?.focusConcepts && plan.focusConcepts.length > 0
      ? `\nLearner Context: Emphasize intuition and clear explanations for these specific focus concepts: ${plan.focusConcepts.join(", ")}. Keep standard sections.`
      : "";

  const user = `Topic: ${prompt}${learnerContext}\nGenerate the notes following the structure above.`;
  const result = await model.generateContent([system, user]);
  const text = result.response.text().trim();
  if (!text) {
    throw new Error("Empty response from Gemini");
  }
  return text;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Public Health Check Endpoint (no auth required)
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "healthy",
      service: "eduvision-express",
      timestamp: new Date().toISOString(),
    });
  });

  // ---------------------------------------------------------------------------
  // Internal Endpoints for Python Services / Study-Planner Agent
  // (Protected via shared X-Internal-Token header)
  // ---------------------------------------------------------------------------

  app.get("/api/internal/learner-profile", async (req, res) => {
    const token = req.headers["x-internal-token"];
    const expectedToken = process.env.INTERNAL_AUTH_TOKEN || "eduvision-internal-secret-token-key";
    if (!token || token !== expectedToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = typeof req.query.userId === "string" ? req.query.userId : "";
    const topicQuery = typeof req.query.topic === "string" ? req.query.topic : "";
    if (!userId || !topicQuery) {
      return res.status(400).json({ error: "Missing userId or topic" });
    }

    let topic = await storage.getTopicById(topicQuery);
    if (!topic) {
      topic = await storage.getTopicByName(userId, topicQuery);
    }

    if (!topic) {
      return res.json({ topicId: "", topicName: topicQuery, concepts: [], lastActivity: null, totalAttempts: 0 });
    }

    const profile = await getLearnerProfile(userId, topic.id);
    res.json(profile);
  });

  app.get("/api/internal/user-topics", async (req, res) => {
    const token = req.headers["x-internal-token"];
    const expectedToken = process.env.INTERNAL_AUTH_TOKEN || "eduvision-internal-secret-token-key";
    if (!token || token !== expectedToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = typeof req.query.userId === "string" ? req.query.userId : "";
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const topicsList = await storage.getUserTopics(userId);
    res.json(topicsList);
  });

  app.get("/api/internal/existing-assets", async (req, res) => {
    const token = req.headers["x-internal-token"];
    const expectedToken = process.env.INTERNAL_AUTH_TOKEN || "eduvision-internal-secret-token-key";
    if (!token || token !== expectedToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = typeof req.query.userId === "string" ? req.query.userId : "";
    const topicQuery = typeof req.query.topic === "string" ? req.query.topic : "";
    if (!userId || !topicQuery) {
      return res.status(400).json({ error: "Missing userId or topic" });
    }

    let topic = await storage.getTopicById(topicQuery);
    if (!topic) {
      topic = await storage.getTopicByName(userId, topicQuery);
    }

    if (!topic) {
      return res.json({ video: null, notes: null, quiz: null });
    }

    const videos = await storage.getGeneratedVideos(userId);
    const topicVideo = videos.find((v) => v.topicId === topic.id);

    const now = Date.now();
    let videoInfo = null;
    if (topicVideo) {
      const ageHours = (now - new Date(topicVideo.createdAt).getTime()) / (1000 * 60 * 60);
      videoInfo = {
        id: topicVideo.id,
        videoUrl: topicVideo.videoUrl,
        ageHours: parseFloat(ageHours.toFixed(1)),
      };
    }

    res.json({
      topicId: topic.id,
      topicName: topic.canonicalName,
      video: videoInfo,
    });
  });

  // All other /api/* routes require a verified session
  app.use("/api", requireUser);

  // ---------------------------------------------------------------------------
  // Async Jobs Pipeline
  // ---------------------------------------------------------------------------

  /**
   * POST /api/jobs: Enqueues a new animation render job.
   * Validates input length, enforces 1 active job limit and daily quota cap.
   * Returns 202 Accepted immediately with { jobId, status: "queued" }.
   */
  app.post("/api/jobs", async (req, res) => {
    try {
      const schema = z.object({
        prompt: z
          .string()
          .trim()
          .min(3, "Prompt must be at least 3 characters")
          .max(500, "Prompt must be 500 characters or less"),
      });

      const { prompt } = schema.parse(req.body);
      const userId = req.user!.id;

      // Enforce at most 1 active job per user
      const activeJob = await storage.getActiveJobForUser(userId);
      if (activeJob) {
        return res.status(429).json({
          error: "active_job_limit",
          message:
            "You already have an animation in progress. Please wait for it to complete.",
        });
      }

      // Enforce daily cap (default 10)
      const dailyCap = parseInt(process.env.DAILY_JOB_CAP || "10", 10);
      const todayCount = await storage.getDailyJobCountForUser(userId);
      if (todayCount >= dailyCap) {
        return res.status(429).json({
          error: "daily_cap_reached",
          message: `You have reached your daily limit of ${dailyCap} animations. Please try again tomorrow.`,
        });
      }

      // Normalize topic for user (keeps canonical names stable across prompt variations)
      const topic = await normalizeTopicForUser(userId, prompt);

      const job = await storage.createRenderJob({
        userId,
        topicId: topic.id,
        prompt,
        status: "queued",
        attempts: 0,
      });

      res.status(202).json({
        jobId: job.id,
        status: "queued",
        prompt: job.prompt,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: error.errors[0]?.message || "Invalid input" });
      }
      console.error("Create job error:", error);
      res.status(500).json({ error: "Failed to queue job" });
    }
  });

  /**
   * GET /api/jobs/:id: Returns status, attempts, error details, and when completed,
   * the video and notes records. Owner only (returns 404 for other users).
   */
  app.get("/api/jobs/:id", async (req, res) => {
    try {
      const job = await storage.getRenderJob(req.params.id);
      if (!job || job.userId !== req.user!.id) {
        return res.status(404).json({ error: "Job not found" });
      }

      let video: any = null;
      let notes: any = null;

      if (job.status === "succeeded") {
        video = await storage.getVideoByJobId(job.id);
        if (video) {
          notes = await storage.getNotesByVideoId(video.id);
        }
      }

      res.json({
        ...job,
        video,
        notes: notes
          ? { id: notes.id, notesText: notes.notesText, downloaded: notes.downloaded }
          : null,
        notesUnavailable: job.status === "succeeded" && video && !notes,
      });
    } catch (error) {
      console.error("Get job error:", error);
      res.status(500).json({ error: "Failed to fetch job" });
    }
  });

  /**
   * POST /api/jobs/:id/retry-notes: Re-attempts generating study notes if the
   * initial note generation failed, preserving the rendered video.
   */
  app.post("/api/jobs/:id/retry-notes", async (req, res) => {
    try {
      const job = await storage.getRenderJob(req.params.id);
      if (!job || job.userId !== req.user!.id) {
        return res.status(404).json({ error: "Job not found" });
      }

      if (job.status !== "succeeded") {
        return res.status(400).json({ error: "Job is not in succeeded state" });
      }

      const video = await storage.getVideoByJobId(job.id);
      if (!video) {
        return res.status(404).json({ error: "Associated video not found" });
      }

      let notes = await storage.getNotesByVideoId(video.id);
      if (!notes) {
        const notesText = await generateNotesWithGemini(job.prompt);
        notes = await storage.createNotes({
          videoId: video.id,
          notesText,
          downloaded: false,
        });
      }

      res.json(notes);
    } catch (error) {
      console.error("Retry notes error:", error);
      res.status(500).json({ error: "Failed to generate notes" });
    }
  });

  // ---------------------------------------------------------------------------
  // Quiz Routes
  // ---------------------------------------------------------------------------

  app.post("/api/quiz/generate", async (req, res) => {
    try {
      const schema = z.object({
        prompt: z.string().min(1),
        notesText: z.string().optional().nullable(),
      });
      const { prompt, notesText } = schema.parse(req.body);
      const userId = req.user!.id;

      // Normalize topic for user and retrieve existing concept labels
      const topic = await normalizeTopicForUser(userId, prompt);
      const existingConcepts = await storage.getExistingConceptsForTopic(userId, topic.id);

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      // Check if user has weak concepts for this topic to personalize the quiz
      const profile = await getLearnerProfile(userId, topic.id);
      const weakConcepts = profile.concepts
        .filter((c) => c.status === "weak")
        .map((c) => c.concept);

      const conceptGuidance =
        weakConcepts.length > 0
          ? `CRITICAL PERSONALIZATION RULE: At least 60% of questions (at least 3 out of 5) MUST directly target these weak focus concepts: ${JSON.stringify(weakConcepts.slice(0, 3))}. The remaining questions should cover broader topic fundamentals.`
          : existingConcepts.length > 0
          ? `User's known concept labels for this topic: ${JSON.stringify(existingConcepts)}. Where applicable, reuse these exact concept labels. If the question addresses a new aspect, create a short lowercase snake_case label.`
          : `The 'concept' MUST be a short lowercase snake_case label (2 to 60 characters, [a-z0-9_] only, e.g. "wave_speed", "frequency_shift").`;

      const system = `You generate multiple-choice quizzes with per-question concept tags. Output STRICT JSON only. No markdown, no commentary. Structure: {"questions":[{"id":"q1","question":"...","concept":"short_snake_case_concept","options":[{"id":"a","text":"..."},{"id":"b","text":"..."},{"id":"c","text":"..."},{"id":"d","text":"..."}],"correctAnswer":"a"}, ... five total]}. Rules: Exactly 5 questions total, each with exactly 4 options (a,b,c,d). ${conceptGuidance} Questions must be grounded in the provided topic/notes. Keep answers unambiguous.`;
      const user = `Topic: ${prompt}\nNotes (optional): ${notesText ?? ""}\nCreate 5 MCQs as per the structure.`;

      const result = await model.generateContent([system, user]);
      const text = result.response.text().trim();

      let payload: any;
      try {
        const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
        payload = JSON.parse(cleaned);
      } catch {
        return res.status(502).json({ error: "LLM returned invalid JSON" });
      }

      const questionSchema = z.object({
        id: z.string(),
        question: z.string(),
        concept: z.string().optional().transform((val) => sanitizeConceptLabel(val)),
        options: z
          .array(z.object({ id: z.enum(["a", "b", "c", "d"]), text: z.string() }))
          .length(4),
        correctAnswer: z.enum(["a", "b", "c", "d"]),
      });
      const parsed = z
        .object({ questions: z.array(questionSchema).length(5) })
        .safeParse(payload);
      if (!parsed.success) {
        return res.status(502).json({ error: "LLM returned malformed questions" });
      }

      // Store quiz server-side (including correctAnswer and concept)
      const quiz = await storage.createQuiz({
        userId,
        prompt,
        questions: parsed.data.questions,
        topicId: topic.id,
      });

      // Strip correctAnswer from client payload
      const clientQuestions = parsed.data.questions.map(({ correctAnswer, ...rest }) => rest);

      res.json({
        quizId: quiz.id,
        questions: clientQuestions,
      });
    } catch (error) {
      console.error("Quiz generate error:", error);
      res.status(500).json({ error: "Failed to generate quiz" });
    }
  });

  app.post("/api/quiz/submit", async (req, res) => {
    try {
      const schema = z.object({
        quizId: z.string().min(1),
        answers: z.record(z.string()),
      });

      const { quizId, answers } = schema.parse(req.body);
      const userId = req.user!.id;

      const quiz = await storage.getQuiz(quizId);
      if (!quiz || quiz.userId !== userId) {
        return res.status(404).json({ error: "Quiz not found" });
      }

      if (quiz.submitted) {
        return res.status(409).json({
          error: "quiz_already_submitted",
          message: "This quiz has already been submitted.",
        });
      }

      const questions = quiz.questions as Array<{
        id: string;
        question: string;
        concept: string;
        options: Array<{ id: string; text: string }>;
        correctAnswer: string;
      }>;

      let score = 0;
      const questionResults: InsertQuestionResult[] = [];
      const feedback = [];

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const chosen = (answers[q.id] || "").trim().toLowerCase();
        const isCorrect = chosen === q.correctAnswer;
        if (isCorrect) {
          score++;
        }

        questionResults.push({
          attemptId: "", // Set in storage transaction
          userId,
          topicId: quiz.topicId ?? null,
          concept: sanitizeConceptLabel(q.concept),
          questionIndex: i,
          chosen: chosen || "none",
          correct: isCorrect,
        });

        feedback.push({
          id: q.id,
          question: q.question,
          concept: q.concept,
          chosen: chosen || null,
          correctAnswer: q.correctAnswer,
          isCorrect,
        });
      }

      const passed = score >= Math.ceil(questions.length * 0.6);

      try {
        const { attempt } = await storage.createQuizAttemptWithResults(
          {
            userId,
            prompt: quiz.prompt,
            score,
            totalQuestions: questions.length,
            topicId: quiz.topicId ?? null,
          },
          questionResults,
          quiz.id
        );

        res.json({
          attempt,
          score,
          totalQuestions: questions.length,
          passed,
          feedback,
          message: passed
            ? "Congratulations, you passed!"
            : "Keep learning and try again!",
        });
      } catch (err: any) {
        if (err.message === "QUIZ_ALREADY_SUBMITTED") {
          return res.status(409).json({
            error: "quiz_already_submitted",
            message: "This quiz has already been submitted.",
          });
        }
        throw err;
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid input" });
      }
      console.error("Quiz submit error:", error);
      res.status(500).json({ error: "Failed to submit quiz" });
    }
  });

  app.get("/api/quiz/history", async (req, res) => {
    try {
      const userId = req.user!.id;
      const attempts = await storage.getQuizAttempts(userId);
      res.json(attempts);
    } catch (error) {
      console.error("Get quiz history error:", error);
      res.status(500).json({ error: "Failed to fetch quiz history" });
    }
  });

  // ---------------------------------------------------------------------------
  // Recommendations & Browse Routes (Server-side YouTube with 24h caching)
  // ---------------------------------------------------------------------------

  app.get("/api/browse", async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const category = typeof req.query.category === "string" ? req.query.category.trim() : "All";

      if (!q) {
        return res.json({ items: [], source: "fallback" });
      }

      const searchTerm = category !== "All" && !q.toLowerCase().includes(category.toLowerCase())
        ? `${q} ${category}`
        : q;

      const result = await searchYouTubeServerSide(searchTerm);
      res.json(result);
    } catch (error) {
      console.error("Browse API error:", error);
      res.status(500).json({ error: "Failed to browse videos" });
    }
  });

  app.get("/api/recommendations", async (req, res) => {
    try {
      const topicId = typeof req.query.topicId === "string" ? req.query.topicId : "";
      if (!topicId) {
        return res.status(400).json({ error: "Missing topicId query parameter" });
      }

      const userId = req.user!.id;
      const topic = await storage.getTopicById(topicId);
      if (!topic || topic.userId !== userId) {
        return res.status(404).json({ error: "Topic not found" });
      }

      const profile = await getLearnerProfile(userId, topic.id);
      const weakest = profile.concepts.find((c) => c.status === "weak") || profile.concepts[0];

      const query = weakest
        ? `${topic.canonicalName.replace(/_/g, " ")} ${weakest.concept.replace(/_/g, " ")} explanation tutorial`
        : `${topic.canonicalName.replace(/_/g, " ")} educational tutorial`;

      const result = await searchYouTubeServerSide(query);
      res.json({
        topic: topic.canonicalName,
        weakestConcept: weakest?.concept || null,
        query,
        ...result,
      });
    } catch (error) {
      console.error("Recommendations API error:", error);
      res.status(500).json({ error: "Failed to fetch recommendations" });
    }
  });

  // ---------------------------------------------------------------------------
  // User Resource Routes
  // ---------------------------------------------------------------------------

  app.get("/api/videos", async (req, res) => {
    try {
      const userId = req.user!.id;
      const videos = await storage.getGeneratedVideos(userId);
      res.json(videos);
    } catch (error) {
      console.error("Get videos error:", error);
      res.status(500).json({ error: "Failed to fetch videos" });
    }
  });

  app.get("/api/videos/:id", async (req, res) => {
    try {
      const video = await storage.getGeneratedVideoById(req.params.id);
      if (!video || video.userId !== req.user!.id) {
        return res.status(404).json({ error: "Video not found" });
      }
      const notes = await storage.getNotesByVideoId(video.id);
      res.json({ video, notes });
    } catch (error) {
      console.error("Get video error:", error);
      res.status(500).json({ error: "Failed to fetch video" });
    }
  });

  app.post("/api/notes/:id/download", async (req, res) => {
    try {
      const note = await storage.getNotesById(req.params.id);
      if (!note) {
        return res.status(404).json({ error: "Notes not found" });
      }

      const video = await storage.getGeneratedVideoById(note.videoId);
      if (!video || video.userId !== req.user!.id) {
        return res.status(404).json({ error: "Notes not found" });
      }

      const updated = await storage.markNotesDownloaded(req.params.id);
      res.json(updated);
    } catch (error) {
      console.error("Mark download error:", error);
      res.status(500).json({ error: "Failed to mark notes as downloaded" });
    }
  });

  app.get("/api/profile", async (req, res) => {
    try {
      const userId = req.user!.id;

      const videos = await storage.getGeneratedVideos(userId);
      const quizAttempts = await storage.getQuizAttempts(userId);
      const notesDownloaded = await storage.getNotesDownloadCount(userId);

      const passedQuizzes = quizAttempts.filter(
        (q) => q.score >= Math.ceil(q.totalQuestions * 0.6)
      ).length;

      const passRate =
        quizAttempts.length > 0
          ? Math.round((passedQuizzes / quizAttempts.length) * 100)
          : 0;

      const streak = await storage.getUserActivityStreak(userId);

      const userTopics = await storage.getUserTopics(userId);
      const topicsWithProfiles = await Promise.all(
        userTopics.map(async (topic) => {
          const profile = await getLearnerProfile(userId, topic.id);
          return {
            id: topic.id,
            canonicalName: topic.canonicalName,
            profile,
          };
        })
      );

      res.json({
        videosGenerated: videos.length,
        notesDownloaded,
        quizAttempts: quizAttempts.length,
        passedQuizzes,
        passRate,
        streak,
        recentVideos: videos.slice(0, 5),
        recentQuizzes: quizAttempts.slice(0, 5),
        topics: topicsWithProfiles,
      });
    } catch (error) {
      console.error("Get profile error:", error);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  return httpServer;
}
