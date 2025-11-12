import { learningStorage } from "../storage";
import type { RecommendationTracking, RecommendationPerformance } from "@shared/schema";

/**
 * TradeOutcomeRepository
 * Lightweight facade over learningStorage.getTradeOutcomes()
 * Provides domain-specific query methods for learning analysis
 */
export class TradeOutcomeRepository {
  /**
   * Get closed trades for a rolling time window
   */
  async getRollingWindowOutcomes(
    days: number,
    strategyVersion?: string
  ): Promise<Array<RecommendationTracking & { performance?: RecommendationPerformance }>> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);
    
    return await learningStorage.getTradeOutcomes({
      strategyVersion,
      startDate,
      endDate,
      closedOnly: true
    });
  }
  
  /**
   * Get all closed trades for a specific strategy version
   */
  async getStrategyOutcomes(
    strategyVersion: string
  ): Promise<Array<RecommendationTracking & { performance?: RecommendationPerformance }>> {
    return await learningStorage.getTradeOutcomes({
      strategyVersion,
      closedOnly: true
    });
  }
  
  /**
   * Get recent closed trades (last N days)
   */
  async getRecentOutcomes(
    days: number = 30
  ): Promise<Array<RecommendationTracking & { performance?: RecommendationPerformance }>> {
    return this.getRollingWindowOutcomes(days);
  }
  
  /**
   * Get trades matching specific conditions (for insight validation)
   */
  async getMatchingTrades(
    conditions: {
      rsiRange?: [number, number];
      vixRange?: [number, number];
      optionType?: 'call' | 'put';
      sector?: string;
    }
  ): Promise<Array<RecommendationTracking & { performance?: RecommendationPerformance }>> {
    // Get all trades and filter by conditions
    const allTrades = await learningStorage.getTradeOutcomes({
      closedOnly: true
    });
    
    return allTrades.filter(trade => {
      // RSI range filter
      if (conditions.rsiRange) {
        const [min, max] = conditions.rsiRange;
        if (trade.rsi < min || trade.rsi > max) return false;
      }
      
      // VIX range filter
      if (conditions.vixRange) {
        const [min, max] = conditions.vixRange;
        if (trade.vix < min || trade.vix > max) return false;
      }
      
      // Option type filter
      if (conditions.optionType && trade.optionType !== conditions.optionType) {
        return false;
      }
      
      // Sector filter (would need sector data)
      // if (conditions.sector) { ... }
      
      return true;
    });
  }
  
  /**
   * Calculate win rate for trades matching conditions
   */
  async calculateWinRate(
    conditions: Parameters<typeof this.getMatchingTrades>[0]
  ): Promise<{ winRate: number; sampleSize: number; avgROI: number }> {
    const trades = await this.getMatchingTrades(conditions);
    const closedTrades = trades.filter(t => t.performance?.closedAt);
    
    if (closedTrades.length === 0) {
      return { winRate: 0, sampleSize: 0, avgROI: 0 };
    }
    
    const wins = closedTrades.filter(t => t.performance?.isWin).length;
    const winRate = (wins / closedTrades.length) * 100;
    const avgROI = closedTrades.reduce((sum, t) => sum + (t.performance?.actualROI || 0), 0) / closedTrades.length;
    
    return {
      winRate,
      sampleSize: closedTrades.length,
      avgROI
    };
  }
}

export const tradeOutcomeRepository = new TradeOutcomeRepository();
