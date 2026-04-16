// Shared TypeScript interfaces used across backend services
// Pre-Phase 0.4: All subsequent phases depend on these types

// --- Local LLM / AI Response ---

export interface GenerateResult {
  text: string;
  tokensUsed: number;
  stopReason: string;
  toolCalls: ToolCall[];
}

// --- Tool System ---

export interface ToolDefinition {
  name: string;
  description: string;
  type: 'custom';
  enabled: boolean;
  inputSchema?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export interface ToolExecution {
  id: string;
  toolName: string;
  userId: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
  durationMs: number;
  tokensUsed: number;
  createdAt: string;
}

// --- Security ---

export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SecurityEvent {
  id: number;
  eventType: string;
  userHandle: string;
  details: Record<string, unknown>;
  severity: SecuritySeverity;
  createdAt: string;
}

export interface RateLimitState {
  userHandle: string;
  windowStart: number;
  requestCount: number;
  isLimited: boolean;
}

// --- Memory / Context ---

export interface UserFact {
  id: string;
  userId: string;
  type: 'preference' | 'personal' | 'behavioral' | 'general';
  content: string;
  source: string;
  confidence: number;
  lastUsedAt: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  conversationId: string;
  summary: string;
  messageRange: { start: string; end: string };
  createdAt: string;
}

// --- Message Formatting ---

export interface FormatterOptions {
  maxResponseChars: number;
  hardMaxChars: number;
  maxChunks: number;
  chunkDelayMs: number;
  stripMarkdown: boolean;
  allowUrls: boolean;
  maxCitations: number;
  enableSplitting: boolean;
}

export interface FormatterResult {
  chunks: string[];
  wasTruncated: boolean;
  wasSanitized: boolean;
  originalLength: number;
  processedLength: number;
}

// --- Reminders & Triggers ---

export interface Reminder {
  id: string;
  userId: string;
  chatGuid: string;
  message: string;
  scheduledAt: string;
  delivered: boolean;
  createdAt: string;
}

export interface TriggerSchedule {
  interval: 'daily' | 'weekly' | 'monthly';
  time: string; // HH:MM format
  dayOfWeek?: number; // 0=Sunday, 6=Saturday (for weekly)
  dayOfMonth?: number; // 1-31 (for monthly)
}

export interface Trigger {
  id: string;
  userId: string;
  chatGuid: string;
  name: string;
  schedule: TriggerSchedule;
  action: string;
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  createdAt: string;
}

// --- Prompt Building ---

export interface PromptSection {
  tag: string; // e.g. 'IDENTITY', 'PERSONA', 'SAFETY'
  content: string;
  cacheable?: boolean;
}

export interface PromptContext {
  date: string;
  contactName: string | null;
  userFacts: UserFact[];
  conversationSummary: string | null;
  enabledTools: string[];
  chatType: 'individual' | 'group';
  participantCount?: number;
}

// --- API Usage ---

export interface ApiUsageRecord {
  id: number;
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
  model: string;
  createdAt: string;
}

// --- Dashboard / API ---

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface ApiError {
  error: string;
  message?: string;
  details?: Record<string, unknown>;
}
