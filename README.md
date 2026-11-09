# EduVision - AI-Powered Visual Learning Platform



Transform complex concepts into engaging visual learning experiences with AI-powered animations and interactive quizzes.

## 🚀 Overview

EduVision is an innovative educational platform that leverages artificial intelligence to convert natural language descriptions into animated educational videos. It combines the power of large language models (LLMs) with advanced animation technologies like Manim and VPython to create immersive learning experiences.

## 🏗️ System Architecture

<div align="center">
  <img src="./attached_assets/system diagram.png" alt="EduVision System Architecture" width="800"/>
  <p><em>Figure 1: High-level system architecture of EduVision platform</em></p>
</div>

### Key Components

1. **Frontend Layer**
   - Modern, responsive UI built with React and TypeScript
   - Interactive video player and quiz interfaces
   - Real-time progress tracking and feedback

2. **Backend Services**
   - RESTful API built with Node.js and Express
   -LLM data parsing
   - Request routing and processing

3. **AI Processing**
   - Text analysis and understanding using Gemini
   - Content generation and structuring
   - Animation script generation

4. **Video Generation**
   - Manim for mathematical animations
   - VPython for 3D visualizations
   - Video optimization and processing

5. **Data Storage**
   - PostgreSQL for structured data
   - File system for media storage
   - Caching layer for improved performance

### Key Components

1. **Frontend (React + TypeScript)**
   - Modern, responsive UI built with React and TypeScript
   - State management with React Context
   - Interactive quiz and video player components

2. **Backend (Node.js + Express)**
   - RESTful API endpoints
   - Integration with Gemini AI for content generation
   - Database operations and session management

3. **AI & Animation Engine**
   - LLM-powered content generation
   - Manim for mathematical animations
   - VPython for 3D visualizations
   - Video optimization pipeline

4. **Database (PostgreSQL)**
   - User data and preferences
   - Video and quiz history
   - Performance analytics

## 🛠️ Installation

### Prerequisites

- Node.js (v16+)
- Python 3.8+
- PostgreSQL
- Git

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone https://github.com/PreethamMR22/testing.git
   cd testing
   ```

2. **Set up environment variables**

   Create a `.env` file in the root directory with the following content:
   ```env
   # Database Configuration
   DATABASE_URL=postgresql://neondb_owner:npg_iLGPf7KaC4mT@ep-red-bread-ahvklmt7-pooler.c-3.us-east-1.aws.neondb/neondb?sslmode=require&channel_binding=require

   # Session Configuration
   SESSION_SECRET=your-secret-key-here-change-this-in-production

   # Node Environment
   NODE_ENV=development

   # Server Port
   PORT=8000

   # API Keys
   GEMINI_API_KEY=your-gemini-api-key
   REACT_APP_YOUTUBE_API_KEY=your-youtube-api-key
   ```

3. **Set up frontend environment**
   ```bash
   cd client
   echo "VITE_YOUTUBE_API_KEY=your-youtube-api-key" > .env
   cd ..
   ```

4. **Install dependencies**
   ```bash
   # Install backend dependencies
   npm install

   # Install frontend dependencies
   cd client
   npm install
   cd ..

   # Install Python dependencies
   cd hack27
   python -m pip install -r requirements.txt
   ```

5. **Set up UV Package Manager and Virtual Environment**
   ```bash
   # Install UV package manager
   curl -LsSf https://astral.sh/uv/install.sh | sh
   
   # Sync dependencies and create virtual environment
   uv sync
   
   # Activate the virtual environment
   source .venv/bin/activate  # On Unix/Linux/MacOS
   # OR
   .venv\Scripts\activate    # On Windows
   
   # Run the application
   uv run main.py
   ```

## 🚀 Running the Application

1. **Start the AI and animation service**
   ```bash
   cd hack27
   python3 main.py
   ```

2. **In a new terminal, start the main application**
   ```bash
   # From the root directory
   npm run dev
   ```

3. **Access the application**
   Open your browser and navigate to `http://localhost:8000`

## 🎯 Features

- **AI-Powered Video Generation**
  - Convert text descriptions to educational animations
  - Support for complex mathematical and scientific concepts
  - Customizable animation parameters

- **Interactive Learning**
  - AI-generated quizzes based on video content
  - Real-time feedback and explanations
  - Progress tracking and performance analytics

- **Content Discovery**
  - Browse and search educational videos
  - Personalized recommendations
  - YouTube integration for additional resources

- **User Profile**
  - Track learning progress
  - View history and achievements
  - Manage saved content

## 📚 Tech Stack

- **Frontend**
  - React.js
  - TypeScript
  - Tailwind CSS
  - Vite

- **Backend**
  - Node.js
  - Express.js
  - PostgreSQL
  - Prisma ORM

