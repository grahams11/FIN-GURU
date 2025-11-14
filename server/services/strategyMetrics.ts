import { db } from "../db";
import { recommendationTracking, recommendationPerformance } from "@shared/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";

export interface StrategyMetrics {
  winRate: number;
  avgROI: number;
  profitFactor: number;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  totalProfit: number;
  totalLoss: number;
}

export class StrategyMetricsService {
  /**
   * Calculate comprehensive strategy performance metrics using SQL aggregation
   * Optionally filter by strategy version (defaults to all versions if not specified)
   */
  async calculateMetrics(strategyVersion?: string): Promise<StrategyMetrics> {
    try {
      // Build WHERE clause for strategy version filtering
      const versionFilter = strategyVersion 
        ? sql`${recommendationTracking.strategyVersion} = ${strategyVersion}`
        : sql`1=1`; // No filtering if version not specified

      // Use SQL aggregation with JOIN for efficiency - get all metrics in one query
      const result = await db
        .select({
          closedCount: sql<number>`count(*) filter (where ${recommendationPerformance.closedAt} is not null and ${recommendationPerformance.actualROI} is not null)`,
          wins: sql<number>`count(*) filter (where ${recommendationPerformance.isWin} = true and ${recommendationPerformance.closedAt} is not null)`,
          losses: sql<number>`count(*) filter (where ${recommendationPerformance.isLoss} = true and ${recommendationPerformance.closedAt} is not null)`,
          totalProfit: sql<number>`coalesce(sum(${recommendationPerformance.actualProfit}) filter (where ${recommendationPerformance.actualProfit} > 0 and ${recommendationPerformance.closedAt} is not null), 0)`,
          totalLoss: sql<number>`coalesce(abs(coalesce(sum(${recommendationPerformance.actualProfit}) filter (where ${recommendationPerformance.actualProfit} < 0 and ${recommendationPerformance.closedAt} is not null), 0)), 0)`,
          avgROI: sql<number>`coalesce(avg(${recommendationPerformance.actualROI}) filter (where ${recommendationPerformance.actualROI} is not null and ${recommendationPerformance.closedAt} is not null), 0)`,
        })
        .from(recommendationPerformance)
        .innerJoin(recommendationTracking, eq(recommendationPerformance.recommendationId, recommendationTracking.id))
        .where(versionFilter);

      // Get count of open/monitoring trades filtered by strategy version
      const openResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(recommendationTracking)
        .where(
          and(
            sql`${recommendationTracking.status} IN ('open', 'monitoring')`,
            versionFilter
          )
        );
      
      const openTrades = Number(openResult[0]?.count || 0);
      const closedTradesCount = Number(result[0]?.closedCount || 0);
      const wins = Number(result[0]?.wins || 0);
      const losses = Number(result[0]?.losses || 0);
      const totalProfit = Number(result[0]?.totalProfit || 0);
      const totalLoss = Number(result[0]?.totalLoss || 0);
      const avgROI = Number(result[0]?.avgROI || 0);
      
      // Calculate metrics
      const winRate = closedTradesCount > 0 ? (wins / closedTradesCount) * 100 : 0;
      
      // Handle profit factor: use 999.99 as sentinel for Infinity (UI-friendly)
      let profitFactor = 0;
      if (totalLoss > 0) {
        profitFactor = totalProfit / totalLoss;
      } else if (totalProfit > 0) {
        profitFactor = 999.99; // Sentinel value for "infinite" profit factor
      }
      
      return {
        winRate: Math.round(winRate * 10) / 10,
        avgROI: Math.round(avgROI * 10) / 10,
        profitFactor: Math.min(999.99, Math.round(profitFactor * 100) / 100), // Cap at 999.99
        totalTrades: closedTradesCount,
        openTrades,
        closedTrades: closedTradesCount,
        wins,
        losses,
        totalProfit: Math.round(totalProfit * 100) / 100,
        totalLoss: Math.round(totalLoss * 100) / 100,
      };
    } catch (error) {
      console.error('Error calculating strategy metrics:', error);
      return {
        winRate: 0,
        avgROI: 0,
        profitFactor: 0,
        totalTrades: 0,
        openTrades: 0,
        closedTrades: 0,
        wins: 0,
        losses: 0,
        totalProfit: 0,
        totalLoss: 0,
      };
    }
  }

  /**
   * Update performance for a specific recommendation
   */
  async updatePerformance(
    recommendationId: string,
    exitPrice: number,
    exitPremium: number,
    exitReason: string
  ): Promise<void> {
    try {
      // Get the original recommendation
      const recommendation = await db
        .select()
        .from(recommendationTracking)
        .where(eq(recommendationTracking.id, recommendationId))
        .limit(1);

      if (!recommendation || recommendation.length === 0) {
        console.error(`Recommendation ${recommendationId} not found`);
        return;
      }

      const rec = recommendation[0];
      
      // Calculate actual ROI and profit
      const actualROI = ((exitPremium - rec.premium) / rec.premium) * 100;
      const actualProfit = (exitPremium - rec.premium) * rec.contracts * 100; // Options are 100 shares each
      
      // Determine win/loss
      const isWin = actualROI > 0;
      const isLoss = actualROI < 0;
      
      // Calculate hold days
      const entryDate = new Date(rec.recommendedAt);
      const exitDate = new Date();
      const holdDays = Math.floor((exitDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // Check if performance record exists
      const existingPerf = await db
        .select()
        .from(recommendationPerformance)
        .where(eq(recommendationPerformance.recommendationId, recommendationId))
        .limit(1);
      
      if (existingPerf.length > 0) {
        // Update existing performance record
        await db
          .update(recommendationPerformance)
          .set({
            exitDate: new Date(),
            exitPrice,
            exitPremium,
            actualROI,
            actualProfit,
            exitReason,
            holdDays,
            isWin,
            isLoss,
            closedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(recommendationPerformance.id, existingPerf[0].id));
      } else {
        // Insert new performance record
        await db.insert(recommendationPerformance).values({
          recommendationId,
          exitDate: new Date(),
          exitPrice,
          exitPremium,
          actualROI,
          actualProfit,
          exitReason,
          holdDays,
          isWin,
          isLoss,
          closedAt: new Date(),
        });
      }
      
      // Update recommendation status
      await db
        .update(recommendationTracking)
        .set({ status: 'closed' })
        .where(eq(recommendationTracking.id, recommendationId));
      
      console.log(`✅ Updated performance for ${rec.ticker}: ${actualROI > 0 ? '+' : ''}${actualROI.toFixed(1)}% ROI`);
    } catch (error) {
      console.error('Error updating performance:', error);
    }
  }
}

export const strategyMetricsService = new StrategyMetricsService();
