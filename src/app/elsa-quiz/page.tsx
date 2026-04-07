"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Lightbulb,
  ChevronRight,
  RotateCcw,
  Sparkles,
  Star,
  Filter,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import questionsData from "./data.json";

type Question = {
  id: number;
  subject: string;
  category: string;
  difficulty: number;
  question: string;
  options: string[];
  answer: number;
  hint: string;
  explanation: string;
};

const allQuestions: Question[] = questionsData as Question[];
const categories = Array.from(new Set(allQuestions.map((q) => q.category)));

function ConfettiEffect() {
  const [particles] = useState(() =>
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      size: Math.random() * 8 + 6,
      color: ["#f59e0b", "#ec4899", "#8b5cf6", "#10b981", "#3b82f6"][
        Math.floor(Math.random() * 5)
      ],
      duration: Math.random() * 1 + 1.5,
    }))
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute animate-confetti rounded-full"
          style={{
            left: `${p.left}%`,
            top: "-10px",
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function ElsaQuizPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [quizFinished, setQuizFinished] = useState(false);

  const filteredQuestions = useMemo(
    () =>
      selectedCategory === "all"
        ? allQuestions
        : allQuestions.filter((q) => q.category === selectedCategory),
    [selectedCategory]
  );

  const currentQuestion = filteredQuestions[currentIndex];

  const isCorrect = selectedOption === currentQuestion?.answer;

  const handleSelect = useCallback(
    (optionIndex: number) => {
      if (showResult) return;
      setSelectedOption(optionIndex);
      setShowResult(true);
      setAnsweredCount((c) => c + 1);

      if (optionIndex === currentQuestion.answer) {
        setCorrectCount((c) => c + 1);
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 2500);
      }
    },
    [showResult, currentQuestion]
  );

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= filteredQuestions.length) {
      setQuizFinished(true);
      return;
    }
    setCurrentIndex((i) => i + 1);
    setSelectedOption(null);
    setShowHint(false);
    setShowResult(false);
  }, [currentIndex, filteredQuestions.length]);

  const handleReset = useCallback(() => {
    setCurrentIndex(0);
    setSelectedOption(null);
    setShowHint(false);
    setShowResult(false);
    setCorrectCount(0);
    setAnsweredCount(0);
    setQuizFinished(false);
  }, []);

  const handleCategoryChange = useCallback((cat: string) => {
    setSelectedCategory(cat);
    setCurrentIndex(0);
    setSelectedOption(null);
    setShowHint(false);
    setShowResult(false);
    setCorrectCount(0);
    setAnsweredCount(0);
    setQuizFinished(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && showResult && !quizFinished) {
        handleNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showResult, quizFinished, handleNext]);

  const progress =
    filteredQuestions.length > 0
      ? ((currentIndex + (showResult ? 1 : 0)) / filteredQuestions.length) * 100
      : 0;
  const accuracy =
    answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;

  if (quizFinished) {
    const emoji = accuracy >= 80 ? "🏆" : accuracy >= 60 ? "⭐" : "💪";
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-purple-100 via-pink-50 to-amber-50 p-6">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl">
          <div className="mb-4 text-6xl">{emoji}</div>
          <h2 className="mb-2 text-3xl font-bold text-purple-700">
            練習完成！
          </h2>
          <p className="mb-1 text-xl text-gray-600">
            答對 <span className="font-bold text-green-600">{correctCount}</span>{" "}
            / {answeredCount} 題
          </p>
          <p className="mb-6 text-lg text-gray-500">正確率：{accuracy}%</p>
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 px-8 py-3 text-lg font-semibold text-white shadow-lg transition hover:scale-105 hover:shadow-xl"
          >
            <RotateCcw size={20} />
            再練習一次
          </button>
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-purple-100 via-pink-50 to-amber-50 p-6">
        <p className="text-xl text-gray-500">此分類沒有題目喔！</p>
      </div>
    );
  }

  const difficultyStars = Array.from(
    { length: currentQuestion.difficulty },
    (_, i) => i
  );

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-purple-100 via-pink-50 to-amber-50">
      {showConfetti && <ConfettiEffect />}

      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-purple-100 bg-white/80 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="text-purple-500" size={24} />
            <h1 className="text-lg font-bold text-purple-700">
              Elsa 的刷題樂園
            </h1>
          </div>
          <div className="text-right text-sm">
            <span className="font-medium text-gray-600">
              正確率{" "}
              <span
                className={`font-bold ${accuracy >= 70 ? "text-green-600" : accuracy >= 40 ? "text-amber-500" : "text-red-500"}`}
              >
                {accuracy}%
              </span>
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mx-auto mt-2 max-w-2xl">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              第 {currentIndex + 1} / {filteredQuestions.length} 題
            </span>
            <span>
              答對 {correctCount} / {answeredCount}
            </span>
          </div>
          <div className="mt-1 h-3 overflow-hidden rounded-full bg-purple-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-400 to-pink-400 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </header>

      {/* Category filter */}
      <div className="mx-auto w-full max-w-2xl px-4 pt-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <Filter size={16} className="shrink-0 text-gray-400" />
          <button
            onClick={() => handleCategoryChange("all")}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${
              selectedCategory === "all"
                ? "bg-purple-500 text-white shadow-md"
                : "bg-white text-gray-600 hover:bg-purple-50"
            }`}
          >
            全部
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => handleCategoryChange(cat)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${
                selectedCategory === cat
                  ? "bg-purple-500 text-white shadow-md"
                  : "bg-white text-gray-600 hover:bg-purple-50"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6">
        {/* Question card */}
        <div className="rounded-3xl bg-white p-6 shadow-lg">
          {/* Difficulty + category */}
          <div className="mb-3 flex items-center justify-between">
            <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-medium text-purple-700">
              {currentQuestion.category}
            </span>
            <div className="flex items-center gap-0.5">
              {difficultyStars.map((i) => (
                <Star
                  key={i}
                  size={14}
                  className="fill-amber-400 text-amber-400"
                />
              ))}
            </div>
          </div>

          {/* Question text */}
          <p className="mb-6 text-xl font-semibold leading-relaxed text-gray-800">
            {currentQuestion.question}
          </p>

          {/* Options */}
          <div className="space-y-3">
            {currentQuestion.options.map((opt, idx) => {
              let optionStyle =
                "border-2 border-gray-200 bg-gray-100 text-blue-700 hover:border-purple-300 hover:bg-purple-50";

              if (showResult) {
                if (idx === currentQuestion.answer) {
                  optionStyle =
                    "border-2 border-green-400 bg-green-50 ring-2 ring-green-200";
                } else if (idx === selectedOption && !isCorrect) {
                  optionStyle =
                    "border-2 border-red-400 bg-red-50 ring-2 ring-red-200";
                } else {
                  optionStyle =
                    "border-2 border-gray-100 bg-gray-50 opacity-50";
                }
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleSelect(idx)}
                  disabled={showResult}
                  className={`flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left text-lg transition-all ${optionStyle} ${!showResult ? "cursor-pointer active:scale-[0.98]" : "cursor-default"}`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-200 text-sm font-bold text-purple-700">
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className="flex-1">{opt}</span>
                  {showResult && idx === currentQuestion.answer && (
                    <CheckCircle2
                      size={22}
                      className="shrink-0 text-green-500"
                    />
                  )}
                  {showResult &&
                    idx === selectedOption &&
                    !isCorrect &&
                    idx !== currentQuestion.answer && (
                      <XCircle size={22} className="shrink-0 text-red-500" />
                    )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Hint button */}
        {!showResult && (
          <button
            onClick={() => setShowHint((v) => !v)}
            className="mx-auto mt-4 flex items-center gap-2 rounded-full bg-amber-100 px-5 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-200"
          >
            <Lightbulb size={18} className="text-amber-500" />
            {showHint ? "隱藏提示" : "需要提示嗎？"}
          </button>
        )}

        {/* Hint content */}
        {showHint && !showResult && (
          <div className="mx-auto mt-3 w-full max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center text-base leading-relaxed text-amber-800">
            💡 {currentQuestion.hint}
          </div>
        )}

        {/* Result feedback */}
        {showResult && (
          <div
            className={`mt-4 rounded-2xl border-2 p-5 ${
              isCorrect
                ? "border-green-200 bg-green-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <p
              className={`mb-2 text-lg font-bold ${isCorrect ? "text-green-600" : "text-red-600"}`}
            >
              {isCorrect ? "🎉 答對了！太棒了！" : "😢 答錯了，沒關係！"}
            </p>
            <p className="text-base leading-relaxed text-gray-700">
              {currentQuestion.explanation}
            </p>
          </div>
        )}

        {/* Next button */}
        {showResult && (
          <button
            onClick={handleNext}
            className="mx-auto mt-6 flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 px-8 py-3 text-lg font-semibold text-white shadow-lg transition hover:scale-105 hover:shadow-xl"
          >
            {currentIndex + 1 >= filteredQuestions.length
              ? "查看成績"
              : "下一題"}
            <ChevronRight size={20} />
          </button>
        )}
      </main>

      <style jsx global>{`
        @keyframes confetti-fall {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
        .animate-confetti {
          animation: confetti-fall 2s ease-in forwards;
        }
      `}</style>
    </div>
  );
}
