import { polygonService } from './polygonService';
import { historicalDataCache } from './historicalDataCache';
import { MarketStatusService } from './marketStatusService';

/**
 * BatchDataService - Efficient bulk stock data management
 * 
 * Smart Data Strategy:
 * - When market is CLOSED: Use historical cache (11k+ stocks, 30 days of data)
 * - When market is OPEN: Try Polygon API first, fall back to cache on failure
 * - Caches data for 6 hours to minimize API usage
 * - Shared across Elite Scanner, UOA Scanner, and other services
 * - Tracks data source (live vs cached) for status indicators
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
  private marketStatusService: MarketStatusService;
  
  // Data source tracking
  private currentDataSource: 'live' | 'cache' = 'cache';
  private lastLiveDataTime: number = 0;

  private constructor() {
    this.marketStatusService = MarketStatusService.getInstance();
  }

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
   * Fetch fresh stock data - smart source selection
   * Strategy: Use historical cache when market closed, try live when open
   */
  private async refreshStockUniverse(): Promise<StockSnapshot[]> {
    const startTime = Date.now();
    const marketOpen = this.marketStatusService.isMarketOpen();
    
    console.log(`🔄 Refreshing stock universe (market ${marketOpen ? 'OPEN' : 'CLOSED'})...`);
    
    // Strategy 1: Market is closed - use historical cache directly
    if (!marketOpen) {
      console.log('🌙 Market closed - using historical cache');
      return this.getHistoricalCacheData();
    }
    
    // Strategy 2: Market is open - try live first, fall back to cache
    try {
      console.log('📡 Market open - attempting live Polygon API...');
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
      
      // Track live data source
      this.currentDataSource = 'live';
      this.lastLiveDataTime = now;

      const duration = Date.now() - startTime;
      console.log(`✅ Live data: ${snapshots.length} stocks in ${(duration / 1000).toFixed(1)}s`);
      console.log(`💾 Cached for 6 hours (expires at ${new Date(this.cache.expiresAt).toLocaleTimeString()})`);

      return snapshots;
    } catch (error: any) {
      const errorCode = error?.response?.status || error?.status || 'unknown';
      console.error(`❌ Live API failed (${errorCode}):`, error.message);
      
      // Fall back to historical cache
      console.log('🔄 Falling back to historical cache...');
      return this.getHistoricalCacheData();
    }
  }
  
  /**
   * Get data from historical cache and transform to StockSnapshot format
   */
  private async getHistoricalCacheData(): Promise<StockSnapshot[]> {
    if (!historicalDataCache.isReady()) {
      console.warn('⚠️ Historical cache not ready yet');
      
      // Return stale cache if available
      if (this.cache) {
        console.log('⚠️ Using stale BatchData cache as last resort');
        this.currentDataSource = 'cache';
        return this.cache.data;
      }
      
      throw new Error('No data available - historical cache not ready and no fallback cache');
    }
    
    // Get all cached symbols
    const allSymbols = historicalDataCache.getAllSymbols();
    console.log(`📊 Transforming ${allSymbols.length} symbols from historical cache...`);
    
    const snapshots: StockSnapshot[] = [];
    
    for (const symbol of allSymbols) {
      try {
        const bars = historicalDataCache.getHistoricalBars(symbol);
        
        if (!bars || bars.length === 0) {
          continue;
        }
        
        // Use the most recent bar (yesterday's data)
        const latestBar = bars[bars.length - 1];
        const previousBar = bars.length > 1 ? bars[bars.length - 2] : null;
        
        // Calculate change from previous bar
        const change = previousBar ? latestBar.close - previousBar.close : 0;
        const changePercent = previousBar ? ((change / previousBar.close) * 100) : 0;
        
        snapshots.push({
          ticker: symbol,
          price: latestBar.close,
          change,
          changePercent,
          volume: latestBar.volume,
          high: latestBar.high,
          low: latestBar.low,
          open: latestBar.open,
          close: latestBar.close,
          timestamp: latestBar.timestamp
        });
      } catch (error) {
        // Skip symbols with errors
        continue;
      }
    }
    
    // Cache the results
    const now = Date.now();
    this.cache = {
      data: snapshots,
      timestamp: now,
      expiresAt: now + this.CACHE_DURATION_MS
    };
    
    // Track cache data source
    this.currentDataSource = 'cache';
    
    console.log(`✅ Historical cache data: ${snapshots.length} stocks`);
    console.log(`💾 Cached for 6 hours (expires at ${new Date(this.cache.expiresAt).toLocaleTimeString()})`);
    
    return snapshots;
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
   * Get data source status for frontend indicator
   */
  getDataSourceStatus(): {
    isLive: boolean;
    source: 'live' | 'cache';
    lastUpdate: number;
    marketOpen: boolean;
  } {
    return {
      isLive: this.currentDataSource === 'live',
      source: this.currentDataSource,
      lastUpdate: this.cache?.timestamp || 0,
      marketOpen: this.marketStatusService.isMarketOpen()
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
