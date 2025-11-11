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
  private static LOOKBACK_DAYS = 60; // 60 days of 4-hour bars = ~360 candles
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

      // Use 4-hour chart data for Fibonacci calculations (as per trading strategy)
      // Fallback to daily bars if 4-hour bars aren't available
      let bars = await polygonService.getHistoricalBars(
        symbol,
        fromDate.toISOString().split('T')[0],
        toDate.toISOString().split('T')[0],
        'hour',
        4 // 4-hour bars
      );

      // If insufficient 4-hour bars, fallback to daily bars (more widely available)
      if (!bars || bars.length < 10) {
        console.log(`${symbol}: Falling back to daily bars for Fibonacci calculation`);
        bars = await polygonService.getHistoricalBars(
          symbol,
          fromDate.toISOString().split('T')[0],
          toDate.toISOString().split('T')[0],
          'day',
          1 // daily bars
        );
      }

      if (!bars || bars.length < 10) {
        console.warn(`${symbol}: Insufficient historical data for Fibonacci calculation (even with daily bars)`);
        return null;
      }

      // Find swing high/low pivots instead of absolute highest/lowest
      // This filters out outlier spikes and finds meaningful support/resistance
      const swingPivots = this.findSwingPivots(bars);
      
      if (!swingPivots) {
        console.warn(`${symbol}: Unable to identify swing pivots`);
        return null;
      }

      const { swingHigh, swingLow } = swingPivots;
      const range = swingHigh - swingLow;

      if (range === 0 || range < 0) {
        console.warn(`${symbol}: Invalid price range in swing pivots`);
        return null;
      }

      // Calculate Fibonacci retracement levels from swing high
      const level_0_618 = swingHigh - (range * 0.618);
      const level_0_707 = swingHigh - (range * 0.707);

      const recentPrice = bars[bars.length - 1].c;
      const midpoint = swingHigh - (range * 0.5);
      
      let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      if (recentPrice > midpoint + (range * 0.1)) {
        trend = 'bullish';
      } else if (recentPrice < midpoint - (range * 0.1)) {
        trend = 'bearish';
      }

      const levels: FibonacciLevels = {
        high: swingHigh,
        low: swingLow,
        level_0_618,
        level_0_707,
        trend,
        timestamp: Date.now()
      };

      this.cache.set(symbol, levels);
      
      console.log(`${symbol}: Fibonacci (4H swing) - High: ${swingHigh.toFixed(2)}, Low: ${swingLow.toFixed(2)}, 0.618: ${level_0_618.toFixed(2)}, 0.707: ${level_0_707.toFixed(2)}, Trend: ${trend}`);
      
      return levels;
    } catch (error) {
      console.error(`${symbol}: Failed to calculate Fibonacci levels:`, error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  /**
   * Find swing high and swing low pivots using fractal detection
   * A swing high requires higher highs on both sides (5-bar lookback)
   * A swing low requires lower lows on both sides (5-bar lookback)
   */
  private static findSwingPivots(bars: HistoricalBar[]): { swingHigh: number; swingLow: number } | null {
    if (bars.length < 11) return null;

    const lookback = 5; // 5 bars on each side for pivot confirmation
    const swingHighs: number[] = [];
    const swingLows: number[] = [];

    // Scan for swing pivots (skip first and last 'lookback' bars)
    for (let i = lookback; i < bars.length - lookback; i++) {
      const currentHigh = bars[i].h;
      const currentLow = bars[i].l;

      // Check if this is a swing high (higher than surrounding bars)
      let isSwingHigh = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j !== i && bars[j].h >= currentHigh) {
          isSwingHigh = false;
          break;
        }
      }
      if (isSwingHigh) {
        swingHighs.push(currentHigh);
      }

      // Check if this is a swing low (lower than surrounding bars)
      let isSwingLow = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j !== i && bars[j].l <= currentLow) {
          isSwingLow = false;
          break;
        }
      }
      if (isSwingLow) {
        swingLows.push(currentLow);
      }
    }

    // Use most recent significant swing high and swing low
    // If no pivots found, fallback to recent 30-bar high/low
    const swingHigh = swingHighs.length > 0
      ? swingHighs[swingHighs.length - 1]
      : Math.max(...bars.slice(-30).map(b => b.h));
      
    const swingLow = swingLows.length > 0
      ? swingLows[swingLows.length - 1]
      : Math.min(...bars.slice(-30).map(b => b.l));

    return { swingHigh, swingLow };
  }

  static async detectBounce(
    symbol: string,
    currentPrice: number,
    optionType: 'call' | 'put'
  ): Promise<BounceDetection | null> {
    const levels = await this.calculateFibonacciLevels(symbol);
    
    if (!levels) {
      // Fail safe: return null instead of invalid data
      return null;
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
