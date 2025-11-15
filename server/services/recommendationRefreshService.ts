/**
 * Recommendation Refresh Service
 * 
 * Auto-refreshes trade recommendations during market hours:
 * - Runs every 15 minutes during market hours (9:30am - 4:00pm ET)
 * - Pauses during after-hours
 * - Validates and clears stale recommendations
 */

import { storage } from '../storage';
import { RecommendationValidator } from './recommendationValidator';
import { eliteScanner, type EliteScanResult } from './eliteScanner';
import { polygonService } from './polygonService';
import type { TradeRecommendation } from '@shared/schema';

export class RecommendationRefreshService {
  private static refreshInterval: NodeJS.Timeout | null = null;
  private static readonly REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  private static isRefreshing = false;
  
  /**
   * Format option symbol for Polygon WebSocket (O:SPY251113C00680000)
   */
  private static formatOptionSymbol(underlying: string, strike: number, expiry: string, optionType: 'call' | 'put'): string {
    const expiryParts = expiry.split('-');
    const yy = expiryParts[0].slice(2);
    const mm = expiryParts[1];
    const dd = expiryParts[2];
    const expiryFormatted = `${yy}${mm}${dd}`;
    
    const strikeFormatted = Math.round(strike * 1000).toString().padStart(8, '0');
    const optType = optionType === 'call' ? 'C' : 'P';
    
    return `O:${underlying}${expiryFormatted}${optType}${strikeFormatted}`;
  }
  
  /**
   * Convert EliteScanResult to TradeRecommendation format
   * Uses same pricing logic as AIAnalysisService for consistency
   * Returns null if trade has invalid pricing (guards against NaN/0 values)
   */
  private static convertScanResultToRecommendation(result: EliteScanResult): TradeRecommendation | null {
    // Estimate premium based on delta (typical options pricing relationship)
    // For ATM options: premium ≈ stock_price × delta × time_factor
    const timeFactor = 0.15; // ~15% for 3-7 day options
    const premium = result.stockPrice * Math.abs(result.delta) * timeFactor;
    
    // Guard: Skip if premium is invalid (same as AIAnalysisService)
    if (!premium || premium <= 0 || !isFinite(premium)) {
      console.warn(`${result.symbol}: Invalid premium $${premium?.toFixed(2)}, skipping trade`);
      return null;
    }
    
    // Calculate contracts using $1000 budget (same as AIAnalysisService)
    const maxTradeAmount = 1000;
    const costPerContract = premium * 100; // Options are sold in contracts of 100 shares
    const optimalContracts = Math.floor(maxTradeAmount / costPerContract);
    const contracts = Math.max(1, Math.min(50, optimalContracts)); // Cap at 50 contracts
    
    // Calculate total cost
    const totalCost = contracts * premium * 100;
    
    // Guard: Skip if total cost is invalid (same as AIAnalysisService)
    if (!totalCost || totalCost <= 0 || !isFinite(totalCost)) {
      console.warn(`${result.symbol}: Invalid total cost $${totalCost?.toFixed(2)}, skipping trade`);
      return null;
    }
    
    // Calculate target stock price for exit
    const targetMove = result.optionType === 'call' ? 1.05 : 0.95; // 5% move
    const stockExitPrice = result.stockPrice * targetMove;
    
    // Calculate exit premium based on stock movement and delta
    // Delta represents the change in option price per $1 move in underlying stock
    const stockMovement = Math.abs(stockExitPrice - result.stockPrice);
    const exitPrice = premium + (stockMovement * Math.abs(result.delta));
    
    // Calculate projected ROI (guarded by totalCost validation above)
    const contractMultiplier = 100;
    const totalExitValue = contracts * exitPrice * contractMultiplier;
    const profit = totalExitValue - totalCost;
    const projectedROI = (profit / totalCost) * 100;
    const projectedROIAmount = totalExitValue;
    
    // Format option symbol for Polygon WebSocket live premium tracking
    const optionSymbol = this.formatOptionSymbol(result.symbol, result.strike, result.expiry, result.optionType);
    
    return {
      ticker: result.symbol,
      optionSymbol, // For live premium WebSocket streaming
      optionType: result.optionType,
      currentPrice: result.stockPrice,
      strikePrice: result.strike,
      expiry: result.expiry,
      stockEntryPrice: result.stockPrice,
      stockExitPrice,
      premium,
      entryPrice: premium,
      exitPrice,
      totalCost,
      contracts,
      projectedROI,
      projectedROIAmount,
      aiConfidence: result.signalQuality,
      greeks: {
        delta: result.delta,
        gamma: result.gamma,
        theta: result.theta,
        vega: result.vega,
        rho: 0 // Not provided by Elite Scanner
      },
      sentiment: result.rsi > 50 ? 0.7 : 0.3, // Bullish/bearish based on RSI
      score: result.signalQuality,
      holdDays: 3, // Standard swing trade duration
      isWatchlist: result.isWatchlist
    };
  }
  
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
    
