import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  onSnapshot,
} from "firebase/firestore";
import {
  ArrowRight,
  Bot,
  User,
  FileText,
  BrainCircuit,
  Mic,
  Send,
  ChevronLeft,
  Link as LinkIcon,
  LogOut,
} from "lucide-react";

// --- Firebase Configuration ---
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
const auth = getAuth(app);
const db = getFirestore(app);

// --- Gemini API & Web Speech API ---
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const API_URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;

// Speech Recognition setup
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) {
  recognition.continuous = true;
  recognition.lang = "ko-KR";
  recognition.interimResults = true;
}

const fetchWithBackoff = async (url, options, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response.json();
      }
      if (response.status >= 400 && response.status < 500) {
        console.error(
          "Client-side error:",
          response.status,
          await response.text()
        );
        throw new Error(`Client error: ${response.status}`);
      }
    } catch (error) {
      if (i === retries - 1) throw error;
    }
    await new Promise((res) => setTimeout(res, delay * Math.pow(2, i)));
  }
};

const geminiAPI = {
  generateBriefing: async (company, role) => {
    const prompt = `You are an expert career consultant. For the company "${company}" and the job role "${role}", provide a concise briefing for an interview candidate. The output must be a JSON object, and all text must be in Korean. The company is located in South Korea, so all analysis should be based on the Korean market.

JSON Output Structure:
- "companySummary": A summary of the company's recent activities and market position.
- "industryTrends": 3-4 key industry trends relevant to the role.
- "companyCulture": An educated guess on the company's culture.
- "recommendedTone": Recommend a specific tone for the interview.`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            companySummary: { type: "STRING" },
            industryTrends: { type: "ARRAY", items: { type: "STRING" } },
            companyCulture: { type: "STRING" },
            recommendedTone: { type: "STRING" },
          },
          required: [
            "companySummary",
            "industryTrends",
            "companyCulture",
            "recommendedTone",
          ],
        },
      },
    };
    const result = await fetchWithBackoff(API_URL_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("AI 브리핑 파싱 실패");
    return JSON.parse(text);
  },

  generateQuestions: async (role, count) => {
    const prompt = `You are an expert interviewer. For a "${role}" position in a South Korean tech company, generate ${count} essential interview questions. The output must be a JSON array of objects, with each object having a "type" and "text" in Korean. Types: '기초', '직무', '경험', '협업', '심화'.`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { type: { type: "STRING" }, text: { type: "STRING" } },
            required: ["type", "text"],
          },
        },
      },
    };
    const result = await fetchWithBackoff(API_URL_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("AI 질문 파싱 실패");
    return JSON.parse(text);
  },

  getFeedback: async (question, answer) => {
    const prompt = `You are an expert interview coach AI. A candidate has answered a question via voice, and this is the transcription.
- Question: "${question}"
- Transcribed Answer: "${answer}"

Provide feedback in a JSON object, with all text in Korean. Analyze the text to infer the speaker's vocal delivery.
1.  **logic**: Evaluate the logical structure (e.g., STAR method). Score (0-100) and comment.
2.  **clarity**: Evaluate the clarity of the content. Score (0-100) and comment.
3.  **vocalTone**: Based on the text's wording, structure, and flow, infer and evaluate the speaker's vocal tone and confidence. Score (0-100) and provide a comment as if you heard the actual voice (e.g., mention confidence, pace, conviction).
4.  **betterExample**: Rewrite the answer into a more ideal and impactful response.`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            logic: {
              type: "OBJECT",
              properties: {
                score: { type: "NUMBER" },
                comment: { type: "STRING" },
              },
              required: ["score", "comment"],
            },
            clarity: {
              type: "OBJECT",
              properties: {
                score: { type: "NUMBER" },
                comment: { type: "STRING" },
              },
              required: ["score", "comment"],
            },
            vocalTone: {
              type: "OBJECT",
              properties: {
                score: { type: "NUMBER" },
                comment: { type: "STRING" },
              },
              required: ["score", "comment"],
            },
            betterExample: { type: "STRING" },
          },
          required: ["logic", "clarity", "vocalTone", "betterExample"],
        },
      },
    };
    const result = await fetchWithBackoff(API_URL_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("AI 피드백 파싱 실패");
    return JSON.parse(text);
  },

  generateRecommendedQuestions: async (weakness) => {
    const prompt = `You are an expert interviewer. A candidate needs to improve on: "${weakness}". Generate 3 new, targeted interview questions to practice this area. The output must be a JSON array of objects (type, text), all in Korean.`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { type: { type: "STRING" }, text: { type: "STRING" } },
            required: ["type", "text"],
          },
        },
      },
    };
    const result = await fetchWithBackoff(API_URL_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("AI 추천 질문 파싱 실패");
    return JSON.parse(text);
  },
};

