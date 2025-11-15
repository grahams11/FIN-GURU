/**
 * Historical Data Cache Service
 * 
 * Purpose: Eliminate 99% of API calls by caching 30 days of historical data
 * 
 * Problem: OvernightDataFetcher calls getDailyAggregates individually for each symbol
 *   - 100 symbols x 30-day lookup = 100 API calls per scan
 *   - Multiple scans per day = 28,800+ API calls daily
 * 
 * Solution: Batch fetch grouped daily bars once, cache for 24 hours
 *   - Single grouped bars API call fetches ALL symbols' data at once
 *   - Reuse cached data across all scans
 *   - Refresh cache daily at market close
 * 
 * API Reduction: ~28,800 calls/day → ~30 calls/day (99.89% reduction)
 */

import { polygonService } from './polygonService';

export interface HistoricalBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SymbolHistoricalData {
  symbol: string;
  bars: HistoricalBar[];
  startDate: string;
  endDate: string;
  lastUpdated: number;
}

export class HistoricalDataCache {
  private static instance: HistoricalDataCache | null = null;
  
  // Cache structure: Map<symbol, HistoricalBar[]>
  private cache = new Map<string, HistoricalBar[]>();
  
  // Cache metadata
  private cacheStartDate: string | null = null;
  private cacheEndDate: string | null = null;
  private lastCacheTime: number = 0;
  private scheduledTask: NodeJS.Timeout | null = null;
  
  // Configuration
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private readonly LOOKBACK_DAYS = 30; // 30 days of history
  
  private constructor() {}
  
  static getInstance(): HistoricalDataCache {
    if (!HistoricalDataCache.instance) {
      HistoricalDataCache.instance = new HistoricalDataCache();
    }
    return HistoricalDataCache.instance;
  }
  
  /**
   * Initialize cache on server startup with retry logic
   */
  async initialize(): Promise<void> {
    console.log('📊 Initializing Historical Data Cache...');
    
    const maxRetries = 3;
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        // Populate cache immediately
        await this.refreshCache();
        console.log('✅ Historical cache initialized successfully');
        
        // Schedule daily refresh at 4:00 PM CST
        this.startScheduler();
        return;
      } catch (error: any) {
        retries++;
        console.error(`❌ Cache initialization attempt ${retries}/${maxRetries} failed:`, error.message);
        
        if (retries < maxRetries) {
          const backoffMs = retries * 10000; // 10s, 20s, 30s backoff
          console.log(`⏳ Retrying in ${backoffMs/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }
    
    // If all retries failed, reject promise to prevent scanner from starting
    const error = new Error('Historical cache initialization failed after all retries');
    console.error('❌ Historical cache initialization failed after all retries');
    console.warn('⚠️ Scheduler disabled - cache will remain empty until manual refresh');
    throw error;
  }
  
  /**
   * Check if cache is ready with sufficient data
   */
  isReady(): boolean {
    return this.cache.size > 0 && this.lastCacheTime > 0;
  }
  
  /**
   * Start scheduler to refresh cache daily at 4:00 PM CST
   */
  private startScheduler(): void {
    console.log('📅 Starting historical cache scheduler (4:00 PM CST daily)...');
    
    // Check every minute for 4:00 PM CST
    this.scheduledTask = setInterval(() => {
      this.checkAndRefresh();
    }, 60_000); // Check every minute
  }
  
  /**
   * Stop scheduler
   */
  stopScheduler(): void {
    if (this.scheduledTask) {
      clearInterval(this.scheduledTask);
      this.scheduledTask = null;
      console.log('📅 Historical cache scheduler stopped');
    }
  }
  
  /**
   * Check if it's 4:00 PM CST and refresh cache
   */
  private async checkAndRefresh(): Promise<void> {
    const now = new Date();
    
    const cstHour = parseInt(now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      hour12: false
    }));
    
    const cstMinute = parseInt(now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      minute: 'numeric'
    }));
    
    const dateStr = now.toISOString().split('T')[0];
    
    // Refresh at 4:00 PM CST if not already refreshed today
    if (cstHour === 16 && cstMinute === 0 && this.cacheEndDate !== dateStr) {
      console.log('🕓 4:00 PM CST detected - refreshing historical cache...');
      await this.refreshCache();
    }
  }
  
  /**
   * Refresh cache with latest 30 days of historical data
   * Iterates through dates, fetching grouped daily bars (only trading days)
   */
  async refreshCache(): Promise<void> {
    try {
      console.log('🔄 Refreshing historical data cache (30 trading days)...');
      const startTime = Date.now();
      
      // Calculate date range (go back 60 calendar days to ensure 30 trading days)
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 1); // Yesterday (most recent complete data)
      
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 60); // Extra buffer for weekends/holidays
      
      const endDateStr = endDate.toISOString().split('T')[0];
      const startDateStr = startDate.toISOString().split('T')[0];
      
      console.log(`📅 Fetching grouped bars for date range: ${startDateStr} → ${endDateStr}`);
      
      // Clear old cache
      this.cache.clear();
      
      // Temporary storage to accumulate bars per symbol
      const symbolBarsMap = new Map<string, HistoricalBar[]>();
      
      // Iterate through each date in the range
      const currentDate = new Date(startDate);
      let apiCalls = 0;
      let tradingDays = 0;
      let totalSymbols = 0;
      
      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const dayOfWeek = currentDate.getDay();
        
        // Skip weekends (Saturday = 6, Sunday = 0)
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          currentDate.setDate(currentDate.getDate() + 1);
          continue;
        }
        
        try {
          // Fetch grouped daily bars for this date (1 API call for ALL symbols)
          const groupedBars = await polygonService.getGroupedDailyBars(dateStr);
          
          if (groupedBars && groupedBars.length > 0) {
            apiCalls++;
            tradingDays++;
            totalSymbols = Math.max(totalSymbols, groupedBars.length);
            
            // Add bars to each symbol's historical data
            for (const bar of groupedBars) {
              const symbol = bar.T;
              
              if (!symbolBarsMap.has(symbol)) {
                symbolBarsMap.set(symbol, []);
              }
              
              const symbolBars = symbolBarsMap.get(symbol)!;
              symbolBars.push({
                timestamp: bar.t,
                open: bar.o,
                high: bar.h,
                low: bar.l,
                close: bar.c,
                volume: bar.v
              });
            }
            
            console.log(`✅ ${dateStr}: Fetched ${groupedBars.length} symbols`);
          } else {
            // If no data on a weekday, it's a holiday - don't count as error
            console.warn(`⚠️ ${dateStr}: No data (holiday)`);
          }
        } catch (error: any) {
          console.error(`❌ ${dateStr}: Failed to fetch grouped bars - ${error.message}`);
        }
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
        
        // Add 5-second delay between dates to respect fair-use policy
        // Prevents 429 errors on unlimited plan (30 days × 5s = 2.5 min total)
        if (currentDate <= endDate) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      // Validate we got enough trading days
      if (tradingDays < 20) {
        throw new Error(`Insufficient trading days: ${tradingDays}/20 required`);
      }
      
      // Filter symbols with sufficient data and populate cache
      let cachedCount = 0;
      for (const [symbol, bars] of Array.from(symbolBarsMap.entries())) {
        // Require at least 20 bars for indicator calculation
        if (bars.length >= 20) {
          // Sort bars by timestamp (oldest first)
          bars.sort((a: HistoricalBar, b: HistoricalBar) => a.timestamp - b.timestamp);
          this.cache.set(symbol, bars);
          cachedCount++;
        }
      }
      
      // Update metadata
      this.cacheStartDate = startDateStr;
      this.cacheEndDate = endDateStr;
      this.lastCacheTime = Date.now();
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Historical cache refreshed: ${cachedCount} symbols in ${duration}s`);
      console.log(`📊 Trading days: ${tradingDays}, API calls: ${apiCalls}`);
      console.log(`📊 Cache range: ${startDateStr} → ${endDateStr}`);
      console.log(`💾 Cache expires in 24 hours`);
      
    } catch (error: any) {
      console.error('❌ Failed to refresh historical cache:', error);
      throw error;
    }
  }
  
