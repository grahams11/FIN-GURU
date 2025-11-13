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

export class HistoricalDataService {
  /**
   * Fetch historical daily bars (OHLCV) for a symbol
   * Delegates to PolygonService for centralized authentication and rate limiting
   */
  async getDailyBars(
    symbol: string,
    startDate: string,
    endDate: string,
    useCache: boolean = true,
    unlimited: boolean = false
  ): Promise<HistoricalBar[]> {
    if (useCache) {
      const cached = await historicalDataCache.get(symbol, 'daily_bars', startDate, endDate);
      if (cached) return cached;
    }

    // Delegate to PolygonService for centralized auth, retry, and unlimited mode
    const bars = await polygonService.getHistoricalBars(symbol, startDate, endDate, 'day', 1, unlimited);
    
    if (!bars || bars.length === 0) {
      return [];
    }

    // Convert to HistoricalBar format
    const historicalBars: HistoricalBar[] = bars.map((bar: any) => ({
      timestamp: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v
    }));

    if (useCache && historicalBars.length > 0) {
      await historicalDataCache.set(symbol, 'daily_bars', startDate, endDate, historicalBars);
    }

    return historicalBars;
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
   * Delegates to PolygonService for centralized authentication
   */
  async getVIXHistory(
    startDate: string,
    endDate: string,
    useCache: boolean = true,
    unlimited: boolean = false
  ): Promise<HistoricalBar[]> {
    if (useCache) {
      const cached = await historicalDataCache.get('VIX', 'daily_bars', startDate, endDate);
      if (cached) return cached;
    }

    // Delegate to PolygonService (uses I:VIX symbol)
    const bars = await polygonService.getHistoricalBars('I:VIX', startDate, endDate, 'day', 1, unlimited);
    
    if (!bars || bars.length === 0) {
      return [];
    }

    const historicalBars: HistoricalBar[] = bars.map((bar: any) => ({
      timestamp: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v || 0
    }));

    if (useCache && historicalBars.length > 0) {
      await historicalDataCache.set('VIX', 'daily_bars', startDate, endDate, historicalBars);
    }

    return historicalBars;
  }

  /**
   * Fetch SPX historical data
   * Delegates to PolygonService for centralized authentication
   */
  async getSPXHistory(
    startDate: string,
    endDate: string,
    useCache: boolean = true,
    unlimited: boolean = false
  ): Promise<HistoricalBar[]> {
    if (useCache) {
      const cached = await historicalDataCache.get('SPX', 'daily_bars', startDate, endDate);
      if (cached) return cached;
    }

    // Delegate to PolygonService (uses I:SPX symbol)
    const bars = await polygonService.getHistoricalBars('I:SPX', startDate, endDate, 'day', 1, unlimited);
    
    if (!bars || bars.length === 0) {
      return [];
    }

    const historicalBars: HistoricalBar[] = bars.map((bar: any) => ({
      timestamp: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v || 0
    }));

    if (useCache && historicalBars.length > 0) {
      await historicalDataCache.set('SPX', 'daily_bars', startDate, endDate, historicalBars);
    }

    return historicalBars;
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
