import { polygonService, type HistoricalBar } from './polygonService.js';

interface FibonacciLevels {
  high: number;
  low: number;
  level_0_618: number;
  level_0_707: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  timestamp: number;
}

interface BounceDetection {
  isBouncing: boolean;
  fibLevel?: 0.618 | 0.707;
  color?: 'gold' | 'green';
  levels: FibonacciLevels;
}

export class FibonacciService {
  private static cache = new Map<string, FibonacciLevels>();
  private static CACHE_TTL = 3600000; // 1 hour TTL
  private static LOOKBACK_DAYS = 60;
  private static BOUNCE_TOLERANCE = 0.01; // ±1% tolerance

  static async calculateFibonacciLevels(symbol: string): Promise<FibonacciLevels | null> {
    const cached = this.cache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached;
    }

    try {
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - this.LOOKBACK_DAYS);

      const bars = await polygonService.getHistoricalBars(
        symbol,
        fromDate.toISOString().split('T')[0],
        toDate.toISOString().split('T')[0],
        'day'
      );

      if (!bars || bars.length < 10) {
        console.warn(`${symbol}: Insufficient historical data for Fibonacci calculation`);
        return null;
      }

      const high = Math.max(...bars.map((b: HistoricalBar) => b.h));
      const low = Math.min(...bars.map((b: HistoricalBar) => b.l));
      const range = high - low;

      if (range === 0) {
        console.warn(`${symbol}: No price range in historical data`);
        return null;
      }

      const level_0_618 = high - (range * 0.618);
      const level_0_707 = high - (range * 0.707);

      const recentPrice = bars[bars.length - 1].c;
      const midpoint = high - (range * 0.5);
      
      let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      if (recentPrice > midpoint + (range * 0.1)) {
        trend = 'bullish';
      } else if (recentPrice < midpoint - (range * 0.1)) {
        trend = 'bearish';
      }

      const levels: FibonacciLevels = {
        high,
        low,
        level_0_618,
        level_0_707,
        trend,
        timestamp: Date.now()
      };

      this.cache.set(symbol, levels);
      
      console.log(`${symbol}: Fibonacci calculated - High: ${high.toFixed(2)}, Low: ${low.toFixed(2)}, 0.618: ${level_0_618.toFixed(2)}, 0.707: ${level_0_707.toFixed(2)}, Trend: ${trend}`);
      
      return levels;
    } catch (error) {
      console.error(`${symbol}: Failed to calculate Fibonacci levels:`, error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  static async detectBounce(
    symbol: string,
    currentPrice: number,
    optionType: 'call' | 'put'
  ): Promise<BounceDetection> {
    const levels = await this.calculateFibonacciLevels(symbol);
    
    if (!levels) {
      return { isBouncing: false, levels: null as any };
    }

    const tolerance_0_618 = levels.level_0_618 * this.BOUNCE_TOLERANCE;
    const tolerance_0_707 = levels.level_0_707 * this.BOUNCE_TOLERANCE;

    const isNear_0_707 = Math.abs(currentPrice - levels.level_0_707) <= tolerance_0_707;
    const isNear_0_618 = Math.abs(currentPrice - levels.level_0_618) <= tolerance_0_618;

    if (isNear_0_707) {
      const validBounce = this.validateBounceDirection(levels.trend, optionType);
      if (validBounce) {
        console.log(`${symbol}: ⭐ GOLDEN BOUNCE at 0.707 Fibonacci (${currentPrice.toFixed(2)} near ${levels.level_0_707.toFixed(2)})`);
        return {
          isBouncing: true,
          fibLevel: 0.707,
          color: 'gold',
          levels
        };
      }
    }

    if (isNear_0_618) {
      const validBounce = this.validateBounceDirection(levels.trend, optionType);
      if (validBounce) {
        console.log(`${symbol}: ✅ GREEN BOUNCE at 0.618 Fibonacci (${currentPrice.toFixed(2)} near ${levels.level_0_618.toFixed(2)})`);
        return {
          isBouncing: true,
          fibLevel: 0.618,
          color: 'green',
          levels
        };
      }
    }

    console.log(`${symbol}: ❌ NOT at Fibonacci level (current: ${currentPrice.toFixed(2)}, 0.707: ${levels.level_0_707.toFixed(2)}, 0.618: ${levels.level_0_618.toFixed(2)})`);
    return { isBouncing: false, levels };
  }

  private static validateBounceDirection(trend: string, optionType: 'call' | 'put'): boolean {
    if (trend === 'bullish' && optionType === 'call') {
      return true;
    }
    if (trend === 'bearish' && optionType === 'put') {
      return true;
    }
    if (trend === 'neutral') {
      return true;
    }
    return false;
  }

  static clearCache(symbol?: string): void {
    if (symbol) {
      this.cache.delete(symbol);
    } else {
      this.cache.clear();
    }
  }
}

export const fibonacciService = new FibonacciService();
