/**
 * Recommendation Tracking Service
 * 
 * Captures every dashboard recommendation and tracks its actual performance
 * to continuously refine the trading strategy and maintain 80%+ win rate
 */

import { db } from '../db';
import { recommendationTracking, recommendationPerformance, strategyParameters } from '@shared/schema';
import type { TradeRecommendation } from '@shared/schema';
import { eq, and, gte, desc } from 'drizzle-orm';
import { EliteStrategyEngine } from './eliteStrategyEngine';

export class RecommendationTracker {
  
  /**
   * Capture a recommendation when it's displayed on the dashboard
   */
  static async trackRecommendation(
    recommendation: TradeRecommendation,
    recommendationType: 'day_trade' | 'swing_trade',
    signalMetrics: {
      rsi: number;
      vix: number;
      ema?: number;
      atrShort?: number;
      atrLong?: number;
      fibonacciLevel?: number;
    }
  ): Promise<string> {
    
    // Get current active strategy version
    const activeParams = await this.getActiveParameters();
    const strategyVersion = activeParams?.version || `v${Date.now()}`;
    
    // Insert tracking record
    const [tracked] = await db.insert(recommendationTracking).values({
      ticker: recommendation.ticker,
      optionType: recommendation.optionType,
      recommendationType,
      strikePrice: recommendation.strikePrice,
      expiry: recommendation.expiry,
      entryPrice: recommendation.currentPrice,
      premium: recommendation.premium,
      contracts: recommendation.contracts,
      projectedROI: recommendation.projectedROI,
      aiConfidence: recommendation.aiConfidence,
      
      // Signal metrics
      rsi: signalMetrics.rsi,
      vix: signalMetrics.vix,
      ema: signalMetrics.ema || null,
      atrShort: signalMetrics.atrShort || null,
      atrLong: signalMetrics.atrLong || null,
      fibonacciLevel: signalMetrics.fibonacciLevel || recommendation.fibonacciLevel || null,
      
      // Greeks
      delta: recommendation.greeks.delta,
      theta: recommendation.greeks.theta,
      gamma: recommendation.greeks.gamma,
      vega: recommendation.greeks.vega,
      
      // Strategy info
      strategyVersion,
      parameters: activeParams ? {
        rsiOversold: activeParams.rsiOversold,
        rsiOverbought: activeParams.rsiOverbought,
        vixMinCall: activeParams.vixMinCall,
        vixMinPut: activeParams.vixMinPut,
        stopLoss: activeParams.stopLoss,
        profitTarget: activeParams.profitTarget,
        emaLength: activeParams.emaLength,
        atrMultiplier: activeParams.atrMultiplier,
        deltaMin: activeParams.deltaMin,
        deltaMax: activeParams.deltaMax
      } : EliteStrategyEngine.getInstance().getConfig(),
      
      status: 'monitoring'
    }).returning();
    
    console.log(`📊 Tracked ${recommendation.ticker} ${recommendation.optionType.toUpperCase()} - ${recommendationType} (ID: ${tracked.id})`);
    
    return tracked.id;
  }
  
  /**
   * Update performance when outcome is known
   */
  static async recordOutcome(
    recommendationId: string,
    outcome: {
      exitDate: Date;
      exitPrice: number;
      exitPremium: number;
      exitReason: 'profit_target' | 'stop_loss' | 'time_based' | 'manual' | 'expiry';
    }
  ): Promise<void> {
    
    // Get original recommendation
    const [rec] = await db.select()
      .from(recommendationTracking)
      .where(eq(recommendationTracking.id, recommendationId))
      .limit(1);
    
    if (!rec) {
      console.warn(`❌ Recommendation ${recommendationId} not found`);
      return;
    }
    
    // Calculate actual performance
    const actualROI = ((outcome.exitPremium - rec.premium) / rec.premium) * 100;
    const actualProfit = (outcome.exitPremium - rec.premium) * rec.contracts * 100;
    const holdDays = Math.floor((outcome.exitDate.getTime() - new Date(rec.recommendedAt || new Date()).getTime()) / (1000 * 60 * 60 * 24));
    
    // Determine win/loss based on outcome
    const isWin = actualROI >= (rec.parameters as any).profitTarget * 100; // Hit profit target
    const isLoss = actualROI <= -(rec.parameters as any).stopLoss * 100; // Hit stop loss
    
    // Insert or update performance record
    const [perf] = await db.insert(recommendationPerformance).values({
      recommendationId,
      exitDate: outcome.exitDate,
      exitPrice: outcome.exitPrice,
      exitPremium: outcome.exitPremium,
      actualROI,
      actualProfit,
      exitReason: outcome.exitReason,
      holdDays,
      maxDrawdown: null, // TODO: Track intraday if monitoring
      maxProfit: actualROI > 0 ? actualROI : 0,
      isWin,
      isLoss,
      closedAt: new Date()
    }).returning();
    
    // Update recommendation status
    await db.update(recommendationTracking)
      .set({ status: 'closed' })
      .where(eq(recommendationTracking.id, recommendationId));
    
    console.log(`✅ Recorded ${rec.ticker} outcome: ${actualROI.toFixed(1)}% ROI (${isWin ? 'WIN' : isLoss ? 'LOSS' : 'NEUTRAL'})`);
    
    // Check if we need to adjust parameters
    await this.checkAndAdjustParameters();
  }
  
