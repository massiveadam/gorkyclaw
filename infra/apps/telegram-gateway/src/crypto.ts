/**
 * Cryptographic signing for approvals
 * Prevents replay attacks and ensures non-repudiation
 */

import {
  createHash,
  createSign,
  createVerify,
  generateKeyPairSync,
} from 'crypto';

export interface SignedApproval {
  jobId: string;
  action: 'approve' | 'deny';
  userId: number;
  timestamp: number;
  nonce: string;
  signature: string;
}

export class ApprovalSigner {
  private privateKey: string;
  private publicKey: string;
  private usedNonces: Set<string> = new Set();
  private nonceTTL: number = 24 * 60 * 60 * 1000; // 24 hours

  constructor(privateKey?: string, publicKey?: string) {
    if (privateKey && publicKey) {
      this.privateKey = privateKey;
      this.publicKey = publicKey;
    } else {
      // Generate new key pair for testing
      const { privateKey: priv, publicKey: pub } = generateKeyPairSync(
        'ed25519',
        {
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        },
      );
      this.privateKey = priv;
      this.publicKey = pub;
    }
  }

  /**
   * Generate a unique nonce
   */
  generateNonce(): string {
    return createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Create a signed approval
   */
  signApproval(
    jobId: string,
    action: 'approve' | 'deny',
    userId: number,
  ): SignedApproval {
    const timestamp = Date.now();
    const nonce = this.generateNonce();

    const data = this.serializeData(jobId, action, userId, timestamp, nonce);

    const signer = createSign('SHA256');
    signer.update(data);
    const signature = signer.sign(this.privateKey, 'base64');

    // Track nonce to prevent replay
    this.usedNonces.add(nonce);
    this.cleanupOldNonces();

    return {
      jobId,
      action,
      userId,
      timestamp,
      nonce,
      signature,
    };
  }

  /**
   * Verify a signed approval
   */
  verifyApproval(approval: SignedApproval): boolean {
    // Check for replay attack
    if (this.usedNonces.has(approval.nonce)) {
      console.error('❌ Replay attack detected: nonce already used');
      return false;
    }

    // Check timestamp (prevent old approvals)
    const age = Date.now() - approval.timestamp;
    if (age > this.nonceTTL) {
      console.error('❌ Approval expired');
      return false;
    }

    // Verify signature
    const data = this.serializeData(
      approval.jobId,
      approval.action,
      approval.userId,
      approval.timestamp,
      approval.nonce,
    );

    const verifier = createVerify('SHA256');
    verifier.update(data);
    const isValid = verifier.verify(
      this.publicKey,
      approval.signature,
      'base64',
    );

    if (isValid) {
      // Mark nonce as used
      this.usedNonces.add(approval.nonce);
    }

    return isValid;
  }

  /**
   * Serialize data for signing
   */
  private serializeData(
    jobId: string,
    action: string,
    userId: number,
    timestamp: number,
    nonce: string,
  ): string {
    // Deterministic JSON serialization
    return JSON.stringify({
      jobId,
      action,
      userId,
      timestamp,
      nonce,
    });
  }

  /**
   * Clean up old nonces to prevent memory leak
   */
  private cleanupOldNonces(): void {
    // In production, use Redis or database with TTL
    // For now, keep only last 10000 nonces
    if (this.usedNonces.size > 10000) {
      const toDelete = this.usedNonces.size - 10000;
      let count = 0;
      for (const nonce of this.usedNonces) {
        this.usedNonces.delete(nonce);
        count++;
        if (count >= toDelete) break;
      }
    }
  }

  /**
   * Export keys for persistence
   */
  exportKeys(): { privateKey: string; publicKey: string } {
    return {
      privateKey: this.privateKey,
      publicKey: this.publicKey,
    };
  }
}

/**
 * Job ID generator with collision resistance
 */
export class JobIdGenerator {
  private counter: number = 0;
  private lastTimestamp: number = 0;

  generate(): string {
    const timestamp = Date.now();

    // Reset counter if timestamp changed
    if (timestamp !== this.lastTimestamp) {
      this.counter = 0;
      this.lastTimestamp = timestamp;
    }

    this.counter++;

    // Create unique ID: timestamp-counter-random
    const random = Math.floor(Math.random() * 10000);
    return `${timestamp.toString(36)}-${this.counter.toString(36)}-${random.toString(36)}`;
  }
}

/**
 * Audit logger with tamper detection
 */
export class AuditLogger {
  private logs: Array<{
    timestamp: number;
    event: string;
    data: any;
    hash: string;
  }> = [];

  private previousHash: string = '0'.repeat(64);

  log(event: string, data: any): void {
    const timestamp = Date.now();
    const entry = JSON.stringify({ timestamp, event, data });
    const hash = createHash('sha256')
      .update(this.previousHash + entry)
      .digest('hex');

    this.logs.push({
      timestamp,
      event,
      data,
      hash,
    });

    this.previousHash = hash;
  }

  /**
   * Verify log integrity
   */
  verifyIntegrity(): boolean {
    let expectedPreviousHash = '0'.repeat(64);

    for (const log of this.logs) {
      const entry = JSON.stringify({
        timestamp: log.timestamp,
        event: log.event,
        data: log.data,
      });
      const expectedHash = createHash('sha256')
        .update(expectedPreviousHash + entry)
        .digest('hex');

      if (log.hash !== expectedHash) {
        console.error(`❌ Log integrity check failed at ${log.timestamp}`);
        return false;
      }

      expectedPreviousHash = log.hash;
    }

    return true;
  }

  getLogs(): any[] {
    return [...this.logs];
  }
}
