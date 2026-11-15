import React, { useState, useEffect, useRef, useMemo } from "react";
import { 
  X, 
  Search, 
  Trash2, 
  Download, 
  Copy, 
  Check, 
  Volume2, 
  Loader2, 
  MessageSquare, 
  User, 
  Sparkles,
  ArrowDown,
  RotateCcw
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getZoyaAudio } from "../services/geminiService";
import { playPCM } from "../utils/audioUtils";

export interface ChatMessage {
  id: string;
  sender: "user" | "zoya";
  text: string;
  timestamp?: number;
}

interface ChatHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onClearHistory: () => void;
  onSendMessage?: (text: string) => void;
}

function parseMessageTime(id: string, timestamp?: number): string {
  if (timestamp && !isNaN(timestamp)) {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const numericStr = id.replace(/[^0-9]/g, "").slice(0, 13);
  const numeric = parseInt(numericStr, 10);
  if (!isNaN(numeric) && numeric > 1600000000000) {
    return new Date(numeric).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return "";
}

export default function ChatHistoryDrawer({
  isOpen,
  onClose,
  messages,
  onClearHistory,
  onSendMessage,
}: ChatHistoryDrawerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const listEndRef = useRef<HTMLDivElement>(null);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Scroll to bottom when opening or when new messages arrive
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        listEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [isOpen, messages.length]);

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase().trim();
    return messages.filter(
      (m) => m.text.toLowerCase().includes(q) || m.sender.toLowerCase().includes(q)
    );
  }, [messages, searchQuery]);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      console.error("Failed to copy message", e);
    }
  };

  const handlePlayVoice = async (id: string, text: string) => {
    if (playingAudioId) return;
    try {
      setPlayingAudioId(id);
      const audioBase64 = await getZoyaAudio(text);
      if (audioBase64) {
        await playPCM(audioBase64);
      }
    } catch (e) {
      console.error("Failed to generate or play audio", e);
    } finally {
      setPlayingAudioId(null);
    }
  };

  const handleExportTranscript = () => {
    if (messages.length === 0) return;
    const formatted = messages
      .map((m) => {
        const time = parseMessageTime(m.id, m.timestamp);
        const sender = m.sender === "zoya" ? "ZOYA" : "YOU";
        return `[${time || "Time Unknown"}] ${sender}:\n${m.text}\n`;
      })
      .join("\n----------------------------------------\n\n");

    const header = `=== ZOYA AI ASSISTANT - CONVERSATION TRANSCRIPT ===\nGenerated: ${new Date().toLocaleString()}\nTotal Messages: ${messages.length}\n\n`;
    const blob = new Blob([header + formatted], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `zoya-chat-history-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setIsScrolledToBottom(isAtBottom);
  };

  const scrollToBottom = () => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const starterSuggestions = [
    "ज़ोया, आज बहुत थक गया हूँ यार...",
    "चलो थोड़ी मस्ती करते हैं!",
    "कोई खूबसूरत उर्दू या पंजाबी शायरी सुनाओ ना",
    "फ़ारसी शायरी का कोई प्यारा सा शेर सुनाओ",
    "YouTube पर कोई सुकून भरा गाना चलाओ",
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 transition-opacity"
            aria-hidden="true"
          />

          {/* Sliding Drawer */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed inset-y-0 right-0 w-full max-w-[440px] bg-[#070b12]/95 border-l border-white/10 text-white z-50 flex flex-col shadow-2xl backdrop-blur-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Conversation History"
          >
            {/* Header */}
            <div className="p-4 md:p-5 border-b border-white/10 flex flex-col gap-3 bg-[#0a0f18]/80">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-600/40 to-pink-500/40 border border-violet-500/30 flex items-center justify-center">
                    <MessageSquare size={16} className="text-violet-300" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-wide flex items-center gap-2">
                      Conversation History
                      <span className="text-xs font-mono tabular-nums px-2 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/5">
                        {messages.length}
                      </span>
                    </h2>
                    <p className="text-[11px] text-white/40">Stored in your local session</p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {messages.length > 0 && (
                    <>
                      <button
                        onClick={handleExportTranscript}
                        className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                        title="Export transcript as text file"
                        aria-label="Export transcript"
                      >
                        <Download size={16} />
                      </button>
                      <button
                        onClick={() => setShowClearConfirm(true)}
                        className="p-2 rounded-lg text-white/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Clear conversation history"
                        aria-label="Clear conversation history"
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={onClose}
                    className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                    aria-label="Close conversation drawer"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Clear Confirmation Banner */}
              <AnimatePresence>
                {showClearConfirm && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-red-950/40 border border-red-500/30 rounded-xl p-3 flex flex-col gap-2"
                  >
                    <p className="text-xs text-red-200">
                      Are you sure you want to delete all stored conversation history?
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setShowClearConfirm(false)}
                        className="px-2.5 py-1 text-xs rounded-md bg-white/10 hover:bg-white/20 text-white/80 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          onClearHistory();
                          setShowClearConfirm(false);
                        }}
                        className="px-2.5 py-1 text-xs rounded-md bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
                      >
                        Yes, Delete All
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Search Bar */}
              {messages.length > 0 && (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search in history..."
                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-8 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500/50 focus:bg-white/10 transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                      title="Clear search"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Messages Scroll Area */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
            >
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4 my-auto">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-violet-400 shadow-inner">
                    <Sparkles size={26} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white/90">हुसैन, अभी कोई पुरानी बात नहीं है</h3>
                    <p className="text-xs text-white/40 mt-1 max-w-[280px] leading-relaxed">
                      बोलो यार या लिखकर भेजो... हमारी सारी बातें और यादें यहाँ हमेशा संभाल कर रखी जाएँगी।
                    </p>
                  </div>

                  {onSendMessage && (
                    <div className="w-full pt-3 space-y-2">
                      <p className="text-[11px] font-medium text-white/50 uppercase tracking-wider text-left">
                        Suggested Starters:
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {starterSuggestions.map((prompt) => (
                          <button
                            key={prompt}
                            onClick={() => {
                              onSendMessage(prompt);
                              onClose();
                            }}
                            className="text-left text-xs px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-violet-500/30 text-white/80 hover:text-violet-200 transition-all flex items-center justify-between group"
                          >
                            <span>{prompt}</span>
                            <span className="text-white/30 group-hover:text-violet-300 text-[10px]">Send &rarr;</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : filteredMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-white/40 space-y-2 my-auto">
                  <Search size={24} className="opacity-50" />
                  <p className="text-xs">No messages matched &ldquo;{searchQuery}&rdquo;</p>
                  <button
                    onClick={() => setSearchQuery("")}
                    className="text-xs text-violet-400 hover:underline"
                  >
                    Clear search filter
                  </button>
                </div>
              ) : (
                filteredMessages.map((msg, index) => {
                  const isUser = msg.sender === "user";
                  const time = parseMessageTime(msg.id, msg.timestamp);
                  const isPlaying = playingAudioId === msg.id;
                  const isCopied = copiedId === msg.id;

                  return (
                    <motion.div
                      key={msg.id || index}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
                    >
                      {/* Sender Info / Header */}
                      <div className={`flex items-center gap-1.5 px-1 text-[11px] text-white/40 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
                        <span className="font-medium text-white/60">
                          {isUser ? "Hussain (तुम)" : "ज़ोया (Zoya)"}
                        </span>
                        {time && (
                          <>
                            <span>&middot;</span>
                            <span className="font-mono tabular-nums text-[10px]">{time}</span>
                          </>
                        )}
                      </div>

                      {/* Bubble */}
                      <div
                        className={`group relative max-w-[88%] rounded-2xl p-3 text-xs md:text-[13px] leading-relaxed transition-all ${
                          isUser
                            ? "bg-violet-600/25 border border-violet-500/30 text-violet-50 rounded-tr-xs"
                            : "bg-white/5 border border-white/10 text-white/90 rounded-tl-xs hover:border-white/20"
                        }`}
                      >
                        <p className="whitespace-pre-wrap select-text break-words">{msg.text}</p>

                        {/* Action buttons (Copy / Speak) */}
                        <div
                          className={`mt-2 pt-1.5 border-t border-white/5 flex items-center gap-1 opacity-80 md:opacity-0 group-hover:opacity-100 transition-opacity ${
                            isUser ? "justify-end" : "justify-between"
                          }`}
                        >
                          {!isUser && (
                            <button
                              onClick={() => handlePlayVoice(msg.id, msg.text)}
                              disabled={isPlaying}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
                                isPlaying
                                  ? "bg-pink-500/20 text-pink-300"
                                  : "text-white/50 hover:text-pink-300 hover:bg-white/5"
                              }`}
                              title="Listen to Zoya's response"
                            >
                              {isPlaying ? (
                                <>
                                  <Loader2 size={11} className="animate-spin" />
                                  <span>Speaking...</span>
                                </>
                              ) : (
                                <>
                                  <Volume2 size={11} />
                                  <span>Listen</span>
                                </>
                              )}
                            </button>
                          )}

                          <button
                            onClick={() => handleCopy(msg.id, msg.text)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-white/50 hover:text-white hover:bg-white/5 transition-colors ml-auto"
                            title="Copy message to clipboard"
                          >
                            {isCopied ? (
                              <>
                                <Check size={11} className="text-emerald-400" />
                                <span className="text-emerald-400">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy size={11} />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
              <div ref={listEndRef} />
            </div>

            {/* Scroll-to-bottom Floating Button */}
            {!isScrolledToBottom && messages.length > 5 && (
              <button
                onClick={scrollToBottom}
                className="absolute bottom-16 right-5 p-2 rounded-full bg-violet-600/90 text-white shadow-lg border border-violet-400/40 hover:bg-violet-500 transition-all"
                title="Scroll to latest message"
              >
                <ArrowDown size={14} />
              </button>
            )}

            {/* Drawer Footer Status */}
            <div className="p-3 border-t border-white/10 bg-[#0a0f18]/90 text-[11px] text-white/40 flex items-center justify-between">
              <span>{filteredMessages.length} displayed</span>
              <button
                onClick={onClose}
                className="hover:text-white transition-colors"
              >
                Close Drawer &times;
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
