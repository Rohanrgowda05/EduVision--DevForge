import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  authId: text("auth_id").notNull().unique(),
  email: text("email").notNull(),
  streak: integer("streak").default(0).notNull(),
  lastActiveDate: text("last_active_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const topics = pgTable(
  "topics",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id).notNull(),
    canonicalName: text("canonical_name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("topics_user_id_canonical_name_idx").on(table.userId, table.canonicalName),
    index("topics_user_id_idx").on(table.userId),
  ]
);

export const renderJobs = pgTable(
  "render_jobs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id).notNull(),
    topicId: varchar("topic_id").references(() => topics.id),
    prompt: text("prompt").notNull(),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed"] })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").default(0).notNull(),
    videoUrl: text("video_url"),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
    plan: jsonb("plan"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    index("render_jobs_status_created_at_idx").on(table.status, table.createdAt),
    index("render_jobs_user_id_created_at_idx").on(table.userId, table.createdAt),
  ]
);

export const generatedVideos = pgTable("generated_videos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  topicId: varchar("topic_id").references(() => topics.id),
  jobId: varchar("job_id").references(() => renderJobs.id),
  prompt: text("prompt").notNull(),
  videoUrl: text("video_url").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notes = pgTable("notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").references(() => generatedVideos.id).notNull(),
  notesText: text("notes_text").notNull(),
  downloaded: boolean("downloaded").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const quizzes = pgTable(
  "quizzes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id).notNull(),
    topicId: varchar("topic_id").references(() => topics.id),
    prompt: text("prompt").notNull(),
    questions: jsonb("questions").notNull(), // Stores Question[] including correctAnswer and concept
    submitted: boolean("submitted").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("quizzes_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("quizzes_topic_id_idx").on(table.topicId),
  ]
);

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id).notNull(),
    quizId: varchar("quiz_id").references(() => quizzes.id),
    topicId: varchar("topic_id").references(() => topics.id),
    prompt: text("prompt").notNull(),
    score: integer("score").notNull(),
    totalQuestions: integer("total_questions").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("quiz_attempts_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("quiz_attempts_topic_id_idx").on(table.topicId),
  ]
);

export const questionResults = pgTable(
  "question_results",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    attemptId: varchar("attempt_id").references(() => quizAttempts.id).notNull(),
    userId: varchar("user_id").references(() => users.id).notNull(),
    topicId: varchar("topic_id").references(() => topics.id),
    concept: text("concept").notNull(),
    questionIndex: integer("question_index").notNull(),
    chosen: text("chosen").notNull(),
    correct: boolean("correct").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("question_results_user_topic_concept_idx").on(table.userId, table.topicId, table.concept),
    index("question_results_attempt_id_idx").on(table.attemptId),
  ]
);

export const recommendationCache = pgTable(
  "recommendation_cache",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    cacheKey: text("cache_key").notNull().unique(),
    query: text("query").notNull(),
    results: jsonb("results").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [
    index("recommendation_cache_cache_key_idx").on(table.cacheKey),
    index("recommendation_cache_expires_at_idx").on(table.expiresAt),
  ]
);

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertTopicSchema = createInsertSchema(topics).omit({
  id: true,
  createdAt: true,
});

export const insertRenderJobSchema = createInsertSchema(renderJobs).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
});

export const insertGeneratedVideoSchema = createInsertSchema(generatedVideos).omit({
  id: true,
  createdAt: true,
});

export const insertNotesSchema = createInsertSchema(notes).omit({
  id: true,
  createdAt: true,
});

export const insertQuizSchema = createInsertSchema(quizzes).omit({
  id: true,
  createdAt: true,
});

export const insertQuizAttemptSchema = createInsertSchema(quizAttempts).omit({
  id: true,
  createdAt: true,
});

export const insertQuestionResultSchema = createInsertSchema(questionResults).omit({
  id: true,
  createdAt: true,
});

export const insertRecommendationCacheSchema = createInsertSchema(recommendationCache).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertTopic = z.infer<typeof insertTopicSchema>;
export type Topic = typeof topics.$inferSelect;

export type InsertRenderJob = z.infer<typeof insertRenderJobSchema>;
export type RenderJob = typeof renderJobs.$inferSelect;

export type InsertGeneratedVideo = z.infer<typeof insertGeneratedVideoSchema>;
export type GeneratedVideo = typeof generatedVideos.$inferSelect;

export type InsertNotes = z.infer<typeof insertNotesSchema>;
export type Notes = typeof notes.$inferSelect;

export type InsertQuiz = z.infer<typeof insertQuizSchema>;
export type Quiz = typeof quizzes.$inferSelect;

export type InsertQuizAttempt = z.infer<typeof insertQuizAttemptSchema>;
export type QuizAttempt = typeof quizAttempts.$inferSelect;

export type InsertQuestionResult = z.infer<typeof insertQuestionResultSchema>;
export type QuestionResult = typeof questionResults.$inferSelect;

export type InsertRecommendationCache = z.infer<typeof insertRecommendationCacheSchema>;
export type RecommendationCache = typeof recommendationCache.$inferSelect;
