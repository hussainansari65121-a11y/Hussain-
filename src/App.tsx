import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Loader2, Volume2, VolumeX, Keyboard, Send, Trash2, History, MapPin, X, LayoutGrid } from "lucide-react";
import { getZoyaResponse, getZoyaAudio, resetZoyaSession } from "./services/geminiService";
import { processCommand } from "./services/commandService";
import { LiveSessionManager } from "./services/liveService";
import { ZoyaTone, normalizeTone } from "./utils/personalityUtils";
import Visualizer from "./components/Visualizer";
import PermissionModal from "./components/PermissionModal";
import ChatHistoryDrawer, { ChatMessage } from "./components/ChatHistoryDrawer";
import GoogleMapsPanel from "./components/GoogleMapsPanel";
import WorkspaceDrawer from "./components/WorkspaceDrawer";
import type { MapCommandPayload } from "./types/maps";
import type { WorkspaceCommandPayload } from "./types/workspace";
import { playPCM } from "./utils/audioUtils";
import { motion, AnimatePresence } from "motion/react";

type AppState = "idle" | "listening" | "processing" | "speaking";

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function App() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [tone, setTone] = useState<ZoyaTone>(() => {
    const saved = localStorage.getItem("zoya_personality_tone");
    return normalizeTone(saved);
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem("zoya_chat_history");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse chat history", e);
      }
    }
    return [];
  });
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
    localStorage.setItem("zoya_chat_history", JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem("zoya_personality_tone", tone);
    resetZoyaSession();
  }, [tone]);

  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.isMuted = isMuted;
    }
  }, [isMuted]);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [pendingMapCommand, setPendingMapCommand] = useState<MapCommandPayload | null>(null);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [pendingWorkspaceCommand, setPendingWorkspaceCommand] = useState<WorkspaceCommandPayload | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [mapsApiKey, setMapsApiKey] = useState<string>(() => import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "");

  const liveSessionRef = useRef<LiveSessionManager | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleQuotaExceeded = () => setQuotaExceeded(true);
    window.addEventListener("gmp-quota-exceeded", handleQuotaExceeded);
    return () => window.removeEventListener("gmp-quota-exceeded", handleQuotaExceeded);
  }, []);

  useEffect(() => {
    if (mapsApiKey) return;
    let cancelled = false;
    fetch("/api/maps-config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { apiKey?: string } | null) => {
        if (!cancelled && data?.apiKey) {
          setMapsApiKey(data.apiKey);
        }
      })
      .catch(() => {
        // Ignore config lookup failure if offline
      });
    return () => {
      cancelled = true;
    };
  }, [mapsApiKey]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, appState]);

  const handleTextCommand = useCallback(async (finalTranscript: string) => {
    if (!finalTranscript.trim()) {
      setAppState("idle");
      return;
    }

    setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "user", text: finalTranscript, timestamp: Date.now() }]);
    
    // If live session is active, send text through it
    if (isSessionActive && liveSessionRef.current) {
      liveSessionRef.current.sendText(finalTranscript);
      return;
    }

    setAppState("processing");

    // 1. Check for browser commands
    const commandResult = processCommand(finalTranscript);

    let responseText = "";

    if (commandResult.isBrowserAction) {
      responseText = commandResult.action;
      setMessages((prev) => [...prev, { id: Date.now().toString() + "-z", sender: "zoya", text: responseText, timestamp: Date.now() }]);

      if (commandResult.mapAction) {
        setPendingMapCommand(commandResult.mapAction);
        setIsMapOpen(true);
      }

      if (commandResult.workspaceAction) {
        setPendingWorkspaceCommand(commandResult.workspaceAction);
        setIsWorkspaceOpen(true);
      }

      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getZoyaAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }

      setAppState("idle");

      if (commandResult.url) {
        setTimeout(() => {
          window.open(commandResult.url, "_blank");
        }, 1500);
      }
    } else {
      // 2. General Chit-Chat via Gemini
      responseText = await getZoyaResponse(finalTranscript, messagesRef.current, tone);
      setMessages((prev) => [...prev, { id: Date.now().toString() + "-z", sender: "zoya", text: responseText, timestamp: Date.now() }]);
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getZoyaAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }
      setAppState("idle");
    }
  }, [isMuted, isSessionActive, tone]);

  useEffect(() => {
    return () => {
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
      }
    };
  }, []);

  const toggleListening = async () => {
    if (isSessionActive) {
      setIsSessionActive(false);
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
        liveSessionRef.current = null;
      }
      setAppState("idle");
      resetZoyaSession();
    } else {
      try {
        setIsSessionActive(true);
        resetZoyaSession();
        
        const session = new LiveSessionManager(tone, messagesRef.current);
        session.isMuted = isMuted;
        liveSessionRef.current = session;
        
        session.onStateChange = (state) => {
          setAppState(state);
        };
        
        session.onMessage = (sender, text) => {
          setMessages((prev) => [...prev, { id: Date.now().toString() + "-" + sender, sender, text, timestamp: Date.now() }]);
        };
        
        session.onCommand = (url) => {
          setTimeout(() => {
            window.open(url, "_blank");
          }, 1000);
        };

        session.onMapCommand = (cmd) => {
          setPendingMapCommand(cmd);
          setIsMapOpen(true);
        };

        session.onWorkspaceCommand = (cmd) => {
          setPendingWorkspaceCommand(cmd);
          setIsWorkspaceOpen(true);
        };

        await session.start();
      } catch (e) {
        console.error("Failed to start session", e);
        setShowPermissionModal(true);
        setIsSessionActive(false);
        setAppState("idle");
      }
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    
    handleTextCommand(textInput);
    setTextInput("");
    setShowTextInput(false);
  };

  return (
    <div className="h-[100dvh] w-screen bg-[#050505] text-white flex flex-col items-center justify-between font-sans relative overflow-hidden m-0 p-0">
      {quotaExceeded && (
        <div
          role="alert"
          className="fixed top-0 left-0 right-0 z-50 bg-amber-950/95 border-b border-amber-500/40 text-amber-100 px-4 py-2.5 text-xs md:text-sm flex items-center justify-between gap-3 backdrop-blur-md shadow-lg"
        >
          <p className="flex-1 text-center">
            Google Maps Platform quota reached. If you are the app owner, visit{" "}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-300 hover:text-amber-200"
            >
              maps developer site
            </a>{" "}
            for instructions to update your account.
          </p>
          <button
            type="button"
            onClick={() => setQuotaExceeded(false)}
            className="p-1 rounded hover:bg-white/10 text-amber-200/80 hover:text-white transition-colors"
            aria-label="Dismiss quota notice"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {showPermissionModal && (
        <PermissionModal 
          onClose={() => setShowPermissionModal(false)} 
        />
      )}

      {/* Cinematic Background Gradients */}
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-violet-900/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-pink-900/20 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="absolute top-0 left-0 w-full flex flex-wrap lg:flex-nowrap justify-between items-center gap-2 z-20 shrink-0 px-4 py-3 md:px-10 md:py-5">
        <div className="flex items-center gap-3 order-1">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-violet-500 to-pink-500 flex items-center justify-center font-bold text-sm">
            Z
          </div>
          <h1 className="text-xl font-serif font-medium tracking-wide opacity-90">Zoya</h1>
        </div>

        {/* Dynamic Personality Tone Selector Pill */}
        <div className="order-3 lg:order-2 w-full lg:w-auto flex items-center justify-center">
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-full p-1 text-[11px] lg:text-xs backdrop-blur-md overflow-x-auto max-w-full">
            {[
              { id: "friendly", label: "दोस्त (Bestie)" },
              { id: "playful", label: "चुलबुली (Playful)" },
              { id: "sassy", label: "सैसी (Sassy)" },
              { id: "romantic", label: "रोमांटिक (Flirty)" },
              { id: "caring", label: "फ़िक्रमंद (Caring)" },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTone(id as ZoyaTone)}
                className={`px-2.5 py-1 rounded-full transition-all duration-300 font-medium whitespace-nowrap ${
                  tone === id
                    ? "bg-gradient-to-r from-violet-500 to-pink-500 text-white shadow-md font-semibold"
                    : "text-white/60 hover:text-white/90 hover:bg-white/5"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 order-2 lg:order-3">
          <button
            onClick={() => setIsWorkspaceOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 active:scale-95 transition-all border border-white/10 text-xs font-medium text-white/80 hover:text-white backdrop-blur-md shadow-sm"
            title="Open Google Workspace (Calendar & Contacts)"
            aria-label="Open Google Workspace"
          >
            <LayoutGrid size={15} className="text-cyan-400" />
            <span className="hidden sm:inline">Workspace</span>
          </button>

          <button
            onClick={() => setIsMapOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 active:scale-95 transition-all border border-white/10 text-xs font-medium text-white/80 hover:text-white backdrop-blur-md shadow-sm"
            title="Open Google Maps"
            aria-label="Open Google Maps"
          >
            <MapPin size={15} className="text-pink-400" />
            <span className="hidden sm:inline">Maps</span>
          </button>

          <button
            onClick={() => setIsHistoryOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 active:scale-95 transition-all border border-white/10 text-xs font-medium text-white/80 hover:text-white backdrop-blur-md shadow-sm"
            title="Review Chat History"
            aria-label="Open Conversation History"
          >
            <History size={15} className="text-violet-400" />
            <span className="hidden sm:inline">History</span>
            {messages.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-violet-500/25 text-violet-300 border border-violet-500/30 text-[10px] font-mono tabular-nums">
                {messages.length}
              </span>
            )}
          </button>

          {messages.length > 0 && (
            <button
              onClick={() => {
                if (confirm("Are you sure you want to clear the chat history?")) {
                  setMessages([]);
                  resetZoyaSession();
                }
              }}
              className="p-2 rounded-full bg-white/5 hover:bg-red-500/20 hover:text-red-400 transition-colors border border-white/10"
              title="Clear Chat History"
            >
              <Trash2 size={18} className="opacity-70" />
            </button>
          )}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <VolumeX size={18} className="opacity-70" />
            ) : (
              <Volume2 size={18} className="opacity-70" />
            )}
          </button>
        </div>
      </header>

      {/* Main Content - Visualizer & Chat */}
      <main className="absolute inset-0 flex flex-row items-center justify-between w-full h-full z-10 overflow-hidden pt-20 pb-24 px-4 md:px-12 pointer-events-none">
        
        {/* Left Column: Zoya Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10">
          <div className="h-6">
            <AnimatePresence>
              {appState === "processing" && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-cyan-300/80 text-sm md:text-base italic font-serif"
                >
                  <Loader2 size={16} className="animate-spin" />
                  Replying...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Center Visualizer (Fixed Full Screen Background) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <Visualizer state={appState} />
        </div>

        {/* Right Column: User Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10">
          <div className="h-6 flex justify-end">
            <AnimatePresence>
              {appState === "listening" && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="flex items-center gap-2 text-violet-300/80 text-sm md:text-base italic"
                >
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                  Listening...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

      </main>

      {/* Controls */}
      <footer className="absolute bottom-0 left-0 w-full flex flex-col items-center justify-center pb-6 md:pb-8 z-20 shrink-0 gap-4">
        <AnimatePresence>
          {showTextInput && (
            <motion.form 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onSubmit={handleTextSubmit}
              className="w-full max-w-md flex items-center gap-2 bg-white/5 border border-white/10 rounded-full p-1 pl-4 backdrop-blur-md shadow-2xl"
            >
              <input 
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="हुसैन, बोलो यार क्या बात है... (Type to Zoya)"
                className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
                autoFocus
              />
              <button 
                type="submit"
                disabled={!textInput.trim()}
                className="p-2 rounded-full bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:hover:bg-violet-500 transition-colors"
              >
                <Send size={16} />
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleListening}
            className={`
              group relative flex items-center gap-3 px-8 py-4 rounded-full font-medium tracking-wide transition-all duration-300 shadow-2xl
              ${
                isSessionActive
                  ? "bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
                  : "bg-white/10 text-white border border-white/20 hover:bg-white/20 hover:scale-105"
              }
            `}
          >
            {isSessionActive ? (
              <>
                <MicOff size={20} />
                <span>End Session</span>
              </>
            ) : (
              <>
                <Mic size={20} className="group-hover:animate-bounce" />
                <span>Start Session</span>
              </>
            )}
          </button>
          
          {!isSessionActive && (
            <button
              onClick={() => setShowTextInput(!showTextInput)}
              className="p-4 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors shadow-2xl"
              title="Type instead"
            >
              <Keyboard size={20} className="opacity-70" />
            </button>
          )}
        </div>
      </footer>

      {/* Sliding Drawer for Chat History */}
      <ChatHistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        messages={messages}
        onClearHistory={() => {
          setMessages([]);
          resetZoyaSession();
        }}
        onSendMessage={(text) => handleTextCommand(text)}
      />

      {/* Interactive Google Maps Panel */}
      <GoogleMapsPanel
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
        apiKey={mapsApiKey}
        pendingCommand={pendingMapCommand}
        onCommandHandled={() => setPendingMapCommand(null)}
      />

      {/* Google Workspace Panel (Calendar & Contacts) */}
      <WorkspaceDrawer
        isOpen={isWorkspaceOpen}
        onClose={() => setIsWorkspaceOpen(false)}
        pendingCommand={pendingWorkspaceCommand}
        onCommandHandled={() => setPendingWorkspaceCommand(null)}
        onAskZoya={(prompt) => handleTextCommand(prompt)}
      />
    </div>
  );
}
