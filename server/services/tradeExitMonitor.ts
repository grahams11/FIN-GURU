import { db } from '../db';
import { recommendationTracking } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { RecommendationTracker } from './recommendationTracker';
import { formatOptionSymbol, toPolygonSubscriptionTopic } from '../utils/optionSymbols';
import { DateTime } from 'luxon';

/**
 * TradeExitMonitor - Tracks historical trade recommendations
 * 
 * Runs once daily at 4:15 PM ET (after market close) to evaluate
 * which recommendations hit profit targets, stop losses, or expired.
 * Used to calculate strategy win rate and performance metrics.
 */
export class TradeExitMonitor {
  private static isRunning = false;
  private static monitoringTimeout: NodeJS.Timeout | null = null;

  /**
   * Start monitoring - runs once daily at 4:15 PM ET
   */
  static start() {
    if (this.isRunning) {
      console.log('⚠️  TradeExitMonitor already running');
      return;
    }

    this.isRunning = true;
    this.scheduleNextRun();
  }

  /**
   * Stop the monitoring service
   */
  static stop() {
    if (this.monitoringTimeout) {
      clearTimeout(this.monitoringTimeout);
      this.monitoringTimeout = null;
    }
    this.isRunning = false;
    console.log('🛑 TradeExitMonitor stopped');
  }

  /**
   * Schedule the next daily run at 4:15 PM ET using Luxon for reliable timezone handling
   */
  private static scheduleNextRun() {
    // Get current time in America/New_York timezone
    const nowET = DateTime.now().setZone('America/New_York');
    
    // Set target time to 4:15 PM ET today
    let targetET = nowET.set({ hour: 16, minute: 15, second: 0, millisecond: 0 });
    
    // If we're past 4:15 PM ET today, schedule for tomorrow
    if (nowET >= targetET) {
      targetET = targetET.plus({ days: 1 });
    }
    
    // Calculate milliseconds until next run
    const msUntilNextRun = targetET.toMillis() - nowET.toMillis();
    
    // Validate that delay is positive
    if (msUntilNextRun <= 0) {
      console.error('❌ TradeExitMonitor: Invalid delay calculated, defaulting to tomorrow');
      targetET = nowET.plus({ days: 1 }).set({ hour: 16, minute: 15, second: 0, millisecond: 0 });
    }
    
    const hoursUntil = Math.floor(msUntilNextRun / (1000 * 60 * 60));
    const minutesUntil = Math.floor((msUntilNextRun % (1000 * 60 * 60)) / (1000 * 60));
    
    // Convert to JS Date for verification logs
    const targetUTC = targetET.toJSDate();
    
    // Log scheduling with verification
    console.log(`🚀 TradeExitMonitor: Next run scheduled for:`);
    console.log(`   📅 ET time: ${targetET.toFormat('yyyy-MM-dd HH:mm:ss ZZZZ')}`);
    console.log(`   🌍 UTC time: ${targetET.toUTC().toFormat('yyyy-MM-dd HH:mm:ss')}`);
    console.log(`   ⏱️  In: ${hoursUntil}h ${minutesUntil}m (${msUntilNextRun}ms)`);

    this.monitoringTimeout = setTimeout(() => {
      this.runDailyCheck();
    }, msUntilNextRun);
  }

  /**
   * Run the daily check and reschedule for next day
   */
  private static async runDailyCheck() {
    console.log('📊 Running daily recommendation tracking check at market close...');
    
    await this.checkExits().catch(err => {
      console.error('❌ TradeExitMonitor error:', err);
    });

    // Schedule next run for tomorrow
    this.scheduleNextRun();
  }

  /**
   * Check all open trades for exit conditions
   */
  private static async checkExits(): Promise<void> {
    try {
      // Get all recommendations with 'monitoring' or 'open' status (align with metrics counting)
      const openTrades = await db.select()
        .from(recommendationTracking)
        .where(sql`${recommendationTracking.status} IN ('open', 'monitoring')`);

      if (openTrades.length === 0) {
        return;
      }

      console.log(`📊 Checking ${openTrades.length} open trade(s) for exit conditions...`);

      // Check each trade for exit conditions
      for (const trade of openTrades) {
        await this.evaluateTradeExit(trade);
      }
    } catch (error) {
      console.error('❌ Error checking exits:', error);
    }
  }

