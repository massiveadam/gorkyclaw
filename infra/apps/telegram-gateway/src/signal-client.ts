/**
 * Signal Integration via signal-cli-rest-api
 * Alternative secure messaging channel
 */

export interface SignalMessage {
  from: string;
  text: string;
  timestamp: number;
  groupId?: string;
}

export class SignalClient {
  private baseUrl: string;
  private phoneNumber: string;

  constructor(
    baseUrl: string = 'http://signal-cli:8080',
    phoneNumber: string = '',
  ) {
    this.baseUrl = baseUrl;
    this.phoneNumber = phoneNumber;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}/v1${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Signal API error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Send message to a phone number
   */
  async sendMessage(to: string, message: string): Promise<void> {
    await this.request('/messages', {
      method: 'POST',
      body: JSON.stringify({
        recipient: [to],
        message,
      }),
    });
  }

  /**
   * Send message to a group
   */
  async sendGroupMessage(groupId: string, message: string): Promise<void> {
    await this.request('/messages', {
      method: 'POST',
      body: JSON.stringify({
        groupId,
        message,
      }),
    });
  }

  /**
   * Receive messages (polling)
   */
  async receiveMessages(): Promise<SignalMessage[]> {
    const response = await this.request('/receive');
    return response.messages || [];
  }

  /**
   * List linked devices
   */
  async listDevices(): Promise<string[]> {
    return this.request('/devices');
  }

  /**
   * Send approval request via Signal
   */
  async sendApprovalRequest(
    to: string,
    jobId: string,
    summary: string,
    actions: Array<{ command: string; target?: string; risk: string }>,
  ): Promise<void> {
    let message = `🔐 OpenClaw Approval Request\n\n`;
    message += `Job: ${summary}\n`;
    message += `ID: ${jobId}\n\n`;
    message += `Actions:\n`;

    actions.forEach((action, i) => {
      const target = action.target ? ` [${action.target}]` : '';
      message += `${i + 1}. ${action.command}${target} (Risk: ${action.risk})\n`;
    });

    message += `\nReply with:\n`;
    message += `APPROVE ${jobId}\n`;
    message += `or\n`;
    message += `DENY ${jobId}`;

    await this.sendMessage(to, message);
  }

  /**
   * Parse approval response
   */
  parseApprovalResponse(text: string): {
    action: 'approve' | 'deny' | null;
    jobId: string | null;
  } {
    const approveMatch = text.match(/^APPROVE\s+(\w+)/i);
    if (approveMatch) {
      return { action: 'approve', jobId: approveMatch[1] };
    }

    const denyMatch = text.match(/^DENY\s+(\w+)/i);
    if (denyMatch) {
      return { action: 'deny', jobId: denyMatch[1] };
    }

    return { action: null, jobId: null };
  }
}