// --- Toast Component ---
const Toast = ({ message, type, onHide }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onHide();
    }, 3000);
    return () => clearTimeout(timer);
  }, [onHide]);

  const bgColor = type === "success" ? "bg-green-500" : "bg-red-500";

  return (
    <div
      className={`fixed top-5 left-1/2 -translate-x-1/2 px-6 py-3 rounded-lg text-white text-sm shadow-lg z-50 transition-opacity duration-300 ${bgColor}`}
    >
      {message}
    </div>
  );
};

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [screen, setScreen] = useState("home");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  const [briefingData, setBriefingData] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [practiceLog, setPracticeLog] = useState([]);
  const [jobLink, setJobLink] = useState("");
  const [selectedLog, setSelectedLog] = useState(null);
  const [questionCount, setQuestionCount] = useState(5);

  const [toast, setToast] = useState({ show: false, message: "", type: "" });
  const appId =
    typeof __app_id !== "undefined" ? __app_id : "interviewbook-ai-default";

  const showToast = (message, type = "error") => {
    setToast({ show: true, message, type });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setPracticeLog([]);
      return;
    }
    const logCollectionRef = collection(
      db,
      `artifacts/${appId}/users/${user.uid}/practiceLogs`
    );
    const q = query(logCollectionRef);
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const logs = [];
        querySnapshot.forEach((doc) => {
          logs.push({ id: doc.id, ...doc.data() });
        });
        logs.sort((a, b) => b.timestamp?.toDate() - a.timestamp?.toDate());
        setPracticeLog(logs);
      },
      (dbError) => {
        console.error("Error fetching practice logs:", dbError);
        showToast("연습 기록을 불러오는 데 실패했습니다.");
      }
    );
    return () => unsubscribe();
  }, [user, appId]);

  const handleStart = async () => {
    if (!company || !role) {
      showToast("회사명과 직무명을 모두 입력해주세요.");
      return;
    }
    setLoading(true);
    try {
      setLoadingMessage("AI가 기업 정보를 분석 중입니다...");
      const briefing = await geminiAPI.generateBriefing(company, role);
      setBriefingData(briefing);

      setLoadingMessage("맞춤형 면접 질문을 생성 중입니다...");
      const generatedQuestions = await geminiAPI.generateQuestions(
        role,
        questionCount
      );
      setQuestions(generatedQuestions);

      setJobLink(
        `https://www.google.com/search?q=${encodeURIComponent(
          company
        )}+${encodeURIComponent(role)}+채용`
      );

      setScreen("briefing");
    } catch (e) {
      showToast("분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      console.error(e);
    } finally {
      setLoading(false);
      setLoadingMessage("");
    }
  };

  const handlePracticeRecommended = async (weakness) => {
    setLoading(true);
    try {
      setLoadingMessage(
        "AI가 약점 보완을 위한<br/>추천 질문을 생성 중입니다..."
      );
      setScreen("home");
      const recommendedQuestions = await geminiAPI.generateRecommendedQuestions(
        weakness
      );
      setQuestions(recommendedQuestions);
      setScreen("practice");
    } catch (e) {
      showToast("추천 질문 생성 중 오류가 발생했습니다.");
      setScreen("report");
      console.error(e);
    } finally {
      setLoading(false);
      setLoadingMessage("");
    }
  };

  const handleViewLog = (log) => {
    setSelectedLog(log);
    setScreen("report");
  };

  const resetApp = () => {
    setScreen("home");
    setCompany("");
    setRole("");
    setBriefingData(null);
    setQuestions([]);
    setJobLink("");
    setSelectedLog(null);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      showToast("로그아웃 되었습니다.", "success");
    } catch (e) {
      console.error("Logout failed", e);
      showToast("로그아웃에 실패했습니다.");
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <svg
            className="animate-spin h-10 w-10 text-indigo-500 mx-auto"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  const renderScreen = () => {
    if (!user) {
      return <AuthScreen showToast={showToast} />;
    }
    switch (screen) {
      case "briefing":
        return (
          <BriefingScreen
            briefingData={briefingData}
            company={company}
            role={role}
            onStartPractice={() => setScreen("practice")}
            onBack={resetApp}
          />
        );
      case "practice":
        return (
          <PracticeScreen
            company={company || "추천"}
            role={role || "연습"}
            questions={questions}
            onFinishPractice={() => {
              setSelectedLog(null);
              setScreen("report");
            }}
            userId={user.uid}
            appId={appId}
          />
        );
      case "report":
        return (
          <ReportScreen
            onRestart={resetApp}
            practiceLog={practiceLog}
            onPracticeRecommended={handlePracticeRecommended}
            jobLink={jobLink}
            selectedLog={selectedLog}
          />
        );
      case "home":
      default:
        return (
          <HomeScreen
            company={company}
            setCompany={setCompany}
            role={role}
            setRole={setRole}
            onStart={handleStart}
            loading={loading}
            loadingMessage={loadingMessage}
            practiceLog={practiceLog}
            setScreen={setScreen}
            handleViewLog={handleViewLog}
            questionCount={questionCount}
            setQuestionCount={setQuestionCount}
          />
        );
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen font-sans flex items-center justify-center p-4">
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onHide={() => setToast({ ...toast, show: false })}
        />
      )}
      <div className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-lg overflow-hidden h-[85vh] flex flex-col">
        <Header screen={screen} user={user} onLogout={handleLogout} />
        <div className="flex-grow overflow-y-auto">{renderScreen()}</div>
        {user && <Footer userId={user.uid} />}
      </div>
    </div>
  );
}

