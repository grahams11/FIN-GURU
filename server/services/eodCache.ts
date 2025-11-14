/**
 * EOD (End-of-Day) Cache Service
 * 
 * Saves market snapshot at 3:00 PM CST daily for overnight scanning.
 * Provides baseline data for overnight breakout detection.
 * 
 * Data Saved:
 * - Close prices, volume, high/low
 * - Used by overnight scanners to detect breakouts vs EOD baseline
 */

import { batchDataService } from './batchDataService';

export interface EODSnapshot {
  symbol: string;
  close: number;
  high: number;
  low: number;
  volume: number;
  timestamp: number; // 3:00 PM CST timestamp
  date: string; // YYYY-MM-DD
}

export class EODCacheService {
  private static instance: EODCacheService | null = null;
  private cache = new Map<string, EODSnapshot>();
  private lastCacheDate: string | null = null;
  private scheduledTask: NodeJS.Timeout | null = null;
  
  private constructor() {}
  
  static getInstance(): EODCacheService {
    if (!EODCacheService.instance) {
      EODCacheService.instance = new EODCacheService();
    }
    return EODCacheService.instance;
  }
  
  /**
   * Initialize scheduler to cache EOD data at 3:00 PM CST daily
   */
  startScheduler(): void {
    console.log('📅 Starting EOD cache scheduler...');
    
    // Check every minute if it's 3:00 PM CST
    this.scheduledTask = setInterval(() => {
      this.checkAndCacheEOD();
    }, 60_000); // Check every minute
    
    // Also try to cache on startup if after 3 PM
    this.checkAndCacheEOD();
  }
  
  /**
   * Stop the scheduler
   */
  stopScheduler(): void {
    if (this.scheduledTask) {
      clearInterval(this.scheduledTask);
      this.scheduledTask = null;
      console.log('📅 EOD cache scheduler stopped');
    }
  }
  
  /**
   * Check if it's 3:00 PM CST and cache EOD data
   */
  private async checkAndCacheEOD(): Promise<void> {
    const now = new Date();
    
    // Convert to CST (America/Chicago)
    const cstHour = parseInt(now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      hour12: false
    }));
    
    const cstMinute = parseInt(now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      minute: 'numeric'
    }));
    
    const dateStr = now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).split('/').reverse().join('-'); // YYYY-MM-DD
    
    // Check if it's 3:00 PM CST and we haven't cached today yet
    if (cstHour === 15 && cstMinute === 0 && this.lastCacheDate !== dateStr) {
      console.log('🕐 3:00 PM CST detected - caching EOD data...');
      await this.cacheEODData();
      this.lastCacheDate = dateStr;
    }
  }
  
  /**
   * Cache current market snapshot as EOD data
   */
  async cacheEODData(): Promise<void> {
    try {
      console.log('💾 Caching EOD snapshot...');
      const startTime = Date.now();
      
      // Get all stocks from batch service
      const stocks = await batchDataService.getStockUniverse();
      
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
      
      // Clear old cache
      this.cache.clear();
      
      // Save snapshots for all stocks
      let cachedCount = 0;
      for (const stock of stocks) {
        if (stock.price > 0 && stock.volume > 0) {
          this.cache.set(stock.ticker, {
            symbol: stock.ticker,
            close: stock.price,
            high: stock.high || stock.price,
            low: stock.low || stock.price,
            volume: stock.volume,
            timestamp: Date.now(),
            date: dateStr
          });
          cachedCount++;
        }
      }
      
      const duration = Date.now() - startTime;
      console.log(`✅ EOD cache complete: ${cachedCount} stocks cached in ${(duration/1000).toFixed(2)}s`);
    } catch (error: any) {
      console.error('❌ Failed to cache EOD data:', error.message);
    }
  }
  
  /**
   * Get EOD snapshot for a symbol
   */
  getEODSnapshot(symbol: string): EODSnapshot | null {
    return this.cache.get(symbol.toUpperCase()) || null;
  }
  
  /**
   * Check if we have valid EOD cache (from today)
   */
  hasValidCache(): boolean {
    if (this.cache.size === 0) {
      return false;
    }
    
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    
    // Check if cache is from today
    const firstSnapshot = Array.from(this.cache.values())[0];
    return firstSnapshot?.date === todayStr;
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    date: string | null;
    isValid: boolean;
  } {
    const firstSnapshot = Array.from(this.cache.values())[0];
    return {
      size: this.cache.size,
      date: firstSnapshot?.date || null,
      isValid: this.hasValidCache()
    };
  }
  
  /**
   * Manually trigger EOD cache (for testing/debugging)
   */
  async manualCache(): Promise<void> {
    console.log('🔧 Manual EOD cache triggered');
    await this.cacheEODData();
  }
}

// Export singleton instance
export const eodCacheService = EODCacheService.getInstance();
