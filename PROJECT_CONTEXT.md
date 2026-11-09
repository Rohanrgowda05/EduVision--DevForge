# EduVision — Complete Project Context for LLM

> **Purpose of this file:** Give any LLM a complete, self-contained understanding of the EduVision project — its goals, architecture, every source file, data flows, API contracts, database schema, environment variables, and how to run it — so it can confidently modify, extend, or debug the codebase.

---

## 1. Project Overview

**EduVision** is an AI-powered visual-learning platform. A user types a natural-language topic (e.g. "Visualize the Doppler effect"), and the system:

1. Sends the prompt to a **Python Flask microservice** (`hack27/`) which uses **Google Gemini LLM** to generate a **Manim** (mathematical animation library) Python script.
2. Executes the Manim script to render an **MP4 animation video**.
3. Returns the video URL to the **React frontend**.
4. Simultaneously calls **Gemini** from the **Node.js Express backend** to generate **Markdown study notes** about the topic.
5. Displays the video + notes to the user.
6. Lets the user take an **AI-generated MCQ quiz** (also via Gemini) on the topic.
7. Tracks stats on a **Profile page** (videos generated, quiz pass rate, learning streak).
8. Offers a **Browse page** that searches **YouTube Data API v3** for related educational videos.

**Team:** Code Warriors (Scaler School of Technology / DevForge hackathon project)

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        USER (Browser)                       │
│  React 18 + TypeScript + Tailwind + Vite + shadcn/ui        │
│  Pages: Home │ Quiz │ Browse │ Profile                      │
│  Authentication: Clerk JWT / Session Cookie                 │
└──────────────────────────────┬──────────────────────────────┘
                               │ Authenticated requests (/api/*)
                               │ (Browser NEVER calls Flask directly)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Node.js Express Backend                     │
│                 (server/ - Port 3000)                       │
│                                                             │
│  • Auth: Clerk session verification (server/auth.ts)        │
│  • Job Queue: POST /api/jobs → 202 Accepted + jobId         │
│  • Worker: server/worker.ts (FOR UPDATE SKIP LOCKED)        │
│    - Deterministic / Agent Personalization Planner          │
│    - POST http://127.0.0.1:5000/generate                    │
│      (Headers: X-Internal-Token, focus_concepts, difficulty)│
│    - Generates markdown study notes via Gemini              │
│  • Adaptive Learning Layer (server/learning/):              │
│    - Topic normalization (normalize.ts)                     │
│    - Bayesian Laplace mastery model (mastery.ts)            │
│    - Study planner & ADK agent bridge (planner.ts)          │
│    - YouTube search with 24h DB caching (recommendations.ts)│
│  • Storage: DatabaseStorage on Neon Postgres via Drizzle    │
└──────────────────────────────┬──────────────────────────────┘
                               │ Private Internal HTTP + X-Internal-Token
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              Python Flask Animation Service                 │
│              (hack27/ - Port 5000)                          │
│                                                             │
│  • Auth: Strict X-Internal-Token header verification        │
│  • POST /generate:                                          │
│    - Pipeline: hack27/planner/pipeline.py                   │
│    - Code Gen: Gemini 2.5 Flash (plannerscript.py)          │
│    - Security Filter: AST Validator (validator.py)          │
│    - Sandboxed Execution: Docker container (sandbox/)       │
│      (no network, 2GB RAM, 1 CPU, 64 pids, 120s timeout)   │
│    - Repair Loop: Max 3 attempts feeding stderr to Gemini   │
│  • POST /plan: Google ADK Study-Planner Agent (agent/)      │
│  • Telemetry: JSONL structured run metrics (logs/)          │
└─────────────────────────────────────────────────────────────┘
```

### Two Services in Production

| Service | Technology | Port | Purpose & Security Boundary |
|---------|------------|------|-----------------------------|
| **Node.js Express** | TypeScript, Express, Drizzle, Clerk | `3000` | User auth boundary, Postgres async queue & worker, Gemini notes, adaptive learning layer, recommendations cache |
| **Python Flask** | Flask, Manim, Docker, Google ADK | `5000` | Internal execution service; Manim code generation, AST validation, Docker sandbox execution, study-planner agent |

---

## 3. Directory Structure (annotated)

```
EduVision--DevForge/
├── .env                        # Root env vars (DB URL, API keys, port)
├── sample.env                  # Template for .env
├── package.json                # Node.js deps & scripts
├── tsconfig.json               # TypeScript config (paths: @/ → client/src, @shared → shared/)
├── vite.config.ts              # Vite config (React plugin, path aliases, dev server)
├── drizzle.config.ts           # Drizzle ORM config (Neon Postgres, schema from shared/)
├── postcss.config.js           # PostCSS (Tailwind)
├── tailwind.config.ts          # Tailwind theme
├── components.json             # shadcn/ui config
├── run_project.ps1             # PowerShell script to start both servers
│
├── server/                     # ── Node.js Express backend ──
│   ├── index.ts                # Entry point: Express app, middleware, Vite dev setup, listens on PORT
│   ├── routes.ts               # All API route handlers (generate, quiz, videos, notes, profile)
│   ├── storage.ts              # In-memory data store (implements IStorage interface)
│   ├── db.ts                   # Drizzle + Neon Postgres connection (not used at runtime; schema-ready)
│   ├── vite.ts                 # Vite dev middleware integration (HMR, serves index.html)
│   └── static.ts               # Production static file serving
│
├── shared/                     # ── Shared types & DB schema ──
│   └── schema.ts               # Drizzle table definitions + Zod insert schemas + TS types
│                                 # Tables: users, generated_videos, notes, quiz_attempts
│
├── client/                     # ── React frontend ──
│   ├── index.html              # HTML entry point (loads /src/main.tsx)
│   └── src/
│       ├── main.tsx            # ReactDOM.createRoot, renders <App />
│       ├── App.tsx             # Router (wouter), providers (QueryClient, Tooltip, Sidebar, AppContext)
│       ├── index.css           # Global CSS (Tailwind directives + custom properties)
│       │
│       ├── context/
│       │   └── AppContext.tsx   # Global state: prompt, videos, notes, quiz, profile, generateVideo()
│       │
│       ├── pages/
│       │   ├── Home.tsx         # Main page: prompt input → calls Flask /generate → shows video + notes
│       │   ├── Quiz.tsx         # Quiz page: fetches MCQs from /api/quiz/generate, submit answers
│       │   ├── Browse.tsx       # YouTube search via YouTube Data API v3
│       │   ├── Profile.tsx      # Stats dashboard: videos, notes downloaded, quiz pass rate, streak
│       │   └── not-found.tsx    # 404 page
│       │
│       ├── components/
│       │   ├── AppSidebar.tsx       # Navigation sidebar (Home, Quiz, Browse, Profile)
│       │   ├── VideoPlaceholder.tsx  # Video player / loading spinner / empty state
│       │   ├── NotesPanel.tsx       # Collapsible markdown notes viewer + download button
│       │   ├── QuizCard.tsx         # Single quiz question display
│       │   ├── QuizHistoryItem.tsx  # Quiz attempt row for Profile page
│       │   ├── StatsCard.tsx        # Stat card component (icon, value, trend)
│       │   ├── BrowseItem.tsx       # YouTube video card
│       │   ├── ThemeToggle.tsx      # Dark/light mode toggle
│       │   └── ui/                  # shadcn/ui primitives (button, card, input, dialog, etc.)
│       │
│       ├── hooks/
│       │   ├── use-toast.ts     # Toast notification hook
│       │   └── use-mobile.tsx   # Mobile breakpoint detection
│       │
│       └── lib/
│           ├── queryClient.ts   # TanStack React Query client + apiRequest helper
│           └── utils.ts         # cn() utility (clsx + tailwind-merge)
│
├── hack27/                     # ── Python Flask AI/Animation microservice ──
│   ├── .env                    # GOOGLE_API_KEY for Gemini (used by LangChain)
│   ├── main.py                 # Flask app: POST /generate → pipeline execution → unique video URL
│   ├── requirements.txt        # Python dependencies
│   ├── pyproject.toml          # UV/pip project metadata
│   ├── test.py                 # Test script
│   ├── test_manim.py           # Manim test
│   │
│   ├── sandbox/                # Docker container isolation
│   │   └── Dockerfile          # Python 3.12-slim + ffmpeg + cairo/pango + manim (non-root, network: none)
│   │
│   ├── planner/
│   │   ├── plannerscript.py    # generate_dsl() & repair_dsl(): rate-limited Gemini calls + exponential backoff
│   │   ├── validator.py        # AST validation layer (syntax, imports whitelist, API blacklist, Scene hierarchy)
│   │   ├── manim_run.py        # Isolated rendering (Docker / local) with per-job media dir & timeout
│   │   ├── pipeline.py         # Full generate -> validate -> render -> repair feedback loop
│   │   └── telemetry.py        # JSONL job logger for attempts, latency, errors, token counts
│   │
│   ├── eval/                   # Evaluation harness & benchmark suite
│   │   ├── prompts.json        # 50 curated educational prompts (10 hard)
│   │   ├── prompts_small.json  # 20 curated smoke prompts (14 normal + 6 hard)
│   │   ├── llm_cache.py        # Disk-based LLM response cache
│   │   ├── run_eval.py         # Resumable evaluation runner (baseline vs full)
│   │   ├── results.jsonl       # Persistent evaluation ledger
│   │   ├── results.csv         # Structured evaluation CSV metrics
│   │   └── summary.md          # Markdown evaluation performance report
│   │
│   ├── logs/                   # Telemetry output (jobs.jsonl)
│   ├── tests/                  # Unit test suite (validator, pipeline, telemetry, eval)
│   └── static/videos/          # Output directory for rendered MP4s (<job_id>.mp4)
│
├── public/                     # Vite public assets (served at /)
│   └── assets/vid.mp4          # Fallback/preview video
│
└── attached_assets/            # Design assets (system diagram image, etc.)
```

---

## 4. Database Schema (shared/schema.ts)

The schema is defined with **Drizzle ORM** targeting **Neon Postgres**, but at runtime the app uses **in-memory storage** (`InMemoryStorage` class in `server/storage.ts`). The schema exists so the app can be upgraded to persistent DB storage.

### Tables

```sql
-- users
id          VARCHAR PK (gen_random_uuid)
username    TEXT NOT NULL UNIQUE
password    TEXT NOT NULL
streak      INTEGER DEFAULT 0
created_at  TIMESTAMP DEFAULT now()

-- generated_videos
id          VARCHAR PK (gen_random_uuid)
user_id     VARCHAR FK → users.id (nullable)
prompt      TEXT NOT NULL
video_url   TEXT NOT NULL
created_at  TIMESTAMP DEFAULT now()

-- notes
id          VARCHAR PK (gen_random_uuid)
video_id    VARCHAR FK → generated_videos.id NOT NULL
notes_text  TEXT NOT NULL
downloaded  BOOLEAN DEFAULT false
created_at  TIMESTAMP DEFAULT now()

-- quiz_attempts
id              VARCHAR PK (gen_random_uuid)
user_id         VARCHAR FK → users.id (nullable)
prompt          TEXT NOT NULL
score           INTEGER NOT NULL
total_questions INTEGER NOT NULL
created_at      TIMESTAMP DEFAULT now()
```

### TypeScript Types Exported

- `User`, `InsertUser`
- `GeneratedVideo`, `InsertGeneratedVideo`
- `Notes`, `InsertNotes`
- `QuizAttempt`, `InsertQuizAttempt`

---

## 5. API Contracts

### 5.1 Node.js Express API (port 3000)

#### `POST /api/generate`
- **Body:** `{ prompt: string, userId?: string }`
- **Action:** Saves video record (hardcoded `/assets/vid.mp4` URL), calls Gemini to generate notes markdown
- **Response:** `{ video: GeneratedVideo, notes: Notes }`

#### `POST /api/quiz/generate`
- **Body:** `{ prompt: string, notesText?: string }`
- **Action:** Calls Gemini to generate 5 MCQ questions as JSON
- **Response:** `{ questions: [{ id, question, options: [{id, text}], correctAnswer }] }` (5 questions, 4 options each)

#### `POST /api/quiz/submit`
- **Body:** `{ prompt: string, score: number, totalQuestions: number, userId?: string }`
- **Response:** `{ attempt: QuizAttempt, passed: boolean, message: string }`
- **Pass threshold:** score ≥ ceil(totalQuestions × 0.6)

#### `GET /api/videos`
- **Query:** `?userId=...` (optional)
- **Response:** `GeneratedVideo[]`

#### `GET /api/videos/:id`
- **Response:** `{ video: GeneratedVideo, notes: Notes }`

#### `POST /api/notes/:id/download`
- **Action:** Marks notes as downloaded
- **Response:** `Notes`

#### `GET /api/profile`
- **Query:** `?userId=...` (optional)
- **Response:**
```json
{
  "videosGenerated": number,
  "notesDownloaded": number,
  "quizAttempts": number,
  "passedQuizzes": number,
  "passRate": number,
  "streak": number,
  "recentVideos": GeneratedVideo[],
  "recentQuizzes": QuizAttempt[]
}
```

#### `GET /api/quiz/history`
- **Query:** `?userId=...` (optional)
- **Response:** `QuizAttempt[]`

---

### 5.2 Python Flask API (port 5000)

#### `POST /generate`
- **Body:** `{ "prompt": "visualize the doppler effect" }`
- **Action:**
  1. Generates unique `job_id = uuid4().hex`
  2. Runs pipeline (`planner/pipeline.py`):
     - Attempt 1: calls `generate_dsl(prompt)` (Gemini `gemini-2.5-flash` with rate limiting & exponential backoff)
     - AST Validator (`planner/validator.py`): verifies syntax, imports whitelist (`manim`, `numpy`, `math`, `random`), blocks dangerous builtins/system calls, validates single `Scene` subclass with `construct(self)`
     - If validation fails: passes violations to `repair_dsl(prompt, previous_code, error_text)` (up to 3 attempts)
     - Sandbox Render (`planner/manim_run.py`): runs inside isolated Docker container (`eduvision-manim`, network none, memory 1g, cpus 1, pids 256) or isolated local per-job temp directory; strictly isolated with no shared media directory collisions
     - If render fails: feeds `stderr_tail` to `repair_dsl()` for iterative repair
  3. Saves video to `static/videos/<job_id>.mp4`
  4. Appends telemetry record to `hack27/logs/jobs.jsonl`
  5. Returns `{ "status": "success", "video_url": "/static/videos/<job_id>.mp4", "job_id": "<job_id>", "attempts": N, "duration_s": 4.5 }`
- **Error Response:** `{ "error": "...", "job_id": "...", "error_type": "...", "attempts": N, "stderr_tail": "..." }` with status 500 (or status 429 `{ "error": "rate_limited", ... }`)

---

## 6. Key Data Flows

### Flow 1: Async Job Pipeline (Animation Generation & Notes)

```
User types prompt in Home.tsx
        │
        ▼
Home.tsx handleGenerate()
        │
        ├── POST /api/jobs  { prompt }                       ──► Express server
        │   (Authenticated via Clerk session; owner only)             │
        │   ◄── 202 Accepted { jobId: "<uuid>" }                      │
        │                                                    Enqueues into `render_jobs` table
        ▼                                                             │
Frontend polls GET /api/jobs/:id every 2s                             ▼
(Shows: queued → rendering (attempt N) → ready)      Worker loop (`server/worker.ts`):
                                                     1. Atomic claim via FOR UPDATE SKIP LOCKED
                                                     2. Normalizes topic (`server/learning/normalize.ts`)
                                                     3. Generates Personalization Plan:
                                                        - If PLANNER=rules (default): rules-based
                                                        - If PLANNER=agent: calls Flask POST /plan
                                                        - Detects remedial / advanced / reuse_existing
                                                     4. If reuse_existing within 24h:
                                                        - Reuses existing videoUrl; skips Manim render
                                                     5. Otherwise calls Flask POST /generate:
                                                        - Sends { prompt, focus_concepts, difficulty }
                                                        - Headers: X-Internal-Token
                                                        ▼
                                                     Flask Pipeline (`hack27/planner/pipeline.py`):
                                                        - Gemini 2.5 Flash → Manim code
                                                        - AST Validator (`validator.py`)
                                                        - Sandboxed Docker run (`sandbox/`)
                                                        - Repair loop (up to 3 attempts on stderr)
                                                        - Returns { status: "success", video_url }
                                                        ▼
                                                     6. Generates markdown notes via Gemini
                                                        (with learner context & focus concepts)
                                                     7. Updates job status to "succeeded"
        │
        ◄── GET /api/jobs/:id returns { status: "succeeded", video, notes, plan }
        ▼
Home.tsx renders video, study plan rationale, focus concepts, and markdown notes
```

### Flow 2: Adaptive Quiz & Per-Concept Mastery

```
User navigates to /quiz
        │
Quiz.tsx useEffect
        ├── POST /api/quiz/generate  { prompt, notesText }
        │       → Server normalizes topic & fetches known concept labels
        │       → Gemini generates 5 MCQs tagged with concepts (at least 60% on weak concepts)
        │       → Server STRIPS correct answers before returning to client (prevents client tampering)
        │       → Quizzes record saved in `quizzes` table
        │       ◄── { quizId, questions: [{ id, question, options, concept }] }
        │
User answers questions → handleSubmit()
        ├── POST /api/quiz/submit  { quizId, answers: { [qId]: chosenAnswer } }
        │       → Server grades against server-stored questions
        │       → Atomic compare-and-swap guarantees single-submission (second submit returns 409)
        │       → Persists individual concept outcomes in `question_results` table
        │       → Recency-weighted decay (14-day half-life) & Laplace smoothing updates mastery
        │       ◄── { score, totalQuestions, passed, feedback: [...] }
        │
Profile page displays per-topic mastery bars with status (weak / strong / unknown) & evidence count
```

### Flow 3: Server-Side YouTube Recommendations & Browse

```
User visits Browse page or views topic recommendations
        │
        ├── GET /api/browse?q=... or GET /api/recommendations?topicId=...
        │       → Express verifies session
        │       → Server checks `recommendation_cache` table (keyed by query, 24h TTL)
        │       → Cache miss: calls YouTube Data API v3 server-side with `YOUTUBE_API_KEY`
        │         (VITE_YOUTUBE_API_KEY is completely eradicated from client bundle)
        │       → Caches response in DB
        │       → Rate-limited and graceful fallback on quota exhaustion (never 500)
        │       ◄── { items: [...], source: "cache" | "youtube" | "fallback" }
        │
Grid of educational video cards displayed safely
```

---

## 7. Environment Variables

### Root `.env` (for Node.js & Flask microservices)

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | Neon Postgres connection string | `postgresql://...@...neon.tech/neondb?sslmode=require` |
| `SESSION_SECRET` | Express session secret | `your-secret-key-here` |
| `NODE_ENV` | Environment mode (`development` \| `production`) | `development` |
| `PORT` | Express server port | `3000` |
| `INTERNAL_AUTH_TOKEN` | Shared secret header between Express and Flask (`X-Internal-Token`) | `eduvision-internal-secret-token-key` |
| `FLASK_URL` | Python Flask microservice URL | `http://127.0.0.1:5000` |
| `PLANNER` | Personalization planner mode (`rules` \| `agent`, default: `rules`) | `rules` |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key (server-side only) | `AIza...` |
| `GEMINI_API_KEY` | Google Gemini API key (notes, quiz, Manim, ADK agent) | `AIza...` |
| `CLERK_PUBLISHABLE_KEY` | Clerk authentication public key | `pk_test_...` |
| `CLERK_SECRET_KEY` | Clerk authentication secret key | `sk_test_...` |

### `hack27/.env` (for Flask server)

| Variable | Purpose | Example |
|----------|---------|---------|
| `GOOGLE_API_KEY` | Google Gemini API key (used by LangChain) | `AIza...` |

---

## 8. Technology Stack Summary

### Frontend
- **React 18** with TypeScript
- **Vite 5** (dev server + build)
- **Tailwind CSS 3** + **shadcn/ui** (Radix primitives)
- **wouter** for client-side routing
- **TanStack React Query** for server state
- **Framer Motion** for animations
- **Lucide React** for icons
- **Recharts** for charts (available, not heavily used yet)

### Backend (Node.js)
- **Express 4** with TypeScript
- **Drizzle ORM** + **Neon Serverless** (PostgreSQL, schema-ready but in-memory at runtime)
- **Google Generative AI SDK** (`@google/generative-ai`) — model: `gemini-2.5-flash`
- **Zod** for request validation
- **dotenv** for env vars

### AI/Animation Microservice (Python)
- **Flask 3** with CORS
- **LangChain** + `langchain-google-genai` — model: `gemini-2.5-flash`
- **Manim** (Community Edition ≥ 0.18.1) — mathematical animation engine
- **UV** package manager (optional) or pip
- Python ≥ 3.12

---

## 9. Gemini LLM Prompts Used

### 9.1 Notes Generation (`server/routes.ts` → `generateNotesWithGemini`)

**System:** "You are EduVision, an expert educational notes generator for a visual learning platform. Produce concise (300–500 words), accurate Markdown with sections: Title (H1), Key Concepts, Intuition, Equations (inline), Real-World Applications, Suggested Animation Storyboard (numbered steps), Summary. No code fences."

**User:** "Topic: {prompt}\nGenerate the notes following the structure above."

### 9.2 Quiz Generation (`server/routes.ts` → `/api/quiz/generate`)

**System:** Generates 5 MCQs as strict JSON. Structure: `{"questions":[{"id":"q1","question":"...","options":[{"id":"a","text":"..."},...],"correctAnswer":"a"},...]}`

**User:** "Topic: {prompt}\nNotes (optional): {notesText}\nCreate 5 MCQs as per the structure."

### 9.3 Manim Code Generation (`hack27/planner/plannerscript.py` → `generate_dsl`)

**System:** Detailed prompt instructing Gemini to output ONLY valid Manim Python code. Key constraints:
- No JSON/markdown/backticks
- No `MathTex`, `Tex`, `DecimalNumber` (avoid LaTeX dependency)
- Use only `Text()` for labels
- No `get_part_by_text()`, `get_unit_normal()`, `get_unit_vector()`
- Call `update_text()` directly, never wrap in `self.play()`
- Fixed frame: `config.frame_width = 14`, `config.frame_height = 7.5`

---

## 10. Storage Layer Details

The `IStorage` interface (`server/storage.ts`) defines:

```typescript
interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserStreak(userId: string, streak: number): Promise<User | undefined>;

  // Videos
  createGeneratedVideo(video: InsertGeneratedVideo): Promise<GeneratedVideo>;
  getGeneratedVideos(userId?: string): Promise<GeneratedVideo[]>;
  getGeneratedVideoById(id: string): Promise<GeneratedVideo | undefined>;

  // Notes
  createNotes(note: InsertNotes): Promise<Notes>;
  getNotesByVideoId(videoId: string): Promise<Notes | undefined>;
  markNotesDownloaded(notesId: string): Promise<Notes | undefined>;
  getNotesDownloadCount(userId?: string): Promise<number>;

  // Quiz
  createQuizAttempt(attempt: InsertQuizAttempt): Promise<QuizAttempt>;
  getQuizAttempts(userId?: string): Promise<QuizAttempt[]>;
}
```

**Current implementation:** `InMemoryStorage` — arrays in memory, IDs generated via `Date.now().toString(36) + random`. Data is lost on server restart.

**Upgrade path:** Replace `InMemoryStorage` with a `DatabaseStorage` class using Drizzle ORM queries against the Neon Postgres database (connection already configured in `server/db.ts`).

---

## 11. Frontend Routing & State Management

### Routes (wouter)

| Path | Component | Purpose |
|------|-----------|---------|
| `/` | `Home` | Prompt input, video player, notes panel |
| `/quiz` | `Quiz` | AI-generated MCQ quiz |
| `/browse` | `Browse` | YouTube video search |
| `/profile` | `Profile` | User stats dashboard |
| `*` | `NotFound` | 404 page |

### Global State (AppContext)

```typescript
interface AppContextType {
  currentPrompt: string;
  setCurrentPrompt: (prompt: string) => void;
  generatedVideos: GeneratedVideo[];
  quizAttempts: QuizAttempt[];
  streak: number;
  isGenerating: boolean;
  setIsGenerating: (value: boolean) => void;
  currentVideo: GeneratedVideo | null;
  currentNotes: NotesRecord | null;
  generateVideo: (prompt: string, videoUrl: string) => Promise<void>;
  submitQuiz: (prompt: string, score: number, total: number) => Promise<{ passed: boolean; message: string }>;
  notesDownloaded: number;
  loadProfile: () => Promise<void>;
  profileData: ProfileData | null;
  markNotesDownloaded: (notesId: string) => Promise<void>;
}
```

The context loads profile data on mount via `GET /api/profile`.

---

## 12. How to Run

### Prerequisites
- Node.js ≥ 16
- Python ≥ 3.12
- Manim Community Edition installed (requires FFmpeg, LaTeX optional)
- Google Gemini API key
- YouTube Data API v3 key (for Browse page)

### Step-by-step

```bash
# 1. Clone & install Node dependencies
cd EduVision--DevForge
npm install

# 2. Configure root .env
cp sample.env .env
# Edit .env: set GEMINI_API_KEY, VITE_YOUTUBE_API_KEY, PORT=3000

# 3. Set up Python environment
cd hack27
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
# Or use UV: uv sync && uv run main.py

# 4. Configure hack27/.env
echo "GOOGLE_API_KEY=your-gemini-key" > .env

# 5. Start Flask server (Terminal 1)
cd hack27
python main.py                # Runs on http://127.0.0.1:5000

# 6. Start Node.js server (Terminal 2)
cd EduVision--DevForge
npm run dev                   # Runs on http://localhost:3000

# OR use the PowerShell script:
.\run_project.ps1             # Starts both servers
```

### npm Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `cross-env NODE_ENV=development tsx server/index.ts` | Start dev server |
| `build` | `tsx script/build.ts` | Production build |
| `start` | `cross-env NODE_ENV=production node dist/index.cjs` | Run production build |
| `check` | `tsc` | TypeScript type checking |
| `db:push` | `drizzle-kit push` | Push schema to database |

---

## 13. Key Design Decisions & Security Architecture

1. **Service Boundary & Security Isolation.** The browser NEVER interacts directly with the Python Flask service. All requests go through Express with verified Clerk session tokens (`/api/jobs`, `/api/videos/:id`, etc.). Node communicates with Flask over a private internal network authenticated by a shared secret header `X-Internal-Token`.

2. **Database Storage & State Persistence.** Production storage uses `DatabaseStorage` with Neon Postgres over Drizzle ORM. All records (`users`, `render_jobs`, `generated_videos`, `notes`, `quizzes`, `question_results`, `topics`, `recommendation_cache`) persist permanently across restarts. `STORAGE=memory` remains available strictly for ephemeral unit tests.

3. **Per-Job Sandboxing & File Isolation.** Video generation renders to isolated `<job_id>.mp4` paths in dedicated per-job temporary directories. No shared `final.mp4` or file collisions. Videos are served exclusively through authenticated Express routes verifying resource ownership.

4. **Multi-Layer Untrusted Code Execution Defense:**
   - **AST Validator Filter**: Pre-execution static analysis verifies syntax, enforces an import whitelist (`manim`, `numpy`, `math`, `random`), bans dangerous builtins (`exec`, `eval`, `open`, `__import__`) and restricted OS/system modules, and requires a single `Scene` subclass with `construct(self)`.
   - **Docker Sandbox Boundary**: Executes Manim inside an unprivileged Docker container with `network: none`, `memory: 2g`, `cpus: 1.0`, `pids-limit: 64`, read-only root filesystem, and strict timeout enforcement (`docker rm -f`).
   - **Feedback-Driven Repair Loop**: If AST validation fails or Manim rendering fails, stderr is sanitized and fed back into Gemini for iterative code repair (up to 3 attempts).

5. **Asynchronous Postgres Queue & Stuck Job Recovery.** `POST /api/jobs` returns immediately (HTTP 202) with a job ID. A background worker polls using `FOR UPDATE SKIP LOCKED` respecting concurrency limits (`RENDER_CONCURRENCY`). On startup, any jobs stuck in `running` state are automatically recovered.

6. **Anti-Tamper Server-Side Quiz Grading.** Correct quiz answers are NEVER sent to the client before submission. Submissions send only `{ quizId, answers }`. The server grades against stored questions and guarantees single-submission idempotency via atomic compare-and-swap SQL updates. Duplicate submissions return HTTP 409 Conflict.

7. **Adaptive Concept Mastery Model.** Mastery uses Bayesian Laplace smoothing: $\text{mastery} = (\text{weightedCorrect} + 1) / (\text{weightedAttempts} + 2)$ with recency-weighted exponential decay (14-day half-life). An evidence threshold of $\ge 3$ attempts prevents premature labeling of single unlucky guesses.

8. **Deterministic Personalization Planner vs Google ADK Agent.**
   - Defaults to deterministic rule-based planning (`PLANNER=rules`) for zero-cost, sub-millisecond execution ($0.004\text{ ms}$).
   - Google ADK Study-Planner Agent (`PLANNER=agent`) is available behind a feature flag. The agent is **strictly non-autonomous**: it proposes candidate plans via read-only tools (`get_learner_profile`, `find_existing_assets`); deterministic application code validates the proposal against strict Pydantic schemas and executes it.

9. **Secure Server-Side Recommendations.** YouTube searches run server-side with `YOUTUBE_API_KEY`, cached in Neon DB for 24 hours. The API key is completely eradicated from client bundles.

---

## 14. File-by-File Reference

### server/index.ts
Entry point. Creates Express app, registers middleware, initializes Clerk authentication, registers routes, bootstraps the background worker (`startWorker`), sets up Vite dev server or production static serving, listens on `PORT`.

### server/routes.ts
All user-facing and internal API endpoints (`/api/jobs`, `/api/videos`, `/api/quiz/*`, `/api/browse`, `/api/recommendations`, `/api/profile`, and internal `/api/internal/*` tools). Enforces owner isolation and rate limits.

### server/worker.ts
Postgres-backed background job worker. Polls `render_jobs` with `FOR UPDATE SKIP LOCKED`, queries personalization planner, coordinates with Flask `/generate`, handles video reuse within 24h, triggers Gemini study notes generation, and persists completed state.

### server/auth.ts
Clerk authentication integration. Verifies session tokens, injects `req.user`, and enforces multi-user data isolation.

### server/learning/mastery.ts
Mathematical mastery engine. Implements recency-weighted exponential decay (14-day half-life) and Laplace smoothing. Exports `getLearnerProfile(userId, topicId)`.

### server/learning/normalize.ts
Canonical topic normalization. Maps varied user prompts to normalized canonical slugs per user, reusing existing concept labels.

### server/learning/planner.ts
Personalization planner. Implements deterministic `planStudy` baseline rules (remedial, advanced, reuse_existing, generate_new) and orchestrates Google ADK agent query with automatic fallback.

### server/learning/recommendations.ts
Server-side YouTube search with 24-hour database caching in `recommendation_cache`. Gracefully handles quota limits.

### server/storage.ts
`IStorage` interface + `DatabaseStorage` production implementation (Neon Postgres) and `InMemoryStorage` test implementation.

### shared/schema.ts
Drizzle table definitions (`users`, `render_jobs`, `generated_videos`, `notes`, `quizzes`, `question_results`, `topics`, `recommendation_cache`), Zod schemas, and TypeScript types.

### client/src/context/AppContext.tsx
React Context global state. Manages active jobs, polling loop, current video, notes, quiz history, adaptive study plan, and profile data.

### client/src/pages/Home.tsx
Primary landing and generation page. Prompt input, live study plan rationale banner, status polling display, video playback, notes panel, and action buttons.

### client/src/pages/Profile.tsx
Profile dashboard. Stats cards, Learning Streak, Recent Videos, Quiz History, and the **Adaptive Concept Mastery** section with per-topic progress bars and a "Practice weak areas" trigger.

### client/src/pages/Quiz.tsx
Interactive MCQ quiz. Displays server-generated questions without exposing answers, submits user choices, and renders per-concept feedback.

### client/src/pages/Browse.tsx
Educational video discovery. Searches YouTube safely via server-side `/api/browse` with 24h DB caching.

### hack27/main.py
Flask microservice. Routes: `GET /health`, `POST /generate` (Manim animation pipeline), `POST /plan` (Google ADK Study-Planner Agent). Protected by `X-Internal-Token`.

### hack27/planner/pipeline.py
Animation pipeline orchestrator. Manages Gemini code generation, AST validator checks, Docker sandbox execution, iterative repair loop (up to 3 attempts), and structured `RenderResult`.

### hack27/planner/validator.py
Python AST static analysis security filter. Enforces whitelist, checks for single Scene subclass, and blocks forbidden APIs and builtins.

### hack27/planner/manim_run.py
Sandbox runner. Runs Manim CLI inside Docker container or isolated local per-job directory with strict timeouts.

### hack27/agent/planner_agent.py
Google ADK Study-Planner Agent. Implements tool-using planning with schema validation, repair turns, daily quota enforcement, and telemetry logging.

### hack27/eval/planner_eval.py
Evaluation benchmark harness. Compares deterministic rules baseline vs ADK planner agent vs negative control across hand-written synthetic learner scenarios.

---

## 15. Dependency Summary

### Node.js Key Dependencies
- `express` (4.x) — HTTP server
- `@clerk/clerk-sdk-node` — User authentication and session verification
- `@google/generative-ai` (0.24+) — Gemini AI SDK
- `drizzle-orm` + `@neondatabase/serverless` — ORM + Neon Postgres driver
- `zod` + `drizzle-zod` — Schema validation
- `react` (18.x) + `react-dom` — UI
- `wouter` (3.x) — Client routing
- `@tanstack/react-query` (5.x) — Server state
- `tailwindcss` (3.x) + `@radix-ui/*` — Styling + accessible UI components
- `lucide-react` — Icons
- `vite` (5.x) — Frontend build tool

### Python Key Dependencies
- `flask` (3.x) — HTTP microservice
- `google-adk` (2.14+) — Google Agent Development Kit
- `google-genai` (1.x+) — Google Gemini SDK
- `pydantic` (2.x) — Data modeling and schema validation
- `docker` (7.x) — Docker container SDK for sandbox isolation
- `manim` (≥ 0.18.1) — Mathematical animation rendering engine
- `numpy` — Numerical computations
- `python-dotenv` — Environment variables
