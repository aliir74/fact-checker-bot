export type Verdict =
  | "True"
  | "Mostly True"
  | "Mixed"
  | "Mostly False"
  | "False"
  | "Satire"
  | "Unverifiable";

export type Confidence = "High" | "Medium" | "Low";

export type ClaimInput =
  | { type: "text"; text: string; truncated?: boolean }
  | { type: "image"; fileId: string; caption?: string }
  | { type: "url"; url: string; surroundingText?: string }
  | { type: "rejected"; reason: string };

export interface FactCheckResult {
  verdict: Verdict;
  confidence: Confidence;
  analysisEn: string;
  analysisFa: string;
  sources: string[];
  sourceType: "fact_check_api" | "ai_analysis";
  claimText: string;
}

export interface CachedClaim {
  claim_hash: string;
  claim_text: string;
  verdict: string;
  confidence: string;
  analysis_en: string | null;
  analysis_fa: string | null;
  sources: string | null;
  source_type: string;
  created_at: string;
}

export interface FactCheckApiResult {
  claim: string;
  claimant: string;
  rating: string;
  source: string;
  url: string;
}

// Telegram types

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: unknown;
  video?: unknown;
  sticker?: unknown;
}

export interface TelegramUser {
  id: number;
  username?: string;
  first_name: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

export interface TelegramDocument {
  file_id: string;
  mime_type?: string;
}
