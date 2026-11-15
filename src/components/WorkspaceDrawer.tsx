import React, { useState, useEffect, useCallback } from "react";
import type { User } from "firebase/auth";
import {
  X,
  Calendar,
  Users,
  Search,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  MapPin,
  Clock,
  Mail,
  Phone,
  Copy,
  Check,
  LogOut,
  Loader2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  initAuth,
  googleSignIn,
  getAccessToken,
  clearAccessToken,
  logout,
} from "../services/workspaceAuth";
import {
  listCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  listContacts,
  WorkspaceAuthExpiredError,
} from "../services/workspaceApi";
import type {
  WorkspaceTab,
  WorkspaceCommandPayload,
  CalendarEventItem,
  ContactItem,
} from "../types/workspace";

interface WorkspaceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  pendingCommand: WorkspaceCommandPayload | null;
  onCommandHandled: () => void;
  onAskZoya?: (prompt: string) => void;
}

interface PendingConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
  isDestructive?: boolean;
  onConfirm: () => Promise<void>;
}

function formatEventTimeRange(event: CalendarEventItem): string {
  const startRaw = event.start?.dateTime || event.start?.date;
  const endRaw = event.end?.dateTime || event.end?.date;
  if (!startRaw) return "";

  if (!event.start?.dateTime) {
    return `${startRaw} (All day)`;
  }

  const startDate = new Date(startRaw);
  const dateLabel = startDate.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startTime = startDate.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endTime = endRaw
    ? new Date(endRaw).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return endTime ? `${dateLabel} · ${startTime} – ${endTime}` : `${dateLabel} · ${startTime}`;
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function WorkspaceDrawer({
  isOpen,
  onClose,
  pendingCommand,
  onCommandHandled,
  onAskZoya,
}: WorkspaceDrawerProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("calendar");
  const [needsAuth, setNeedsAuth] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Shared search/load state
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Data per service
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [contacts, setContacts] = useState<ContactItem[]>([]);

  // Calendar Create/Edit Form
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventSummary, setEventSummary] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventStart, setEventStart] = useState(() => {
    const d = new Date(Date.now() + 3600000);
    d.setMinutes(0, 0, 0);
    return toLocalInputValue(d);
  });
  const [eventEnd, setEventEnd] = useState(() => {
    const d = new Date(Date.now() + 7200000);
    d.setMinutes(0, 0, 0);
    return toLocalInputValue(d);
  });

  // Explicit Confirmation Modal State (MANDATORY before Calendar mutations/deletes)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmation | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  useEffect(() => {
    const unsubscribe = initAuth(
      (authedUser) => {
        setUser(authedUser);
        setNeedsAuth(false);
      },
      (firebaseUser) => {
        setUser(firebaseUser);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (pendingConfirm) {
          setPendingConfirm(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, pendingConfirm, onClose]);

  const loadActiveTabData = useCallback(
    async (tab: WorkspaceTab, queryOverride?: string) => {
      const token = getAccessToken();
      if (!token) {
        setNeedsAuth(true);
        return;
      }

      const q = queryOverride !== undefined ? queryOverride : searchQuery;
      setIsLoading(true);
      setApiError(null);

      try {
        if (tab === "calendar") {
          const items = await listCalendarEvents(token, q);
          setEvents(items);
        } else {
          const people = await listContacts(token, q);
          setContacts(people);
        }
      } catch (err) {
        if (err instanceof WorkspaceAuthExpiredError) {
          clearAccessToken();
          setNeedsAuth(true);
          setAuthError("Your Google Workspace session expired. Please sign in again.");
        } else {
          setApiError(
            err instanceof Error ? err.message : "Failed to load Workspace data."
          );
        }
      } finally {
        setIsLoading(false);
      }
    },
    [searchQuery]
  );

  // Handle incoming commands from Zoya (voice or text)
  useEffect(() => {
    if (!pendingCommand || !isOpen) return;
    setActiveTab(pendingCommand.tab);
    const nextQuery = pendingCommand.query || "";
    setSearchQuery(nextQuery);
    if (!needsAuth && getAccessToken()) {
      void loadActiveTabData(pendingCommand.tab, nextQuery);
    }
    onCommandHandled();
  }, [pendingCommand, isOpen, needsAuth]);

  // Auto-load when drawer opens or tab switches while signed in
  useEffect(() => {
    if (isOpen && !needsAuth && getAccessToken()) {
      void loadActiveTabData(activeTab);
    }
  }, [isOpen, activeTab, needsAuth]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn();
      setUser(result.user);
      setNeedsAuth(false);
      await loadActiveTabData(activeTab);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : "Sign in with Google failed."
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setNeedsAuth(true);
    setEvents([]);
    setContacts([]);
  };

  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const openCreateForm = () => {
    const start = new Date(Date.now() + 3600000);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    setEditingEventId(null);
    setEventSummary("");
    setEventLocation("");
    setEventDescription("");
    setEventStart(toLocalInputValue(start));
    setEventEnd(toLocalInputValue(end));
    setShowEventForm(true);
  };

  const openEditForm = (event: CalendarEventItem) => {
    setEditingEventId(event.id);
    setEventSummary(event.summary || "");
    setEventLocation(event.location || "");
    setEventDescription(event.description || "");
    if (event.start?.dateTime) {
      setEventStart(toLocalInputValue(new Date(event.start.dateTime)));
    }
    if (event.end?.dateTime) {
      setEventEnd(toLocalInputValue(new Date(event.end.dateTime)));
    }
    setShowEventForm(true);
  };

  const requestEventSaveConfirmation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventSummary.trim()) return;

    const isUpdate = Boolean(editingEventId);
    const startLabel = new Date(eventStart).toLocaleString();
    const endLabel = new Date(eventEnd).toLocaleString();

    setPendingConfirm({
      title: isUpdate ? "Update Calendar Event?" : "Create Calendar Event?",
      description: isUpdate
        ? `Update "${eventSummary.trim()}" (${startLabel} to ${endLabel}) on your Google Calendar?`
        : `Add "${eventSummary.trim()}" (${startLabel} to ${endLabel}) to your Google Calendar?`,
      confirmLabel: isUpdate ? "Confirm Update" : "Confirm Create",
      isDestructive: false,
      onConfirm: async () => {
        const token = getAccessToken();
        if (!token) {
          setNeedsAuth(true);
          return;
        }
        if (isUpdate && editingEventId) {
          await updateCalendarEvent(token, editingEventId, {
            summary: eventSummary.trim(),
            location: eventLocation.trim(),
            description: eventDescription.trim(),
            startDateTime: eventStart,
            endDateTime: eventEnd,
          });
        } else {
          await createCalendarEvent(token, {
            summary: eventSummary.trim(),
            location: eventLocation.trim(),
            description: eventDescription.trim(),
            startDateTime: eventStart,
            endDateTime: eventEnd,
          });
        }
        setShowEventForm(false);
        setEditingEventId(null);
        await loadActiveTabData("calendar");
      },
    });
  };

  const requestEventDeleteConfirmation = (event: CalendarEventItem) => {
    const title = event.summary || "Untitled event";
    const timeRange = formatEventTimeRange(event);
    setPendingConfirm({
      title: "Delete Calendar Event?",
      description: `Permanently delete "${title}"${timeRange ? ` (${timeRange})` : ""} from your Google Calendar? This action cannot be undone.`,
      confirmLabel: "Delete Event",
      isDestructive: true,
      onConfirm: async () => {
        const token = getAccessToken();
        if (!token) {
          setNeedsAuth(true);
          return;
        }
        await deleteCalendarEvent(token, event.id);
        await loadActiveTabData("calendar");
      },
    });
  };

  const executeConfirmedAction = async () => {
    if (!pendingConfirm) return;
    setIsMutating(true);
    setApiError(null);
    try {
      await pendingConfirm.onConfirm();
      setPendingConfirm(null);
    } catch (err) {
      if (err instanceof WorkspaceAuthExpiredError) {
        clearAccessToken();
        setNeedsAuth(true);
        setPendingConfirm(null);
      } else {
        setApiError(err instanceof Error ? err.message : "Operation failed.");
        setPendingConfirm(null);
      }
    } finally {
      setIsMutating(false);
    }
  };

  const handleSummarizeWithZoya = () => {
    if (!onAskZoya) return;
    if (activeTab === "calendar" && events.length > 0) {
      const preview = events
        .slice(0, 5)
        .map((e) => `- ${e.summary || "Untitled"} (${formatEventTimeRange(e)})`)
        .join("\n");
      onAskZoya(`ज़ोया, मेरे इन आने वाले Calendar events का छोटा और प्यारा summary बताओ ना:\n${preview}`);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/65 backdrop-blur-xs z-40"
            aria-hidden="true"
          />

          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed inset-y-0 right-0 w-full max-w-[540px] bg-[#070b12]/98 border-l border-white/10 text-white z-40 flex flex-col shadow-2xl backdrop-blur-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Google Workspace"
          >
            {/* Header */}
            <div className="p-4 md:p-5 border-b border-white/10 bg-[#0a0f18]/90 flex flex-col gap-3 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-600/40 to-pink-500/40 border border-violet-500/30 flex items-center justify-center">
                    <Calendar size={16} className="text-violet-300" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-wide text-white">
                      Google Workspace
                    </h2>
                    <p className="text-[11px] text-white/45">
                      Calendar &amp; Contacts
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {!needsAuth && (
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-white/65 hover:text-white hover:bg-white/10 border border-white/10 transition-colors"
                      title="Sign out of Google"
                    >
                      <LogOut size={13} />
                      <span className="hidden sm:inline">Sign out</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                    aria-label="Close Google Workspace panel"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Connected Account Bar */}
              {!needsAuth && user && (
                <div className="flex items-center justify-between text-xs bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || "Google User"}
                        className="w-6 h-6 rounded-full border border-white/20"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-violet-500/30 flex items-center justify-center text-[11px] font-semibold">
                        {(user.displayName || user.email || "U")[0].toUpperCase()}
                      </div>
                    )}
                    <div className="truncate">
                      <span className="font-medium text-white/90">
                        {user.displayName || "Connected Account"}
                      </span>
                      {user.email && (
                        <span className="text-white/45 ml-1.5 text-[11px]">
                          ({user.email})
                        </span>
                      )}
                    </div>
                  </div>
                  {onAskZoya && activeTab === "calendar" && events.length > 0 && (
                    <button
                      type="button"
                      onClick={handleSummarizeWithZoya}
                      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 text-[11px] font-medium transition-colors"
                    >
                      <Sparkles size={11} />
                      Ask Zoya
                    </button>
                  )}
                </div>
              )}

              {/* Tabs */}
              <div className="grid grid-cols-2 gap-1.5 bg-white/5 p-1 rounded-xl border border-white/10">
                {[
                  { id: "calendar" as const, label: "Calendar", icon: Calendar },
                  { id: "contacts" as const, label: "Contacts", icon: Users },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setActiveTab(id);
                      setSearchQuery("");
                      setApiError(null);
                    }}
                    className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      activeTab === id
                        ? "bg-gradient-to-r from-violet-600 to-pink-600 text-white shadow"
                        : "text-white/60 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>

              {/* Search & Actions */}
              {!needsAuth && (
                <div className="flex items-center gap-2">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void loadActiveTabData(activeTab);
                    }}
                    className="relative flex-1"
                  >
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={
                        activeTab === "calendar"
                          ? "Search calendar events..."
                          : "Search contacts..."
                      }
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-8 pr-8 py-1.5 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-violet-500/60"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery("");
                          void loadActiveTabData(activeTab, "");
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </form>

                  <button
                    type="button"
                    onClick={() => void loadActiveTabData(activeTab)}
                    disabled={isLoading}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/75 hover:text-white transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw
                      size={14}
                      className={isLoading ? "animate-spin" : ""}
                    />
                  </button>

                  {activeTab === "calendar" && (
                    <button
                      type="button"
                      onClick={openCreateForm}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white transition-colors shrink-0"
                    >
                      <Plus size={14} />
                      New Event
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-3 relative">
              {needsAuth ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-5">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-violet-500/20 to-pink-500/20 border border-white/15 flex items-center justify-center">
                    <Calendar size={26} className="text-violet-300" />
                  </div>
                  <div className="space-y-1.5 max-w-xs">
                    <h3 className="text-base font-semibold text-white">
                      Connect Google Workspace
                    </h3>
                    <p className="text-xs text-white/55 leading-relaxed">
                      Sign in with your Google account so Zoya can manage your Calendar events and search your Contacts.
                    </p>
                  </div>

                  {authError && (
                    <p className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-lg px-3 py-2 max-w-xs">
                      {authError}
                    </p>
                  )}

                  {/* Official Sign in with Google button */}
                  <button
                    type="button"
                    onClick={handleLogin}
                    disabled={isLoggingIn}
                    className="gsi-material-button inline-flex items-center gap-3 px-5 py-2.5 rounded-full bg-white hover:bg-slate-50 active:bg-slate-100 text-[#1f1f1f] font-medium text-sm shadow-lg border border-slate-300 transition-all cursor-pointer disabled:opacity-60"
                  >
                    <div className="gsi-material-button-icon w-5 h-5 shrink-0">
                      <svg
                        version="1.1"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 48 48"
                        style={{ display: "block" }}
                      >
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                        <path fill="none" d="M0 0h48v48H0z" />
                      </svg>
                    </div>
                    <span className="gsi-material-button-contents">
                      {isLoggingIn ? "Signing in..." : "Sign in with Google"}
                    </span>
                  </button>
                </div>
              ) : (
                <>
                  {apiError && (
                    <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/35 text-xs text-rose-200 flex items-start gap-2">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5 text-rose-400" />
                      <span>{apiError}</span>
                    </div>
                  )}

                  {/* Create / Edit Calendar Event Form */}
                  {activeTab === "calendar" && showEventForm && (
                    <form
                      onSubmit={requestEventSaveConfirmation}
                      className="p-3.5 rounded-2xl bg-white/5 border border-violet-500/35 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-violet-200">
                          {editingEventId ? "Edit Calendar Event" : "Schedule New Event"}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setShowEventForm(false)}
                          className="text-white/50 hover:text-white"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <input
                        type="text"
                        required
                        value={eventSummary}
                        onChange={(e) => setEventSummary(e.target.value)}
                        placeholder="Event title"
                        className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-violet-500"
                      />

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-white/50 mb-1">
                            Start
                          </label>
                          <input
                            type="datetime-local"
                            required
                            value={eventStart}
                            onChange={(e) => setEventStart(e.target.value)}
                            className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-white/50 mb-1">
                            End
                          </label>
                          <input
                            type="datetime-local"
                            required
                            value={eventEnd}
                            onChange={(e) => setEventEnd(e.target.value)}
                            className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
                          />
                        </div>
                      </div>

                      <input
                        type="text"
                        value={eventLocation}
                        onChange={(e) => setEventLocation(e.target.value)}
                        placeholder="Location (optional)"
                        className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-violet-500"
                      />

                      <textarea
                        rows={2}
                        value={eventDescription}
                        onChange={(e) => setEventDescription(e.target.value)}
                        placeholder="Notes or description (optional)"
                        className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-violet-500 resize-none"
                      />

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setShowEventForm(false)}
                          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white/75"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white"
                        >
                          {editingEventId ? "Review Update" : "Review & Create"}
                        </button>
                      </div>
                    </form>
                  )}

                  {isLoading ? (
                    <div className="py-16 flex flex-col items-center justify-center gap-2 text-white/50 text-xs">
                      <Loader2 size={22} className="animate-spin text-violet-400" />
                      <span>Loading your {activeTab}...</span>
                    </div>
                  ) : activeTab === "calendar" ? (
                    events.length === 0 ? (
                      <div className="py-14 text-center text-xs text-white/45 space-y-2">
                        <Calendar size={26} className="mx-auto opacity-50" />
                        <p>No upcoming calendar events found.</p>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {events.map((event) => (
                          <div
                            key={event.id}
                            className="p-3.5 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 transition-all space-y-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="text-sm font-medium text-white leading-snug">
                                {event.summary || "(No title)"}
                              </h4>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => openEditForm(event)}
                                  className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                                  title="Edit event"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => requestEventDeleteConfirmation(event)}
                                  className="p-1.5 rounded-lg text-white/50 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                  title="Delete event"
                                >
                                  <Trash2 size={13} />
                                </button>
                                {event.htmlLink && (
                                  <a
                                    href={event.htmlLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 rounded-lg text-white/50 hover:text-violet-300 hover:bg-white/10 transition-colors"
                                    title="Open in Google Calendar"
                                  >
                                    <ExternalLink size={13} />
                                  </a>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-violet-300/90">
                              <span className="inline-flex items-center gap-1">
                                <Clock size={11} />
                                {formatEventTimeRange(event)}
                              </span>
                              {event.location && (
                                <span className="inline-flex items-center gap-1 text-white/60">
                                  <MapPin size={11} />
                                  {event.location}
                                </span>
                              )}
                            </div>

                            {event.description && (
                              <p className="text-xs text-white/60 line-clamp-2 leading-relaxed">
                                {event.description}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  ) : contacts.length === 0 ? (
                    <div className="py-14 text-center text-xs text-white/45 space-y-2">
                      <Users size={26} className="mx-auto opacity-50" />
                      <p>No contacts found.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {contacts.map((person) => (
                        <div
                          key={person.resourceName}
                          className="p-3 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 transition-all flex items-start justify-between gap-3"
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            {person.photoUrl ? (
                              <img
                                src={person.photoUrl}
                                alt={person.displayName}
                                className="w-9 h-9 rounded-full border border-white/15 shrink-0 object-cover"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-violet-500/30 to-pink-500/30 border border-white/15 flex items-center justify-center text-xs font-semibold shrink-0">
                                {person.displayName[0]?.toUpperCase() || "?"}
                              </div>
                            )}

                            <div className="min-w-0 space-y-1">
                              <p className="text-xs md:text-[13px] font-medium text-white truncate">
                                {person.displayName}
                              </p>
                              {person.organization && (
                                <p className="text-[11px] text-white/45 truncate">
                                  {person.organization}
                                </p>
                              )}

                              <div className="flex flex-wrap gap-2 pt-0.5">
                                {person.email && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleCopy(
                                        `${person.resourceName}-email`,
                                        person.email!
                                      )
                                    }
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-[11px] text-white/75 transition-colors"
                                    title="Copy email"
                                  >
                                    <Mail size={10} className="text-violet-300" />
                                    <span className="truncate max-w-[170px]">
                                      {person.email}
                                    </span>
                                    {copiedKey === `${person.resourceName}-email` ? (
                                      <Check size={10} className="text-emerald-400" />
                                    ) : (
                                      <Copy size={10} className="opacity-50" />
                                    )}
                                  </button>
                                )}

                                {person.phone && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleCopy(
                                        `${person.resourceName}-phone`,
                                        person.phone!
                                      )
                                    }
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-[11px] text-white/75 transition-colors"
                                    title="Copy phone number"
                                  >
                                    <Phone size={10} className="text-pink-300" />
                                    <span>{person.phone}</span>
                                    {copiedKey === `${person.resourceName}-phone` ? (
                                      <Check size={10} className="text-emerald-400" />
                                    ) : (
                                      <Copy size={10} className="opacity-50" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Mandatory Explicit Confirmation Modal for Mutations / Deletions */}
            <AnimatePresence>
              {pendingConfirm && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-5"
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="w-full max-w-sm bg-[#0d1320] border border-white/15 rounded-2xl p-5 shadow-2xl space-y-4"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          pendingConfirm.isDestructive
                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                            : "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                        }`}
                      >
                        <AlertTriangle size={18} />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-white">
                          {pendingConfirm.title}
                        </h3>
                        <p className="text-xs text-white/70 leading-relaxed">
                          {pendingConfirm.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => setPendingConfirm(null)}
                        className="px-3.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white/80 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => void executeConfirmedAction()}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-medium text-white flex items-center gap-1.5 transition-colors ${
                          pendingConfirm.isDestructive
                            ? "bg-rose-600 hover:bg-rose-500"
                            : "bg-violet-600 hover:bg-violet-500"
                        }`}
                      >
                        {isMutating && <Loader2 size={12} className="animate-spin" />}
                        {pendingConfirm.confirmLabel}
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