    // 24/7 REFRESH — EOD + OVERNIGHT DATA
    console.log('🔄 Refreshing recommendations — 24/7 mode active');
    
    try {
      this.isRefreshing = true;
      console.log('\n🔄 ========== AUTO-REFRESH RECOMMENDATIONS ==========');
      
      // Get existing trades
      const existingTrades = await storage.getTopTrades();
      console.log(`📊 Current recommendations: ${existingTrades.length}`);
      
      // Validate existing trades
      const validationResults = await RecommendationValidator.validateRecommendations(existingTrades);
      const invalidTrades = existingTrades.filter(trade => {
        const result = validationResults.get(trade.id);
        return result && !result.isValid;
      });
      
      // Delete ONLY invalid trades (surgical deletion instead of clearing all)
      if (invalidTrades.length > 0) {
        console.log(`🧹 Found ${invalidTrades.length} invalid recommendations - removing them...`);
        for (const trade of invalidTrades) {
          await storage.deleteOptionsTrade(trade.id);
          const result = validationResults.get(trade.id);
          console.log(`  ❌ Removed ${trade.ticker} (${result?.reason || 'invalid'})`);
        }
      }
      
      // Check if we need new recommendations (less than target count)
      const remainingTrades = await storage.getTopTrades();
      const needsRefresh = remainingTrades.length === 0;
      
      if (needsRefresh) {
        console.log(`🔄 Generating new recommendations (${remainingTrades.length} remaining)...`);
        
        // Generate new recommendations using Elite Scanner
        const scanResponse = await eliteScanner.scan();
        const scanResults = scanResponse.results; // Destructure results array from response object
        console.log(`🔍 Elite Scanner found ${scanResults.length} opportunities (${scanResponse.isOvernight ? 'overnight' : 'live'} mode)`);
        
        // Convert scan results to TradeRecommendation format (filter out invalid trades)
        const newRecommendations = scanResults
          .map(result => this.convertScanResultToRecommendation(result))
          .filter((rec): rec is TradeRecommendation => rec !== null);
        console.log(`✅ Converted ${newRecommendations.length} valid recommendations (${newRecommendations.filter(r => r.isWatchlist).length} watchlist) from ${scanResults.length} scan results`);
        
        // Store new recommendations
        let storedCount = 0;
        const optionSymbols: string[] = [];
        
        for (const rec of newRecommendations) {
          try {
            const validFibLevel = rec.fibonacciLevel !== null && rec.fibonacciLevel !== undefined 
              ? rec.fibonacciLevel 
              : null;
            const validEstimatedProfit = rec.estimatedProfit !== null && rec.estimatedProfit !== undefined && !isNaN(rec.estimatedProfit) 
              ? rec.estimatedProfit 
              : null;

            await storage.createOptionsTrade({
              ticker: rec.ticker,
              optionSymbol: rec.optionSymbol || null, // Store option symbol for live premium tracking
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
              isExecuted: false,
              isWatchlist: rec.isWatchlist ?? false
            });
            
            // Collect option symbols for WebSocket subscription
            if (rec.optionSymbol) {
              optionSymbols.push(rec.optionSymbol);
            }
            
            storedCount++;
          } catch (error) {
            console.error(`❌ Failed to store ${rec.ticker}:`, error);
          }
        }
        
        console.log(`💾 Stored ${storedCount}/${newRecommendations.length} new recommendations`);
        
        // Subscribe to option quotes for live premium tracking (market hours only)
        if (optionSymbols.length > 0) {
          try {
            await polygonService.subscribeToOptionQuotes(optionSymbols);
            console.log(`📡 Subscribed to ${optionSymbols.length} option quotes for live premium streaming`);
          } catch (error) {
            console.error('❌ Failed to subscribe to option quotes:', error);
          }
        }
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
