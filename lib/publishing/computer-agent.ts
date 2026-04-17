/**
 * Penworth Computer — the agent loop.
 *
 * Wraps Anthropic's computer-use tool in a screenshot-action-screenshot
 * cycle against a live Chromium (via BrowserRuntime). Each turn:
 *
 *   1. Take a screenshot
 *   2. Send conversation + screenshot + tool definitions to Claude
 *   3. Claude returns a tool_use (click/type/key/scroll/wait) OR a final
 *      text answer OR a handoff request (e.g. "I need a 2FA code")
 *   4. Execute the action against the page
 *   5. Append the result + append an events row + repeat
 *
 * Control flow is yielded through an async iterator so the API route can
 * stream progress via Server-Sent Events and an operator can cancel or
 * resolve a handoff mid-session.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Page } from 'playwright-core';
import type { BrowserRuntime } from './computer-runtime';

// Keep model choice centralised — opus-4-7 handles UI reasoning best
const COMPUTER_USE_MODEL = 'claude-opus-4-7';
const MAX_TURNS = 40;            // hard safety stop
const MAX_TOKENS_PER_TURN = 4096;

export interface AgentTurnEvent {
  turnIndex: number;
  type: 'screenshot' | 'action' | 'thought' | 'handoff' | 'complete' | 'error';
  payload: Record<string, unknown>;
  screenshot?: Buffer;
}

export interface AgentControl {
  /** Operator cancels the session. Loop exits after current action. */
  cancel(): void;
  /** Operator provides a 2FA code (or any text) the agent was waiting on. */
  resolveHandoff(text: string): void;
}

export interface AgentAttachment {
  /** Agent-facing name. Must match what the system prompt tells Claude about. */
  name: string;
  /** On-disk or in-memory filename the buffer will be written as before upload. */
  filename: string;
  buffer: Buffer;
  mimeType: string;
}

export interface AgentRunOptions {
  runtime: BrowserRuntime;
  systemPrompt: string;
  userGoal: string;
  /**
   * Files the agent can upload into browser file inputs via the upload_file
   * tool. Keyed by .name. The agent only sees the names — never the paths
   * or contents — and calls upload_file with the name it wants.
   */
  attachments?: AgentAttachment[];
  /**
   * Called before each Claude API request. Use this to short-circuit or
   * inject supplemental context (e.g. append "file is now uploaded" after
   * an out-of-band operation).
   */
  onBeforeTurn?: (turnIndex: number) => Promise<string | null>;
}

export interface AgentRunHandle {
  events: AsyncIterable<AgentTurnEvent>;
  control: AgentControl;
}

/**
 * Start an agent run. Returns an async-iterable event stream plus a control
 * handle so the caller (API route) can cancel or resolve handoffs.
 */
