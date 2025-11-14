/**
 * Elite Self-Learning Trading Strategy Engine
 * 
 * Features:
 * - Enhanced RSI with cross confirmation
 * - EMA trend alignment
 * - ATR momentum filtering
 * - Greeks quality filters
 * - Adaptive parameter tuning
 * - Partial profit-taking
 * - Continuous performance tracking
 */

import { historicalDataService } from './historicalDataService';

interface EliteStrategyConfig {
  // Dynamic parameters (adjusted by adaptive tuner)
  rsiOversold: number; // Default: 30 (Nov 12 strict filter)
  rsiOverbought: number; // Default: 70 (Nov 12 strict filter)
  vixMinCall: number; // Default: 15 (raised from 10)
  vixMinPut: number; // Default: 20 (raised from 10)
  
  // Stop/target parameters
  stopLoss: number; // Default: 0.30 (30%, tighter from 45%)
  profitTarget: number; // Default: 0.65 (65%, lower from 100%)
  partialProfitLevel: number; // Default: 0.35 (35%, take 50% position)
  partialProfitPercent: number; // Default: 0.50 (50% of position)
  
  // Trend and momentum filters
  emaLength: number; // Default: 20
  atrShort: number; // Default: 5
  atrLong: number; // Default: 30
  atrMultiplier: number; // Default: 1.2 (short ATR must be > 1.2x long ATR)
  
  // Greeks quality filters
  deltaMin: number; // Default: 0.10
  deltaMax: number; // Default: 0.80
  thetaMax: number; // Default: 999 (disabled - too restrictive for stock options)
  ivRankMin: number; // Default: 30 (percentile)
  
  // Fibonacci proximity
  fibProximity: number; // Default: 0.005 (0.5%)
}

export interface EnhancedSignal {
  date: string;
  ticker: string;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  entryPremium: number;
  contracts: number;
  
  // Signal metrics
  rsi: number;
  rsiPrevious: number; // For cross confirmation
  vix: number;
  stockPrice: number;
  ema: number;
  atrShort: number;
  atrLong: number;
  iv: number;
  
  // Greeks
  delta: number;
  theta: number;
  gamma: number;
  vega: number;
  
  // Confidence scoring
  signalQuality: number; // 0-100 score
  passedFilters: string[];
}

export class EliteStrategyEngine {
  private static instance: EliteStrategyEngine | null = null;
  private config: EliteStrategyConfig;
  
  private constructor(config?: Partial<EliteStrategyConfig>) {
    // Default elite parameters
    this.config = {
      rsiOversold: 30,
      rsiOverbought: 70,
      vixMinCall: 15,
      vixMinPut: 20,
      stopLoss: 0.30,
      profitTarget: 0.65,
      partialProfitLevel: 0.35,
      partialProfitPercent: 0.50,
      emaLength: 20,
      atrShort: 5,
      atrLong: 30,
      atrMultiplier: 1.2,
      deltaMin: 0.10,  // Wide range to allow more stock options
      deltaMax: 0.80,  // Wide range to allow more stock options
      thetaMax: 999,   // Disabled - too restrictive for low-priced stock options
      ivRankMin: 30,
      fibProximity: 0.005,
      ...config
    };
  }
  
  /**
   * Get singleton instance (creates if doesn't exist)
   */
  static getInstance(): EliteStrategyEngine {
    if (!EliteStrategyEngine.instance) {
      EliteStrategyEngine.instance = new EliteStrategyEngine();
    }
    return EliteStrategyEngine.instance;
  }
  
  /**
   * Load parameters from database and update config
   */
  async loadParametersFromDatabase(): Promise<void> {
    try {
      const { db } = await import('../db');
      const { strategyParameters } = await import('@shared/schema');
      const { eq, desc } = await import('drizzle-orm');
      
      const [activeParams] = await db.select()
        .from(strategyParameters)
        .where(eq(strategyParameters.isActive, true))
        .orderBy(desc(strategyParameters.activatedAt))
        .limit(1);
      
      if (activeParams) {
        this.config = {
          rsiOversold: activeParams.rsiOversold,
          rsiOverbought: activeParams.rsiOverbought,
          vixMinCall: activeParams.vixMinCall,
          vixMinPut: activeParams.vixMinPut,
          stopLoss: activeParams.stopLoss,
          profitTarget: activeParams.profitTarget,
          partialProfitLevel: activeParams.partialProfitLevel || 0.35,
          partialProfitPercent: activeParams.partialProfitPercent || 0.50,
          emaLength: activeParams.emaLength || 20,
          atrShort: 5,
          atrLong: 30,
          atrMultiplier: activeParams.atrMultiplier || 1.2,
          deltaMin: activeParams.deltaMin || 0.10,
          deltaMax: activeParams.deltaMax || 0.80,
          thetaMax: 999,  // Disabled theta filter
          ivRankMin: 30,
          fibProximity: 0.005,
        };
        console.log(`✅ Loaded active strategy parameters ${activeParams.version} from database`);
      } else {
        console.log(`ℹ️ No active parameters in database, using defaults`);
      }
    } catch (error) {
      console.error('Failed to load parameters from database:', error);
      // Continue with default parameters
    }
  }
  
