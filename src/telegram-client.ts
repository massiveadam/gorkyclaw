/**
 * Telegram integration for NanoClaw
 * Replaces WhatsApp with Telegram Bot API
 */
import TelegramBot from 'node-telegram-bot-api';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

export interface TelegramConfig {
  token: string;
  adminChatId: string;
}

export class TelegramClient {
  private bot: TelegramBot;
  private config: TelegramConfig;
  private registeredGroups: Map<string, RegisteredGroup> = new Map();
  private messageHandlers: Array<(chatId: string, text: string, from: string, timestamp: Date) => void> = [];
  private callbackHandlers: Array<
    (chatId: string, data: string, from: string, timestamp: Date) => void
  > = [];
  private isConnected = false;

  constructor(config: TelegramConfig) {
    this.config = config;
    // Use polling mode (no webhook needed for self-hosted)
    this.bot = new TelegramBot(config.token, { polling: true });
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Handle text messages
    this.bot.on('message', (msg) => {
      if (!msg.text) return;

      const chatId = msg.chat.id.toString();
      const text = msg.text;
      const from = msg.from?.username || msg.from?.first_name || 'Unknown';
      const timestamp = new Date(msg.date * 1000);

      logger.info(
        { chatId, from, text: text.slice(0, 50) },
        'Received Telegram message'
      );

      // Notify all handlers
      this.messageHandlers.forEach((handler) => {
        try {
          handler(chatId, text, from, timestamp);
        } catch (err) {
          logger.error({ err, chatId }, 'Error in message handler');
        }
      });
    });

    this.bot.on('callback_query', async (query) => {
      const chatId = query.message?.chat.id?.toString();
      const data = query.data || '';
      if (!chatId || !data) return;

      const from = query.from?.username || query.from?.first_name || 'Unknown';
      const timestamp = new Date();

      try {
        await this.bot.answerCallbackQuery(query.id);
      } catch (err) {
        logger.debug({ err }, 'Failed to acknowledge callback query');
      }

      this.callbackHandlers.forEach((handler) => {
        try {
          handler(chatId, data, from, timestamp);
        } catch (err) {
          logger.error({ err, chatId, data }, 'Error in callback handler');
        }
      });
    });

    // Handle errors
    this.bot.on('error', (err) => {
      logger.error({ err }, 'Telegram bot error');
    });

    // Handle polling errors
    this.bot.on('polling_error', (err) => {
      logger.error({ err }, 'Telegram polling error');
    });

    this.isConnected = true;
    logger.info('Telegram bot connected and polling');
  }

  onMessage(handler: (chatId: string, text: string, from: string, timestamp: Date) => void): void {
    this.messageHandlers.push(handler);
  }

  onCallbackQuery(
    handler: (chatId: string, data: string, from: string, timestamp: Date) => void,
  ): void {
    this.callbackHandlers.push(handler);
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, text);
      logger.info({ chatId, length: text.length }, 'Sent Telegram message');
    } catch (err) {
      logger.error({ err, chatId }, 'Failed to send Telegram message');
      throw err;
    }
  }

  async sendApprovalButtons(chatId: string, text: string, proposalId: string): Promise<void> {
    await this.bot.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Approve', callback_data: `approve:${proposalId}` },
            { text: 'Deny', callback_data: `deny:${proposalId}` },
          ],
          [{ text: 'Other reason', callback_data: `reason:${proposalId}` }],
        ],
      },
    });
  }

  async setTyping(chatId: string, isTyping: boolean): Promise<void> {
    try {
      if (isTyping) {
        await this.bot.sendChatAction(chatId, 'typing');
      }
    } catch (err) {
      logger.debug({ err, chatId }, 'Failed to set typing status');
    }
  }

  getBotInfo(): Promise<TelegramBot.User> {
    return this.bot.getMe();
  }

  isMainChat(chatId: string): boolean {
    return chatId === this.config.adminChatId;
  }

  stop(): void {
    this.bot.stopPolling();
    this.isConnected = false;
    logger.info('Telegram bot stopped');
  }

  getAdminChatId(): string {
    return this.config.adminChatId;
  }

  isReady(): boolean {
    return this.isConnected;
  }
}

export default TelegramClient;
