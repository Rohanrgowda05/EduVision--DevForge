CREATE TABLE "question_results" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"topic_id" varchar,
	"concept" text NOT NULL,
	"question_index" integer NOT NULL,
	"chosen" text NOT NULL,
	"correct" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"topic_id" varchar,
	"prompt" text NOT NULL,
	"questions" jsonb NOT NULL,
	"submitted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"query" text NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "recommendation_cache_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"canonical_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_videos" ADD COLUMN "topic_id" varchar;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "quiz_id" varchar;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "topic_id" varchar;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD COLUMN "topic_id" varchar;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "question_results" ADD CONSTRAINT "question_results_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_results" ADD CONSTRAINT "question_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_results" ADD CONSTRAINT "question_results_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_results_user_topic_concept_idx" ON "question_results" USING btree ("user_id","topic_id","concept");--> statement-breakpoint
CREATE INDEX "question_results_attempt_id_idx" ON "question_results" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "quizzes_user_id_created_at_idx" ON "quizzes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "quizzes_topic_id_idx" ON "quizzes" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "recommendation_cache_cache_key_idx" ON "recommendation_cache" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "recommendation_cache_expires_at_idx" ON "recommendation_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_user_id_canonical_name_idx" ON "topics" USING btree ("user_id","canonical_name");--> statement-breakpoint
CREATE INDEX "topics_user_id_idx" ON "topics" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "generated_videos" ADD CONSTRAINT "generated_videos_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quiz_attempts_topic_id_idx" ON "quiz_attempts" USING btree ("topic_id");