import { polygonService } from './polygonService';
import { historicalDataCache } from './historicalDataCache';

interface HistoricalBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RateLimiter {
  tokens: number;
  maxTokens: number;
  refillRate: number; // tokens per second
  lastRefill: number;
}

export class HistoricalDataService {
  private rateLimiter: RateLimiter = {
    tokens: 1,
    maxTokens: 1,
    refillRate: 0.5, // 1 request every 2 seconds (very conservative)
    lastRefill: Date.now()
  };

  private async waitForRateLimit(): Promise<void> {
    // Refill tokens based on time elapsed
    const now = Date.now();
    const elapsed = (now - this.rateLimiter.lastRefill) / 1000;
    this.rateLimiter.tokens = Math.min(
      this.rateLimiter.maxTokens,
      this.rateLimiter.tokens + elapsed * this.rateLimiter.refillRate
    );
    this.rateLimiter.lastRefill = now;

    // Wait if no tokens available
    if (this.rateLimiter.tokens < 1) {
      const waitTime = ((1 - this.rateLimiter.tokens) / this.rateLimiter.refillRate) * 1000;
      console.log(`⏳ Rate limit: waiting ${Math.ceil(waitTime)}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.rateLimiter.tokens = 1;
    }

    this.rateLimiter.tokens -= 1;
  }

  /**
   * Fetch historical daily bars (OHLCV) for a symbol with retry logic
   */
  async getDailyBars(
    symbol: string,
    startDate: string,
    endDate: string,
    useCache: boolean = true
  ): Promise<HistoricalBar[]> {
    if (useCache) {
      const cached = await historicalDataCache.get(symbol, 'daily_bars', startDate, endDate);
      if (cached) return cached;
    }

    // Retry with exponential backoff
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await this.waitForRateLimit();

      try {
        const response = await fetch(
          `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${startDate}/${endDate}?adjusted=true&sort=asc&limit=50000&apiKey=${process.env.POLYGON_API_KEY}`
        );

        if (response.status === 429) {
          const backoffTime = Math.min(30000, 2000 * Math.pow(2, attempt)); // 2s, 4s, 8s (max 30s)
          console.warn(`⏳ Rate limited - waiting ${backoffTime/1000}s before retry (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue;
        }

        if (!response.ok) {
          console.error(`❌ Polygon API error (${response.status}): ${symbol}`);
          return [];
        }

        const data = await response.json();
        const bars: HistoricalBar[] = (data.results || []).map((bar: any) => ({
          timestamp: bar.t,
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v
        }));

        if (useCache && bars.length > 0) {
          await historicalDataCache.set(symbol, 'daily_bars', startDate, endDate, bars);
        }

        console.log(`✅ Fetched ${bars.length} bars for ${symbol}`);
        return bars;
      } catch (error) {
        console.error(`Failed to fetch daily bars for ${symbol} (attempt ${attempt + 1}):`, error);
        if (attempt === maxRetries - 1) return [];
      }
    }

    return [];
  }

  /**
   * Calculate RSI from historical bars
   */
  calculateRSI(bars: HistoricalBar[], period: number = 14): number[] {
    if (bars.length < period + 1) return [];

    const rsi: number[] = [];
    const gains: number[] = [];
    const losses: number[] = [];

    // Calculate price changes
    for (let i = 1; i < bars.length; i++) {
      const change = bars[i].close - bars[i - 1].close;
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    // Calculate first average gain/loss
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    // Calculate RSI for first period
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));

    // Calculate subsequent RSI values using smoothed averages
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }

    return rsi;
  }

  /**
   * Fetch VIX historical data
   */
  async getVIXHistory(
    startDate: string,
    endDate: string,
    useCache: boolean = true
  ): Promise<HistoricalBar[]> {
    if (useCache) {
      const cached = await historicalDataCache.get('VIX', 'daily_bars', startDate, endDate);
      if (cached) return cached;
    }

    await this.waitForRateLimit();

    try {
      const response = await fetch(
        `https://api.polygon.io/v2/aggs/ticker/I:VIX/range/1/day/${startDate}/${endDate}?adjusted=true&sort=asc&limit=50000&apiKey=${process.env.POLYGON_API_KEY}`
      );

      if (!response.ok) {
        console.error(`❌ Polygon API error (${response.status}): VIX`);
        return [];
      }

      const data = await response.json();
      const bars: HistoricalBar[] = (data.results || []).map((bar: any) => ({
        timestamp: bar.t,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v || 0
      }));

      if (useCache && bars.length > 0) {
        await historicalDataCache.set('VIX', 'daily_bars', startDate, endDate, bars);
      }

      return bars;
    } catch (error) {
      console.error(`Failed to fetch VIX history:`, error);
      return [];
    }
  }

  /**
   * Fetch SPX historical data
   */
  async getSPXHistory(
    startDate: string,
    endDate: string,
    useCache: boolean = true
  ): Promise<HistoricalBar[]> {
    if (useCache) {
      const cached = await historicalDataCache.get('SPX', 'daily_bars', startDate, endDate);
      if (cached) return cached;
    }

    await this.waitForRateLimit();

    try {
      const response = await fetch(
        `https://api.polygon.io/v2/aggs/ticker/I:SPX/range/1/day/${startDate}/${endDate}?adjusted=true&sort=asc&limit=50000&apiKey=${process.env.POLYGON_API_KEY}`
      );

      if (!response.ok) {
        console.error(`❌ Polygon API error (${response.status}): SPX`);
        return [];
      }

      const data = await response.json();
      const bars: HistoricalBar[] = (data.results || []).map((bar: any) => ({
        timestamp: bar.t,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v || 0
      }));

      if (useCache && bars.length > 0) {
        await historicalDataCache.set('SPX', 'daily_bars', startDate, endDate, bars);
      }

      return bars;
    } catch (error) {
      console.error(`Failed to fetch SPX history:`, error);
      return [];
    }
  }

  /**
   * Clear cache (useful for testing/admin)
   */
  async clearCache(symbol?: string): Promise<void> {
    await historicalDataCache.clear(symbol);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return historicalDataCache.getStats();
  }
}

export const historicalDataService = new HistoricalDataService();
