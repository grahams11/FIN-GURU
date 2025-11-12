import type { InsertUoaTrade } from '@shared/schema';

/**
 * In-Memory UOA Cache
 * Stores last scan results for instant dashboard access (<100ms)
 * Refreshed by background worker every 2 minutes
 * Scans only 5 high-liquidity stocks (SPY, QQQ, AAPL, TSLA, NVDA)
 */

export class UoaCache {
  private static topTrades: InsertUoaTrade[] = [];
  private static lastUpdated: Date | null = null;
  private static isScanning: boolean = false;

  /**
   * Get cached top trades
   */
  static get(): { trades: InsertUoaTrade[]; lastUpdated: Date | null; isStale: boolean } {
    const now = new Date();
    const isStale = !this.lastUpdated || (now.getTime() - this.lastUpdated.getTime()) > 60000; // >1min = stale
    
    return {
      trades: this.topTrades,
      lastUpdated: this.lastUpdated,
      isStale,
    };
  }

  /**
   * Update cache with new scan results
   */
  static set(trades: InsertUoaTrade[]): void {
    this.topTrades = trades;
    this.lastUpdated = new Date();
    console.log(`✅ UOA cache updated: ${trades.length} trades at ${this.lastUpdated.toLocaleTimeString()}`);
  }

  /**
   * Check if scan is currently running
   */
  static getScanStatus(): boolean {
    return this.isScanning;
  }

  /**
   * Set scan status
   */
  static setScanStatus(scanning: boolean): void {
    this.isScanning = scanning;
  }

  /**
   * Get cache metrics
   */
  static getMetrics() {
    return {
      tradeCount: this.topTrades.length,
      lastUpdated: this.lastUpdated,
      isScanning: this.isScanning,
      cacheAge: this.lastUpdated ? Date.now() - this.lastUpdated.getTime() : null,
    };
  }
}