  /**
   * Calculate rolling 30-day win rate
   */
  static async getRecentWinRate(days: number = 30): Promise<{
    winRate: number;
    avgROI: number;
    profitFactor: number;
    totalTrades: number;
  }> {
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    // Get all closed recommendations from last N days
    const recentRecs = await db.select()
      .from(recommendationTracking)
      .innerJoin(recommendationPerformance, eq(recommendationTracking.id, recommendationPerformance.recommendationId))
      .where(
        and(
          eq(recommendationTracking.status, 'closed'),
          gte(recommendationTracking.recommendedAt, cutoffDate)
        )
      );
    
    if (recentRecs.length === 0) {
      return { winRate: 0, avgROI: 0, profitFactor: 0, totalTrades: 0 };
    }
    
    const wins = recentRecs.filter(r => r.recommendation_performance.isWin).length;
    const losses = recentRecs.filter(r => r.recommendation_performance.isLoss).length;
    const winRate = (wins / recentRecs.length) * 100;
    
    const totalROI = recentRecs.reduce((sum, r) => sum + (r.recommendation_performance.actualROI || 0), 0);
    const avgROI = totalROI / recentRecs.length;
    
    const grossProfit = recentRecs
      .filter(r => r.recommendation_performance.actualProfit! > 0)
      .reduce((sum, r) => sum + (r.recommendation_performance.actualProfit || 0), 0);
    
    const grossLoss = Math.abs(recentRecs
      .filter(r => r.recommendation_performance.actualProfit! < 0)
      .reduce((sum, r) => sum + (r.recommendation_performance.actualProfit || 0), 0));
    
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
    
    return {
      winRate,
      avgROI,
      profitFactor,
      totalTrades: recentRecs.length
    };
  }
  
  /**
   * Check if parameters need adjustment to maintain 80%+ win rate
   */
  static async checkAndAdjustParameters(): Promise<void> {
    const metrics = await this.getRecentWinRate(30);
    
    // Only adjust if we have enough data
    if (metrics.totalTrades < 10) {
      console.log(`⏳ Not enough data yet (${metrics.totalTrades}/10 trades)`);
      return;
    }
    
    console.log(`📈 30-Day Performance: ${metrics.winRate.toFixed(1)}% win rate, ${metrics.avgROI.toFixed(1)}% avg ROI, ${metrics.profitFactor.toFixed(2)}x profit factor`);
    
    // If win rate is below 80%, adjust parameters
    if (metrics.winRate < 80) {
      console.log(`⚠️ Win rate ${metrics.winRate.toFixed(1)}% below target 80% - adjusting parameters...`);
      await this.adjustParameters('win_rate_low', metrics);
    } else if (metrics.winRate >= 85) {
      console.log(`✅ Win rate ${metrics.winRate.toFixed(1)}% above target - strategy performing well!`);
    }
  }
  
