/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  BookOpen, Award, CheckCircle2, XCircle, Clock, BarChart3, AlertTriangle, 
  Check, ChevronRight, RotateCcw, LogOut, LogIn, Play, FileText, HelpCircle, 
  ShieldCheck, TrendingUp, User, Bookmark, Sparkles, Menu, X, ArrowRight, ArrowLeft,
  Flame, Target, Zap, Settings
} from 'lucide-react';

import { GoogleGenAI } from '@google/genai';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit, 
  doc, 
  updateDoc, 
  onSnapshot, 
  serverTimestamp 
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || '(default)');
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Error handler for Firestore
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
}

interface Question {
  id: string;
  paper: 'Paper 1' | 'Paper 2';
  unit: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

interface QuizAttempt {
  id?: string;
  userId: string;
  timestamp: any;
  score: number;
  total_marks: number;
  percentage: number;
  time_taken_seconds: number;
  paper1_score: number;
  paper2_score: number;
  topic_breakdown: Record<string, { correct: number; total: number }>;
}

interface MistakeItem {
  id?: string;
  userId: string;
  question_text: string;
  options: string[];
  correct_answer: number;
  user_answer: number;
  explanation: string;
  paper: 'Paper 1' | 'Paper 2';
  unit: string;
  mastered: boolean;
  practice_count?: number;
  correct_streak?: number;
  timestamp?: any;
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'home' | 'quiz' | 'analytics' | 'mistakes' | 'syllabus'>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Quiz state
  const [quizState, setQuizState] = useState<'idle' | 'loading' | 'active' | 'review'>('idle');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [markedForReview, setMarkedForReview] = useState<Record<number, boolean>>({});
  const [timeLeft, setTimeLeft] = useState(30 * 60); // 30 minutes in seconds
  const [timerActive, setTimerActive] = useState(false);
  const [lastResult, setLastResult] = useState<QuizAttempt | null>(null);

  // Gemini API Key state for on-the-fly generation
  const [userApiKey, setUserApiKey] = useState<string>(() => {
    return localStorage.getItem('pet10_gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY || '';
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tempKeyInput, setTempKeyInput] = useState(userApiKey);

  const saveApiKey = () => {
    localStorage.setItem('pet10_gemini_api_key', tempKeyInput.trim());
    setUserApiKey(tempKeyInput.trim());
    setSettingsOpen(false);
    alert('Gemini API Key saved successfully! Quizzes will now be generated on the fly via AI.');
  };

  // Firestore data
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [mistakes, setMistakes] = useState<MistakeItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Mistake practice mode state
  const [practicingMistakes, setPracticingMistakes] = useState(false);
  const [mistakeIndex, setMistakeIndex] = useState(0);
  const [mistakeAnswer, setMistakeAnswer] = useState<number | null>(null);
  const [mistakeFeedback, setMistakeFeedback] = useState<boolean | null>(null);

  // Auth observer
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Fetch attempts and mistakes when user changes
  useEffect(() => {
    if (!user) {
      setAttempts([]);
      setMistakes([]);
      return;
    }

    setLoadingData(true);
    const fetchUserData = async () => {
      try {
        // Fetch quiz attempts
        const attemptsQuery = query(
          collection(db, 'quiz_attempts'),
          where('userId', '==', user.uid)
        );
        const attemptSnap = await getDocs(attemptsQuery);
        const loadedAttempts: QuizAttempt[] = [];
        attemptSnap.forEach(docSnap => {
          loadedAttempts.push({ id: docSnap.id, ...docSnap.data() } as QuizAttempt);
        });
        // Sort client-side by timestamp descending
        loadedAttempts.sort((a, b) => {
          const tA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp instanceof Date ? a.timestamp.getTime() : 0);
          const tB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp instanceof Date ? b.timestamp.getTime() : 0);
          return tB - tA;
        });
        setAttempts(loadedAttempts);

        // Fetch mistake bank
        const mistakesQuery = query(
          collection(db, 'mistake_bank'),
          where('userId', '==', user.uid)
        );
        const mistakeSnap = await getDocs(mistakesQuery);
        const loadedMistakes: MistakeItem[] = [];
        mistakeSnap.forEach(docSnap => {
          loadedMistakes.push({ id: docSnap.id, ...docSnap.data() } as MistakeItem);
        });
        setMistakes(loadedMistakes);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'quiz_attempts / mistake_bank');
      } finally {
        setLoadingData(false);
      }
    };

    fetchUserData();
  }, [user]);

  // Timer countdown
  useEffect(() => {
    let interval: any = null;
    if (quizState === 'active' && timerActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            submitQuiz(); // Auto submit on time out
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [quizState, timerActive, timeLeft]);

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Login error:', err);
    }
  };

  const loadSampleMistake = () => {
    const sample: MistakeItem = {
      id: 'sample_' + Date.now(),
      userId: user ? user.uid : 'anonymous',
      question_text: 'In hypothesis testing, what is the precise definition of a Type II error?',
      options: [
        'Rejecting a true null hypothesis',
        'Failing to reject a false null hypothesis',
        'Accepting the null hypothesis when it is true',
        'Calculating incorrect degrees of freedom'
      ],
      correct_answer: 1,
      user_answer: 0,
      explanation: 'A Type II error (false negative) occurs when the researcher fails to reject a false null hypothesis. A Type I error is rejecting a true null hypothesis.',
      paper: 'Paper 1',
      unit: 'Unit 7: Hypothesis',
      mastered: false,
      practice_count: 0,
      correct_streak: 0,
      timestamp: new Date()
    };
    setMistakes(prev => [sample, ...prev]);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setActiveTab('home');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Start 20-Question Quiz (Client-side Gemini AI + Fallback Pool)
  const startQuiz = async () => {
    setQuizState('loading');
    try {
      const apiKey = userApiKey || import.meta.env.VITE_GEMINI_API_KEY || '';
      if (!apiKey) {
        // Use diverse random questions pool
        const pool = getRandomDiverseQuestions();
        const p1 = pool.filter(q => q.paper === 'Paper 1').sort(() => 0.5 - Math.random()).slice(0, 10);
        const p2 = pool.filter(q => q.paper === 'Paper 2').sort(() => 0.5 - Math.random()).slice(0, 10);
        const selected = [...p1, ...p2].sort(() => 0.5 - Math.random());
        setQuestions(selected);
        setCurrentIndex(0);
        setSelectedAnswers({});
        setMarkedForReview({});
        setTimeLeft(30 * 60);
        setTimerActive(true);
        setQuizState('active');
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are an expert Ph.D. Entrance Examination Committee member at Punyashlok Ahilyadevi Holkar Solapur University.
Generate a brand new, highly rigorous 20-question PET-10 Entrance Exam quiz strictly adhering to the following structure:
- Exactly 10 questions for Paper 1: Research Methodology.
- Exactly 10 questions for Paper 2: Mechanical Engineering.
Return a valid JSON array of exactly 20 objects. Each object must have:
- "id": string
- "paper": "Paper 1" or "Paper 2"
- "unit": string
- "question": string
- "options": array of 4 strings (A, B, C, D)
- "correct_index": integer (0-3)
- "explanation": string
Return ONLY valid JSON array. No markdown outside JSON.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });

      const text = response.text;
      if (!text) throw new Error('No response');
      const data = JSON.parse(text);
      if (Array.isArray(data) && data.length > 0) {
        setQuestions(data);
        setCurrentIndex(0);
        setSelectedAnswers({});
        setMarkedForReview({});
        setTimeLeft(30 * 60);
        setTimerActive(true);
        setQuizState('active');
      } else {
        throw new Error('Invalid format');
      }
    } catch (err) {
      console.error('Quiz generation error:', err);
      // Fallback to diverse random questions pool
      const pool = getRandomDiverseQuestions();
      const p1 = pool.filter(q => q.paper === 'Paper 1').sort(() => 0.5 - Math.random()).slice(0, 10);
      const p2 = pool.filter(q => q.paper === 'Paper 2').sort(() => 0.5 - Math.random()).slice(0, 10);
      const selected = [...p1, ...p2].sort(() => 0.5 - Math.random());
      setQuestions(selected);
      setCurrentIndex(0);
      setSelectedAnswers({});
      setMarkedForReview({});
      setTimeLeft(30 * 60);
      setTimerActive(true);
      setQuizState('active');
    }
  };

