import { UoaScannerService } from './uoaScanner';
import { UoaCache } from './uoaCache';

/**
 * UOA Background Worker
 * Continuously scans market for UOA opportunities every 20-30s
 * Updates cache for instant dashboard access
 */

export class UoaWorker {
  private static interval: NodeJS.Timeout | null = null;
  private static readonly SCAN_INTERVAL = 120000; // 2 minutes (respects 5 API calls/min limit)
  
  /**
   * Start background worker
   */
  static start(): void {
    console.log('🔄 Starting UOA background worker...');
    
    // Run first scan immediately
    this.runScan();
    
    // Then run every 30 seconds
    this.interval = setInterval(() => {
      this.runScan();
    }, this.SCAN_INTERVAL);
    
    console.log(`✅ UOA worker started - scanning every ${this.SCAN_INTERVAL / 1000}s`);
  }
  
  /**
   * Stop background worker
   */
  static stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('🛑 UOA worker stopped');
    }
  }
  
  /**
   * Run a single scan and update cache + storage
   */
  private static async runScan(): Promise<void> {
    // Skip if already scanning
    if (UoaCache.getScanStatus()) {
      console.log('⏭️ Skipping scan - previous scan still running');
      return;
    }
    
    try {
      UoaCache.setScanStatus(true);
      console.log('\n🔍 UOA Worker: Starting scheduled scan...');
      
      const startTime = Date.now();
      const topTrades = await UoaScannerService.scan();
      const duration = Date.now() - startTime;
      
      // Update cache for instant API responses
      UoaCache.set(topTrades);
      
      // Persist to database so /api/top-trades can serve them
      await this.persistToStorage(topTrades);
      
      console.log(`✅ UOA scan complete in ${(duration / 1000).toFixed(1)}s - cache + DB updated`);
    } catch (error) {
      console.error('❌ UOA scan error:', error);
    } finally {
      UoaCache.setScanStatus(false);
    }
  }
  
  /**
   * Persist UOA trades to database
   * Clears old trades and writes new ones
   */
  private static async persistToStorage(trades: any[]): Promise<void> {
    try {
      // Dynamically import storage to avoid circular dependencies
      const { storage } = await import('../index');
      
      // Clear all existing trades
      await storage.clearTrades();
      
      // Convert UOA trades to OptionsTrade format and store
      for (const trade of trades) {
        await storage.createOptionsTrade({
          ticker: trade.ticker,
          optionSymbol: trade.optionSymbol,
          optionType: trade.optionType,
          strike: trade.strike,
          expiry: trade.expiry,
          stockEntryPrice: trade.stockPrice,
          stockExitPrice: null,
          currentPrice: trade.stockPrice,
          premium: trade.premium,
          entryPrice: trade.bid,
          exitPrice: trade.ask,
          holdDays: trade.daysToExpiry,
          totalCost: trade.premium * 100, // 1 contract
          contracts: 1,
          strikePrice: trade.strike,
          projectedROI: trade.roiScore,
          aiConfidence: trade.likelihoodScore / 100,
          greeks: {
            delta: trade.delta,
            theta: trade.theta,
            gamma: trade.gamma,
            vega: trade.vega,
          },
          sentiment: 0.5, // Neutral
          score: trade.compositeScore,
          fibonacciLevel: null,
          fibonacciColor: null,
          estimatedProfit: null,
          isExecuted: false,
        });
      }
      
      console.log(`💾 Persisted ${trades.length} UOA trades to database`);
    } catch (error) {
      console.error('❌ Error persisting trades to storage:', error);
    }
  }
  
  /**
   * Trigger manual scan
   */
  static async triggerManualScan(): Promise<void> {
    console.log('🔘 Manual scan triggered');
    await this.runScan();
  }
}
