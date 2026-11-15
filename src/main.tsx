import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Tier 1: Global Google Maps JS SDK quota and auth failure interception
(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent("gmp-quota-exceeded"));
};

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  origConsoleError(...args);
  const text = args
    .map((arg) => (typeof arg === "string" ? arg : arg instanceof Error ? arg.message : ""))
    .join(" ");
  if (text.includes("OverQuotaMapError") || text.includes("QuotaExceededError")) {
    window.dispatchEvent(new CustomEvent("gmp-quota-exceeded"));
  }
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
