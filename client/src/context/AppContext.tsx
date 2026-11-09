import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";

export interface GeneratedVideo {
  id: string;
  userId?: string;
  jobId?: string | null;
  prompt: string;
  videoUrl: string;
  createdAt: Date;
}

export interface NotesRecord {
  id: string;
  videoId: string;
  notesText: string;
  downloaded: boolean;
  createdAt: Date;
}

export interface QuizAttempt {
  id: string;
  userId?: string;
  prompt: string;
  score: number;
  totalQuestions: number;
  createdAt: Date;
}

export interface ConceptMasteryUI {
  concept: string;
  mastery: number;
  evidence: number;
  status: "weak" | "strong" | "unknown";
  rawCorrect: number;
  rawAttempts: number;
}

export interface TopicWithProfile {
  id: string;
  canonicalName: string;
  profile: {
    topicId: string;
    topicName?: string;
    concepts: ConceptMasteryUI[];
    lastActivity: string | null;
    totalAttempts: number;
  };
}

export interface StudyPlanUI {
  action: "generate_new" | "reuse_existing" | "remedial" | "advanced";
  focusConcepts: string[];
  difficulty: "intro" | "standard" | "challenging";
  includeYoutube: boolean;
  rationale: string;
  reusedVideoUrl?: string | null;
}

export interface ProfileData {
  videosGenerated: number;
  notesDownloaded: number;
  quizAttempts: number;
  passedQuizzes: number;
  passRate: number;
  streak: number;
  recentVideos: GeneratedVideo[];
  recentQuizzes: QuizAttempt[];
  topics?: TopicWithProfile[];
}