  const handleSelectOption = (qIdx: number, optIdx: number) => {
    setSelectedAnswers(prev => ({ ...prev, [qIdx]: optIdx }));
  };

  const toggleMarkForReview = (qIdx: number) => {
    setMarkedForReview(prev => ({ ...prev, [qIdx]: !prev[qIdx] }));
  };

  // Submit Quiz & Grade
  const submitQuiz = async () => {
    setTimerActive(false);
    let score = 0;
    let paper1Score = 0;
    let paper2Score = 0;
    const topicBreakdown: Record<string, { correct: number; total: number }> = {};

    questions.forEach((q, idx) => {
      const userAns = selectedAnswers[idx];
      const isCorrect = userAns === q.correct_index;

      if (!topicBreakdown[q.unit]) {
        topicBreakdown[q.unit] = { correct: 0, total: 0 };
      }
      topicBreakdown[q.unit].total += 1;

      if (isCorrect) {
        score += 1;
        topicBreakdown[q.unit].correct += 1;
        if (q.paper === 'Paper 1') paper1Score += 1;
        if (q.paper === 'Paper 2') paper2Score += 1;
      }
    });

    const percentage = Math.round((score / questions.length) * 100);
    const timeTakenSeconds = 30 * 60 - timeLeft;

    const attemptData: QuizAttempt = {
      userId: user ? user.uid : 'anonymous',
      timestamp: serverTimestamp(),
      score,
      total_marks: questions.length,
      percentage,
      time_taken_seconds: timeTakenSeconds,
      paper1_score: paper1Score,
      paper2_score: paper2Score,
      topic_breakdown: topicBreakdown
    };

    setLastResult(attemptData);

    // Save to Firestore & Mistake Bank if user is logged in
    if (user) {
      try {
        const docRef = await addDoc(collection(db, 'quiz_attempts'), attemptData);
        setAttempts(prev => [{ id: docRef.id, ...attemptData, timestamp: new Date() }, ...prev]);

        // Process mistakes
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          const userAns = selectedAnswers[i];
          if (userAns !== q.correct_index) {
            const mistakeItem: MistakeItem = {
              userId: user.uid,
              question_text: q.question,
              options: q.options,
              correct_answer: q.correct_index,
              user_answer: userAns !== undefined ? userAns : -1,
              explanation: q.explanation,
              paper: q.paper,
              unit: q.unit,
              mastered: false,
              practice_count: 0,
              correct_streak: 0,
              timestamp: serverTimestamp()
            };
            const mRef = await addDoc(collection(db, 'mistake_bank'), mistakeItem);
            setMistakes(prev => [{ id: mRef.id, ...mistakeItem, timestamp: new Date() }, ...prev]);
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'quiz_attempts / mistake_bank');
      }
    }

    setQuizState('review');
  };

  // Readiness Calculations
  const readinessMetrics = useMemo(() => {
    if (attempts.length === 0) {
      return { status: 'Not Ready Yet', color: 'red', avgPercentage: 0 };
    }
    const last10 = attempts.slice(0, 10);
    const totalPercentage = last10.reduce((acc, curr) => acc + curr.percentage, 0);
    const avgPercentage = Math.round(totalPercentage / last10.length);

    let status = 'Not Ready Yet';
    let color = 'red';
    if (avgPercentage >= 60) {
      status = 'Ready to Appear';
      color = 'green';
    } else if (avgPercentage >= 50) {
      status = 'Borderline - Revise Weak Units';
      color = 'yellow';
    }
    return { status, color, avgPercentage };
  }, [attempts]);

  // Weakest Units Detector
  const weakestUnits = useMemo(() => {
    const unitStats: Record<string, { correct: number; total: number }> = {};
    attempts.forEach(att => {
      if (att.topic_breakdown) {
        Object.entries(att.topic_breakdown).forEach(([unit, stats]) => {
          if (!unitStats[unit]) unitStats[unit] = { correct: 0, total: 0 };
          unitStats[unit].correct += stats.correct;
          unitStats[unit].total += stats.total;
        });
      }
    });

    const calculated = Object.entries(unitStats).map(([unit, stats]) => ({
      unit,
      accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
      total: stats.total
    }));

    calculated.sort((a, b) => a.accuracy - b.accuracy);
    return calculated.slice(0, 3);
  }, [attempts]);

