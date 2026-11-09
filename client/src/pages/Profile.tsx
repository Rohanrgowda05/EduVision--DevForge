import { useEffect } from "react";
import { useLocation } from "wouter";
import {
  Video,
  FileText,
  Trophy,
  Flame,
  Clock,
  Brain,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Info,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatsCard } from "@/components/StatsCard";
import { QuizHistoryItem } from "@/components/QuizHistoryItem";
import { useApp } from "@/context/AppContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

export default function Profile() {
  const {
    loadProfile,
    profileData,
    generatedVideos,
    quizAttempts,
    streak,
    notesDownloaded,
    submitJob,
  } = useApp();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const videos = profileData?.recentVideos || generatedVideos;
  const quizzes = profileData?.recentQuizzes || quizAttempts;
  const passRate = profileData?.passRate || 0;
  const passedQuizzes = profileData?.passedQuizzes || 0;
  const topics = profileData?.topics || [];

  const handlePracticeWeakAreas = async (topicName: string) => {
    const prompt = `Practice and visualize weak concepts in ${topicName.replace(/_/g, " ")}`;
    toast({
      title: "Creating Remedial Study Job",
      description: `Targeting weak concepts for ${topicName.replace(/_/g, " ")}...`,
    });
    setLocation("/");
    try {
      await submitJob(prompt);
    } catch (e: any) {
      toast({
        title: "Could not create job",
        description: e.message,
        variant: "destructive",
      });
    }
  };

  if (!profileData && videos.length === 0) {
    return (
      <div className="min-h-full p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64 mt-2" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Your Profile</h1>
          <p className="text-muted-foreground mt-1">Track your learning progress and achievements</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Videos Generated"
            value={profileData?.videosGenerated || videos.length}
            subtitle="Total visualizations"
            icon={Video}
            variant="primary"
          />
          <StatsCard
            title="Notes Downloaded"
            value={notesDownloaded}
            icon={FileText}
            variant="default"
          />
          <StatsCard
            title="Quiz Pass Rate"
            value={`${passRate}%`}
            subtitle={`${passedQuizzes}/${quizzes.length} passed`}
            icon={Trophy}
            variant="success"
          />
          <StatsCard
            title="Learning Streak"
            value={`${streak} days`}
            icon={Flame}
            trend="up"
            trendValue="Active"
            variant="warning"
          />
        </div>

        {/* Adaptive Concept Mastery Section */}
        <Card data-testid="card-adaptive-mastery">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-primary" />
                  Adaptive Concept Mastery
                </CardTitle>
                <CardDescription className="mt-1">
                  Per-topic mastery computed from your quiz performance using recency-weighted decay
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Mastery explanation banner */}
            <div className="p-4 rounded-lg bg-muted/60 border border-border flex items-start gap-3">
              <Info className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="text-xs text-muted-foreground leading-relaxed">
                <p className="font-semibold text-foreground mb-0.5">How Mastery is Computed</p>
                Recency-weighted exponential decay (14-day half-life) with Laplace smoothing:{" "}
                <code className="px-1 py-0.5 rounded bg-background font-mono text-[11px]">
                  mastery = (weightedCorrect + 1) / (weightedAttempts + 2)
                </code>
                . A concept requires at least 3 weighted attempts of evidence before being categorized as{" "}
                <strong>Weak (&lt; 60%)</strong> or <strong>Strong (&ge; 80%)</strong>. Concepts with insufficient evidence remain <em>Unknown</em> to prevent premature conclusions.
              </div>
            </div>

            {topics.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Brain className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="font-medium">No topic mastery data recorded yet</p>
                <p className="text-sm mt-1">Take quizzes after watching videos to build your personalized knowledge profile.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {topics.map((topicItem) => {
                  const weakCount = topicItem.profile.concepts.filter((c) => c.status === "weak").length;
                  return (
                    <div
                      key={topicItem.id}
                      className="p-4 rounded-xl border border-border bg-card space-y-4 shadow-sm"
                      data-testid={`topic-mastery-${topicItem.id}`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-base capitalize text-foreground">
                            {topicItem.canonicalName.replace(/_/g, " ")}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {topicItem.profile.concepts.length} concepts tracked &bull; {topicItem.profile.totalAttempts} total quiz questions
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant={weakCount > 0 ? "default" : "outline"}
                          onClick={() => handlePracticeWeakAreas(topicItem.canonicalName)}
                          className="self-start sm:self-auto"
                          data-testid={`button-practice-${topicItem.id}`}
                        >
                          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                          Practice weak areas
                        </Button>
                      </div>

                      {topicItem.profile.concepts.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">No concept breakdown yet for this topic.</p>
                      ) : (
                        <div className="space-y-3 pt-1">
                          {topicItem.profile.concepts.map((concept) => {
                            const pct = Math.round(concept.mastery * 100);
                            return (
                              <div key={concept.concept} className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-medium capitalize text-foreground">
                                    {concept.concept.replace(/_/g, " ")}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground">
                                      Evidence: {concept.evidence.toFixed(1)} ({concept.rawCorrect}/{concept.rawAttempts})
                                    </span>
                                    {concept.status === "weak" && (
                                      <Badge variant="destructive" className="text-[10px] h-5 px-1.5 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" /> Weak ({pct}%)
                                      </Badge>
                                    )}
                                    {concept.status === "strong" && (
                                      <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] h-5 px-1.5 flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3" /> Strong ({pct}%)
                                      </Badge>
                                    )}
                                    {concept.status === "unknown" && (
                                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5 flex items-center gap-1">
                                        <HelpCircle className="w-3 h-3" /> Evaluating ({pct}%)
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="w-full bg-muted h-2 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full transition-all rounded-full ${
                                      concept.status === "weak"
                                        ? "bg-destructive"
                                        : concept.status === "strong"
                                        ? "bg-emerald-500"
                                        : "bg-primary/50"
                                    }`}
                                    style={{ width: `${Math.max(5, pct)}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Video className="w-5 h-5 text-primary" />
                Recent Videos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {videos.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  No videos generated yet. Start by creating your first visualization!
                </p>
              ) : (
                videos.slice(0, 5).map((video) => (
                  <div
                    key={video.id}
                    className="flex items-center gap-4 p-3 rounded-lg bg-muted/50"
                    data-testid={`video-history-${video.id}`}
                  >
                    <div className="w-16 h-10 rounded bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center flex-shrink-0">
                      <Video className="w-4 h-4 text-primary/60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{video.prompt}</p>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {new Date(video.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      2:34
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-primary" />
                Quiz History
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {quizzes.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  No quizzes taken yet. Generate a video and test your knowledge!
                </p>
              ) : (
                quizzes.slice(0, 5).map((quiz) => (
                  <QuizHistoryItem
                    key={quiz.id}
                    prompt={quiz.prompt}
                    score={quiz.score}
                    totalQuestions={quiz.totalQuestions}
                    date={new Date(quiz.createdAt)}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-orange-500" />
              Learning Streak
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {Array.from({ length: 7 }).map((_, i) => {
                const isActive = i < streak % 7 || streak >= 7;
                return (
                  <div
                    key={i}
                    className={`flex-1 h-12 rounded-lg flex items-center justify-center font-medium text-sm ${
                      isActive
                        ? "bg-gradient-to-br from-orange-500/20 to-yellow-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/30"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}
                  </div>
                );
              })}
            </div>
            <p className="text-center text-muted-foreground mt-4">
              Keep your streak going by learning something new every day!
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
