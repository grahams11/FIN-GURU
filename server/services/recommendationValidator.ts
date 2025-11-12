/**
 * Recommendation Validator Service
 * 
 * Validates that trade recommendations are still actionable:
 * 1. Not too old (stale recommendations)
 * 2. Price hasn't moved too far from entry (invalidates setup)
 * 3. Still within trading hours
 * 4. Expiration hasn't passed
 */

import type { OptionsTrade } from '@shared/schema';
import { polygonService } from './polygonService';

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  priceMoved?: number; // Percentage price moved from entry
  ageMinutes?: number;
}

export class RecommendationValidator {
  // Recommendations older than 15 minutes are considered stale
  private static readonly MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes
  
  // If price moves >3% from entry, setup is invalidated
  private static readonly MAX_PRICE_DRIFT_PERCENT = 3.0;
  
  /**
   * Check if a recommendation is still valid and actionable
   */
  static async validateRecommendation(trade: OptionsTrade): Promise<ValidationResult> {
    // 1. Check age (stale recommendations)
    const ageMinutes = this.getAgeMinutes(trade.createdAt);
    if (ageMinutes > (this.MAX_AGE_MS / 60000)) {
      return {
        isValid: false,
        reason: `Stale (${ageMinutes.toFixed(0)}min old)`,
        ageMinutes
      };
    }
    
    // 2. Check if expiration has passed
    const expirationDate = new Date(trade.expiry);
    if (expirationDate < new Date()) {
      return {
        isValid: false,
        reason: 'Expired',
        ageMinutes
      };
    }
    
    // 3. Check if price has moved too much (setup invalidated)
    const currentPrice = await this.getCurrentPrice(trade.ticker);
    if (currentPrice !== null) {
      const entryPrice = trade.stockEntryPrice || trade.currentPrice;
      const priceDriftPercent = Math.abs(((currentPrice - entryPrice) / entryPrice) * 100);
      
      if (priceDriftPercent > this.MAX_PRICE_DRIFT_PERCENT) {
        return {
          isValid: false,
          reason: `Price moved ${priceDriftPercent.toFixed(1)}% (>${this.MAX_PRICE_DRIFT_PERCENT}%)`,
          priceMoved: priceDriftPercent,
          ageMinutes
        };
      }
    }
    
    return {
      isValid: true,
      ageMinutes
    };
  }
  
  /**
   * Batch validate multiple recommendations
   */
  static async validateRecommendations(trades: OptionsTrade[]): Promise<Map<string, ValidationResult>> {
    const results = new Map<string, ValidationResult>();
    
    await Promise.all(
      trades.map(async (trade) => {
        const result = await this.validateRecommendation(trade);
        results.set(trade.id, result);
      })
    );
    
    return results;
  }
  
  /**
   * Filter out invalid recommendations from a list
   */
  static async filterValidRecommendations(trades: OptionsTrade[]): Promise<OptionsTrade[]> {
    const validationResults = await this.validateRecommendations(trades);
    
    const validTrades: OptionsTrade[] = [];
    const invalidTrades: { trade: OptionsTrade; result: ValidationResult }[] = [];
    
    for (const trade of trades) {
      const result = validationResults.get(trade.id);
      if (result?.isValid) {
        validTrades.push(trade);
      } else if (result) {
        invalidTrades.push({ trade, result });
      }
    }
    
    // Log filtered recommendations
    if (invalidTrades.length > 0) {
      console.log(`🧹 Filtered ${invalidTrades.length} invalid recommendations:`);
      invalidTrades.forEach(({ trade, result }) => {
        console.log(`  ❌ ${trade.ticker} ${trade.optionType?.toUpperCase()}: ${result.reason}`);
      });
    }
    
    return validTrades;
  }
  
  /**
   * Check if we're within market hours (9:30am - 4:00pm ET)
   */
  static isMarketHours(): boolean {
    const now = new Date();
    const et = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    }).format(now);
    
    const [hour, minute] = et.split(':').map(Number);
    const timeInMinutes = hour * 60 + minute;
    
    // Market hours: 9:30am (570 min) to 4:00pm (960 min)
    const marketOpen = 9 * 60 + 30; // 570
    const marketClose = 16 * 60; // 960
    
    return timeInMinutes >= marketOpen && timeInMinutes <= marketClose;
  }
  
  /**
   * Get age of recommendation in minutes
   */
  private static getAgeMinutes(createdAt: Date | string | null | undefined): number {
    if (!createdAt) return Infinity;
    const created = new Date(createdAt);
    const now = new Date();
    return (now.getTime() - created.getTime()) / 60000;
  }
  
  /**
   * Get current price for a symbol
   */
  private static async getCurrentPrice(ticker: string): Promise<number | null> {
    try {
      // Try to get cached quote from Polygon
      const quote = polygonService.getCachedQuote(ticker);
      if (quote && quote.price > 0) {
        return quote.price;
      }
      
      // Fallback: Fetch from Polygon API
      const snapshot = await polygonService.getSnapshot(ticker);
      if (snapshot?.ticker?.lastTrade?.p) {
        return snapshot.ticker.lastTrade.p;
      }
      
      return null;
    } catch (error) {
      console.warn(`Failed to get current price for ${ticker}:`, error);
      return null;
    }
  }
}