  /**
   * Evaluate a single trade for exit conditions
   */
  private static async evaluateTradeExit(trade: any): Promise<void> {
    try {
      // Get current option premium using Polygon API or fallback sources
      const currentPremium = await this.getCurrentOptionPremium(
        trade.ticker,
        trade.optionType,
        trade.strikePrice,
        trade.expiry
      );

      if (!currentPremium) {
        // Silently skip if no premium data - common for SPX index options and expired contracts
        return;
      }

      // Get current stock price for accurate exit recording
      const currentStockPrice = await this.getCurrentStockPrice(trade.ticker);

      // Calculate current ROI
      const currentROI = ((currentPremium - trade.premium) / trade.premium) * 100;
      const params = trade.parameters as any;
      const profitTargetPct = (params.profitTarget || 0.65) * 100; // Default 65%
      const stopLossPct = (params.stopLoss || 0.3) * 100; // Default 30%

      console.log(`📈 ${trade.ticker}: Current ROI ${currentROI.toFixed(1)}% (Target: ${profitTargetPct}%, Stop: -${stopLossPct}%)`);

      // Check profit target
      if (currentROI >= profitTargetPct) {
        console.log(`🎯 PROFIT TARGET HIT for ${trade.ticker}! Closing trade...`);
        await RecommendationTracker.recordOutcome(trade.id, {
          exitDate: new Date(),
          exitPrice: currentStockPrice || trade.entryPrice, // Use current price or fallback to entry
          exitPremium: currentPremium,
          exitReason: 'profit_target'
        });
        return;
      }

      // Check stop loss
      if (currentROI <= -stopLossPct) {
        console.log(`🛑 STOP LOSS HIT for ${trade.ticker}! Closing trade...`);
        await RecommendationTracker.recordOutcome(trade.id, {
          exitDate: new Date(),
          exitPrice: currentStockPrice || trade.entryPrice,
          exitPremium: currentPremium,
          exitReason: 'stop_loss'
        });
        return;
      }

      // Check expiry (close if expiring today)
      const expiryDate = new Date(trade.expiry);
      const now = new Date();
      const daysToExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysToExpiry <= 0) {
        console.log(`⏰ EXPIRY REACHED for ${trade.ticker}! Closing trade...`);
        await RecommendationTracker.recordOutcome(trade.id, {
          exitDate: new Date(),
          exitPrice: currentStockPrice || trade.entryPrice,
          exitPremium: currentPremium,
          exitReason: 'expiry'
        });
      }
    } catch (error) {
      console.error(`❌ Error evaluating ${trade.ticker}:`, error);
    }
  }

  /**
   * Get current option premium from Polygon API with WebSocket fallback
   */
  private static async getCurrentOptionPremium(
    ticker: string,
    optionType: 'call' | 'put',
    strikePrice: number,
    expiry: string
  ): Promise<number | null> {
    try {
      const { polygonService } = await import('./polygonService');

      // Format option ticker using proper OCC symbol helper (handles .5/.25 strikes correctly)
      const canonicalSymbol = formatOptionSymbol(ticker, expiry, optionType, strikePrice);
      const optionTicker = toPolygonSubscriptionTopic(canonicalSymbol);

      // Try Polygon REST API snapshot first
      const snapshot = await polygonService.getOptionSnapshot(optionTicker);

      if (snapshot && (snapshot.midpoint || snapshot.last)) {
        return snapshot.midpoint || snapshot.last;
      }

      // Fallback: For SPX and other index options, Polygon snapshots don't work
      // Return null to skip this trade (monitoring will continue next cycle)
      return null;
    } catch (error) {
      // Silently handle errors - most failures are expected for SPX index options
      return null;
    }
  }

  /**
   * Get current stock price for exit recording with robust fallbacks
   */
  private static async getCurrentStockPrice(ticker: string): Promise<number | null> {
    try {
      const { polygonService } = await import('./polygonService');

      // Try WebSocket cache first (most reliable for real-time data)
      const quote = polygonService.getQuote(ticker);
      if (quote?.lastPrice) {
        return quote.lastPrice;
      }

      // Fallback 1: Try Polygon stock quote endpoint (includes snapshot)
      const stockQuote = await polygonService.getStockQuote(ticker);
      if (stockQuote?.price) {
        return stockQuote.price;
      }

      // Fallback 2: Use Polygon REST API snapshot endpoint directly
      const apiKey = process.env.POLYGON_API_KEY?.trim();
      if (!apiKey) {
        return null;
      }

      const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const lastPrice = data?.ticker?.day?.c || data?.ticker?.lastTrade?.p || null;
      
      return lastPrice;
    } catch (error) {
      return null;
    }
  }
}
