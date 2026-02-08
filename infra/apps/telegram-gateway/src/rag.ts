/**
 * RAG (Retrieval Augmented Generation) System
 * Indexes and searches Obsidian vault for context
 */

import { MCPObsidianClient } from './mcp-obsidian.js';

export interface Document {
  id: string;
  path: string;
  content: string;
  embedding?: number[];
  metadata: {
    mtime: number;
    tags?: string[];
  };
}

export interface SearchResult {
  document: Document;
  score: number;
}

export class RAGSystem {
  private obsidian: MCPObsidianClient;
  private documents: Map<string, Document> = new Map();
  private indexed: boolean = false;

  constructor(obsidianClient: MCPObsidianClient) {
    this.obsidian = obsidianClient;
  }

  /**
   * Index the entire vault
   * In production, this would use vector embeddings
   */
  async indexVault(): Promise<void> {
    console.log('📚 Indexing Obsidian vault for RAG...');

    try {
      const files = await this.obsidian.listFiles();

      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        try {
          const note = await this.obsidian.readNote(file);

          // Extract tags
          const tagMatches = note.content.match(/#[\w-]+/g) || [];

          this.documents.set(file, {
            id: file,
            path: file,
            content: note.content,
            metadata: {
              mtime: note.mtime,
              tags: tagMatches.map((t) => t.slice(1)), // Remove #
            },
          });
        } catch (error) {
          console.error(`Failed to index ${file}:`, error);
        }
      }

      this.indexed = true;
      console.log(`✅ Indexed ${this.documents.size} documents`);
    } catch (error) {
      console.error('Failed to index vault:', error);
      throw error;
    }
  }

  /**
   * Search documents using simple keyword matching
   * In production, this would use vector similarity
   */
  async search(query: string, limit: number = 5): Promise<SearchResult[]> {
    if (!this.indexed) {
      await this.indexVault();
    }

    const queryTerms = query.toLowerCase().split(/\s+/);
    const results: SearchResult[] = [];

    for (const doc of this.documents.values()) {
      const score = this.calculateScore(doc, queryTerms);
      if (score > 0) {
        results.push({ document: doc, score });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  private calculateScore(doc: Document, queryTerms: string[]): number {
    const content = doc.content.toLowerCase();
    const path = doc.path.toLowerCase();
    let score = 0;

    for (const term of queryTerms) {
      // Title/path match (higher weight)
      if (path.includes(term)) {
        score += 3;
      }

      // Content match
      const matches = (content.match(new RegExp(term, 'g')) || []).length;
      score += matches;

      // Tag match
      if (doc.metadata.tags?.some((t) => t.toLowerCase().includes(term))) {
        score += 2;
      }
    }

    return score;
  }

  /**
   * Get context for a query
   * Returns relevant document excerpts
   */
  async getContext(query: string, maxTokens: number = 2000): Promise<string> {
    const results = await this.search(query, 3);

    if (results.length === 0) {
      return '';
    }

    let context = '## Relevant Context from Knowledge Base\n\n';
    let tokenCount = 0;

    for (const result of results) {
      const excerpt = this.extractExcerpt(result.document.content, query, 500);
      const section = `### ${result.document.path}\n${excerpt}\n\n`;

      // Rough token estimation (1 token ≈ 4 chars)
      const estimatedTokens = section.length / 4;

      if (tokenCount + estimatedTokens > maxTokens) {
        break;
      }

      context += section;
      tokenCount += estimatedTokens;
    }

    return context;
  }

  private extractExcerpt(
    content: string,
    query: string,
    maxLength: number,
  ): string {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // Find the best matching section
    const index = lowerContent.indexOf(lowerQuery);

    if (index === -1) {
      // No direct match, return beginning
      return (
        content.slice(0, maxLength) + (content.length > maxLength ? '...' : '')
      );
    }

    // Extract around the match
    const start = Math.max(0, index - maxLength / 2);
    const end = Math.min(content.length, index + maxLength / 2);

    let excerpt = content.slice(start, end);

    if (start > 0) excerpt = '...' + excerpt;
    if (end < content.length) excerpt = excerpt + '...';

    return excerpt;
  }

  /**
   * Refresh the index
   */
  async refresh(): Promise<void> {
    this.documents.clear();
    this.indexed = false;
    await this.indexVault();
  }
}

/**
 * Simple in-memory cache for RAG results
 */
export class RAGCache {
  private cache: Map<string, { result: string; timestamp: number }> = new Map();
  private ttl: number; // milliseconds

  constructor(ttlMinutes: number = 5) {
    this.ttl = ttlMinutes * 60 * 1000;
  }

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  set(key: string, result: string): void {
    this.cache.set(key, { result, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}