- **AI & Animation**
  - Google Gemini
  - Google Agent Development Kit (ADK)
  - Manim
  - VPython
  - UV package manager

## 🧠 Phase 3: Adaptive Learning Layer & Study-Planner

EduVision features an intelligent adaptive learning engine that tracks each student's concept-level mastery over time, dynamically tailoring visual animations, study notes, quizzes, and recommendations.

### 1. Server-Side Grading & Anti-Tamper Security
- **Zero Client Answer Exposure**: Correct answers and grading rubrics are strictly stripped before sending quiz payloads to the client.
- **Server-Side Verification**: The backend grades submissions, calculates scores, and records per-concept outcomes (`question_results`).
- **Atomic Single-Submit**: Quizzes enforce single-submission semantics via atomic compare-and-swap SQL queries. Resubmissions return an HTTP `409 Conflict`.

### 2. Topic Normalization & Concept Reuse
- User prompts (e.g., "visualize doppler effect" and "doppler shift in sound") are normalized to canonical topics per user.
- Existing concept labels are preserved across quizzes and notes to ensure consistent longitudinal tracking.

### 3. Mathematical Mastery Model (Pure Deterministic Code)
- **Recency-Weighted Exponential Decay**: Evaluates knowledge retention with a 14-day half-life:
  $$w_i = \exp\left(-\ln(2) \cdot \frac{\Delta t_{\text{days}}}{14.0}\right)$$
- **Laplace Smoothing**: Prevents extreme probability estimates on small sample sizes:
  $$\text{mastery} = \frac{\sum w_i \cdot \text{correct}_i + 1}{\sum w_i + 2}$$
- **Evidence Thresholding**: Requires at least $3.0$ weighted attempts of evidence before categorizing a concept as:
  - **Weak**: Mastery $< 0.60$
  - **Strong**: Mastery $\ge 0.80$
  - **Unknown**: Insufficient evidence ($< 3.0$ attempts) or borderline mastery

### 4. Study-Planner Architecture: Deterministic vs Google ADK Agent
The system implements both a pure rule-based planner and a Google ADK study-planner agent, toggled via the `PLANNER` environment variable (default: `rules`):

> **Important Architectural Note**: The study-planner agent is **never autonomous**. The agent only *proposes* a candidate study plan. Deterministic system code validates the proposal against strict Pydantic schemas, enforces daily quotas and user isolation boundaries, and executes the final plan.

- **Tools with User Isolation**: The ADK agent operates using read-only tools (`get_learner_profile`, `list_user_topics`, `find_existing_assets`). User IDs are injected via tool closures in backend server sessions; the LLM model never receives or manipulates user identifiers, rendering prompt-injection privilege escalation impossible.
- **Fail-Safe Fallback**: If the agent service is unavailable, times out, or fails schema validation after a repair turn, the system seamlessly falls back to the deterministic rule-based plan with `fallback_used = true`. Jobs never fail due to agent errors.

### 5. Empirical Evaluation (`planner_eval`)

Evaluated on **15 synthetic learner scenarios** covering cold start, unlucky misses, multi-concept struggles, stale decay, 24-hour asset reuse, and topic label drift:

| Metric | Deterministic Rules (`rules`) | ADK Agent (`agent`) | Analysis |
| :--- | :--- | :--- | :--- |
| **Action Accuracy vs Ground Truth** | **100.0%** | **100.0%** | Both achieve flawless action alignment |
| **Action Agreement (Rules vs Agent)** | 100.0% | 100.0% | Agent perfectly respects pedagogical constraints |
| **Focus Concepts Precision** | **100.0%** | **100.0%** | Accurate targeting of weakest concepts |
| **Focus Concepts Recall** | **100.0%** | **100.0%** | Up to 3 weakest concepts reliably targeted |
| **Fallback Rate** | 0.0% | 0.0% | Zero unexpected execution failures |
| **LLM Calls per Plan** | **0** | 1.00 | Rules require zero external API requests |
| **Average Latency** | **0.004 ms** | 858.0 ms | Rules are ~200,000x faster |

**Why `PLANNER` defaults to `rules`**:
The deterministic rules engine executes in sub-millisecond time ($0.004\text{ ms}$) with $0$ API cost and zero risk of rate-limiting, while guaranteeing 100% adherence to evidence thresholds. The ADK Agent is available for deployments requiring natural language adaptability or conversational rationale customization.


## 🙏 Acknowledgments

We are deeply grateful to the following organizations and communities for their invaluable support:

- **Scaler School of Technology** for their exceptional mentorship and guidance throughout the development of this project
- **DevForge Team** for their continuous support, technical expertise, and encouragement
- The **Manim community** for their incredible animation engine that powers our visualizations
- **Google** for the Gemini AI models that enable our intelligent content generation


---

<div align="center">
  Made with ❤️ by the Code Warriors Team
</div>