  /**
   * Adjust strategy parameters to improve win rate
   */
  static async adjustParameters(reason: string, currentMetrics: any): Promise<void> {
    const currentConfig = EliteStrategyEngine.getInstance().getConfig();
    const activeParams = await this.getActiveParameters();
    
    // Deactivate current parameters
    if (activeParams) {
      await db.update(strategyParameters)
        .set({
          isActive: false,
          deactivatedAt: new Date(),
          winRate: currentMetrics.winRate,
          avgROI: currentMetrics.avgROI,
          profitFactor: currentMetrics.profitFactor,
          totalTrades: currentMetrics.totalTrades
        })
        .where(eq(strategyParameters.id, activeParams.id));
    }
    
    // Calculate new parameters (more conservative to boost win rate)
    const newConfig = {
      rsiOversold: Math.min(45, currentConfig.rsiOversold + 2), // More conservative entry
      rsiOverbought: Math.max(55, currentConfig.rsiOverbought - 2),
      vixMinCall: Math.min(20, currentConfig.vixMinCall + 1), // Higher VIX requirement
      vixMinPut: Math.min(25, currentConfig.vixMinPut + 1),
      stopLoss: Math.max(0.25, currentConfig.stopLoss - 0.02), // Tighter stop
      profitTarget: Math.max(0.50, currentConfig.profitTarget - 0.05), // Lower target
      partialProfitLevel: currentConfig.partialProfitLevel,
      partialProfitPercent: currentConfig.partialProfitPercent,
      emaLength: currentConfig.emaLength,
      atrMultiplier: Math.min(1.5, currentConfig.atrMultiplier + 0.1), // Stronger momentum required
      deltaMin: currentConfig.deltaMin,
      deltaMax: currentConfig.deltaMax
    };
    
    // Create new parameter version
    const newVersion = `v${Date.now()}`;
    await db.insert(strategyParameters).values({
      version: newVersion,
      rsiOversold: newConfig.rsiOversold,
      rsiOverbought: newConfig.rsiOverbought,
      vixMinCall: newConfig.vixMinCall,
      vixMinPut: newConfig.vixMinPut,
      stopLoss: newConfig.stopLoss,
      profitTarget: newConfig.profitTarget,
      partialProfitLevel: newConfig.partialProfitLevel,
      partialProfitPercent: newConfig.partialProfitPercent,
      emaLength: newConfig.emaLength,
      atrMultiplier: newConfig.atrMultiplier,
      deltaMin: newConfig.deltaMin,
      deltaMax: newConfig.deltaMax,
      winRate: null, // Will be filled as data comes in
      avgROI: null,
      profitFactor: null,
      totalTrades: 0,
      adjustmentReason: `${reason} - Previous: ${currentMetrics.winRate.toFixed(1)}% win rate`,
      previousVersion: activeParams?.version || null,
      isActive: true
    });
    
    // Update elite strategy engine
    EliteStrategyEngine.getInstance().updateConfig(newConfig);
    
    console.log(`🎯 Parameters adjusted to boost win rate:`);
    console.log(`   RSI: ${newConfig.rsiOversold}/${newConfig.rsiOverbought} (was ${currentConfig.rsiOversold}/${currentConfig.rsiOverbought})`);
    console.log(`   VIX: ${newConfig.vixMinCall}/${newConfig.vixMinPut} (was ${currentConfig.vixMinCall}/${currentConfig.vixMinPut})`);
    console.log(`   Stop/Target: ${(newConfig.stopLoss * 100).toFixed(0)}%/${(newConfig.profitTarget * 100).toFixed(0)}% (was ${(currentConfig.stopLoss * 100).toFixed(0)}%/${(currentConfig.profitTarget * 100).toFixed(0)}%)`);
  }
  
  /**
   * Get currently active parameters
   */
  static async getActiveParameters() {
    const [active] = await db.select()
      .from(strategyParameters)
      .where(eq(strategyParameters.isActive, true))
      .orderBy(desc(strategyParameters.activatedAt))
      .limit(1);
    
    return active || null;
  }
  
  /**
   * Initialize default parameters if none exist
   */
  static async initializeDefaultParameters(): Promise<void> {
    const existing = await this.getActiveParameters();
    if (existing) return;
    
    const defaultConfig = EliteStrategyEngine.getInstance().getConfig();
    
    await db.insert(strategyParameters).values({
      version: 'v1.0.0',
      rsiOversold: defaultConfig.rsiOversold,
      rsiOverbought: defaultConfig.rsiOverbought,
      vixMinCall: defaultConfig.vixMinCall,
      vixMinPut: defaultConfig.vixMinPut,
      stopLoss: defaultConfig.stopLoss,
      profitTarget: defaultConfig.profitTarget,
      partialProfitLevel: defaultConfig.partialProfitLevel,
      partialProfitPercent: defaultConfig.partialProfitPercent,
      emaLength: defaultConfig.emaLength,
      atrMultiplier: defaultConfig.atrMultiplier,
      deltaMin: defaultConfig.deltaMin,
      deltaMax: defaultConfig.deltaMax,
      winRate: null,
      avgROI: null,
      profitFactor: null,
      totalTrades: 0,
      adjustmentReason: 'Initial elite strategy parameters',
      previousVersion: null,
      isActive: true
    });
    
    console.log(`✅ Initialized default elite strategy parameters`);
  }
}

// Initialize on startup
RecommendationTracker.initializeDefaultParameters().catch(console.error);
