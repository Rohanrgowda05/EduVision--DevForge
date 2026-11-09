import { useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuizOption {
  id: string;
  text: string;
}

interface QuizCardProps {
  questionNumber: number;
  totalQuestions: number;
  question: string;
  options: QuizOption[];
  correctAnswer?: string;
  selectedAnswer: string | null;
  onSelect: (optionId: string) => void;
  showResult?: boolean;
}

export function QuizCard({
  questionNumber,
  totalQuestions,
  question,
  options,
  correctAnswer,
  selectedAnswer,
  onSelect,
  showResult = false,
}: QuizCardProps) {
  return (
    <div className="w-full" data-testid={`quiz-card-${questionNumber}`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-muted-foreground">
          Question {questionNumber} of {totalQuestions}
        </span>
        <div className="flex gap-1">
          {Array.from({ length: totalQuestions }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                i + 1 === questionNumber
                  ? "bg-primary"
                  : i + 1 < questionNumber
                  ? "bg-primary/50"
                  : "bg-muted"
              )}
            />
          ))}
        </div>
      </div>

      <h3 className="text-xl font-semibold mb-6">{question}</h3>

      <div className="space-y-3">
        {options.map((option) => {
          const isSelected = selectedAnswer === option.id;
          const isCorrect = option.id === correctAnswer;
          const showCorrect = showResult && isCorrect;
          const showIncorrect = showResult && isSelected && !isCorrect;

          return (
            <button
              key={option.id}
              onClick={() => !showResult && onSelect(option.id)}
              disabled={showResult}
              className={cn(
                "w-full text-left p-4 rounded-lg border-2 transition-all",
                "flex items-center justify-between gap-3",
                !showResult && "hover-elevate cursor-pointer",
                !showResult && isSelected && "border-primary bg-primary/5",
                !showResult && !isSelected && "border-border",
                showCorrect && "border-green-500 bg-green-500/10",
                showIncorrect && "border-red-500 bg-red-500/10",
                showResult && !showCorrect && !showIncorrect && "opacity-50"
              )}
              data-testid={`quiz-option-${option.id}`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                    isSelected && !showResult && "border-primary bg-primary",
                    !isSelected && !showResult && "border-muted-foreground/30",
                    showCorrect && "border-green-500 bg-green-500",
                    showIncorrect && "border-red-500 bg-red-500"
                  )}
                >
                  {showCorrect && <Check className="w-4 h-4 text-white" />}
                  {showIncorrect && <X className="w-4 h-4 text-white" />}
                  {isSelected && !showResult && (
                    <div className="w-2 h-2 rounded-full bg-white" />
                  )}
                </div>
                <span className={cn(
                  "text-base",
                  showCorrect && "text-green-700 dark:text-green-400 font-medium",
                  showIncorrect && "text-red-700 dark:text-red-400"
                )}>
                  {option.text}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