interface AppContextType {
  currentPrompt: string;
  setCurrentPrompt: (prompt: string) => void;
  generatedVideos: GeneratedVideo[];
  quizAttempts: QuizAttempt[];
  streak: number;
  isGenerating: boolean;
  setIsGenerating: (value: boolean) => void;
  jobStatus: string | null;
  jobStatusMessage: string | null;
  currentPlan: StudyPlanUI | null;
  currentVideo: GeneratedVideo | null;
  currentNotes: NotesRecord | null;
  submitJob: (prompt: string) => Promise<void>;
  generateVideo: (prompt: string, videoUrl: string) => Promise<void>;
  submitQuiz: (
    quizId: string,
    answers: Record<string, string>
  ) => Promise<{
    passed: boolean;
    message: string;
    score: number;
    totalQuestions: number;
    feedback?: any[];
  }>;
  notesDownloaded: number;
  loadProfile: () => Promise<void>;
  profileData: ProfileData | null;
  markNotesDownloaded: (notesId: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [generatedVideos, setGeneratedVideos] = useState<GeneratedVideo[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>([]);
  const [streak, setStreak] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobStatusMessage, setJobStatusMessage] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<StudyPlanUI | null>(null);
  const [currentVideo, setCurrentVideo] = useState<GeneratedVideo | null>(null);
  const [currentNotes, setCurrentNotes] = useState<NotesRecord | null>(null);
  const [notesDownloaded, setNotesDownloaded] = useState(0);
  const [profileData, setProfileData] = useState<ProfileData | null>(null);

  /**
   * Submit an animation prompt to Express async job pipeline, then poll for live status.
   *
   * Note: HTTP Polling was chosen for simplicity, zero connection-state overhead, and
   * resilience across worker restarts. SSE (Server-Sent Events) or WebSockets would be
   * the natural next step for real-time sub-second progress updates.
   */
  const submitJob = useCallback(async (prompt: string) => {
    setIsGenerating(true);
    setCurrentPrompt(prompt);
    setJobStatus("queued");
    setJobStatusMessage("Queued in render queue...");
    setCurrentPlan(null);

    try {
      const queueRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!queueRes.ok) {
        const errJson = await queueRes.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.error || `Server responded with ${queueRes.status}`);
      }

      const { jobId } = await queueRes.json();
      console.log(`[Job Pipeline] Enqueued job ${jobId}`);

      let pollInterval = 2000;
      let completed = false;

      while (!completed) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        const jobRes = await fetch(`/api/jobs/${jobId}`);
        if (!jobRes.ok) {
          throw new Error("Failed to check render status");
        }

        const job = await jobRes.json();
        setJobStatus(job.status);
        if (job.plan) {
          setCurrentPlan(job.plan);
        }

        if (job.status === "queued") {
          setJobStatusMessage("Queued — waiting for worker slot...");
        } else if (job.status === "running") {
          const attemptText = job.attempts > 1 ? ` (attempt ${job.attempts})` : "";
          setJobStatusMessage(`Rendering animation${attemptText}...`);
        } else if (job.status === "succeeded") {
          setJobStatusMessage("Animation ready!");
          completed = true;

          if (job.video) {
            const video: GeneratedVideo = {
              ...job.video,
              createdAt: new Date(job.video.createdAt),
            };
            setCurrentVideo(video);
            setGeneratedVideos((prev) => [video, ...prev]);
          }

          if (job.notes) {
            const notes: NotesRecord = {
              ...job.notes,
              createdAt: new Date(),
            };
            setCurrentNotes(notes);
          } else {
            setCurrentNotes(null);
          }

          break;
        } else if (job.status === "failed") {
          completed = true;
          const failureReason = job.errorMessage || "Rendering failed";
          setJobStatusMessage(failureReason);
          throw new Error(failureReason);
        }

        // Exponential backoff up to 5000ms
        pollInterval = Math.min(Math.round(pollInterval * 1.15), 5000);
      }
    } finally {
      setIsGenerating(false);
    }
  }, []);

  // Backward-compatible direct video helper
  const generateVideo = useCallback(async (prompt: string, videoUrl: string) => {
    setIsGenerating(true);
    setCurrentPrompt(prompt);

    try {
      const cacheBustedUrl = `${videoUrl}${videoUrl.includes("?") ? "&" : "?"}_t=${Date.now()}`;
      const video: GeneratedVideo = {
        id: `video-${Date.now()}`,
        prompt,
        videoUrl: cacheBustedUrl,
        createdAt: new Date(),
      };
      setCurrentVideo(video);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const submitQuiz = useCallback(async (quizId: string, answers: Record<string, string>) => {
    try {
      const response = await fetch("/api/quiz/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId, answers }),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.message || errorJson.error || "Failed to submit quiz");
      }

      const data = await response.json();

      const attempt: QuizAttempt = {
        ...data.attempt,
        createdAt: new Date(data.attempt.createdAt),
      };

      setQuizAttempts((prev) => [attempt, ...prev]);

      return {
        passed: data.passed,
        message: data.message,
        score: data.score,
        totalQuestions: data.totalQuestions,
        feedback: data.feedback,
      };
    } catch (error) {
      console.error("Failed to submit quiz:", error);
      throw error;
    }
  }, []);

  const markNotesDownloaded = useCallback(
    async (notesId: string) => {
      try {
        await apiRequest("POST", `/api/notes/${notesId}/download`);
        setNotesDownloaded((prev) => prev + 1);
        if (currentNotes && currentNotes.id === notesId) {
          setCurrentNotes({ ...currentNotes, downloaded: true });
        }
      } catch (error) {
        console.error("Failed to mark notes as downloaded:", error);
      }
    },
    [currentNotes]
  );

  const loadProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/profile");
      if (!response.ok) {
        return;
      }
      const data = await response.json();

      const profile: ProfileData = {
        ...data,
        recentVideos: data.recentVideos.map((v: any) => ({
          ...v,
          createdAt: new Date(v.createdAt),
        })),
        recentQuizzes: data.recentQuizzes.map((q: any) => ({
          ...q,
          createdAt: new Date(q.createdAt),
        })),
      };

      setProfileData(profile);
      setStreak(profile.streak);
      setNotesDownloaded(profile.notesDownloaded);
      setGeneratedVideos(profile.recentVideos);
      setQuizAttempts(profile.recentQuizzes);
    } catch (error) {
      console.error("Failed to load profile:", error);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  return (
    <AppContext.Provider
      value={{
        currentPrompt,
        setCurrentPrompt,
        generatedVideos,
        quizAttempts,
        streak,
        isGenerating,
        setIsGenerating,
        jobStatus,
        jobStatusMessage,
        currentPlan,
        currentVideo,
        currentNotes,
        submitJob,
        generateVideo,
        submitQuiz,
        notesDownloaded,
        loadProfile,
        profileData,
        markNotesDownloaded,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