export function runAgent(opts: AgentRunOptions): AgentRunHandle {
  let cancelled = false;
  let pendingHandoffResolve: ((text: string) => void) | null = null;

  const control: AgentControl = {
    cancel() {
      cancelled = true;
      if (pendingHandoffResolve) pendingHandoffResolve('[cancelled]');
    },
    resolveHandoff(text) {
      if (pendingHandoffResolve) {
        pendingHandoffResolve(text);
        pendingHandoffResolve = null;
      }
    },
  };

  async function* generate(): AsyncGenerator<AgentTurnEvent, void, unknown> {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { width, height } = opts.runtime.viewport();

    const tools = [
      {
        type: 'computer_20250124' as const,
        name: 'computer',
        display_width_px: width,
        display_height_px: height,
        display_number: 1,
      },
      // Custom tool for user handoff (e.g. need a 2FA code)
      {
        name: 'request_user_input',
        description:
          'Pause and ask the author for input. Use this when you need ' +
          'a 2FA code, email verification link, or any decision only the ' +
          'author can make. The browser stays open while waiting.',
        input_schema: {
          type: 'object' as const,
          properties: {
            reason: {
              type: 'string',
              description: 'Why you need their input (1 short sentence).',
            },
            hint: {
              type: 'string',
              description: 'What format the answer should take (optional).',
            },
          },
          required: ['reason'],
        },
      },
      // Custom tool to report final success with a result URL
      {
        name: 'report_completion',
        description: 'Call this ONCE when the publishing task is fully done.',
        input_schema: {
          type: 'object' as const,
          properties: {
            result_url: {
              type: 'string',
              description: 'URL of the published product if available.',
            },
            summary: {
              type: 'string',
              description: 'One-sentence summary of what was accomplished.',
            },
          },
          required: ['summary'],
        },
      },
      // Custom tool for uploading a file into a browser <input type=file>
      {
        name: 'upload_file',
        description:
          'Upload one of the provided attachments into a file input on ' +
          'the current page. Use this when the page shows a file-picker ' +
          'or drop-zone that expects a real file. Pass a CSS selector that ' +
          "points at the input element (or its parent if it's hidden).",
        input_schema: {
          type: 'object' as const,
          properties: {
            selector: {
              type: 'string',
              description:
                "CSS selector for the <input type='file'> (e.g. 'input[type=file]', " +
                "'input[name=manuscript]', or a data-testid selector).",
            },
            attachment_name: {
              type: 'string',
              description:
                'Which attachment to upload. Must match one of the names listed ' +
                'in the system prompt\'s ATTACHMENTS section.',
            },
          },
          required: ['selector', 'attachment_name'],
        },
      },
    ];

    // Seed the conversation with the user's goal
    const conversation: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: opts.userGoal },
    ];

    for (let turnIndex = 0; turnIndex < MAX_TURNS; turnIndex++) {
      if (cancelled) {
        yield {
          turnIndex,
          type: 'error',
          payload: { reason: 'cancelled_by_user' },
        };
        return;
      }

      const supplemental = opts.onBeforeTurn
        ? await opts.onBeforeTurn(turnIndex)
        : null;
      if (supplemental) {
        conversation.push({ role: 'user', content: supplemental });
      }

      // Capture screenshot before asking Claude what to do next
      const screenshot = await opts.runtime.screenshot();
      yield {
        turnIndex,
        type: 'screenshot',
        payload: { size: screenshot.byteLength },
        screenshot,
      };

      // Add the screenshot to the conversation as a tool_result OR as an
      // initial image, depending on whether there's a prior tool_use to
      // answer. For the first turn it goes as a plain image; after actions
      // it goes as the tool_result for the computer tool_use from last turn.
      const response = await anthropic.messages.create({
        model: COMPUTER_USE_MODEL,
        max_tokens: MAX_TOKENS_PER_TURN,
        system: opts.systemPrompt,
        tools: tools as unknown as Anthropic.Messages.Tool[],
        messages: conversation,
      });

      // Record Claude's assistant turn verbatim
      conversation.push({ role: 'assistant', content: response.content });

      const toolUses = response.content.filter((c) => c.type === 'tool_use');
      const textBlocks = response.content.filter((c) => c.type === 'text');

      if (textBlocks.length) {
        yield {
          turnIndex,
          type: 'thought',
          payload: {
            text: textBlocks.map((t) => (t as Anthropic.Messages.TextBlock).text).join('\n'),
          },
        };
      }

      if (!toolUses.length) {
        // Claude produced only text, no tools — treat as completion
        yield {
          turnIndex,
          type: 'complete',
          payload: {
            stop_reason: response.stop_reason,
            final_text: textBlocks.map((t) => (t as Anthropic.Messages.TextBlock).text).join('\n'),
          },
        };
        return;
      }

      // Execute every tool use in order and package the results
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const block of toolUses) {
        const use = block as Anthropic.Messages.ToolUseBlock;

        if (use.name === 'report_completion') {
          yield {
            turnIndex,
            type: 'complete',
            payload: use.input as Record<string, unknown>,
          };
          return;
        }

        if (use.name === 'request_user_input') {
          const handoffInput = use.input as { reason: string; hint?: string };
          yield {
            turnIndex,
            type: 'handoff',
            payload: handoffInput,
          };
          // Block until the operator resolves it
          const answer = await new Promise<string>((resolve) => {
            pendingHandoffResolve = resolve;
          });
          if (cancelled) {
            yield { turnIndex, type: 'error', payload: { reason: 'cancelled_by_user' } };
            return;
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: `Author responded: ${answer}`,
          });
          continue;
        }

        if (use.name === 'computer') {
          const input = use.input as ComputerToolInput;
          try {
            yield {
              turnIndex,
              type: 'action',
              payload: input as unknown as Record<string, unknown>,
            };
            const shot = await executeComputerAction(opts.runtime.page, input);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: use.id,
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: shot.toString('base64'),
                  },
                },
              ],
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: use.id,
              is_error: true,
              content: `Action failed: ${msg}`,
            });
            yield {
              turnIndex,
              type: 'error',
              payload: { action: input, error: msg },
            };
          }
          continue;
        }

        if (use.name === 'upload_file') {
          const input = use.input as { selector: string; attachment_name: string };
          try {
            const attachment = (opts.attachments || []).find(
              (a) => a.name === input.attachment_name,
            );
            if (!attachment) {
              throw new Error(
                `No attachment named "${input.attachment_name}". Available: ` +
                  (opts.attachments || []).map((a) => a.name).join(', ') || '(none)',
              );
            }
            yield {
              turnIndex,
              type: 'action',
              payload: {
                action: 'upload_file',
                selector: input.selector,
                attachment: attachment.name,
                bytes: attachment.buffer.byteLength,
              },
            };
            // Playwright accepts in-memory payloads for setInputFiles — no
            // disk writes, no temp files, no leak of credentials through fs
            await opts.runtime.page.setInputFiles(input.selector, {
              name: attachment.filename,
              mimeType: attachment.mimeType,
              buffer: attachment.buffer,
            });
            // After upload, give the page a moment + return a fresh screenshot
            await new Promise((r) => setTimeout(r, 500));
            const shot = await opts.runtime.page.screenshot({ type: 'png', fullPage: false });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: use.id,
              content: [
                { type: 'text', text: `Uploaded ${attachment.filename} (${attachment.buffer.byteLength} bytes)` },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: shot.toString('base64'),
                  },
                },
              ],
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: use.id,
              is_error: true,
              content: `Upload failed: ${msg}`,
            });
            yield {
              turnIndex,
              type: 'error',
              payload: { action: input, error: msg },
            };
          }
          continue;
        }

        // Unknown tool — feed back as error so Claude course-corrects
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: true,
          content: `Unknown tool: ${use.name}`,
        });
      }

      conversation.push({ role: 'user', content: toolResults });
    }

    yield {
      turnIndex: MAX_TURNS,
      type: 'error',
      payload: { reason: 'max_turns_reached' },
    };
  }

  return { events: generate(), control };
}

