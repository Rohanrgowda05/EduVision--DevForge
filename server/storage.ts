import {
  type User,
  type InsertUser,
  type RenderJob,
  type InsertRenderJob,
  type GeneratedVideo,
  type InsertGeneratedVideo,
  type Notes,
  type InsertNotes,
  type QuizAttempt,
  type InsertQuizAttempt,
  type Topic,
  type InsertTopic,
  type Quiz,
  type InsertQuiz,
  type QuestionResult,
  type InsertQuestionResult,
  users,
  topics,
  renderJobs,
  generatedVideos,
  notes,
  quizzes,
  quizAttempts,
  questionResults,
  recommendationCache,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, inArray, gte, lte, desc, sql } from "drizzle-orm";
import { calculateStreak } from "./streak";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByAuthId(authId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  upsertUser(user: { authId: string; email: string }): Promise<User>;
  updateUserStreak(userId: string, streak: number, lastActiveDate?: string): Promise<User | undefined>;
  getUserActivityStreak(userId: string): Promise<number>;

  // Render Jobs
  createRenderJob(job: InsertRenderJob): Promise<RenderJob>;
  getRenderJob(id: string): Promise<RenderJob | undefined>;
  updateRenderJob(id: string, updates: Partial<RenderJob>): Promise<RenderJob | undefined>;
  getActiveJobForUser(userId: string): Promise<RenderJob | undefined>;
  getDailyJobCountForUser(userId: string, date?: Date): Promise<number>;
  claimNextQueuedJob(): Promise<RenderJob | undefined>;
  recoverStuckJobs(thresholdMs?: number): Promise<number>;

  // Videos
  createGeneratedVideo(video: InsertGeneratedVideo): Promise<GeneratedVideo>;
  getGeneratedVideos(userId?: string): Promise<GeneratedVideo[]>;
  getGeneratedVideoById(id: string): Promise<GeneratedVideo | undefined>;
  getVideoByJobId(jobId: string): Promise<GeneratedVideo | undefined>;

  // Notes
  createNotes(note: InsertNotes): Promise<Notes>;
  getNotesByVideoId(videoId: string): Promise<Notes | undefined>;
  getNotesById(id: string): Promise<Notes | undefined>;
  markNotesDownloaded(notesId: string): Promise<Notes | undefined>;
  getNotesDownloadCount(userId?: string): Promise<number>;

  // Topics
  createTopic(topic: InsertTopic): Promise<Topic>;
  getTopicByName(userId: string, canonicalName: string): Promise<Topic | undefined>;
  getTopicById(id: string): Promise<Topic | undefined>;
  getUserTopics(userId: string): Promise<Topic[]>;

  // Quiz & Per-Concept Results
  createQuiz(quiz: InsertQuiz): Promise<Quiz>;
  getQuiz(id: string): Promise<Quiz | undefined>;
  markQuizSubmitted(id: string): Promise<void>;
  createQuizAttempt(attempt: InsertQuizAttempt): Promise<QuizAttempt>;
  createQuizAttemptWithResults(
    attempt: InsertQuizAttempt,
    results: InsertQuestionResult[],
    quizId: string
  ): Promise<{ attempt: QuizAttempt; results: QuestionResult[] }>;
  getQuizAttempts(userId?: string): Promise<QuizAttempt[]>;
  getQuestionResultsForUser(userId: string, topicId?: string): Promise<QuestionResult[]>;
  getExistingConceptsForTopic(userId: string, topicId: string): Promise<string[]>;
  // Recommendations Cache
  getCachedRecommendations(key: string): Promise<any | null>;
  setCachedRecommendations(key: string, query: string, results: any, expiresAt: Date): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByAuthId(authId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.authId, authId));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async upsertUser(data: { authId: string; email: string }): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        authId: data.authId,
        email: data.email,
        streak: 0,
      })
      .onConflictDoUpdate({
        target: users.authId,
        set: {
          email: data.email,
        },
      })
      .returning();
    return user;
  }

  async updateUserStreak(userId: string, streak: number, lastActiveDate?: string): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({
        streak,
        ...(lastActiveDate ? { lastActiveDate } : {}),
      })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async getUserActivityStreak(userId: string): Promise<number> {
    const videoRows = await db
      .select({ createdAt: generatedVideos.createdAt })
      .from(generatedVideos)
      .where(eq(generatedVideos.userId, userId));

    const quizRows = await db
      .select({ createdAt: quizAttempts.createdAt })
      .from(quizAttempts)
      .where(eq(quizAttempts.userId, userId));

    const activityDates = [
      ...videoRows.map((v) => v.createdAt),
      ...quizRows.map((q) => q.createdAt),
    ];

    const streak = calculateStreak(activityDates);
    await this.updateUserStreak(userId, streak);
    return streak;
  }

  async createRenderJob(job: InsertRenderJob): Promise<RenderJob> {
    const [created] = await db.insert(renderJobs).values(job).returning();
    return created;
  }

  async getRenderJob(id: string): Promise<RenderJob | undefined> {
    const [job] = await db.select().from(renderJobs).where(eq(renderJobs.id, id));
    return job;
  }

  async updateRenderJob(id: string, updates: Partial<RenderJob>): Promise<RenderJob | undefined> {
    const [updated] = await db
      .update(renderJobs)
      .set(updates)
      .where(eq(renderJobs.id, id))
      .returning();
    return updated;
  }

  async getActiveJobForUser(userId: string): Promise<RenderJob | undefined> {
    const [job] = await db
      .select()
      .from(renderJobs)
      .where(
        and(
          eq(renderJobs.userId, userId),
          inArray(renderJobs.status, ["queued", "running"])
        )
      )
      .orderBy(desc(renderJobs.createdAt))
      .limit(1);
    return job;
  }

  async getDailyJobCountForUser(userId: string, date: Date = new Date()): Promise<number> {
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const jobs = await db
      .select({ id: renderJobs.id })
      .from(renderJobs)
      .where(
        and(
          eq(renderJobs.userId, userId),
          gte(renderJobs.createdAt, startOfDay),
          lte(renderJobs.createdAt, endOfDay)
        )
      );

    return jobs.length;
  }

  async claimNextQueuedJob(): Promise<RenderJob | undefined> {
    return await db.transaction(async (tx) => {
      // FOR UPDATE SKIP LOCKED ensures concurrent workers never grab the same job
      const res = await tx.execute(sql`
        SELECT id
        FROM render_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);

      const row = res.rows[0] as { id: string } | undefined;
      if (!row) {
        return undefined;
      }

      const [claimed] = await tx
        .update(renderJobs)
        .set({
          status: "running",
          startedAt: new Date(),
        })
        .where(eq(renderJobs.id, row.id))
        .returning();

      return claimed;
    });
  }

  async recoverStuckJobs(thresholdMs: number = 300000): Promise<number> {
    const cutoff = new Date(Date.now() - thresholdMs);
    const updated = await db
      .update(renderJobs)
      .set({
        status: "failed",
        errorType: "interrupted",
        errorMessage: "Job interrupted due to worker shutdown or timeout. Please retry.",
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(renderJobs.status, "running"),
          or(lte(renderJobs.startedAt, cutoff), sql`started_at IS NULL`)
        )
      )
      .returning();

    return updated.length;
  }

  async getVideoByJobId(jobId: string): Promise<GeneratedVideo | undefined> {
    const [video] = await db
      .select()
      .from(generatedVideos)
      .where(eq(generatedVideos.jobId, jobId));
    return video;
  }

  async createGeneratedVideo(video: InsertGeneratedVideo): Promise<GeneratedVideo> {
    const [created] = await db.insert(generatedVideos).values(video).returning();
    return created;
  }

  async getGeneratedVideos(userId?: string): Promise<GeneratedVideo[]> {
    if (userId) {
      return db
        .select()
        .from(generatedVideos)
        .where(eq(generatedVideos.userId, userId))
        .orderBy(desc(generatedVideos.createdAt));
    }
    return db
      .select()
      .from(generatedVideos)
      .orderBy(desc(generatedVideos.createdAt));
  }

  async getGeneratedVideoById(id: string): Promise<GeneratedVideo | undefined> {
    const [video] = await db
      .select()
      .from(generatedVideos)
      .where(eq(generatedVideos.id, id));
    return video;
  }

  async createNotes(note: InsertNotes): Promise<Notes> {
    const [created] = await db.insert(notes).values(note).returning();
    return created;
  }

  async getNotesByVideoId(videoId: string): Promise<Notes | undefined> {
    const [note] = await db
      .select()
      .from(notes)
      .where(eq(notes.videoId, videoId));
    return note;
  }

  async getNotesById(id: string): Promise<Notes | undefined> {
    const [note] = await db
      .select()
      .from(notes)
      .where(eq(notes.id, id));
    return note;
  }

  async markNotesDownloaded(notesId: string): Promise<Notes | undefined> {
    const [updated] = await db
      .update(notes)
      .set({ downloaded: true })
      .where(eq(notes.id, notesId))
      .returning();
    return updated;
  }

  async getNotesDownloadCount(userId?: string): Promise<number> {
    if (userId) {
      const userNotes = await db
        .select({ id: notes.id })
        .from(notes)
        .innerJoin(generatedVideos, eq(notes.videoId, generatedVideos.id))
        .where(
          and(
            eq(generatedVideos.userId, userId),
            eq(notes.downloaded, true)
          )
        );
      return userNotes.length;
    }

    const allNotes = await db
      .select({ id: notes.id })
      .from(notes)
      .where(eq(notes.downloaded, true));
    return allNotes.length;
  }

  // Topics
  async createTopic(topic: InsertTopic): Promise<Topic> {
    const [created] = await db.insert(topics).values(topic).returning();
    return created;
  }

  async getTopicByName(userId: string, canonicalName: string): Promise<Topic | undefined> {
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.userId, userId), eq(topics.canonicalName, canonicalName)));
    return topic;
  }

  async getTopicById(id: string): Promise<Topic | undefined> {
    const [topic] = await db.select().from(topics).where(eq(topics.id, id));
    return topic;
  }

  async getUserTopics(userId: string): Promise<Topic[]> {
    return db
      .select()
      .from(topics)
      .where(eq(topics.userId, userId))
      .orderBy(desc(topics.createdAt));
  }

  // Quiz & Per-Concept Results
  async createQuiz(quiz: InsertQuiz): Promise<Quiz> {
    const [created] = await db.insert(quizzes).values(quiz).returning();
    return created;
  }

  async getQuiz(id: string): Promise<Quiz | undefined> {
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, id));
    return quiz;
  }

  async markQuizSubmitted(id: string): Promise<void> {
    await db.update(quizzes).set({ submitted: true }).where(eq(quizzes.id, id));
  }

  async createQuizAttempt(attempt: InsertQuizAttempt): Promise<QuizAttempt> {
    const [created] = await db.insert(quizAttempts).values(attempt).returning();
    return created;
  }

  async createQuizAttemptWithResults(
    attempt: InsertQuizAttempt,
    results: InsertQuestionResult[],
    quizId: string
  ): Promise<{ attempt: QuizAttempt; results: QuestionResult[] }> {
    // 1. Atomic compare-and-swap on submitted flag:
    // Only updates if submitted is currently false. Prevents race conditions and duplicate submissions.
    const [updatedQuiz] = await db
      .update(quizzes)
      .set({ submitted: true })
      .where(and(eq(quizzes.id, quizId), eq(quizzes.submitted, false)))
      .returning();

    if (!updatedQuiz) {
      throw new Error("QUIZ_ALREADY_SUBMITTED");
    }

    // 2. Insert attempt
    const [createdAttempt] = await db
      .insert(quizAttempts)
      .values({ ...attempt, quizId })
      .returning();

    // 3. Insert question results
    let createdResults: QuestionResult[] = [];
    if (results.length > 0) {
      const resultsWithAttempt = results.map((r) => ({
        ...r,
        attemptId: createdAttempt.id,
      }));
      createdResults = await db
        .insert(questionResults)
        .values(resultsWithAttempt)
        .returning();
    }

    return { attempt: createdAttempt, results: createdResults };
  }

  async getQuizAttempts(userId?: string): Promise<QuizAttempt[]> {
    if (userId) {
      return db
        .select()
        .from(quizAttempts)
        .where(eq(quizAttempts.userId, userId))
        .orderBy(desc(quizAttempts.createdAt));
    }
    return db
      .select()
      .from(quizAttempts)
      .orderBy(desc(quizAttempts.createdAt));
  }

  async getQuestionResultsForUser(userId: string, topicId?: string): Promise<QuestionResult[]> {
    if (topicId) {
      return db
        .select()
        .from(questionResults)
        .where(and(eq(questionResults.userId, userId), eq(questionResults.topicId, topicId)))
        .orderBy(desc(questionResults.createdAt));
    }
    return db
      .select()
      .from(questionResults)
      .where(eq(questionResults.userId, userId))
      .orderBy(desc(questionResults.createdAt));
  }

  async getExistingConceptsForTopic(userId: string, topicId: string): Promise<string[]> {
    const rows = await db
      .select({ concept: questionResults.concept })
      .from(questionResults)
      .where(and(eq(questionResults.userId, userId), eq(questionResults.topicId, topicId)));
    return Array.from(new Set(rows.map((r) => r.concept)));
  }

  async getCachedRecommendations(key: string): Promise<any | null> {
    const [cached] = await db
      .select()
      .from(recommendationCache)
      .where(eq(recommendationCache.cacheKey, key));
    if (!cached) return null;
    return cached;
  }

  async setCachedRecommendations(key: string, query: string, results: any, expiresAt: Date): Promise<void> {
    const existing = await this.getCachedRecommendations(key);
    if (existing) {
      await db
        .update(recommendationCache)
        .set({ results, expiresAt })
        .where(eq(recommendationCache.cacheKey, key));
    } else {
      await db.insert(recommendationCache).values({
        cacheKey: key,
        query,
        results,
        expiresAt,
      });
    }
  }
}

export class InMemoryStorage implements IStorage {
  private users: User[] = [];
  private renderJobs: RenderJob[] = [];
  private videos: GeneratedVideo[] = [];
  private notesStore: Notes[] = [];
  private quizzes: QuizAttempt[] = [];
  private topicsStore: Topic[] = [];
  private quizStore: Quiz[] = [];
  private questionResultsStore: QuestionResult[] = [];
  private recommendationStore = new Map<string, { query: string; results: any; expiresAt: Date }>();

  private id() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.find((u) => u.id === id);
  }

  async getUserByAuthId(authId: string): Promise<User | undefined> {
    return this.users.find((u) => u.authId === authId);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const user: User = {
      id: this.id(),
      authId: insertUser.authId,
      email: insertUser.email,
      streak: insertUser.streak ?? 0,
      lastActiveDate: insertUser.lastActiveDate ?? null,
      createdAt: new Date(),
    };
    this.users.push(user);
    return user;
  }

  async upsertUser(data: { authId: string; email: string }): Promise<User> {
    const existing = this.users.find((u) => u.authId === data.authId);
    if (existing) {
      existing.email = data.email;
      return existing;
    }
    return this.createUser({ authId: data.authId, email: data.email });
  }

  async updateUserStreak(userId: string, streak: number, lastActiveDate?: string): Promise<User | undefined> {
    const user = this.users.find((u) => u.id === userId);
    if (user) {
      user.streak = streak;
      if (lastActiveDate !== undefined) {
        user.lastActiveDate = lastActiveDate;
      }
    }
    return user;
  }

  async getUserActivityStreak(userId: string): Promise<number> {
    const userVideos = this.videos.filter((v) => v.userId === userId);
    const userQuizzes = this.quizzes.filter((q) => q.userId === userId);
    const activityDates = [
      ...userVideos.map((v) => v.createdAt),
      ...userQuizzes.map((q) => q.createdAt),
    ];
    const streak = calculateStreak(activityDates);
    await this.updateUserStreak(userId, streak);
    return streak;
  }

  async createRenderJob(job: InsertRenderJob): Promise<RenderJob> {
    const created: RenderJob = {
      id: this.id(),
      userId: job.userId,
      topicId: job.topicId ?? null,
      prompt: job.prompt,
      status: job.status ?? "queued",
      attempts: job.attempts ?? 0,
      videoUrl: job.videoUrl ?? null,
      errorType: job.errorType ?? null,
      errorMessage: job.errorMessage ?? null,
      plan: job.plan ?? null,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
    };
    this.renderJobs.unshift(created);
    return created;
  }

  async getRenderJob(id: string): Promise<RenderJob | undefined> {
    return this.renderJobs.find((j) => j.id === id);
  }

  async updateRenderJob(id: string, updates: Partial<RenderJob>): Promise<RenderJob | undefined> {
    const job = this.renderJobs.find((j) => j.id === id);
    if (job) {
      Object.assign(job, updates);
    }
    return job;
  }

  async getActiveJobForUser(userId: string): Promise<RenderJob | undefined> {
    return this.renderJobs.find(
      (j) => j.userId === userId && (j.status === "queued" || j.status === "running")
    );
  }

  async getDailyJobCountForUser(userId: string, date: Date = new Date()): Promise<number> {
    const dateStr = date.toISOString().split("T")[0];
    return this.renderJobs.filter(
      (j) => j.userId === userId && j.createdAt.toISOString().split("T")[0] === dateStr
    ).length;
  }

  async claimNextQueuedJob(): Promise<RenderJob | undefined> {
    const job = this.renderJobs
      .filter((j) => j.status === "queued")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (job) {
      job.status = "running";
      job.startedAt = new Date();
      return job;
    }
    return undefined;
  }

  async recoverStuckJobs(thresholdMs: number = 300000): Promise<number> {
    const cutoff = Date.now() - thresholdMs;
    let count = 0;
    for (const job of this.renderJobs) {
      if (job.status === "running") {
        if (!job.startedAt || job.startedAt.getTime() <= cutoff) {
          job.status = "failed";
          job.errorType = "interrupted";
          job.errorMessage = "Job interrupted due to worker shutdown or timeout. Please retry.";
          job.finishedAt = new Date();
          count++;
        }
      }
    }
    return count;
  }

  async getVideoByJobId(jobId: string): Promise<GeneratedVideo | undefined> {
    return this.videos.find((v) => v.jobId === jobId);
  }

  async createGeneratedVideo(video: InsertGeneratedVideo): Promise<GeneratedVideo> {
    const created: GeneratedVideo = {
      id: this.id(),
      userId: video.userId,
      topicId: video.topicId ?? null,
      jobId: video.jobId ?? null,
      prompt: video.prompt,
      videoUrl: video.videoUrl,
      createdAt: new Date(),
    };
    this.videos.unshift(created);
    return created;
  }

  async getGeneratedVideos(userId?: string): Promise<GeneratedVideo[]> {
    return userId ? this.videos.filter((v) => v.userId === userId) : this.videos;
  }

  async getGeneratedVideoById(id: string): Promise<GeneratedVideo | undefined> {
    return this.videos.find((v) => v.id === id);
  }

  async createNotes(note: InsertNotes): Promise<Notes> {
    const created: Notes = {
      id: this.id(),
      videoId: note.videoId,
      notesText: note.notesText,
      downloaded: note.downloaded ?? false,
      createdAt: new Date(),
    };
    this.notesStore.push(created);
    return created;
  }

  async getNotesByVideoId(videoId: string): Promise<Notes | undefined> {
    return this.notesStore.find((n) => n.videoId === videoId);
  }

  async getNotesById(id: string): Promise<Notes | undefined> {
    return this.notesStore.find((n) => n.id === id);
  }

  async markNotesDownloaded(notesId: string): Promise<Notes | undefined> {
    const note = this.notesStore.find((n) => n.id === notesId);
    if (note) {
      note.downloaded = true;
    }
    return note;
  }

  async getNotesDownloadCount(userId?: string): Promise<number> {
    if (userId) {
      const userVideoIds = new Set(this.videos.filter((v) => v.userId === userId).map((v) => v.id));
      return this.notesStore.filter((n) => n.downloaded && userVideoIds.has(n.videoId)).length;
    }
    return this.notesStore.filter((n) => n.downloaded).length;
  }

  async createQuizAttempt(attempt: InsertQuizAttempt): Promise<QuizAttempt> {
    const created: QuizAttempt = {
      id: this.id(),
      userId: attempt.userId,
      quizId: attempt.quizId ?? null,
      topicId: attempt.topicId ?? null,
      prompt: attempt.prompt,
      score: attempt.score,
      totalQuestions: attempt.totalQuestions,
      createdAt: new Date(),
    };
    this.quizzes.unshift(created);
    return created;
  }

  async getQuizAttempts(userId?: string): Promise<QuizAttempt[]> {
    return userId ? this.quizzes.filter((q) => q.userId === userId) : this.quizzes;
  }

  // Topics
  async createTopic(topic: InsertTopic): Promise<Topic> {
    const created: Topic = {
      id: this.id(),
      userId: topic.userId,
      canonicalName: topic.canonicalName,
      createdAt: new Date(),
    };
    this.topicsStore.push(created);
    return created;
  }

  async getTopicByName(userId: string, canonicalName: string): Promise<Topic | undefined> {
    return this.topicsStore.find((t) => t.userId === userId && t.canonicalName === canonicalName);
  }

  async getTopicById(id: string): Promise<Topic | undefined> {
    return this.topicsStore.find((t) => t.id === id);
  }

  async getUserTopics(userId: string): Promise<Topic[]> {
    return this.topicsStore
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // Quizzes & Per-Concept Results
  async createQuiz(quiz: InsertQuiz): Promise<Quiz> {
    const created: Quiz = {
      id: this.id(),
      userId: quiz.userId,
      topicId: quiz.topicId ?? null,
      prompt: quiz.prompt,
      questions: quiz.questions,
      submitted: false,
      createdAt: new Date(),
    };
    this.quizStore.push(created);
    return created;
  }

  async getQuiz(id: string): Promise<Quiz | undefined> {
    return this.quizStore.find((q) => q.id === id);
  }

  async markQuizSubmitted(id: string): Promise<void> {
    const quiz = this.quizStore.find((q) => q.id === id);
    if (quiz) {
      quiz.submitted = true;
    }
  }

  async createQuizAttemptWithResults(
    attempt: InsertQuizAttempt,
    results: InsertQuestionResult[],
    quizId: string
  ): Promise<{ attempt: QuizAttempt; results: QuestionResult[] }> {
    const quiz = this.quizStore.find((q) => q.id === quizId);
    if (!quiz || quiz.submitted) {
      throw new Error("QUIZ_ALREADY_SUBMITTED");
    }
    quiz.submitted = true;

    const createdAttempt: QuizAttempt = {
      id: this.id(),
      userId: attempt.userId,
      quizId,
      topicId: attempt.topicId ?? null,
      prompt: attempt.prompt,
      score: attempt.score,
      totalQuestions: attempt.totalQuestions,
      createdAt: new Date(),
    };
    this.quizzes.unshift(createdAttempt);

    const createdResults: QuestionResult[] = results.map((r, idx) => ({
      id: this.id() + "_" + idx,
      attemptId: createdAttempt.id,
      userId: r.userId,
      topicId: r.topicId ?? null,
      concept: r.concept,
      questionIndex: r.questionIndex,
      chosen: r.chosen,
      correct: r.correct,
      createdAt: new Date(),
    }));
    this.questionResultsStore.push(...createdResults);

    return { attempt: createdAttempt, results: createdResults };
  }

  async getQuestionResultsForUser(userId: string, topicId?: string): Promise<QuestionResult[]> {
    return this.questionResultsStore
      .filter((qr) => qr.userId === userId && (!topicId || qr.topicId === topicId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getExistingConceptsForTopic(userId: string, topicId: string): Promise<string[]> {
    const concepts = this.questionResultsStore
      .filter((qr) => qr.userId === userId && qr.topicId === topicId)
      .map((qr) => qr.concept);
    return Array.from(new Set(concepts));
  }

  async getCachedRecommendations(key: string): Promise<any | null> {
    const cached = this.recommendationStore.get(key);
    if (!cached) return null;
    return {
      cacheKey: key,
      query: cached.query,
      results: cached.results,
      expiresAt: cached.expiresAt,
    };
  }

  async setCachedRecommendations(key: string, query: string, results: any, expiresAt: Date): Promise<void> {
    this.recommendationStore.set(key, { query, results, expiresAt });
  }
}

// Configurable storage implementation: default to DatabaseStorage, allow InMemoryStorage via STORAGE=memory
export const storage: IStorage =
  process.env.STORAGE === "memory"
    ? new InMemoryStorage()
    : new DatabaseStorage();
