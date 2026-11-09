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
└──────────┬──────────────────────────────┬───────────────────┘
           │  Port 3000 (dev)             │
           │  /api/* routes               │ POST http://127.0.0.1:5000/generate
           ▼                              ▼
┌──────────────────────┐       ┌──────────────────────────────┐
│  Node.js Express     │       │  Python Flask Microservice   │
│  (server/)           │       │  (hack27/)                   │
│                      │       │                              │
│  • /api/generate     │       │  POST /generate              │
│    → calls Gemini    │       │    → Gemini → Manim code     │
│      for notes       │       │    → Manim render → MP4      │
│  • /api/quiz/generate│       │    → returns video_url       │
│    → Gemini for MCQs │       │                              │
│  • /api/quiz/submit  │       │  Serves static/videos/       │
│  • /api/videos       │       │  on Flask dev server         │
│  • /api/profile      │       │                              │
│  • /api/notes/:id/   │       │  Port 5000                   │
│    download          │       └──────────────────────────────┘
│                      │
│  In-memory storage   │
│  (no DB at runtime,  │
│   schema exists for  │
│   Drizzle/Neon PG)   │
└──────────────────────┘
```

### Two Servers Run Simultaneously

| Server | Technology | Port | Purpose |
|--------|-----------|------|---------|
| **Node.js Express** | TypeScript, Vite (dev middleware) | `3000` (configurable via `PORT` env) | Serves React SPA, exposes REST API for notes/quiz/profile, calls Gemini for notes & quiz |
| **Python Flask** | Flask, LangChain, Manim | `5000` | Receives prompt, generates Manim code via Gemini, renders video, serves the MP4 |

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

### Flow 1: Generate Animation (Primary Feature)

```
User types prompt in Home.tsx
        │
        ▼
Home.tsx handleGenerate()
        │
        ├── POST http://127.0.0.1:5000/generate  { prompt }     ──► Flask server
        │                                                              │
        │                                                    generate_dsl(prompt)
        │                                                    → Gemini LLM → Manim code
        │                                                    run_manim_script()
        │                                                    → manim CLI → MP4
        │                                                              │
        │   ◄── { status: "success", video_url: "/static/videos/final.mp4" }
        │
        ▼
AppContext.generateVideo(prompt, backendUrl)
        │
        ├── POST /api/generate  { prompt }                   ──► Express server
        │                                                              │
        │                                                    generateNotesWithGemini(prompt)
        │                                                    → Gemini → Markdown notes
        │                                                    storage.createGeneratedVideo()
        │                                                    storage.createNotes()
        │                                                              │
        │   ◄── { video, notes }
        │
        ▼
State updated: currentVideo, currentNotes
VideoPlaceholder renders <video> with Flask URL
NotesPanel renders markdown notes
```

### Flow 2: Quiz

```
User navigates to /quiz
        │
Quiz.tsx useEffect
        ├── POST /api/quiz/generate  { prompt, notesText }
        │       → Gemini → 5 MCQ questions (JSON)
        │       ◄── { questions: [...] }
        │
User answers questions → handleSubmit()
        ├── POST /api/quiz/submit  { prompt, score, totalQuestions }
        │       → storage.createQuizAttempt()
        │       ◄── { attempt, passed, message }
        │
Results screen shown
```

### Flow 3: Browse YouTube

```
User types in Browse.tsx search
        │
        ├── GET https://www.googleapis.com/youtube/v3/search?q=...&key=VITE_YOUTUBE_API_KEY
        │       ◄── YouTube video results (thumbnails, titles, channels)
        │
Grid of video cards rendered with "Watch on YouTube →" links
```

---

## 7. Environment Variables

### Root `.env` (for Node.js server)

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | Neon Postgres connection string | `postgresql://...@...neon.tech/neondb?sslmode=require` |
| `SESSION_SECRET` | Express session secret | `your-secret-key-here` |
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | Express server port | `3000` |
| `VITE_YOUTUBE_API_KEY` | YouTube Data API v3 key | `AIza...` |
| `GEMINI_API_KEY` | Google Gemini API key (for notes & quiz) | `AIza...` |
| `QUIET` | Set to `"false"` to enable console output | `false` |

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

## 13. Key Design Decisions & Gotchas

1. **Two separate servers are required.** The React frontend calls Flask directly at `http://127.0.0.1:5000/generate` for video generation (hardcoded in `Home.tsx`). The Node.js server handles notes, quiz, and profile APIs.

2. **In-memory storage.** All data is stored in memory and lost on restart. The Drizzle schema and Neon Postgres connection exist but are not wired into the storage layer yet.

3. **Video URL handling.** The Flask server serves generated videos from `hack27/static/videos/final.mp4`. The URL returned is prepended with `http://127.0.0.1:5000` by the frontend. The Node.js `/api/generate` endpoint also saves a video record but uses a hardcoded `/assets/vid.mp4` path.

4. **Manim constraints.** The LLM prompt in `plannerscript.py` has extensive rules to prevent common Manim errors (no LaTeX, no `MathTex`, no `get_part_by_text`, etc.). If Manim rendering fails, the Flask endpoint returns a 500 error.

5. **Console silencing.** `server/index.ts` silences all console output by default. Set `QUIET=false` env var to re-enable logging.

6. **CORS.** Flask has CORS enabled for all origins (`resources={r"/*": {"origins": "*"}}`). The Node.js server doesn't explicitly configure CORS since the frontend is served from the same origin.

7. **No authentication.** The app has no login/signup flow. The `users` table and auth-related schema exist but user management is not implemented. `userId` is always `null` in API calls.

8. **Cache busting.** `AppContext.generateVideo()` appends `?_t=<timestamp>` to video URLs to prevent browser caching of the Flask-served video.

---

## 14. File-by-File Reference

### server/index.ts
Entry point. Creates Express app, registers middleware (JSON parsing, request logging), calls `registerRoutes()`, sets up Vite dev server or static serving based on `NODE_ENV`, listens on `PORT`.

### server/routes.ts
All API endpoints. Contains `generateNotesWithGemini()` (calls Gemini for notes) and `generateDummyNotes()` (fallback). Registers routes for video generation, quiz generation/submission, video listing, notes download, profile stats, and quiz history.

### server/storage.ts
`IStorage` interface + `InMemoryStorage` implementation using in-memory arrays. Exported as singleton `storage`.

### server/db.ts
Drizzle ORM connection to Neon Postgres. Exports `db` instance. Not actively used by the storage layer.

### server/vite.ts
Sets up Vite as Express middleware in development mode. Handles HMR via WebSocket on `/vite-hmr`. Serves `client/index.html` with cache-busting.

### server/static.ts
Production static file serving from `dist/public/` directory with SPA fallback.

### shared/schema.ts
Drizzle table definitions (`users`, `generated_videos`, `notes`, `quiz_attempts`), Zod insert schemas, and TypeScript type exports.

### client/src/App.tsx
Root component. Wraps everything in `QueryClientProvider`, `TooltipProvider`, `AppProvider`, `SidebarProvider`. Contains the `Router` with all routes.

### client/src/context/AppContext.tsx
Global state management via React Context. Manages prompt, videos, notes, quiz attempts, streak, profile data. Key function: `generateVideo()` which calls `/api/generate` for notes while accepting a pre-fetched video URL.

### client/src/pages/Home.tsx
Main page. Prompt input → calls Flask `/generate` → displays video via `VideoPlaceholder` → shows notes via `NotesPanel`. Quick-try topic buttons. Action buttons (Watch Again, Take Quiz, Exit) appear after generation.

### client/src/pages/Quiz.tsx
Fetches 5 MCQs from `/api/quiz/generate` on mount. Shows questions one at a time with navigation. Submits answers to `/api/quiz/submit`. Shows pass/fail result screen.

### client/src/pages/Browse.tsx
YouTube search with debounced API calls. Category filter buttons. Displays video grid with thumbnails and "Watch on YouTube" links.

### client/src/pages/Profile.tsx
Stats cards (videos generated, notes downloaded, quiz pass rate, streak). Recent videos list. Quiz history. Weekly streak calendar.

### hack27/main.py
Flask app. Single route `POST /generate`. Calls `generate_dsl()` for Manim code, extracts scene name, calls `run_manim_script()`, returns video URL.

### hack27/planner/plannerscript.py
Uses LangChain `ChatGoogleGenerativeAI` with `gemini-2.5-flash`. `generate_dsl(prompt)` sends a detailed system prompt with Manim code rules + the user topic. Returns raw Manim Python code.

### hack27/planner/manim_run.py
`run_manim_script(code, scene_name, output_path)`: writes temp `.py`, runs `manim -ql --disable_caching`, finds rendered MP4 in `media/videos/`, copies to `static/videos/final.mp4`, cleans up media folder.

---

## 15. Dependency Summary

### Node.js Key Dependencies
- `express` (4.x) — HTTP server
- `@google/generative-ai` (0.24+) — Gemini AI SDK
- `drizzle-orm` + `@neondatabase/serverless` — ORM + DB driver
- `zod` + `drizzle-zod` — Validation
- `react` (18.x) + `react-dom` — UI
- `wouter` (3.x) — Routing
- `@tanstack/react-query` (5.x) — Server state
- `tailwindcss` (3.x) + `@radix-ui/*` — Styling + primitives
- `framer-motion` — Animations
- `lucide-react` — Icons
- `vite` (5.x) — Build tool

### Python Key Dependencies
- `flask` (3.x) + `flask-cors` — HTTP server
- `langchain` + `langchain-google-genai` — LLM orchestration
- `manim` (≥ 0.18.1) — Animation rendering
- `numpy` — Numerical computations
- `python-dotenv` — Environment variables