  /**
   * Calculate EMA (Exponential Moving Average)
   */
  calculateEMA(prices: number[], length: number): number[] {
    const ema: number[] = [];
    const multiplier = 2 / (length + 1);
    
    // Start with SMA
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += prices[i];
    }
    ema.push(sum / length);
    
    // Calculate EMA
    for (let i = length; i < prices.length; i++) {
      const value = (prices[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
      ema.push(value);
    }
    
    return ema;
  }
  
  /**
   * Calculate ATR (Average True Range)
   */
  calculateATR(bars: any[], length: number): number[] {
    const atr: number[] = [];
    const trueRanges: number[] = [];
    
    for (let i = 1; i < bars.length; i++) {
      const high = bars[i].high;
      const low = bars[i].low;
      const prevClose = bars[i - 1].close;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }
    
    // Calculate first ATR as SMA
    let sum = 0;
    for (let i = 0; i < length && i < trueRanges.length; i++) {
      sum += trueRanges[i];
    }
    atr.push(sum / Math.min(length, trueRanges.length));
    
    // Calculate subsequent ATR values
    for (let i = length; i < trueRanges.length; i++) {
      const value = (atr[atr.length - 1] * (length - 1) + trueRanges[i]) / length;
      atr.push(value);
    }
    
    return atr;
  }
  
  /**
   * Check if RSI is crossing (not just at level)
   * For CALL: RSI crossing UP from oversold
   * For PUT: RSI crossing DOWN from overbought
   */
  isRSICrossing(currentRSI: number, previousRSI: number, type: 'call' | 'put'): boolean {
    if (type === 'call') {
      // RSI was below oversold and is now crossing back up
      return previousRSI <= this.config.rsiOversold && currentRSI > this.config.rsiOversold;
    } else {
      // RSI was above overbought and is now crossing back down
      return previousRSI >= this.config.rsiOverbought && currentRSI < this.config.rsiOverbought;
    }
  }
  
  /**
   * Check EMA trend alignment
   * CALL: price must be above EMA (uptrend)
   * PUT: price must be below EMA (downtrend)
   */
  isTrendAligned(price: number, ema: number, type: 'call' | 'put'): boolean {
    if (type === 'call') {
      return price > ema; // Uptrend
    } else {
      return price < ema; // Downtrend
    }
  }
  
  /**
   * Check ATR momentum
   * Short-term ATR must be greater than long-term ATR by multiplier
   */
  hasATRMomentum(atrShort: number, atrLong: number): boolean {
    return atrShort > (atrLong * this.config.atrMultiplier);
  }
  
  /**
   * Check if price is near Fibonacci level
   */
  isNearFibonacci(price: number, fibLevel: number): boolean {
    const diff = Math.abs(price - fibLevel) / fibLevel;
    return diff <= this.config.fibProximity;
  }
  
  /**
   * Calculate signal quality score (0-100)
   */
  calculateSignalQuality(metrics: {
    rsiDistance: number;
    trendAlignment: boolean;
    atrMomentum: boolean;
    fibAlignment: boolean;
    vixLevel: number;
    deltaQuality: number;
  }): number {
    let score = 0;
    
    // RSI extremity (0-25 points)
    score += Math.min(25, metrics.rsiDistance * 25);
    
    // Trend alignment (25 points)
    if (metrics.trendAlignment) score += 25;
    
    // ATR momentum (15 points)
    if (metrics.atrMomentum) score += 15;
    
    // Fibonacci alignment (15 points)
    if (metrics.fibAlignment) score += 15;
    
    // VIX level (10 points)
    score += Math.min(10, (metrics.vixLevel - 15) / 2);
    
    // Delta quality (10 points)
    score += metrics.deltaQuality * 10;
    
    return Math.min(100, Math.max(0, score));
  }
  
  /**
   * Update configuration (for adaptive tuning)
   */
  updateConfig(updates: Partial<EliteStrategyConfig>) {
    this.config = { ...this.config, ...updates };
    console.log(`🎯 Elite Strategy Config Updated:`, updates);
  }
  
  /**
   * Get current configuration
   */
  getConfig(): EliteStrategyConfig {
    return { ...this.config };
  }
}
