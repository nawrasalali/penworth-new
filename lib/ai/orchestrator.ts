import Anthropic from '@anthropic-ai/sdk';
import { AgentType, Industry, ModelTier, AgentConfig } from '@/types';
import { getAgentPrompt } from './agents';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Model mapping
const MODEL_MAP: Record<ModelTier, string> = {
  opus: 'claude-sonnet-4-20250514', // Using Sonnet as Opus placeholder for cost efficiency
  sonnet: 'claude-sonnet-4-20250514',
  haiku: 'claude-sonnet-4-20250514', // Will switch to Haiku when available
};

// Model selection based on task criticality
const AGENT_MODEL_TIERS: Record<AgentType, ModelTier> = {
  interview: 'sonnet',
  outline: 'sonnet',
  research: 'sonnet', // Upgrade to opus for complex research
  writing: 'sonnet',
  layout: 'haiku',
  verification: 'opus', // Always use best model for verification
  compliance: 'opus',   // Always use best model for compliance
  review: 'sonnet',
};

// Token limits per model tier
const TOKEN_LIMITS: Record<ModelTier, number> = {
  opus: 4096,
  sonnet: 4096,
  haiku: 2048,
};

export interface OrchestrationContext {
  projectId: string;
  industry: Industry;
  agentType: AgentType;
  userMessage: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  projectContext?: {
    title: string;
    description?: string;
    contentType: string;
    existingContent?: string;
  };
  organizationBranding?: {
    name?: string;
    tone?: string;
    customInstructions?: string;
  };
}

export interface OrchestrationResult {
  content: string;
  model: string;
  tokensUsed: {
    input: number;
    output: number;
  };
  confidence?: number;
  citations?: Array<{
    text: string;
    source: string;
  }>;
}

/**
 * Main orchestration function for routing messages to appropriate agents
 */
export async function orchestrateAgent(
  context: OrchestrationContext
): Promise<OrchestrationResult> {
  const { industry, agentType, userMessage, conversationHistory, projectContext, organizationBranding } = context;

  // Get the appropriate model tier for this agent
  const modelTier = AGENT_MODEL_TIERS[agentType];
  const model = MODEL_MAP[modelTier];
  const maxTokens = TOKEN_LIMITS[modelTier];

  // Build the system prompt
  const basePrompt = getAgentPrompt(industry, agentType);
  const systemPrompt = buildSystemPrompt(basePrompt, projectContext, organizationBranding);

  // Build message history
  const messages = buildMessages(userMessage, conversationHistory);

  // Call Claude API
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  // Extract content
  const content = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('\n');

  return {
    content,
    model,
    tokensUsed: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  };
}

/**
 * Streaming orchestration for real-time responses
 */
export async function* orchestrateAgentStream(
  context: OrchestrationContext
): AsyncGenerator<string, OrchestrationResult> {
  const { industry, agentType, userMessage, conversationHistory, projectContext, organizationBranding } = context;

  const modelTier = AGENT_MODEL_TIERS[agentType];
  const model = MODEL_MAP[modelTier];
  const maxTokens = TOKEN_LIMITS[modelTier];

  const basePrompt = getAgentPrompt(industry, agentType);
  const systemPrompt = buildSystemPrompt(basePrompt, projectContext, organizationBranding);
  const messages = buildMessages(userMessage, conversationHistory);

  let fullContent = '';
  let inputTokens = 0;
  let outputTokens = 0;

  const stream = anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullContent += event.delta.text;
      yield event.delta.text;
    }
    if (event.type === 'message_delta' && event.usage) {
      outputTokens = event.usage.output_tokens;
    }
    if (event.type === 'message_start' && event.message.usage) {
      inputTokens = event.message.usage.input_tokens;
    }
  }

  return {
    content: fullContent,
    model,
    tokensUsed: {
      input: inputTokens,
      output: outputTokens,
    },
  };
}

/**
 * Build the complete system prompt with context
 */
