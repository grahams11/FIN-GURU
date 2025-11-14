import { polygonService } from './polygonService';

/**
 * BatchDataService - Efficient bulk stock data management
 * 
 * Strategy:
 * - Fetches ALL ~9,000 stocks in ONE Polygon API call (bulk snapshot)
 * - Caches data for 6 hours to minimize API usage
 * - Shared across Elite Scanner, UOA Scanner, and other services
 * - Automatically refreshes when cache expires
 */

interface StockSnapshot {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  avgVolume?: number;
  high?: number;
  low?: number;
  open?: number;
  close?: number;
  timestamp: number;
}

interface CacheEntry {
  data: StockSnapshot[];
  timestamp: number;
  expiresAt: number;
}

class BatchDataService {
  private static instance: BatchDataService | null = null;
  private cache: CacheEntry | null = null;
  private readonly CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours
  private refreshing = false;
  private refreshPromise: Promise<StockSnapshot[]> | null = null;

  private constructor() {}

  static getInstance(): BatchDataService {
    if (!BatchDataService.instance) {
      BatchDataService.instance = new BatchDataService();
    }
    return BatchDataService.instance;
  }

  /**
   * Get stock universe (cached or fresh)
   * Thread-safe - prevents duplicate API calls during concurrent requests
   */
  async getStockUniverse(): Promise<StockSnapshot[]> {
    const now = Date.now();

    // Return cached data if still valid
    if (this.cache && now < this.cache.expiresAt) {
      const age = Math.floor((now - this.cache.timestamp) / 1000 / 60);
      console.log(`📦 Using cached stock universe (${this.cache.data.length} stocks, ${age}min old)`);
      return this.cache.data;
    }

    // If already refreshing, wait for that refresh to complete
    if (this.refreshing && this.refreshPromise) {
      console.log('⏳ Waiting for ongoing stock universe refresh...');
      return this.refreshPromise;
    }

    // Start fresh refresh
    this.refreshing = true;
    this.refreshPromise = this.refreshStockUniverse();

    try {
      const data = await this.refreshPromise;
      return data;
    } finally {
      this.refreshing = false;
      this.refreshPromise = null;
    }
  }

  /**
   * Fetch fresh stock data from Polygon bulk snapshot
   * Uses SINGLE API call to get all stocks
   */
  private async refreshStockUniverse(): Promise<StockSnapshot[]> {
    console.log('🔄 Refreshing stock universe from Polygon bulk snapshot...');
    const startTime = Date.now();

    try {
      // Single bulk API call fetches ~9,000 stocks
      const bulkData = await polygonService.getBulkMarketSnapshot();
      
      // Transform to StockSnapshot format
      const snapshots: StockSnapshot[] = bulkData.map((item: any) => ({
        ticker: item.ticker,
        price: item.price,
        change: item.change,
        changePercent: item.changePercent,
        volume: item.volume,
        marketCap: item.marketCap,
        avgVolume: item.avgVolume,
        high: item.high,
        low: item.low,
        open: item.open,
        close: item.close,
        timestamp: Date.now()
      }));

      // Cache the results
      const now = Date.now();
      this.cache = {
        data: snapshots,
        timestamp: now,
        expiresAt: now + this.CACHE_DURATION_MS
      };

      const duration = Date.now() - startTime;
      console.log(`✅ Stock universe refreshed: ${snapshots.length} stocks in ${(duration / 1000).toFixed(1)}s`);
      console.log(`💾 Cached for 6 hours (expires at ${new Date(this.cache.expiresAt).toLocaleTimeString()})`);

      return snapshots;
    } catch (error) {
      console.error('❌ Error refreshing stock universe:', error);
      
      // Return stale cache if available as fallback
      if (this.cache) {
        console.log('⚠️ Using stale cached data as fallback');
        return this.cache.data;
      }
      
      throw error;
    }
  }

  /**
   * Force refresh cache (useful for manual triggers)
   */
  async forceRefresh(): Promise<StockSnapshot[]> {
    console.log('🔄 Force refresh requested');
    this.cache = null; // Invalidate cache
    return this.getStockUniverse();
  }

  /**
   * Get cache status
   */
  getCacheStatus(): {
    cached: boolean;
    stockCount: number;
    ageMinutes: number;
    expiresInMinutes: number;
  } {
    if (!this.cache) {
      return {
        cached: false,
        stockCount: 0,
        ageMinutes: 0,
        expiresInMinutes: 0
      };
    }

    const now = Date.now();
    const ageMinutes = Math.floor((now - this.cache.timestamp) / 1000 / 60);
    const expiresInMinutes = Math.floor((this.cache.expiresAt - now) / 1000 / 60);

    return {
      cached: true,
      stockCount: this.cache.data.length,
      ageMinutes,
      expiresInMinutes
    };
  }

  /**
   * Filter universe by criteria (local filtering - no API calls)
   */
  async filterUniverse(criteria: {
    minPrice?: number;
    maxPrice?: number;
    minVolume?: number;
    minMarketCap?: number;
    tickers?: string[];
  }): Promise<StockSnapshot[]> {
    const universe = await this.getStockUniverse();
    
    return universe.filter(stock => {
      if (criteria.minPrice && stock.price < criteria.minPrice) return false;
      if (criteria.maxPrice && stock.price > criteria.maxPrice) return false;
      if (criteria.minVolume && stock.volume < criteria.minVolume) return false;
      if (criteria.minMarketCap && (!stock.marketCap || stock.marketCap < criteria.minMarketCap)) return false;
      if (criteria.tickers && !criteria.tickers.includes(stock.ticker)) return false;
      return true;
    });
  }
}

// Export singleton instance
export const batchDataService = BatchDataService.getInstance();
export type { StockSnapshot };
