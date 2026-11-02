import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic";
import type { LanguageModel } from "ai";

/**
 * The model provider is chosen with LLM_PROVIDER. The PayPal Agent Toolkit
 * targets the AI SDK tool format, so every provider the AI SDK supports can
 * drive the agent loop unchanged.
 *
 *   google    Gemini through Google AI Studio      GOOGLE_GENERATIVE_AI_API_KEY
 *   anthropic Claude through the Anthropic API     ANTHROPIC_API_KEY
 *   vertex    Gemini or Claude through Vertex AI   GOOGLE_VERTEX_PROJECT (+ ADC or GOOGLE_CREDENTIALS_JSON)
 */
export type Provider = "google" | "anthropic" | "vertex";

const DEFAULT_MODEL: Record<Provider, string> = {
  google: "gemini-3.1-pro-preview",
  anthropic: "claude-opus-5-5",
  vertex: "gemini-3.1-pro-preview",
};

export const PROVIDER: Provider = (() => {
  const p = (process.env.LLM_PROVIDER ?? "google").toLowerCase();
  if (p === "google" || p === "anthropic" || p === "vertex") return p;
  throw new Error(`LLM_PROVIDER must be google, anthropic, or vertex (got "${p}")`);
})();

export const MODEL_ID = process.env.LLM_MODEL || DEFAULT_MODEL[PROVIDER];

/** Human-readable label for the UI, e.g. "Gemini 2.5 Pro" or "Claude Opus 5.5". */
export const MODEL_LABEL = (() => {
  const id = MODEL_ID.replace(/-preview.*$/, "").replace(/@.*$/, "");
  const parts = id.split("-");
  const family = parts[0] === "gemini" ? "Gemini" : parts[0] === "claude" ? "Claude" : parts[0];
  const rest = parts
    .slice(1)
    .map((s) => (/^\d+$/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1)))
    .join(" ")
    .replace(/(\d+) (\d+)/g, "$1.$2");
  return `${family} ${rest}`.trim();
})();

/** The env var that must hold the provider's credential, for health checks and error messages. */
export const CREDENTIAL_ENV: Record<Provider, string> = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  vertex: "GOOGLE_VERTEX_PROJECT",
};

export function hasModelCredentials(): boolean {
  return Boolean(process.env[CREDENTIAL_ENV[PROVIDER]]);
}

function vertexAuth() {
  // On hosts without gcloud (Render), pass a service-account key as JSON in one env var.
  const json = process.env.GOOGLE_CREDENTIALS_JSON;
  return json ? { credentials: JSON.parse(json) as Record<string, string> } : undefined;
}

export function getModel(): LanguageModel {
  if (!hasModelCredentials()) {
    throw new Error(`${CREDENTIAL_ENV[PROVIDER]} must be set for LLM_PROVIDER=${PROVIDER} (see .env.example)`);
  }
  switch (PROVIDER) {
    case "google":
      return google(MODEL_ID);
    case "anthropic":
      return anthropic(MODEL_ID);
    case "vertex": {
      const opts = {
        project: process.env.GOOGLE_VERTEX_PROJECT,
        location: process.env.GOOGLE_VERTEX_LOCATION ?? "global",
        googleAuthOptions: vertexAuth(),
      };
      return MODEL_ID.startsWith("claude") ? createVertexAnthropic(opts)(MODEL_ID) : createVertex(opts)(MODEL_ID);
    }
  }
}

type Effort = "low" | "medium" | "high";

/**
 * Provider options shared by every call. Keys are per provider, so each
 * provider only reads its own entry and ignores the rest.
 */
export const providerOptions = {
  anthropic: {
    effort: (process.env.LLM_EFFORT as Effort | undefined) ?? "medium",
  },
};