function buildSystemPrompt(
  basePrompt: string,
  projectContext?: OrchestrationContext['projectContext'],
  organizationBranding?: OrchestrationContext['organizationBranding']
): string {
  let prompt = basePrompt;

  // Add project context if available
  if (projectContext) {
    prompt += `\n\n<project_context>
Project Title: ${projectContext.title}
Content Type: ${projectContext.contentType}
${projectContext.description ? `Description: ${projectContext.description}` : ''}
${projectContext.existingContent ? `\nExisting Content Summary: ${projectContext.existingContent.slice(0, 1000)}...` : ''}
</project_context>`;
  }

  // Add organization branding if available
  if (organizationBranding) {
    prompt += `\n\n<organization_context>
${organizationBranding.name ? `Organization: ${organizationBranding.name}` : ''}
${organizationBranding.tone ? `Preferred Tone: ${organizationBranding.tone}` : ''}
${organizationBranding.customInstructions ? `Custom Instructions: ${organizationBranding.customInstructions}` : ''}
</organization_context>`;
  }

  return prompt;
}

/**
 * Build message array for API call
 */
function buildMessages(
  userMessage: string,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // Add conversation history
  if (conversationHistory && conversationHistory.length > 0) {
    // Limit history to last 10 exchanges to manage context
    const recentHistory = conversationHistory.slice(-20);
    messages.push(...recentHistory);
  }

  // Add current user message
  messages.push({ role: 'user', content: userMessage });

  return messages;
}

/**
 * Route to verification agent for fact-checking
 */
export async function verifyContent(
  content: string,
  industry: Industry,
  sources?: string[]
): Promise<{
  verified: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
}> {
  const verificationPrompt = `You are a verification agent. Analyze the following content for factual accuracy, potential hallucinations, and compliance with ${industry} industry standards.

Content to verify:
${content}

${sources ? `Available sources for verification:\n${sources.join('\n')}` : ''}

Respond in JSON format:
{
  "verified": boolean,
  "confidence": 0-100,
  "issues": ["list of identified issues"],
  "suggestions": ["list of suggestions for improvement"]
}`;

  const response = await anthropic.messages.create({
    model: MODEL_MAP.opus,
    max_tokens: 1024,
    messages: [{ role: 'user', content: verificationPrompt }],
  });

  const responseText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('');

  try {
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // Fallback if JSON parsing fails
  }

  return {
    verified: false,
    confidence: 0,
    issues: ['Unable to parse verification response'],
    suggestions: ['Manual review recommended'],
  };
}

/**
 * Determine optimal agent routing based on user request
 */
export function determineAgentType(userMessage: string): AgentType {
  const lowerMessage = userMessage.toLowerCase();

  // Interview patterns
  if (
    lowerMessage.includes('tell me about') ||
    lowerMessage.includes('what do you want') ||
    lowerMessage.includes('help me figure out') ||
    lowerMessage.includes('interview')
  ) {
    return 'interview';
  }

  // Outline patterns
  if (
    lowerMessage.includes('outline') ||
    lowerMessage.includes('structure') ||
    lowerMessage.includes('chapters') ||
    lowerMessage.includes('organize')
  ) {
    return 'outline';
  }

  // Research patterns
  if (
    lowerMessage.includes('research') ||
    lowerMessage.includes('find information') ||
    lowerMessage.includes('what does') ||
    lowerMessage.includes('sources')
  ) {
    return 'research';
  }

  // Verification patterns
  if (
    lowerMessage.includes('verify') ||
    lowerMessage.includes('check') ||
    lowerMessage.includes('fact-check') ||
    lowerMessage.includes('accurate')
  ) {
    return 'verification';
  }

  // Compliance patterns
  if (
    lowerMessage.includes('comply') ||
    lowerMessage.includes('regulation') ||
    lowerMessage.includes('legal') ||
    lowerMessage.includes('standard')
  ) {
    return 'compliance';
  }

  // Review patterns
  if (
    lowerMessage.includes('review') ||
    lowerMessage.includes('feedback') ||
    lowerMessage.includes('improve') ||
    lowerMessage.includes('edit')
  ) {
    return 'review';
  }

  // Layout patterns
  if (
    lowerMessage.includes('format') ||
    lowerMessage.includes('layout') ||
    lowerMessage.includes('design') ||
    lowerMessage.includes('style')
  ) {
    return 'layout';
  }

  // Default to writing
  return 'writing';
}
