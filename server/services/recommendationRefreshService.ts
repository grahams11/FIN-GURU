/**
 * Recommendation Refresh Service
 * 
 * Auto-refreshes trade recommendations during market hours:
 * - Runs every 15 minutes during market hours (9:30am - 4:00pm ET)
 * - Pauses during after-hours
 * - Validates and clears stale recommendations
 */

import { AIAnalysisService } from './aiAnalysis';
import { storage } from '../storage';
import { RecommendationValidator } from './recommendationValidator';

export class RecommendationRefreshService {
  private static refreshInterval: NodeJS.Timeout | null = null;
  private static readonly REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  private static isRefreshing = false;
  
  /**
   * Start the auto-refresh background job
   */
  static start(): void {
    if (this.refreshInterval) {
      console.log('⚠️ Recommendation refresh service already running');
      return;
    }
    
    console.log('🔄 Starting recommendation auto-refresh service (15min interval)');
    
    // Run initial refresh if market is open
    this.checkAndRefresh();
    
    // Set up recurring refresh
    this.refreshInterval = setInterval(() => {
      this.checkAndRefresh();
    }, this.REFRESH_INTERVAL_MS);
  }
  
  /**
   * Stop the auto-refresh background job
   */
  static stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log('🛑 Recommendation auto-refresh service stopped');
    }
  }
  
  /**
   * Check if market is open and refresh if needed
   */
  private static async checkAndRefresh(): Promise<void> {
    // Skip if already refreshing
    if (this.isRefreshing) {
      console.log('⏭️ Skipping refresh - already in progress');
      return;
    }
    
    // Check if market is open
    if (!RecommendationValidator.isMarketHours()) {
      console.log('⏸️ Market closed - skipping recommendation refresh');
      return;
    }
    
    try {
      this.isRefreshing = true;
      console.log('\n🔄 ========== AUTO-REFRESH RECOMMENDATIONS ==========');
      
      // Get existing trades
      const existingTrades = await storage.getTopTrades();
      console.log(`📊 Current recommendations: ${existingTrades.length}`);
      
      // Validate existing trades
      const validationResults = await RecommendationValidator.validateRecommendations(existingTrades);
      const invalidCount = Array.from(validationResults.values()).filter(r => !r.isValid).length;
      
      if (invalidCount > 0) {
        console.log(`🧹 Found ${invalidCount} stale/invalid recommendations - clearing and regenerating...`);
        
        // Clear all trades and regenerate fresh ones
        await storage.clearTrades();
        
        // Generate new recommendations
        const newRecommendations = await AIAnalysisService.generateTradeRecommendations();
        console.log(`✅ Generated ${newRecommendations.length} fresh recommendations`);
        
        // Store new recommendations
        let storedCount = 0;
        for (const rec of newRecommendations) {
          try {
            const validFibLevel = rec.fibonacciLevel !== null && rec.fibonacciLevel !== undefined 
              ? rec.fibonacciLevel 
              : null;
            const validEstimatedProfit = rec.estimatedProfit !== null && rec.estimatedProfit !== undefined && !isNaN(rec.estimatedProfit) 
              ? rec.estimatedProfit 
              : null;

            await storage.addTrade({
              ticker: rec.ticker,
              optionType: rec.optionType,
              currentPrice: rec.currentPrice,
              strikePrice: rec.strikePrice,
              expiry: rec.expiry,
              stockEntryPrice: rec.stockEntryPrice || 0,
              stockExitPrice: rec.stockExitPrice || null,
              premium: rec.premium || 0,
              entryPrice: rec.entryPrice,
              exitPrice: rec.exitPrice,
              holdDays: rec.holdDays,
              totalCost: rec.totalCost,
              contracts: rec.contracts,
              projectedROI: rec.projectedROI,
              aiConfidence: rec.aiConfidence,
              greeks: rec.greeks,
              sentiment: rec.sentiment,
              score: rec.score,
              fibonacciLevel: validFibLevel,
              fibonacciColor: rec.fibonacciColor ?? null,
              estimatedProfit: validEstimatedProfit,
              isExecuted: false
            });
            storedCount++;
          } catch (error) {
            console.error(`❌ Failed to store ${rec.ticker}:`, error);
          }
        }
        
        console.log(`💾 Stored ${storedCount}/${newRecommendations.length} new recommendations`);
      } else {
        console.log('✅ All recommendations still valid - no refresh needed');
      }
      
      console.log('========================================\n');
    } catch (error) {
      console.error('❌ Auto-refresh failed:', error);
    } finally {
      this.isRefreshing = false;
    }
  }
  
  /**
   * Force an immediate refresh (for manual triggers)
   */
  static async forceRefresh(): Promise<void> {
    console.log('🔄 Force refresh requested...');
    await this.checkAndRefresh();
  }
}