  // Handle Mistake Practice Answer
  const handleMistakeAnswer = async (selectedOpt: number) => {
    setMistakeAnswer(selectedOpt);
    const currentMistake = activeMistakes[mistakeIndex];
    const isCorrect = selectedOpt === currentMistake.correct_answer;
    setMistakeFeedback(isCorrect);

    if (user && currentMistake.id) {
      const newStreak = (currentMistake.correct_streak || 0) + (isCorrect ? 1 : 0);
      const isMastered = newStreak >= 2;

      try {
        const docRef = doc(db, 'mistake_bank', currentMistake.id);
        await updateDoc(docRef, {
          correct_streak: newStreak,
          mastered: isMastered,
          practice_count: (currentMistake.practice_count || 0) + 1
        });

        setMistakes(prev => prev.map(m => m.id === currentMistake.id ? {
          ...m,
          correct_streak: newStreak,
          mastered: isMastered,
          practice_count: (m.practice_count || 0) + 1
        } : m));
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'mistake_bank');
      }
    }
  };

  const activeMistakes = mistakes.filter(m => !m.mastered);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased selection:bg-emerald-500 selection:text-white">
      
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('home')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-900/30">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold bg-gradient-to-r from-white via-slate-200 to-emerald-400 bg-clip-text text-transparent">
                PET-10 Mechanical Prep
              </h1>
              <p className="text-xs text-slate-400 hidden sm:block">Solapur University Ph.D. Entrance</p>
            </div>
          </div>

          {/* Desktop Nav Tabs */}
          <nav className="hidden md:flex items-center space-x-1">
            <button
              onClick={() => setActiveTab('home')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'home' ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('analytics')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'analytics' ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              Exam Readiness
            </button>
            <button
              onClick={() => setActiveTab('mistakes')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center space-x-1.5 ${activeTab === 'mistakes' ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              <span>Mistake Bank</span>
              {activeMistakes.length > 0 && (
                <span className="px-1.5 py-0.5 text-xs rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 font-bold">
                  {activeMistakes.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('syllabus')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'syllabus' ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              Syllabus & PYQs
            </button>
          </nav>

          {/* Auth & Mobile Menu Toggle */}
          <div className="flex items-center space-x-3">
            {user ? (
              <div className="flex items-center space-x-3">
                <div className="hidden sm:flex items-center space-x-2 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName || 'User'} className="w-6 h-6 rounded-full" />
                  ) : (
                    <User className="w-4 h-4 text-emerald-400" />
                  )}
                  <span className="text-xs font-medium text-slate-200">{user.displayName || user.email}</span>
                </div>
                <button
                  onClick={handleLogout}
                  title="Sign Out"
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={handleGoogleLogin}
                className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-sm shadow-lg shadow-emerald-900/30 transition-all transform hover:scale-[1.02]"
              >
                <LogIn className="w-4 h-4" />
                <span>Google Sign-In</span>
              </button>
            )}

            <button
              onClick={() => { setTempKeyInput(userApiKey); setSettingsOpen(true); }}
              title="Gemini API Key Settings"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors relative"
            >
              <Settings className="w-4 h-4" />
              {!userApiKey && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
              )}
            </button>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-slate-900 border-b border-slate-800 px-4 pt-2 pb-4 space-y-1">
            <button
              onClick={() => { setActiveTab('home'); setMobileMenuOpen(false); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${activeTab === 'home' ? 'bg-emerald-600/20 text-emerald-400' : 'text-slate-300'}`}
            >
              Dashboard
            </button>
            <button
              onClick={() => { setActiveTab('analytics'); setMobileMenuOpen(false); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${activeTab === 'analytics' ? 'bg-emerald-600/20 text-emerald-400' : 'text-slate-300'}`}
            >
              Exam Readiness
            </button>
            <button
              onClick={() => { setActiveTab('mistakes'); setMobileMenuOpen(false); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium flex justify-between items-center ${activeTab === 'mistakes' ? 'bg-emerald-600/20 text-emerald-400' : 'text-slate-300'}`}
            >
              <span>Mistake Bank</span>
              {activeMistakes.length > 0 && (
                <span className="px-1.5 py-0.5 text-xs rounded-full bg-rose-500/20 text-rose-400 font-bold">
                  {activeMistakes.length}
                </span>
              )}
            </button>
            <button
              onClick={() => { setActiveTab('syllabus'); setMobileMenuOpen(false); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${activeTab === 'syllabus' ? 'bg-emerald-600/20 text-emerald-400' : 'text-slate-300'}`}
            >
              Syllabus & PYQs
            </button>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* ================= HOME / DASHBOARD TAB ================= */}
        {activeTab === 'home' && (
          <div className="space-y-8">
            {/* Hero Banner */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-900/40 via-slate-900 to-teal-950 border border-emerald-500/20 p-6 sm:p-10 shadow-2xl">
              <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
              <div className="relative z-10 max-w-2xl space-y-4">
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>PAHSU Solapur University • PET-10</span>
                </div>
                <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
                  Ph.D. Entrance Exam Prep <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">Mechanical</span>
                </h1>
                <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
                  Master Paper-1 (Research Methodology) and Paper-2 (Mechanical Engineering) with AI-powered mock tests, structured analytics, and automated mistake banking.
                </p>
                <div className="pt-2 flex flex-wrap gap-4">
                  <button
                    onClick={startQuiz}
                    disabled={quizState === 'loading'}
                    className="flex items-center space-x-3 px-6 py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-base shadow-lg shadow-emerald-600/30 transition-all transform hover:scale-[1.02] disabled:opacity-50"
                  >
                    {quizState === 'loading' ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Generating AI Exam...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-5 h-5 fill-current" />
                        <span>Start 20-Question PET-10 Quiz</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveTab('analytics')}
                    className="flex items-center space-x-2 px-5 py-3.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700 font-medium text-sm transition-all"
                  >
                    <BarChart3 className="w-4 h-4 text-emerald-400" />
                    <span>View Readiness Dashboard</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="bg-slate-900/60 backdrop-blur-sm border border-slate-800 rounded-2xl p-5 flex items-center space-x-4">
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Award className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Readiness Status</p>
                  <p className={`text-lg font-bold ${readinessMetrics.color === 'green' ? 'text-emerald-400' : readinessMetrics.color === 'yellow' ? 'text-amber-400' : 'text-rose-400'}`}>
                    {readinessMetrics.status}
                  </p>
                </div>
              </div>

              <div className="bg-slate-900/60 backdrop-blur-sm border border-slate-800 rounded-2xl p-5 flex items-center space-x-4">
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Rolling Avg (Last 10)</p>
                  <p className="text-2xl font-bold text-white">{readinessMetrics.avgPercentage}%</p>
                </div>
              </div>

              <div className="bg-slate-900/60 backdrop-blur-sm border border-slate-800 rounded-2xl p-5 flex items-center space-x-4 cursor-pointer hover:border-slate-700 transition-colors" onClick={() => setActiveTab('mistakes')}>
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Active Mistake Bank</p>
                  <p className="text-2xl font-bold text-white">{activeMistakes.length} items</p>
                </div>
              </div>
            </div>

            {/* Exam Structure & Rules Card */}
            <div className="bg-slate-900/60 backdrop-blur-sm border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
              <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <span>PET-10 Exam Blueprint & Guidelines</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 space-y-1">
                  <p className="text-xs text-slate-400">Total Questions</p>
                  <p className="text-xl font-bold text-emerald-400">20 Questions</p>
                  <p className="text-xs text-slate-400">10 Paper 1 + 10 Paper 2</p>
                </div>
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 space-y-1">
                  <p className="text-xs text-slate-400">Marking Scheme</p>
                  <p className="text-xl font-bold text-emerald-400">1 Mark / Correct</p>
                  <p className="text-xs text-slate-400">Zero Negative Marking</p>
                </div>
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 space-y-1">
                  <p className="text-xs text-slate-400">Qualifying Cutoff</p>
                  <p className="text-xl font-bold text-amber-400">50% Minimum</p>
                  <p className="text-xs text-slate-400">Passing threshold</p>
                </div>
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 space-y-1">
                  <p className="text-xs text-slate-400">Time Limit</p>
                  <p className="text-xl font-bold text-teal-400">30 Minutes</p>
                  <p className="text-xs text-slate-400">Timed exam environment</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= ACTIVE QUIZ ENGINE TAB ================= */}
        {activeTab === 'home' && quizState === 'loading' && (
          <div className="py-20 flex flex-col items-center justify-center space-y-4">
            <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-slate-300 font-medium">Generating AI PET-10 Exam based on PAHSU syllabus & PYQs...</p>
          </div>
        )}

        {quizState === 'active' && questions.length > 0 && (
          <div className="space-y-6 max-w-4xl mx-auto">
            {/* Top Bar with Timer & Progress */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center space-x-3">
                <span className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30">
                  {questions[currentIndex].paper}
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  {questions[currentIndex].unit}
                </span>
              </div>
              <div className="flex items-center space-x-4">
                <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border ${timeLeft < 300 ? 'bg-rose-500/20 border-rose-500/40 text-rose-400 animate-pulse' : 'bg-slate-800 border-slate-700 text-slate-200'}`}>
                  <Clock className="w-4 h-4" />
                  <span className="font-mono font-bold text-sm">
                    {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
                  </span>
                </div>
                <button
                  onClick={submitQuiz}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-900/30 transition-all"
                >
                  Submit Exam
                </button>
              </div>
            </div>

            {/* Question Card */}
            <div className="bg-slate-900/80 backdrop-blur-sm border border-slate-800 p-6 sm:p-8 rounded-2xl space-y-6 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <h3 className="text-lg sm:text-xl font-semibold text-white leading-relaxed">
                  <span className="text-emerald-400 font-mono mr-2">Q.{currentIndex + 1}</span>
                  {questions[currentIndex].question}
                </h3>
                <button
                  onClick={() => toggleMarkForReview(currentIndex)}
                  className={`p-2 rounded-xl border transition-colors ${markedForReview[currentIndex] ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
                  title="Mark for Review"
                >
                  <Bookmark className="w-5 h-5" />
                </button>
              </div>

              {/* Options */}
              <div className="space-y-3">
                {questions[currentIndex].options.map((opt, oIdx) => {
                  const isSelected = selectedAnswers[currentIndex] === oIdx;
                  return (
                    <button
                      key={oIdx}
                      onClick={() => handleSelectOption(currentIndex, oIdx)}
                      className={`w-full text-left p-4 rounded-xl border transition-all flex items-center space-x-3 ${isSelected ? 'bg-emerald-600/20 border-emerald-500 text-white shadow-lg shadow-emerald-900/20' : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:border-slate-600'}`}
                    >
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${isSelected ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
                        {String.fromCharCode(65 + oIdx)}
                      </span>
                      <span className="flex-1 text-sm sm:text-base">{opt}</span>
                    </button>
                  );
                })}
              </div>

              {/* Navigation Controls */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                <button
                  onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentIndex === 0}
                  className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed font-medium text-sm"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Previous</span>
                </button>
                <span className="text-xs text-slate-400 font-medium">
                  Question {currentIndex + 1} of {questions.length}
                </span>
                {currentIndex < questions.length - 1 ? (
                  <button
                    onClick={() => setCurrentIndex(prev => Math.min(questions.length - 1, prev + 1))}
                    className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm"
                  >
                    <span>Next</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={submitQuiz}
                    className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 text-white font-bold text-sm shadow-lg shadow-emerald-900/30"
                  >
                    <span>Finish & Submit</span>
                    <Check className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Question Palette / Map */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Question Palette</p>
              <div className="grid grid-cols-10 gap-2">
                {questions.map((_, idx) => {
                  const answered = selectedAnswers[idx] !== undefined;
                  const marked = markedForReview[idx];
                  const current = currentIndex === idx;
                  let bgClass = 'bg-slate-800 text-slate-300 border-slate-700';
                  if (answered) bgClass = 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50';
                  if (marked) bgClass = 'bg-amber-500/30 text-amber-300 border-amber-500/50';
                  if (current) bgClass += ' ring-2 ring-emerald-400';

                  return (
                    <button
                      key={idx}
                      onClick={() => setCurrentIndex(idx)}
                      className={`h-9 rounded-lg border font-mono text-xs font-bold transition-all flex items-center justify-center ${bgClass}`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ================= REVIEW / RESULTS TAB ================= */}
        {quizState === 'review' && lastResult && (
          <div className="space-y-8 max-w-4xl mx-auto">
            {/* Score Summary Card */}
            <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 border border-emerald-500/30 p-6 sm:p-10 rounded-2xl text-center space-y-6 shadow-2xl">
              <div className="inline-flex p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400">
                <Award className="w-10 h-10" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-white">Exam Submitted Successfully!</h2>
                <p className="text-slate-400 text-sm">Punyashlok Ahilyadevi Holkar Solapur University — PET-10</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl mx-auto pt-2">
                <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700">
                  <p className="text-xs text-slate-400">Total Score</p>
                  <p className="text-2xl font-bold text-white">{lastResult.score} / {lastResult.total_marks}</p>
                </div>
                <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700">
                  <p className="text-xs text-slate-400">Percentage</p>
                  <p className={`text-2xl font-bold ${lastResult.percentage >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {lastResult.percentage}%
                  </p>
                </div>
                <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700">
                  <p className="text-xs text-slate-400">Paper-1 (Research)</p>
                  <p className="text-2xl font-bold text-teal-400">{lastResult.paper1_score} / 10</p>
                </div>
                <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700">
                  <p className="text-xs text-slate-400">Paper-2 (Mech)</p>
                  <p className="text-2xl font-bold text-blue-400">{lastResult.paper2_score} / 10</p>
                </div>
              </div>

              <div className="flex justify-center space-x-4 pt-4">
                <button
                  onClick={() => { setQuizState('idle'); setActiveTab('analytics'); }}
                  className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/30"
                >
                  View Full Analytics
                </button>
                <button
                  onClick={() => { setQuizState('idle'); startQuiz(); }}
                  className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-sm"
                >
                  Take Another Quiz
                </button>
              </div>
            </div>

            {/* Detailed Question Review */}
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white">Detailed Answer Explanations</h3>
              {questions.map((q, idx) => {
                const userAns = selectedAnswers[idx];
                const isCorrect = userAns === q.correct_index;

                return (
                  <div key={idx} className={`bg-slate-900 border rounded-2xl p-6 space-y-4 ${isCorrect ? 'border-emerald-500/30' : 'border-rose-500/30'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center space-x-3">
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${isCorrect ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'}`}>
                          {isCorrect ? <Check className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                        </span>
                        <span className="text-xs font-bold text-slate-400">Question {idx + 1} ({q.paper})</span>
                      </div>
                      <span className="text-xs text-slate-400 font-medium">{q.unit}</span>
                    </div>

                    <p className="text-base font-semibold text-white">{q.question}</p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {q.options.map((opt, oIdx) => {
                        let badgeClass = 'bg-slate-800/60 border-slate-700 text-slate-300';
                        if (oIdx === q.correct_index) badgeClass = 'bg-emerald-600/20 border-emerald-500 text-emerald-300 font-bold';
                        else if (oIdx === userAns && !isCorrect) badgeClass = 'bg-rose-600/20 border-rose-500 text-rose-300 font-bold';

                        return (
                          <div key={oIdx} className={`p-3 rounded-xl border text-sm flex items-center space-x-3 ${badgeClass}`}>
                            <span className="w-6 h-6 rounded bg-slate-700 text-white flex items-center justify-center text-xs font-bold">
                              {String.fromCharCode(65 + oIdx)}
                            </span>
                            <span>{opt}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="bg-slate-800/40 border border-slate-700/60 p-4 rounded-xl text-sm text-slate-300 space-y-1">
                      <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Explanation</p>
                      <p>{q.explanation}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= EXAM READINESS DASHBOARD TAB ================= */}
        {activeTab === 'analytics' && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white">Exam Readiness Dashboard</h2>
                <p className="text-sm text-slate-400">Punyashlok Ahilyadevi Holkar Solapur University PET-10 Analytics</p>
              </div>
              <button
                onClick={startQuiz}
                className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/30"
              >
                <Play className="w-4 h-4" />
                <span>Take Practice Quiz</span>
              </button>
            </div>

            {/* Readiness Status Banner */}
            <div className={`p-6 sm:p-8 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-6 ${readinessMetrics.color === 'green' ? 'bg-emerald-950/40 border-emerald-500/40' : readinessMetrics.color === 'yellow' ? 'bg-amber-950/40 border-amber-500/40' : 'bg-rose-950/40 border-rose-500/40'}`}>
              <div className="flex items-center space-x-4">
                <div className={`p-4 rounded-2xl ${readinessMetrics.color === 'green' ? 'bg-emerald-500/20 text-emerald-400' : readinessMetrics.color === 'yellow' ? 'bg-amber-500/20 text-amber-400' : 'bg-rose-500/20 text-rose-400'}`}>
                  {readinessMetrics.color === 'green' ? <Award className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">Readiness Status</p>
                  <h3 className={`text-2xl sm:text-3xl font-extrabold ${readinessMetrics.color === 'green' ? 'text-emerald-400' : readinessMetrics.color === 'yellow' ? 'text-amber-400' : 'text-rose-400'}`}>
                    {readinessMetrics.status}
                  </h3>
                  <p className="text-xs text-slate-300">
                    Based on rolling average of last 10 quiz attempts (Qualifying Cutoff: 50%)
                  </p>
                </div>
              </div>
              <div className="text-center sm:text-right bg-slate-900/60 p-4 rounded-xl border border-slate-800">
                <p className="text-xs text-slate-400 font-medium">Rolling Average Score</p>
                <p className="text-3xl font-black text-white">{readinessMetrics.avgPercentage}%</p>
              </div>
            </div>

            {/* Score Trend Line Chart / History */}
            <div className="bg-slate-900 border border-slate-800 p-6 sm:p-8 rounded-2xl space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                  <span>Historical Score Trend (Last 10 Attempts)</span>
                </h3>
                <span className="text-xs text-slate-400 font-medium">— 50% Qualifying Threshold</span>
              </div>

              {attempts.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>No quiz attempts recorded yet. Start your first quiz to populate analytics!</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Visual Trend Bar representation */}
                  <div className="h-48 flex items-end space-x-3 pt-6 pb-2 px-2 bg-slate-950/60 rounded-xl border border-slate-800/80 overflow-x-auto relative">
                    {/* Dashed Red Line at 50% */}
                    <div className="absolute left-0 right-0 top-1/2 border-b border-dashed border-rose-500/60 z-0 flex items-center justify-end px-2">
                      <span className="text-[10px] text-rose-400 font-bold bg-slate-900 px-1 rounded">50% Cutoff</span>
                    </div>

                    {attempts.slice(0, 10).reverse().map((att, idx) => (
                      <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end z-10 group relative">
                        <div 
                          style={{ height: `${Math.max(10, att.percentage)}%` }}
                          className={`w-full max-w-[36px] rounded-t-lg transition-all ${att.percentage >= 50 ? 'bg-gradient-to-t from-emerald-600 to-teal-400' : 'bg-gradient-to-t from-rose-600 to-amber-500'}`}
                        ></div>
                        <span className="text-[10px] text-slate-400 mt-2 font-mono">{att.percentage}%</span>
                      </div>
                    ))}
                  </div>

                  {/* Attempts Table */}
                  <div className="overflow-x-auto pt-2">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase">
                          <th className="pb-3 font-semibold">Attempt</th>
                          <th className="pb-3 font-semibold">Score</th>
                          <th className="pb-3 font-semibold">Percentage</th>
                          <th className="pb-3 font-semibold">Paper 1</th>
                          <th className="pb-3 font-semibold">Paper 2</th>
                          <th className="pb-3 font-semibold">Time Taken</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 text-slate-300">
                        {attempts.slice(0, 5).map((att, i) => (
                          <tr key={i} className="hover:bg-slate-800/30">
                            <td className="py-3 font-mono font-bold text-emerald-400">#{attempts.length - i}</td>
                            <td className="py-3 font-bold">{att.score} / {att.total_marks}</td>
                            <td className="py-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${att.percentage >= 50 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                {att.percentage}%
                              </span>
                            </td>
                            <td className="py-3">{att.paper1_score} / 10</td>
                            <td className="py-3">{att.paper2_score} / 10</td>
                            <td className="py-3 font-mono text-xs">{Math.floor(att.time_taken_seconds / 60)}m {att.time_taken_seconds % 60}s</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Weakest Units Detector */}
            <div className="bg-slate-900 border border-slate-800 p-6 sm:p-8 rounded-2xl space-y-6">
              <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                <Target className="w-5 h-5 text-rose-400" />
                <span>Automated Weakest Units Detector (Bottom 3 Units)</span>
              </h3>
              {weakestUnits.length === 0 ? (
                <p className="text-slate-500 text-sm">Complete a few quizzes to generate accurate topic weakness insights.</p>
              ) : (
                <div className="space-y-4">
                  {weakestUnits.map((w, idx) => (
                    <div key={idx} className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-rose-400 uppercase tracking-wider">Priority #{idx + 1} Revision</span>
                        <h4 className="font-semibold text-white">{w.unit}</h4>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="text-right">
                          <p className="text-xs text-slate-400">Accuracy</p>
                          <p className="text-lg font-bold text-rose-400">{w.accuracy}%</p>
                        </div>
                        <button
                          onClick={() => setActiveTab('mistakes')}
                          className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold"
                        >
                          Review Mistakes
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= MISTAKE BANK TAB ================= */}
        {activeTab === 'mistakes' && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white">Mistake Bank & Re-practice</h2>
                <p className="text-sm text-slate-400">Automatically captures incorrect answers. Master them by answering correctly twice in a row!</p>
              </div>
              {activeMistakes.length > 0 && !practicingMistakes && (
                <button
                  onClick={() => { setPracticingMistakes(true); setMistakeIndex(0); setMistakeAnswer(null); setMistakeFeedback(null); }}
                  className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 text-white font-bold text-sm shadow-lg shadow-emerald-900/30"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Start Re-Practice Session ({activeMistakes.length})</span>
                </button>
              )}
            </div>

            {/* Re-Practice Mode Overlay / View */}
            {practicingMistakes && activeMistakes.length > 0 ? (
              <div className="bg-slate-900 border border-emerald-500/40 p-6 sm:p-8 rounded-2xl space-y-6 shadow-2xl">
                <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                  <div className="flex items-center space-x-3">
                    <span className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30">
                      Re-Practice Mode
                    </span>
                    <span className="text-xs text-slate-400">
                      Mistake {mistakeIndex + 1} of {activeMistakes.length}
                    </span>
                  </div>
                  <button
                    onClick={() => setPracticingMistakes(false)}
                    className="text-xs font-bold text-slate-400 hover:text-white"
                  >
                    Exit Practice
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center space-x-2 text-xs text-slate-400 font-semibold">
                    <span>{activeMistakes[mistakeIndex].paper}</span>
                    <span>•</span>
                    <span>{activeMistakes[mistakeIndex].unit}</span>
                    <span className="ml-auto bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded">
                      Current Streak: {activeMistakes[mistakeIndex].correct_streak || 0} / 2
                    </span>
                  </div>

                  <h3 className="text-lg sm:text-xl font-semibold text-white">
                    {activeMistakes[mistakeIndex].question_text}
                  </h3>

                  <div className="space-y-3 pt-2">
                    {activeMistakes[mistakeIndex].options.map((opt, oIdx) => {
                      const isSelected = mistakeAnswer === oIdx;
                      const isCorrectOpt = oIdx === activeMistakes[mistakeIndex].correct_answer;
                      let btnStyle = 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800';

                      if (mistakeAnswer !== null) {
                        if (isCorrectOpt) btnStyle = 'bg-emerald-600/30 border-emerald-500 text-emerald-200 font-bold';
                        else if (isSelected && !isCorrectOpt) btnStyle = 'bg-rose-600/30 border-rose-500 text-rose-200 font-bold';
                      }

                      return (
                        <button
                          key={oIdx}
                          disabled={mistakeAnswer !== null}
                          onClick={() => handleMistakeAnswer(oIdx)}
                          className={`w-full text-left p-4 rounded-xl border transition-all flex items-center space-x-3 ${btnStyle}`}
                        >
                          <span className="w-8 h-8 rounded-lg bg-slate-700 text-white flex items-center justify-center text-xs font-bold">
                            {String.fromCharCode(65 + oIdx)}
                          </span>
                          <span className="flex-1 text-sm sm:text-base">{opt}</span>
                        </button>
                      );
                    })}
                  </div>

                  {mistakeAnswer !== null && (
                    <div className={`p-4 rounded-xl border space-y-2 ${mistakeFeedback ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200' : 'bg-rose-950/40 border-rose-500/40 text-rose-200'}`}>
                      <p className="font-bold text-sm">
                        {mistakeFeedback ? 'Correct! Streak increased (+1)' : 'Incorrect. Review explanation below.'}
                      </p>
                      <p className="text-xs text-slate-300">{activeMistakes[mistakeIndex].explanation}</p>
                      
                      <button
                        onClick={() => {
                          if (mistakeIndex < activeMistakes.length - 1) {
                            setMistakeIndex(prev => prev + 1);
                            setMistakeAnswer(null);
                            setMistakeFeedback(null);
                          } else {
                            setPracticingMistakes(false);
                          }
                        }}
                        className="mt-3 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
                      >
                        {mistakeIndex < activeMistakes.length - 1 ? 'Next Mistake' : 'Finish Practice'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {mistakes.length === 0 ? (
                  <div className="bg-slate-900 border border-slate-800 p-12 rounded-2xl text-center space-y-4">
                    <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
                    <h3 className="text-lg font-bold text-white">No mistakes recorded yet!</h3>
                    <p className="text-sm text-slate-400">Incorrect answers from your quizzes will automatically appear here for targeted re-practice.</p>
                    <button
                      onClick={loadSampleMistake}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/30 transition-all"
                    >
                      Load Sample Mistake for Testing
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {mistakes.map((m, idx) => (
                      <div key={idx} className={`bg-slate-900 border p-6 rounded-2xl space-y-4 ${m.mastered ? 'border-emerald-500/30 opacity-75' : 'border-slate-800'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 text-xs font-bold">
                              {m.paper}
                            </span>
                            <span className="text-xs text-slate-400">{m.unit}</span>
                          </div>
                          {m.mastered ? (
                            <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30 flex items-center space-x-1">
                              <Check className="w-3 h-3" />
                              <span>Mastered</span>
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-400 text-xs font-bold border border-rose-500/30">
                              Active Mistake (Streak: {m.correct_streak || 0}/2)
                            </span>
                          )}
                        </div>

                        <h4 className="font-semibold text-white">{m.question_text}</h4>

                        <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-700/60 text-sm space-y-1">
                          <p className="text-xs font-bold text-emerald-400 uppercase">Explanation</p>
                          <p className="text-slate-300">{m.explanation}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= SYLLABUS & PYQ LIBRARY TAB ================= */}
        {activeTab === 'syllabus' && (
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-white">Syllabus & Official PYQ Library</h2>
              <p className="text-sm text-slate-400">Punyashlok Ahilyadevi Holkar Solapur University Ph.D. Entrance Test (PET-10)</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Paper 1 Syllabus Card */}
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="p-3 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-lg">Paper-I: Research Methodology</h3>
                    <p className="text-xs text-slate-400">10 Units • Common for All Engineering Disciplines</p>
                  </div>
                </div>
                <ul className="space-y-2 text-sm text-slate-300 pt-2">
                  <li className="flex items-center space-x-2"><ChevronRight className="w-4 h-4 text-teal-400" /><span>Unit 1: Fundamentals of Research & Citations</span></li>
                  <li className="flex items-center space-x-2"><ChevronRight className="w-4 h-4 text-teal-400" /><span>Unit 2: Defining the Research Problem</span></li>
                  <li className="flex items-center space-x-2"><ChevronRight className="w-4 h-4 text-teal-400" /><span>Unit 3: Literature Survey and Documentation</span></li>
                  <li className="flex items-center space-x-2"><ChevronRight className="w-4 h-4 text-teal-400" /><span>Unit 4: Current Trends in Research</span></li>
                  <li className="flex items-center space-x-2"><ChevronRight className="w-4 h-4 text-teal-400" /><span>Unit 5: Research Proposal and Design</span></li>
                  <li className="flex items-center space-x-2"><ChevronRight className="w-4 h-4 text-teal-400" /><span>Unit 6: Data Collection, Processing and Analysis</span></li>
                  <li className="flex items-center space-x-2"><ChevronRight className="w-4 h-4 text-teal-400" /><span>Unit 7: Hypothesis Testing & Parametric/Non-Parametric</span></li>
                  <li className="flex items-center space-x-2"><ChevronRight className="w-4 h-4 text-teal-400" /><span>Unit 8: Research Ethics, Plagiarism & UGC Rules</span></li>
                  <li className="flex items-center space-x-2"><ChevronRight className="w-4 h-4 text-teal-400" /><span>Unit 9: Application of ICT in Research</span></li>
                  <li className="flex items-center space-x-2"><ChevronRight className="w-4 h-4 text-teal-400" /><span>Unit 10: Funding Agencies (DST, DBT, AICTE, CSIR, DRDO)</span></li>
                </ul>
              </div>

              {/* Paper 2 Syllabus Card */}
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-lg">Paper-II: Mechanical Engineering</h3>
                    <p className="text-xs text-slate-400">3 Core Sections • PET 35</p>
                  </div>
                </div>
                <ul className="space-y-3 text-sm text-slate-300 pt-2">
                  <li className="flex items-start space-x-2">
                    <ChevronRight className="w-4 h-4 text-blue-400 mt-0.5" />
                    <div>
                      <strong className="text-white">Unit 1: Applied Mechanics & Design</strong>
                      <p className="text-xs text-slate-400">Engineering Mechanics, Mechanics of Materials, Theory of Machines, Vibrations, Machine Design.</p>
                    </div>
                  </li>
                  <li className="flex items-start space-x-2">
                    <ChevronRight className="w-4 h-4 text-blue-400 mt-0.5" />
                    <div>
                      <strong className="text-white">Unit 2: Fluid Mechanics & Thermal Sciences</strong>
                      <p className="text-xs text-slate-400">Fluid Mechanics, Heat Transfer, Thermodynamics, Power Engineering, IC Engines, Refrigeration, Turbomachinery.</p>
                    </div>
                  </li>
                  <li className="flex items-start space-x-2">
                    <ChevronRight className="w-4 h-4 text-blue-400 mt-0.5" />
                    <div>
                      <strong className="text-white">Unit 3: Materials, Manufacturing & Industrial Engineering</strong>
                      <p className="text-xs text-slate-400">Engineering Materials, Casting, Forming, Joining, Machining, Metrology, CIM, Production Planning, OR.</p>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* Settings Modal for Gemini API Key */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl relative animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Gemini API Key Settings</h3>
                  <p className="text-xs text-slate-400">Enable on-the-fly AI question generation</p>
                </div>
              </div>
              <button 
                onClick={() => setSettingsOpen(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                Enter your personal Gemini API key below to enable real-time, on-the-fly AI question generation. Your key is stored securely in your browser's local storage.
              </p>

              {/* Step-by-step guide to get API key */}
              <div className="bg-slate-800/60 border border-slate-700/80 p-3.5 rounded-xl space-y-2 text-xs text-slate-300">
                <p className="font-bold text-emerald-400 flex items-center justify-between">
                  <span>How to get a free Gemini API Key:</span>
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-teal-400 underline hover:text-teal-300"
                  >
                    Get Key &rarr;
                  </a>
                </p>
                <ol className="list-decimal list-inside space-y-1 text-slate-300 text-[11px]">
                  <li>Go to <span className="text-white">Google AI Studio</span> (link above).</li>
                  <li>Sign in with your Google account.</li>
                  <li>Click <strong className="text-white">"Create API key"</strong>.</li>
                  <li>Copy and paste your key into the field below.</li>
                </ol>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Gemini API Key</label>
                <input
                  type="password"
                  value={tempKeyInput}
                  onChange={(e) => setTempKeyInput(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-2 border-t border-slate-800">
              <button
                onClick={() => setSettingsOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs"
              >
                Cancel
              </button>
              <button
                onClick={saveApiKey}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-900/30"
              >
                Save & Use AI Generation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        <p>Punyashlok Ahilyadevi Holkar Solapur University — Ph.D. Entrance Test (PET-10) Preparation Suite</p>
      </footer>
    </div>
  );
}

function getRandomDiverseQuestions(): Question[] {
  const paper1Pool: Question[] = [
    {
      id: 'p1_1',
      paper: 'Paper 1',
      unit: 'Unit 1: Fundamentals of Research',
      question: 'Which of the following best defines the h-index of a researcher?',
      options: [
        'Total number of citations received across all publications',
        'Maximum number h such that h publications have at least h citations each',
        'The impact factor of the journal where the researcher published most frequently',
        'Total number of co-authored papers in Scopus indexed journals'
      ],
      correct_index: 1,
      explanation: 'The h-index measures both productivity and citation impact by quantifying the number of publications that have received at least h citations.'
    },
    {
      id: 'p1_2',
      paper: 'Paper 1',
      unit: 'Unit 3: Literature Survey and Documentation',
      question: 'What is the primary purpose of conducting a systematic literature review prior to defining a Ph.D. research problem?',
      options: [
        'To copy existing experimental setups without modification',
        'To identify research gaps, avoid duplication, and establish theoretical grounding',
        'To increase the word count of the thesis introduction chapter',
        'To collect primary quantitative data from respondents'
      ],
      correct_index: 1,
      explanation: 'A systematic literature survey identifies existing knowledge boundaries, highlights research gaps, and ensures academic novelty.'
    },
    {
      id: 'p1_3',
      paper: 'Paper 1',
      unit: 'Unit 7: Hypothesis',
      question: 'In hypothesis testing, a Type I error occurs when:',
      options: [
        'The null hypothesis is false and we fail to reject it',
        'The null hypothesis is true and we reject it',
        'The alternative hypothesis is accepted when false',
        'Sample size is inadequate to calculate p-value'
      ],
      correct_index: 1,
      explanation: 'A Type I error (false positive) occurs when a true null hypothesis is incorrectly rejected.'
    },
    {
      id: 'p1_4',
      paper: 'Paper 1',
      unit: 'Unit 6: Data Collection, Processing and Analysis',
      question: 'Quota sampling belongs to which category of sampling techniques?',
      options: [
        'Probability sampling',
        'Non-probability sampling',
        'Stratified random sampling',
        'Cluster random sampling'
      ],
      correct_index: 1,
      explanation: 'Quota sampling is a non-probability sampling method where researchers select samples based on specific quotas or characteristics.'
    },
    {
      id: 'p1_5',
      paper: 'Paper 1',
      unit: 'Unit 8: Research Ethics, Plagiarism and Impact',
      question: 'According to UGC plagiarism guidelines, similar text exceeding what percentage without proper attribution constitutes severe academic misconduct?',
      options: ['5%', '10%', '15%', 'Level 2/3 thresholds starting above 10-40%'],
      correct_index: 3,
      explanation: 'UGC regulations categorize plagiarism into distinct levels, with significant penalties applied when similarity exceeds permissible academic thresholds.'
    },
    {
      id: 'p1_6',
      paper: 'Paper 1',
      unit: 'Unit 10: Funding Agencies and Research Grants',
      question: 'Which Indian funding agency primarily promotes research in scientific and technological fields under the Ministry of Science and Technology?',
      options: ['ICSSR', 'DST', 'ICMR', 'UGC'],
      correct_index: 1,
      explanation: 'The Department of Science and Technology (DST) is the premier agency funding science and engineering research in India.'
    },
    {
      id: 'p1_7',
      paper: 'Paper 1',
      unit: 'Unit 5: Research Proposal and Design',
      question: 'An experimental research design is characterized by:',
      options: [
        'Purely observational data collection without intervention',
        'Manipulation of independent variables to observe effect on dependent variables',
        'Historical document analysis',
        'Cross-sectional survey questionnaires'
      ],
      correct_index: 1,
      explanation: 'Experimental designs involve active manipulation of independent variables under controlled conditions to establish cause-and-effect relationships.'
    },
    {
      id: 'p1_8',
      paper: 'Paper 1',
      unit: 'Unit 9: Application of ICT in Research',
      question: 'Which of the following software tools is commonly used for reference management and automated bibliography generation?',
      options: ['MATLAB', 'Zotero', 'ANSYS', 'SolidWorks'],
      correct_index: 1,
      explanation: 'Zotero (along with Mendeley and EndNote) is a popular reference management tool used by researchers for citations and bibliographies.'
    },
    {
      id: 'p1_9',
      paper: 'Paper 1',
      unit: 'Unit 2: Defining the Research Problem',
      question: 'A well-defined research problem must possess which key characteristic?',
      options: [
        'Feasibility, clarity, and empirical testability',
        'Vagueness to allow multiple interpretations',
        'Immediate commercial profitability',
        'Exclusively qualitative methodology'
      ],
      correct_index: 0,
      explanation: 'Good research problems must be clearly formulated, empirically testable, and feasible within available time and resources.'
    },
    {
      id: 'p1_10',
      paper: 'Paper 1',
      unit: 'Unit 4: Current Trends in Research',
      question: 'What is the significance of the Academia-Industry-Research relationship?',
      options: [
        'Isolating academic research from practical commercial applications',
        'Translating theoretical innovations into patentable industrial products and societal solutions',
        'Eliminating peer review in favor of corporate funding',
        'Restricting research output to internal university memos'
      ],
      correct_index: 1,
      explanation: 'Academia-industry collaboration bridges theoretical developments with practical applications, fostering patents and societal impact.'
    }
  ];

  const paper2Pool: Question[] = [
    {
      id: 'p2_1',
      paper: 'Paper 2',
      unit: 'Unit 1: Applied Mechanics and Design',
      question: 'Stress concentration in a machine component of ductile material is less harmful than in brittle material because:',
      options: [
        'Ductile material has larger Young modulus',
        'Local yielding at high stress points redistributes stress concentration',
        'Poisson ratio is zero in ductile metals',
        'Ductile materials cannot fracture under fatigue'
      ],
      correct_index: 1,
      explanation: 'Ductile materials undergo local plastic deformation (yielding) at stress raisers, redistributing peak stresses and preventing sudden catastrophic failure.'
    },
    {
      id: 'p2_2',
      paper: 'Paper 2',
      unit: 'Unit 2: Fluid Mechanics and Thermal Sciences',
      question: 'For a fluid flowing over a flat plate with Prandtl number greater than unity, the thermal boundary layer is:',
      options: [
        'Thinner than the hydrodynamic boundary layer',
        'Thicker than the hydrodynamic boundary layer',
        'Equal in thickness to the hydrodynamic boundary layer',
        'Zero throughout the flow field'
      ],
      correct_index: 0,
      explanation: 'When Pr > 1, momentum diffusion exceeds thermal diffusion, making the thermal boundary layer thinner than the hydrodynamic boundary layer.'
    },
    {
      id: 'p2_3',
      paper: 'Paper 2',
      unit: 'Unit 3: Materials, Manufacturing and Industrial Engineering',
      question: 'In metal casting, riser design is primarily intended to:',
      options: [
        'Increase cooling rate during pouring',
        'Provide molten metal to compensate for volumetric solidification shrinkage',
        'Prevent slag entry into the mould cavity',
        'Decrease pattern allowance'
      ],
      correct_index: 1,
      explanation: 'Risers act as molten metal reservoirs that feed the casting during solidification to offset volumetric shrinkage and prevent shrinkage cavities.'
    },
    {
      id: 'p2_4',
      paper: 'Paper 2',
      unit: 'Unit 2: Fluid Mechanics and Thermal Sciences',
      question: 'Biot number represents the ratio of:',
      options: [
        'Convective resistance at surface to internal conductive resistance',
        'Internal conductive resistance to external convective resistance',
        'Kinematic viscosity to thermal diffusivity',
        'Buoyant forces to viscous forces'
      ],
      correct_index: 1,
      explanation: 'The Biot number is defined as internal conduction resistance divided by external convection resistance (hLc / k).'
    },
    {
      id: 'p2_5',
      paper: 'Paper 2',
      unit: 'Unit 1: Applied Mechanics and Design',
      question: 'The number of degrees of freedom of a slider-crank mechanism in spatial motion is different from planar motion. For standard planar slider-crank, mobility (Grublers criterion) yields:',
      options: ['0', '1', '2', '3'],
      correct_index: 1,
      explanation: 'A standard planar slider-crank mechanism has 1 degree of freedom (controlled by the crank angle).'
    },
    {
      id: 'p2_6',
      paper: 'Paper 2',
      unit: 'Unit 3: Materials, Manufacturing and Industrial Engineering',
      question: 'In PERT (Program Evaluation and Review Technique), the time distribution of project activities is assumed to follow:',
      options: ['Normal distribution', 'Beta distribution', 'Poisson distribution', 'Exponential distribution'],
      correct_index: 1,
      explanation: 'PERT assumes activity completion times follow a Beta probability distribution with optimistic, most likely, and pessimistic estimates.'
    },
    {
      id: 'p2_7',
      paper: 'Paper 2',
      unit: 'Unit 2: Fluid Mechanics and Thermal Sciences',
      question: 'In a Rankine vapor power cycle, superheating the steam entering the turbine results in:',
      options: [
        'Decrease in cycle thermal efficiency',
        'Increase in turbine exit steam dryness fraction and thermal efficiency',
        'Decrease in net work output',
        'No change in moisture content at turbine exhaust'
      ],
      correct_index: 1,
      explanation: 'Superheating increases average heat addition temperature, raising cycle thermal efficiency and improving steam dryness at exhaust to reduce blade erosion.'
    },
    {
      id: 'p2_8',
      paper: 'Paper 2',
      unit: 'Unit 1: Applied Mechanics and Design',
      question: 'Tooth interference in external involute spur gears can be eliminated by:',
      options: [
        'Decreasing number of pinion teeth below critical limit',
        'Increasing the number of gear teeth or increasing pressure angle',
        'Increasing module arbitrarily',
        'Decreasing center distance'
      ],
      correct_index: 1,
      explanation: 'Interference is avoided by ensuring the pinion has at least the minimum required teeth or by adopting a larger pressure angle (e.g. 20 deg or 25 deg).'
    },
    {
      id: 'p2_9',
      paper: 'Paper 2',
      unit: 'Unit 3: Materials, Manufacturing and Industrial Engineering',
      question: 'Hot chamber die casting machines are generally unsuitable for casting which of the following metals?',
      options: ['Zinc alloys', 'Tin alloys', 'Aluminum alloys', 'Lead alloys'],
      correct_index: 2,
      explanation: 'Aluminum has a high melting point and dissolves iron from the gooseneck and plunger system in hot chamber machines; thus, cold chamber machines are used.'
    },
    {
      id: 'p2_10',
      paper: 'Paper 2',
      unit: 'Unit 2: Fluid Mechanics and Thermal Sciences',
      question: 'For fully developed turbulent flow in rough pipes, the friction factor depends upon:',
      options: [
        'Reynolds number only',
        'Relative roughness only',
        'Both Reynolds number and Mach number',
        'Froude number and Prandtl number'
      ],
      correct_index: 1,
      explanation: 'In the fully rough turbulent zone (Moody diagram), the friction factor is independent of Reynolds number and depends solely on relative roughness (epsilon / D).'
    }
  ];

  return [...paper1Pool, ...paper2Pool];
}