// --- Screen Components ---

const AuthScreen = ({ showToast }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const getFriendlyErrorMessage = (errorCode) => {
    switch (errorCode) {
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "이메일 또는 비밀번호가 일치하지 않습니다.";
      case "auth/user-not-found":
        return "존재하지 않는 계정입니다.";
      case "auth/email-already-in-use":
        return "이미 사용 중인 이메일입니다.";
      case "auth/weak-password":
        return "비밀번호는 6자 이상이어야 합니다.";
      default:
        return "오류가 발생했습니다. 다시 시도해주세요.";
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      showToast(isLogin ? "로그인 성공!" : "회원가입 성공!", "success");
    } catch (error) {
      console.error(error.code);
      showToast(getFriendlyErrorMessage(error.code));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      showToast("구글 로그인 성공!", "success");
    } catch (error) {
      console.error(error);
      showToast(getFriendlyErrorMessage(error.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 flex flex-col justify-center h-full">
      <div className="text-center mb-8">
        <BrainCircuit className="inline-block text-indigo-500 w-12 h-12" />
        <h1 className="text-2xl font-bold text-gray-800 mt-2">면접백서.ai</h1>
        <p className="text-gray-600">
          {isLogin ? "로그인하여 계속하세요" : "계정을 생성하세요"}
        </p>
      </div>
      <div className="space-y-4">
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center bg-white border border-gray-300 text-gray-700 font-semibold py-3 px-4 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
        >
          <svg className="w-5 h-5 mr-2" viewBox="0 0 48 48">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            ></path>
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.42-4.55H24v8.51h12.8c-.57 2.73-2.21 5.12-4.64 6.7l7.98 6.19c4.56-4.22 7.27-10.29 7.27-17.05z"
            ></path>
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            ></path>
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.98-6.19c-2.11 1.42-4.79 2.27-7.91 2.27-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            ></path>
            <path fill="none" d="M0 0h48v48H0z"></path>
          </svg>
          Google 계정으로 로그인
        </button>
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white px-2 text-gray-500">또는</span>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일 주소"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 transition disabled:bg-indigo-300"
          >
            {loading ? "처리 중..." : isLogin ? "로그인" : "회원가입"}
          </button>
        </form>
      </div>
      <p className="text-center text-sm text-gray-600 mt-6">
        {isLogin ? "계정이 없으신가요?" : "이미 계정이 있으신가요?"}
        <button
          onClick={() => setIsLogin(!isLogin)}
          className="font-semibold text-indigo-600 hover:underline ml-1"
        >
          {isLogin ? "회원가입" : "로그인"}
        </button>
      </p>
    </div>
  );
};

const Header = ({ screen, user, onLogout }) => {
  const titles = {
    home: "면접백서.ai",
    briefing: "AI 기업 브리핑",
    practice: "AI 모의 면접",
    report: "면접 결과 리포트",
  };
  return (
    <div className="bg-white p-4 border-b border-gray-200 flex items-center justify-between">
      <div className="flex-1"></div>
      <h1 className="text-xl font-bold text-gray-800 flex items-center justify-center flex-1">
        <BrainCircuit className="inline-block mr-2 text-indigo-500" />
        {user ? titles[screen] : "환영합니다"}
      </h1>
      <div className="flex-1 text-right">
        {user && (
          <button
            onClick={onLogout}
            className="text-gray-500 hover:text-indigo-600 transition-colors"
          >
            <LogOut size={20} />
          </button>
        )}
      </div>
    </div>
  );
};

const Footer = ({ userId }) => (
  <div className="bg-gray-100 p-2 text-center border-t border-gray-200">
    <p className="text-xs text-gray-500">UID: {userId}</p>
  </div>
);

const HomeScreen = ({
  company,
  setCompany,
  role,
  setRole,
  onStart,
  loading,
  loadingMessage,
  practiceLog,
  handleViewLog,
  questionCount,
  setQuestionCount,
}) => (
  <div className="p-6 flex flex-col h-full">
    {loading ? (
      <div className="flex flex-col items-center justify-center h-full">
        <svg
          className="animate-spin h-10 w-10 text-indigo-500 mb-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
        <p
          className="text-gray-600 text-center"
          dangerouslySetInnerHTML={{
            __html: loadingMessage || "AI 분석 중...",
          }}
        ></p>
      </div>
    ) : (
      <>
        <div className="text-center mb-6">
          <p className="text-gray-600">
            지원할 회사와 직무를 입력하면
            <br />
            AI가 면접 준비를 도와드려요.
          </p>
        </div>

        <div className="space-y-4 mb-4">
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="회사명 (예: 네이버)"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
          />
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="직무명 (예: 백엔드 개발자)"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
          />
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 text-center mb-2">
            질문 수 선택
          </label>
          <div className="flex justify-center items-center space-x-2">
            {[1, 2, 3, 4, 5, 6].map((num) => (
              <button
                key={num}
                onClick={() => setQuestionCount(num)}
                className={`w-10 h-10 rounded-full transition-colors ${
                  questionCount === num
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                {num}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onStart}
          className="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 transition-transform transform hover:scale-105 flex items-center justify-center"
        >
          AI 분석 시작 <ArrowRight className="ml-2 h-5 w-5" />
        </button>

        <div className="mt-8 flex-grow">
          <h2 className="text-lg font-bold text-gray-700 mb-3 flex items-center">
            <FileText className="mr-2 text-gray-500" />
            최근 연습 기록
          </h2>
          {practiceLog.length > 0 ? (
            <div className="space-y-3">
              {practiceLog.map((log) => (
                <div
                  key={log.id}
                  className="bg-gray-100 p-3 rounded-lg cursor-pointer hover:bg-gray-200"
                  onClick={() => handleViewLog(log)}
                >
                  <div className="font-semibold text-gray-800">
                    {log.company} - {log.role}
                  </div>
                  <div className="text-sm text-gray-500">
                    {log.timestamp?.toDate().toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 bg-gray-50 rounded-lg">
              <p className="text-gray-500">아직 연습 기록이 없어요.</p>
            </div>
          )}
        </div>
      </>
    )}
  </div>
);

const BriefingScreen = ({
  briefingData,
  company,
  role,
  onStartPractice,
  onBack,
}) => (
  <div className="p-6">
    <button
      onClick={onBack}
      className="flex items-center text-sm text-gray-500 hover:text-gray-800 mb-4"
    >
      {" "}
      <ChevronLeft className="h-4 w-4 mr-1" /> 처음으로{" "}
    </button>
    <div className="text-center mb-6">
      <h2 className="text-2xl font-bold text-gray-800">{company}</h2>
      <p className="text-indigo-600 font-semibold">{role}</p>
    </div>
    <div className="space-y-6">
      <InfoCard title="AI 기업 & 직무 요약">
        <p className="text-gray-600">{briefingData.companySummary}</p>
      </InfoCard>
      <InfoCard title="최신 산업 동향">
        <ul className="list-disc list-inside space-y-1 text-gray-600">
          {briefingData.industryTrends.map((trend, i) => (
            <li key={i}>{trend}</li>
          ))}
        </ul>
      </InfoCard>
      <InfoCard title="예상 조직 문화">
        <p className="text-gray-600">{briefingData.companyCulture}</p>
      </InfoCard>
      <InfoCard title="AI 추천 답변 톤">
        <p className="text-indigo-700 bg-indigo-50 p-3 rounded-md font-semibold">
          {briefingData.recommendedTone}
        </p>
      </InfoCard>
    </div>
    <div className="mt-8">
      <button
        onClick={onStartPractice}
        className="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 transition-transform transform hover:scale-105"
      >
        {" "}
        모의 면접 시작하기{" "}
      </button>
    </div>
  </div>
);

const InfoCard = ({ title, children }) => (
  <div className="bg-white border border-gray-200 rounded-lg p-4">
    <h3 className="font-bold text-lg text-gray-800 mb-2">{title}</h3>
    {children}
  </div>
);

const PracticeScreen = ({
  company,
  role,
  questions,
  onFinishPractice,
  userId,
  appId,
}) => {
  const [currentQ, setCurrentQ] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sessionLog, setSessionLog] = useState([]);
  const [submittedAnswer, setSubmittedAnswer] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState("");
  const chatContainerRef = useRef(null);
  const finalTranscriptRef = useRef("");

  useEffect(() => {
    if (!recognition) return;

    recognition.onresult = (event) => {
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscriptRef.current += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      setAnswer(finalTranscriptRef.current + interimTranscript);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error", event.error);
      if (event.error === "not-allowed") {
        setMicError(
          "마이크 권한이 거부되었습니다. 음성 인식을 사용하려면, 브라우저 주소창의 자물쇠(🔒) 아이콘을 클릭하여 권한을 '허용'으로 변경해주세요."
        );
      } else {
        setMicError(
          "음성 인식 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
        );
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };
  }, []);

  useEffect(() => {
    chatContainerRef.current?.scrollTo(
      0,
      chatContainerRef.current.scrollHeight
    );
  }, [feedback, loading]);

  const handleGetFeedback = async () => {
    if (!answer) return;
    setLoading(true);
    setFeedback(null);
    setSubmittedAnswer(answer);
    const currentQuestion = questions[currentQ];
    try {
      const newFeedback = await geminiAPI.getFeedback(
        currentQuestion.text,
        answer
      );
      setFeedback(newFeedback);
      const logEntry = {
        question: currentQuestion.text,
        answer: answer,
        feedback: newFeedback,
      };
      setSessionLog((prev) => [...prev, logEntry]);
    } catch (e) {
      console.error(e);
      setFeedback({
        error:
          "피드백 생성에 실패했습니다. 답변을 조금 더 자세하게 작성해보세요.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleNextQuestion = () => {
    setAnswer("");
    setFeedback(null);
    setSubmittedAnswer("");
    setMicError("");
    if (currentQ < questions.length - 1) {
      setCurrentQ(currentQ + 1);
    } else {
      savePracticeLog();
      onFinishPractice();
    }
  };

  const savePracticeLog = async () => {
    if (!userId || sessionLog.length === 0) return;
    try {
      const validLogs = sessionLog.filter(
        (l) => l.feedback && !l.feedback.error
      );
      const overallScore =
        validLogs.length > 0
          ? Math.round(
              validLogs.reduce(
                (acc, cur) =>
                  acc +
                  (cur.feedback.logic?.score || 0) +
                  (cur.feedback.clarity?.score || 0) +
                  (cur.feedback.vocalTone?.score || 0),
                0
              ) /
                (validLogs.length * 3)
            )
          : 0;
      const logData = {
        userId,
        company,
        role,
        log: sessionLog,
        timestamp: new Date(),
        overallScore,
      };
      await addDoc(
        collection(db, `artifacts/${appId}/users/${userId}/practiceLogs`),
        logData
      );
    } catch (error) {
      console.error("Error saving practice log:", error);
    }
  };

  const toggleListening = () => {
    setMicError("");
    if (!recognition) {
      setMicError("음성 인식 기능이 지원되지 않는 브라우저입니다.");
      return;
    }
    if (isListening) {
      recognition.stop();
    } else {
      finalTranscriptRef.current = "";
      setAnswer("");
      recognition.start();
    }
    setIsListening(!isListening);
  };

  const currentQuestion = questions[currentQ];

  return (
    <div className="flex flex-col h-full p-4 bg-gray-100">
      <div className="text-center p-2 mb-2">
        <p className="text-gray-500">
          질문 {currentQ + 1} / {questions.length}
        </p>
      </div>
      <div
        ref={chatContainerRef}
        className="flex-grow space-y-4 overflow-y-auto pr-2"
      >
        <div className="flex items-start gap-3">
          <div className="bg-indigo-500 text-white rounded-full p-2">
            <Bot size={20} />
          </div>
          <div className="bg-white p-3 rounded-lg rounded-tl-none shadow-sm">
            <p className="font-semibold text-gray-500 mb-1">
              [{currentQuestion.type}]
            </p>
            <p className="text-gray-800">{currentQuestion.text}</p>
          </div>
        </div>
        {submittedAnswer && (
          <div className="flex items-start gap-3 justify-end">
            <div className="bg-gray-200 p-3 rounded-lg rounded-tr-none shadow-sm max-w-xs">
              <p className="text-gray-800">{submittedAnswer}</p>
            </div>
            <div className="bg-gray-700 text-white rounded-full p-2">
              <User size={20} />
            </div>
          </div>
        )}
        {!feedback && !submittedAnswer && (
          <div className="flex items-start gap-3 justify-end">
            <div className="bg-gray-200 p-3 rounded-lg rounded-tr-none shadow-sm w-full">
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="여기에 답변을 입력하거나 마이크 버튼을 누르세요..."
                rows="3"
                className="w-full bg-transparent border-0 focus:ring-0 p-0 resize-none"
                disabled={loading}
              />
            </div>
            <div className="bg-gray-700 text-white rounded-full p-2">
              <User size={20} />
            </div>
          </div>
        )}
        {loading && (
          <div className="flex justify-center items-center gap-2">
            <svg
              className="animate-spin h-5 w-5 text-indigo-500"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            <span className="text-gray-500">
              AI가 답변을 분석하고 있어요...
            </span>
          </div>
        )}
        {feedback && !loading && (
          <div className="flex items-start gap-3">
            <div className="bg-indigo-500 text-white rounded-full p-2">
              <Bot size={20} />
            </div>
            <div className="bg-white p-4 rounded-lg rounded-tl-none shadow-sm w-full">
              <FeedbackDisplay feedback={feedback} />
            </div>
          </div>
        )}
      </div>
      <div className="mt-4 pt-4 border-t border-gray-200">
        {micError && (
          <div
            className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-3 text-center"
            role="alert"
          >
            <strong className="font-bold">오류: </strong>
            <span className="block sm:inline ml-1">{micError}</span>
          </div>
        )}
        {feedback ? (
          <button
            onClick={handleNextQuestion}
            className="w-full bg-green-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-600 transition"
          >
            {" "}
            {currentQ < questions.length - 1
              ? "다음 질문으로"
              : "결과 보기"}{" "}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={toggleListening}
              className={`p-3 rounded-full transition ${
                isListening
                  ? "bg-red-500 text-white animate-pulse"
                  : "bg-gray-200 text-gray-600 hover:bg-gray-300"
              }`}
              disabled={!recognition}
            >
              <Mic size={24} />
            </button>
            <button
              onClick={handleGetFeedback}
              disabled={!answer || loading || isListening}
              className="flex-grow bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-300 flex items-center justify-center gap-2"
            >
              <Send size={18} /> 피드백 받기{" "}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const FeedbackDisplay = ({ feedback, isCollapsed = false }) => {
  const [collapsed, setCollapsed] = useState(isCollapsed);
  if (!feedback) return null;
  if (feedback.error) {
    return <p className="text-red-500">{feedback.error}</p>;
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-indigo-700">AI 피드백</h3>
        {isCollapsed && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-sm text-indigo-500"
          >
            {collapsed ? "자세히 보기" : "숨기기"}
          </button>
        )}
      </div>
      {!collapsed && (
        <>
          <FeedbackItem title="논리 구조" score={feedback.logic.score}>
            {feedback.logic.comment}
          </FeedbackItem>
          <FeedbackItem title="내용 명확성" score={feedback.clarity.score}>
            {feedback.clarity.comment}
          </FeedbackItem>
          <FeedbackItem
            title="음성 기반 말투 분석"
            score={feedback.vocalTone.score}
          >
            {feedback.vocalTone.comment}
          </FeedbackItem>
          <div>
            <h4 className="font-semibold text-gray-700 mb-2">
              더 나은 답변 예시
            </h4>
            <p className="text-sm text-gray-600 bg-gray-100 p-3 rounded-md italic">
              {feedback.betterExample}
            </p>
          </div>
        </>
      )}
    </div>
  );
};

const FeedbackItem = ({ title, score, children }) => (
  <div>
    <div className="flex justify-between items-center mb-1">
      <h4 className="font-semibold text-gray-700">{title}</h4>
      <span
        className={`font-bold text-lg ${
          score > 80
            ? "text-green-500"
            : score > 60
            ? "text-yellow-500"
            : "text-red-500"
        }`}
      >
        {score}점
      </span>
    </div>
    <div className="w-full bg-gray-200 rounded-full h-2.5">
      <div
        className={`h-2.5 rounded-full ${
          score > 80
            ? "bg-green-500"
            : score > 60
            ? "bg-yellow-500"
            : "bg-red-500"
        }`}
        style={{ width: `${score}%` }}
      ></div>
    </div>
    <p className="text-sm text-gray-600 mt-2">{children}</p>
  </div>
);

const ReportScreen = ({
  onRestart,
  practiceLog,
  onPracticeRecommended,
  jobLink,
  selectedLog,
}) => {
  const logToDisplay = selectedLog || practiceLog?.[0];

  if (!logToDisplay) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-600 mb-4">리포트를 생성할 데이터가 없습니다.</p>
        <button
          onClick={onRestart}
          className="bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700"
        >
          새로운 면접 시작하기
        </button>
      </div>
    );
  }

  const validLogs = logToDisplay.log.filter(
    (item) => item.feedback && !item.feedback.error
  );
  if (validLogs.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-600 mb-4">분석할 수 있는 피드백이 없습니다.</p>
        <button
          onClick={onRestart}
          className="bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700"
        >
          새로운 면접 시작하기
        </button>
      </div>
    );
  }

  const avgLogic = Math.round(
    validLogs.reduce((sum, item) => sum + item.feedback.logic.score, 0) /
      validLogs.length
  );
  const avgClarity = Math.round(
    validLogs.reduce((sum, item) => sum + item.feedback.clarity.score, 0) /
      validLogs.length
  );
  const avgTone = Math.round(
    validLogs.reduce((sum, item) => sum + item.feedback.vocalTone.score, 0) /
      validLogs.length
  );
  const overallScore = Math.round((avgLogic + avgClarity + avgTone) / 3);
  const isPass = overallScore >= 75;

  const strengths = [];
  if (avgLogic > 80) strengths.push("논리적인 답변 구조");
  if (avgClarity > 80) strengths.push("명확한 의사 전달");
  if (avgTone > 80) strengths.push(" 자신감 있는 말투");
  if (strengths.length === 0) strengths.push("성장 가능성");

  const weaknesses = [];
  if (avgLogic < 70) weaknesses.push("결과/성과 제시 부족");
  if (avgClarity < 70) weaknesses.push("답변이 장황함");
  if (avgTone < 70) weaknesses.push("불안정한 어조");
  if (weaknesses.length === 0) weaknesses.push("개선점 발견");
  const mainWeakness = weaknesses[0];

  return (
    <div className="p-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">
          {logToDisplay.company} - {logToDisplay.role}
        </h2>
        <p className="text-gray-500">면접 결과 리포트</p>
      </div>

      <div
        className={`text-center mb-6 p-4 rounded-lg ${
          isPass ? "bg-blue-100 text-blue-800" : "bg-red-100 text-red-800"
        }`}
      >
        <h3 className="text-xl font-bold">모의 면접 결과</h3>
        <p className="text-2xl font-bold mt-1">
          {isPass ? "🎉 최종 합격 (예상)" : "😥 아쉽지만 불합격 (예상)"}
        </p>
        <p className="text-sm mt-1">
          {isPass
            ? "훌륭합니다! 자신감을 갖고 실제 면접에 임하세요."
            : "보완점을 개선하면 좋은 결과가 있을 거예요."}
        </p>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 text-center">
          <div className="bg-green-50 p-4 rounded-lg">
            <h3 className="font-bold text-green-800">나의 강점</h3>
            <p className="text-green-700 mt-1">{strengths.join(", ")}</p>
          </div>
          <div className="bg-red-50 p-4 rounded-lg">
            <h3 className="font-bold text-red-800">보완할 점</h3>
            <p className="text-red-700 mt-1">{weaknesses.join(", ")}</p>
          </div>
        </div>
        <InfoCard title="종합 점수">
          <div className="space-y-3">
            <FeedbackItem title="논리 구조" score={avgLogic} />
            <FeedbackItem title="내용 명확성" score={avgClarity} />
            <FeedbackItem title="음성 기반 말투 분석" score={avgTone} />
          </div>
        </InfoCard>
        <InfoCard title="AI 추천 개선 플랜">
          <p className="text-gray-600">
            <strong>
              <span className="text-indigo-600">{mainWeakness}</span>
            </strong>
            에 대한 보완이 필요합니다. 다음 연습에서는 STAR 기법에 맞춰{" "}
            <span className="font-bold">구체적인 수치</span>를 포함하여 성과를
            설명하는 데 집중해보세요.
          </p>
          <button
            onClick={() => onPracticeRecommended(mainWeakness)}
            className="mt-3 w-full text-sm bg-indigo-100 text-indigo-700 font-semibold py-2 rounded-lg hover:bg-indigo-200 transition-colors"
          >
            추천 질문으로 연습하기
          </button>
        </InfoCard>
        {jobLink && (
          <InfoCard title="채용 정보">
            <a
              href={jobLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between w-full text-sm bg-gray-100 text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <span>{logToDisplay.company} 채용 공고 검색하기</span>
              <LinkIcon className="h-4 w-4" />
            </a>
          </InfoCard>
        )}
      </div>
      <div className="mt-8">
        <button
          onClick={onRestart}
          className="w-full bg-gray-700 text-white font-bold py-3 px-4 rounded-lg hover:bg-gray-800"
        >
          첫 화면으로 이동하기
        </button>
      </div>
    </div>
  );
};
