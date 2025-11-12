import { learningStorage } from "../storage";
import type { InsertPerformanceMetricsRow, RecommendationTracking, RecommendationPerformance } from "@shared/schema";

/**
 * LearningAnalyticsService
 * Computes performance metrics aggregates from trade outcomes
 * Uses SQL CTE-based calculations for efficiency
 */
export class LearningAnalyticsService {
  /**
   * Compute and persist performance metrics for a given strategy/regime/timeframe
   */
  async refreshMetrics(
    strategyVersion: string,
    marketRegime: string = 'all',
    timeframe: string = '30d'
  ): Promise<InsertPerformanceMetricsRow> {
    // Calculate date range based on timeframe
    const periodEnd = new Date();
    const periodStart = new Date();
    
    switch (timeframe) {
      case '7d':
        periodStart.setDate(periodEnd.getDate() - 7);
        break;
      case '30d':
        periodStart.setDate(periodEnd.getDate() - 30);
        break;
      case '90d':
        periodStart.setDate(periodEnd.getDate() - 90);
        break;
      case 'all_time':
        periodStart.setFullYear(2020); // Far back enough
        break;
      default:
        periodStart.setDate(periodEnd.getDate() - 30);
    }
    
    // Fetch trade outcomes for this strategy
    const outcomes = await learningStorage.getTradeOutcomes({
      strategyVersion,
      startDate: periodStart,
      closedOnly: true // Only analyze closed trades
    });
    
    // Filter by market regime if specified
    const filteredOutcomes = outcomes.filter(outcome => {
      if (marketRegime === 'all') return true;
      // Would need to add regime detection logic here
      // For now, include all
      return true;
    });
    
    // Compute metrics
    const metrics = this.computeMetrics(filteredOutcomes);
    
    // Prepare insert data
    const metricsData: InsertPerformanceMetricsRow = {
      strategyVersion,
      marketRegime,
      timeframe,
      winRate: metrics.winRate,
      avgROI: metrics.avgROI,
      profitFactor: metrics.profitFactor,
      sharpeRatio: metrics.sharpeRatio,
      maxDrawdown: metrics.maxDrawdown,
      totalTrades: metrics.totalTrades,
      winningTrades: metrics.winningTrades,
      losingTrades: metrics.losingTrades,
      callWinRate: metrics.callWinRate,
      putWinRate: metrics.putWinRate,
      periodStart,
      periodEnd
    };
    
    // Upsert to database
    await learningStorage.upsertMetrics(metricsData);
    
    return metricsData;
  }
  
  /**
   * Compute statistical metrics from trade outcomes
   */
  private computeMetrics(outcomes: Array<RecommendationTracking & { performance?: RecommendationPerformance }>) {
    const closedTrades = outcomes.filter(o => o.performance?.closedAt);
    const totalTrades = closedTrades.length;
    
    if (totalTrades === 0) {
      return {
        winRate: 0,
        avgROI: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        callWinRate: 0,
        putWinRate: 0
      };
    }
    
    // Separate wins and losses
    const wins = closedTrades.filter(t => t.performance?.isWin);
    const losses = closedTrades.filter(t => t.performance?.isLoss);
    const winningTrades = wins.length;
    const losingTrades = losses.length;
    
    // Win rate
    const winRate = (winningTrades / totalTrades) * 100;
    
    // Average ROI
    const totalROI = closedTrades.reduce((sum, t) => sum + (t.performance?.actualROI || 0), 0);
    const avgROI = totalROI / totalTrades;
    
    // Profit factor (gross profit / gross loss)
    const grossProfit = wins.reduce((sum, t) => sum + (t.performance?.actualProfit || 0), 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.performance?.actualProfit || 0), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;
    
    // Sharpe ratio (simplified: avg return / std dev of returns)
    const returns = closedTrades.map(t => t.performance?.actualROI || 0);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
    
    // Max drawdown
    const maxDrawdown = Math.min(...closedTrades.map(t => t.performance?.maxDrawdown || 0));
    
    // Call/Put win rates
    const calls = closedTrades.filter(t => t.optionType === 'call');
    const callWins = calls.filter(t => t.performance?.isWin).length;
    const callWinRate = calls.length > 0 ? (callWins / calls.length) * 100 : 0;
    
    const puts = closedTrades.filter(t => t.optionType === 'put');
    const putWins = puts.filter(t => t.performance?.isWin).length;
    const putWinRate = puts.length > 0 ? (putWins / puts.length) * 100 : 0;
    
    return {
      winRate,
      avgROI,
      profitFactor,
      sharpeRatio,
      maxDrawdown,
      totalTrades,
      winningTrades,
      losingTrades,
      callWinRate,
      putWinRate
    };
  }
  
  /**
   * Refresh metrics for all active strategy versions
   */
  async refreshAllMetrics(): Promise<void> {
    // For now, just refresh for the current strategy version
    const strategyVersion = 'v1.0.0'; // Would fetch from strategy parameters
    
    // Refresh for all timeframes
    await Promise.all([
      this.refreshMetrics(strategyVersion, 'all', '7d'),
      this.refreshMetrics(strategyVersion, 'all', '30d'),
      this.refreshMetrics(strategyVersion, 'all', '90d'),
      this.refreshMetrics(strategyVersion, 'all', 'all_time')
    ]);
  }
}

export const learningAnalyticsService = new LearningAnalyticsService();