  /**
   * Get cached historical bars for a symbol
   * Attempts refresh if cache is stale before returning null
   */
  getHistoricalBars(symbol: string): HistoricalBar[] | null {
    // Check cache freshness
    if (this.isCacheStale()) {
      console.warn('⚠️ Historical cache is stale - triggering refresh');
      
      // Attempt background refresh (fire-and-forget to avoid blocking)
      this.refreshCache().catch(error => {
        console.error('❌ Background cache refresh failed:', error.message);
      });
      
      // Return null to trigger fallback for this request
      // Next request should hit refreshed cache
      return null;
    }
    
    return this.cache.get(symbol) || null;
  }
  
  /**
   * Check if cache has data for a symbol
   */
  has(symbol: string): boolean {
    return !this.isCacheStale() && this.cache.has(symbol);
  }
  
  /**
   * Get all cached symbols
   */
  getAllSymbols(): string[] {
    if (this.isCacheStale()) {
      return [];
    }
    return Array.from(this.cache.keys());
  }
  
  /**
   * Get symbol's historical data with metadata
   */
  getHistoricalData(symbol: string): SymbolHistoricalData | null {
    const bars = this.getHistoricalBars(symbol);
    if (!bars || bars.length === 0) {
      return null;
    }
    
    return {
      symbol,
      bars,
      startDate: this.cacheStartDate || '',
      endDate: this.cacheEndDate || '',
      lastUpdated: this.lastCacheTime
    };
  }
  
  /**
   * Check if cache is stale (older than 24 hours)
   */
  private isCacheStale(): boolean {
    if (this.lastCacheTime === 0) return true;
    return Date.now() - this.lastCacheTime > this.CACHE_DURATION;
  }
  
  /**
   * Get cache statistics
   */
  getStats() {
    const cacheAgeMins = this.lastCacheTime > 0 
      ? Math.floor((Date.now() - this.lastCacheTime) / 60_000)
      : null;
    
    return {
      symbolsCached: this.cache.size,
      startDate: this.cacheStartDate,
      endDate: this.cacheEndDate,
      lastRefresh: this.lastCacheTime > 0 ? new Date(this.lastCacheTime).toISOString() : null,
      cacheAgeMins,
      isStale: this.isCacheStale(),
      expiresIn: this.lastCacheTime > 0 
        ? Math.max(0, Math.floor((this.CACHE_DURATION - (Date.now() - this.lastCacheTime)) / 60_000))
        : 0
    };
  }
  
  /**
   * Force cache refresh (admin endpoint)
   */
  async forceRefresh(): Promise<void> {
    console.log('🔧 Force refreshing historical cache...');
    await this.refreshCache();
  }
  
  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.cacheStartDate = null;
    this.cacheEndDate = null;
    this.lastCacheTime = 0;
    console.log('🗑️ Historical cache cleared');
  }
}

// Singleton instance
export const historicalDataCache = HistoricalDataCache.getInstance();
