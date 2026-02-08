/**
 * NanoClaw Client
 * Interfaces with NanoClaw to get structured plans
 */

import { PlanSchema, type Plan } from './types.js';

export interface NanoClawResponse {
  plan?: Plan;
  error?: string;
  rawResponse?: string;
}

interface RequestContext {
  userId: number;
  username?: string;
  chatId: number;
}

export class NanoClawClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async requestPlan(
    message: string,
    context: RequestContext,
  ): Promise<any> {
    const response = await fetch(`${this.baseUrl}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        userId: context.userId,
        username: context.username,
        chatId: context.chatId,
      }),
    });

    if (!response.ok) {
      throw new Error(`NanoClaw returned ${response.status}`);
    }

    return response.json();
  }

  async getPlan(
    message: string,
    context: RequestContext,
  ): Promise<NanoClawResponse> {
    try {
      const data = await this.requestPlan(message, context);

      // Validate plan structure
      const planResult = PlanSchema.safeParse(data.plan);
      if (!planResult.success) {
        // Try parsing from a raw text response if provided
        if (typeof data === 'string') {
          const parsed = this.parsePlanFromText(data);
          if (parsed.plan) return parsed;
        }

        if (typeof data?.rawResponse === 'string') {
          const parsed = this.parsePlanFromText(data.rawResponse);
          if (parsed.plan) return parsed;
        }

        // Ask the LLM to reformat to JSON-only plan block
        const reformatPrompt =
          'Return ONLY the JSON plan block, no prose.\\n\\n' +
          'Original response:\\n' +
          JSON.stringify(data);
        const reformatted = await this.requestPlan(reformatPrompt, context);
        if (typeof reformatted === 'string') {
          const parsed = this.parsePlanFromText(reformatted);
          if (parsed.plan) return parsed;
          return parsed;
        }

        const reformattedPlan = PlanSchema.safeParse(reformatted.plan);
        if (reformattedPlan.success) {
          return { plan: reformattedPlan.data };
        }

        return {
          error: `Invalid plan format: ${planResult.error.message}`,
          rawResponse: JSON.stringify(data),
        };
      }

      return {
        plan: planResult.data,
      };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : 'Failed to contact NanoClaw',
      };
    }
  }

  /**
   * Parse plan from raw text (fallback for when NanoClaw returns text with JSON block)
   */
  parsePlanFromText(text: string): NanoClawResponse {
    // Look for fenced JSON block
    const jsonMatch = text.match(/```(?:json)?\s*\n?(\{[\s\S]*?\})\s*\n?```/);

    if (jsonMatch) {
      try {
        const planData = JSON.parse(jsonMatch[1]);
        const planResult = PlanSchema.safeParse(planData);

        if (planResult.success) {
          return { plan: planResult.data };
        } else {
          return {
            error: `Invalid plan format in JSON block: ${planResult.error.message}`,
            rawResponse: text,
          };
        }
      } catch (e) {
        return {
          error: 'Failed to parse JSON block',
          rawResponse: text,
        };
      }
    }

    // Try parsing the whole text as JSON
    try {
      const planData = JSON.parse(text);
      const planResult = PlanSchema.safeParse(planData);

      if (planResult.success) {
        return { plan: planResult.data };
      }
    } catch {
      // Not valid JSON
    }

    return {
      error: 'No valid JSON plan found in response',
      rawResponse: text.slice(0, 1000),
    };
  }
}