// --- Computer tool action dispatcher ---

type ComputerToolInput =
  | { action: 'screenshot' }
  | { action: 'left_click'; coordinate: [number, number] }
  | { action: 'right_click'; coordinate: [number, number] }
  | { action: 'middle_click'; coordinate: [number, number] }
  | { action: 'double_click'; coordinate: [number, number] }
  | { action: 'triple_click'; coordinate: [number, number] }
  | { action: 'mouse_move'; coordinate: [number, number] }
  | { action: 'left_click_drag'; start_coordinate: [number, number]; coordinate: [number, number] }
  | { action: 'type'; text: string }
  | { action: 'key'; text: string }
  | { action: 'hold_key'; text: string; duration: number }
  | { action: 'scroll'; coordinate: [number, number]; scroll_direction: 'up' | 'down' | 'left' | 'right'; scroll_amount: number }
  | { action: 'wait'; duration: number }
  | { action: 'cursor_position' };

async function executeComputerAction(
  page: Page,
  input: ComputerToolInput,
): Promise<Buffer> {
  switch (input.action) {
    case 'screenshot':
      // fall through to the shared capture below
      break;
    case 'left_click':
    case 'right_click':
    case 'middle_click': {
      const button =
        input.action === 'right_click' ? 'right' :
        input.action === 'middle_click' ? 'middle' : 'left';
      await page.mouse.click(input.coordinate[0], input.coordinate[1], { button });
      break;
    }
    case 'double_click':
      await page.mouse.dblclick(input.coordinate[0], input.coordinate[1]);
      break;
    case 'triple_click':
      await page.mouse.click(input.coordinate[0], input.coordinate[1], { clickCount: 3 });
      break;
    case 'mouse_move':
      await page.mouse.move(input.coordinate[0], input.coordinate[1]);
      break;
    case 'left_click_drag':
      await page.mouse.move(input.start_coordinate[0], input.start_coordinate[1]);
      await page.mouse.down();
      await page.mouse.move(input.coordinate[0], input.coordinate[1], { steps: 10 });
      await page.mouse.up();
      break;
    case 'type':
      await page.keyboard.type(input.text, { delay: 15 });
      break;
    case 'key':
      // Claude sends things like "Return", "Tab", "cmd+a". Translate + issue.
      await typeKeyCombo(page, input.text);
      break;
    case 'hold_key':
      await page.keyboard.down(translateKey(input.text));
      await new Promise((r) => setTimeout(r, input.duration * 1000));
      await page.keyboard.up(translateKey(input.text));
      break;
    case 'scroll': {
      const dy = input.scroll_direction === 'down'  ? input.scroll_amount * 100
               : input.scroll_direction === 'up'    ? -input.scroll_amount * 100 : 0;
      const dx = input.scroll_direction === 'right' ? input.scroll_amount * 100
               : input.scroll_direction === 'left'  ? -input.scroll_amount * 100 : 0;
      await page.mouse.move(input.coordinate[0], input.coordinate[1]);
      await page.mouse.wheel(dx, dy);
      break;
    }
    case 'wait':
      await new Promise((r) => setTimeout(r, input.duration * 1000));
      break;
    case 'cursor_position':
      // No-op — we don't track cursor in Playwright beyond the browser
      break;
    default:
      throw new Error(`Unsupported action: ${(input as { action: string }).action}`);
  }

  // Always return a fresh screenshot so Claude sees the result
  return await page.screenshot({ type: 'png', fullPage: false });
}

/**
 * Translate Claude's key notation into Playwright's.
 * Claude sends things like "Return", "Tab", "cmd+a". Playwright wants
 * "Enter", "Tab", "Meta+KeyA".
 */
async function typeKeyCombo(page: Page, combo: string) {
  const parts = combo.split('+').map((p) => translateKey(p.trim()));
  await page.keyboard.press(parts.join('+'));
}

function translateKey(key: string): string {
  const map: Record<string, string> = {
    'Return': 'Enter',
    'return': 'Enter',
    'Enter': 'Enter',
    'Escape': 'Escape',
    'Tab': 'Tab',
    'Space': 'Space',
    'space': 'Space',
    'BackSpace': 'Backspace',
    'Delete': 'Delete',
    'Up': 'ArrowUp',
    'Down': 'ArrowDown',
    'Left': 'ArrowLeft',
    'Right': 'ArrowRight',
    'cmd': 'Meta',
    'ctrl': 'Control',
    'alt': 'Alt',
    'shift': 'Shift',
    'super': 'Meta',
  };
  if (map[key]) return map[key];
  // Letter keys become "KeyA" etc
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key;
}
