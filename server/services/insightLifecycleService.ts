import { learningStorage } from "../storage";
import type { MarketInsight } from "@shared/schema";

/**
 * InsightLifecycleService
 * Monitors insight performance and auto-deactivates underperforming patterns
 * Tiered thresholds: warn <55%, deactivate <45%
 */
export class InsightLifecycleService {
  private readonly WARN_THRESHOLD = 55; // Warn when win rate drops below 55%
  private readonly DEACTIVATE_THRESHOLD = 45; // Auto-deactivate below 45%
  private readonly MIN_SAMPLE_SIZE = 20; // Minimum trades before deactivating
  
  /**
   * Evaluate all active insights and deactivate underperformers
   */
  async evaluateInsights(): Promise<{
    warned: MarketInsight[];
    deactivated: MarketInsight[];
  }> {
    const activeInsights = await learningStorage.getActiveInsights();
    const warned: MarketInsight[] = [];
    const deactivated: MarketInsight[] = [];
    
    for (const insight of activeInsights) {
      // Skip if sample size too small for statistical significance
      if (insight.sampleSize < this.MIN_SAMPLE_SIZE) {
        continue;
      }
      
      // Check if win rate has degraded
      const currentWinRate = await this.calculateCurrentWinRate(insight);
      
      // Deactivate if below threshold
      if (currentWinRate < this.DEACTIVATE_THRESHOLD) {
        const updated = await learningStorage.deactivateInsight(
          insight.id,
          `Win rate dropped to ${currentWinRate.toFixed(1)}% (below ${this.DEACTIVATE_THRESHOLD}% threshold)`
        );
        if (updated) {
          deactivated.push(updated);
        }
      }
      // Warn if approaching threshold
      else if (currentWinRate < this.WARN_THRESHOLD) {
        warned.push(insight);
        console.warn(`[InsightLifecycle] Insight ${insight.id} win rate at ${currentWinRate.toFixed(1)}% (warning threshold: ${this.WARN_THRESHOLD}%)`);
      }
    }
    
    return { warned, deactivated };
  }
  
  /**
   * Calculate current win rate for an insight based on recent matching trades
   * This would query trades matching the insight conditions
   */
  private async calculateCurrentWinRate(insight: MarketInsight): Promise<number> {
    // For now, return the stored win rate
    // In a full implementation, this would:
    // 1. Query recent trades matching the insight conditions
    // 2. Calculate actual win rate from those trades
    // 3. Compare to historical win rate
    return insight.winRate;
  }
  
  /**
   * Revalidate an insight after cooldown period
   */
  async revalidateInsight(insightId: string): Promise<MarketInsight | undefined> {
    const insight = await learningStorage.validateInsight(insightId);
    
    if (insight) {
      console.log(`[InsightLifecycle] Revalidated insight ${insightId}`);
    }
    
    return insight;
  }
  
  /**
   * Create a new insight from discovered pattern
   */
  async createInsightFromPattern(pattern: {
    pattern: string;
    conditions: Record<string, any>;
    winRate: number;
    sampleSize: number;
    avgROI?: number;
    confidence: number;
    marketRegime?: string;
    sector?: string;
  }): Promise<MarketInsight> {
    return await learningStorage.createInsight({
      insightType: 'pattern',
      pattern: pattern.pattern,
      conditions: pattern.conditions,
      winRate: pattern.winRate,
      sampleSize: pattern.sampleSize,
      avgROI: pattern.avgROI,
      confidence: pattern.confidence,
      discoveredBy: 'grok_analysis',
      marketRegime: pattern.marketRegime,
      sector: pattern.sector,
      isActive: true
    });
  }
}

export const insightLifecycleService = new InsightLifecycleService();
