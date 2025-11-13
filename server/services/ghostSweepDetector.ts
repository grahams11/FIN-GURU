import { polygonService, type PolygonOptionTradeMessage } from './polygonService';
import { Phase4Scoring, type Phase4ScoreResult, type Phase4InputData } from './phase4Scoring';
import { EventEmitter } from 'events';

/**
 * Ghost Sweep Detector - Real-Time Options Flow Scanner
 * 
 * Monitors 15-20 high-volume tickers for institutional sweeps via Polygon Options WebSocket
 * Instantly analyzes sweeps using Phase 4 scoring (Max Pain, IV Skew, RSI, Ghost Detection)
 * 
 * Architecture:
 * - WebSocket: Real-time option trade stream from Polygon
 * - Sweep Detection: $2M+ premium with trade conditions 10-13 (sweep indicators)
 * - Instant Scoring: When sweep detected, run Phase 4 analysis on that ticker only
 * - Event-Driven: Emit alerts for dashboard consumption via SSE
 * 
 * Benefits vs Sequential Scanning:
 * - Speed: 20 minutes → instant alerts
 * - API Efficiency: 500 sequential calls → targeted analysis only
 * - Quality: Focus on high-volume weeklies with real institutional flow
 */

// High-volume tickers with liquid weekly options (institutional favorites)
const HIGH_VOLUME_TICKERS = [
  'NVDA', 'TSLA', 'SPY', 'QQQ', 'AMD', 'META', 'AAPL', 'AMZN', 
  'GOOGL', 'MSFT', 'SMCI', 'COIN', 'MARA', 'HOOD', 'RIVN', 
  'IWM', 'PLTR', 'SOFI', 'NKLA', 'NIO'
];

export interface SweepAlert {
  ticker: string;
  optionSymbol: string;
  side: 'CALL' | 'PUT';
  premium: number;
  strike: number;
  expiry: string;
  sweepPrice: number;
  sweepSize: number;
  timestamp: number;
  phase4Score?: Phase4ScoreResult;
  tradeConditions: number[];
}

export class GhostSweepDetector extends EventEmitter {
  private recentSweeps: SweepAlert[] = [];
  private readonly SWEEP_HISTORY_DURATION = 30 * 60 * 1000; // 30 minutes
  private readonly MIN_SWEEP_PREMIUM = 2_000_000; // $2M minimum

  // Sweep condition codes (Polygon trade conditions)
  private readonly SWEEP_CONDITIONS = [10, 11, 12, 13]; // Intermarket sweep, multi-leg sweep, etc.

  constructor() {
    super();
  }

  /**
   * Initialize Ghost Sweep Detector - register with PolygonService and subscribe to option trades
   */
  async initialize(): Promise<boolean> {
    console.log('👻 Initializing Ghost Sweep Detector...');
    
    // Register callback handler for option trades
    polygonService.registerOptionTradeHandler('ghost-sweep', this.handleOptionTrade.bind(this));
    
    // Subscribe to option trades for high-volume tickers
    const patterns = HIGH_VOLUME_TICKERS.map(ticker => `T.O:${ticker}.*`);
    
    console.log(`👻 Ghost Sweep Detector: Monitoring ${HIGH_VOLUME_TICKERS.length} tickers for institutional sweeps`);
    console.log(`📊 Watching: ${HIGH_VOLUME_TICKERS.join(', ')}`);
    
    await polygonService.subscribeToOptionTrades(patterns);
    
    return true;
  }

  /**
   * Handle option trade messages - detect sweeps (callback for PolygonService)
   */
  private async handleOptionTrade(trade: PolygonOptionTradeMessage): Promise<void> {
    // Check if stream is healthy before processing
    const health = polygonService.getHealthStatus();
    if (!health.isConnected || health.isStale) {
      console.warn('⚠️ Ghost Sweep Detector: Polygon stream is unhealthy, skipping trade');
      return;
    }
    
    try {
      const size = trade.s || 0;
      const price = trade.p || 0;
      const premium = size * price * 100; // Contract size is 100
      const conditions = trade.c || [];

      // Check if this is a sweep: $2M+ premium with sweep conditions
      const isSweep = conditions.some(c => this.SWEEP_CONDITIONS.includes(c));
      
      if (premium >= this.MIN_SWEEP_PREMIUM && isSweep) {
        const sweep = this.parseOptionSymbol(trade.sym, premium, price, size, conditions, trade.t);
        
        if (sweep) {
          console.log(`👻 GHOST SWEEP DETECTED: ${sweep.ticker} ${sweep.side} $${sweep.strike} | Premium: $${sweep.premium.toLocaleString()}`);
          
          // Store sweep
          this.recentSweeps.push(sweep);
          this.cleanOldSweeps();
          
          // Trigger instant Phase 4 analysis
          this.analyzeSweep(sweep);
        }
      }
    } catch (error: any) {
      console.error('❌ Error handling trade:', error.message);
    }
  }

  /**
   * Parse Polygon option symbol into components
   * Format: O:TICKER250117C00200000 → NVDA 01/17/25 $200 CALL
   */
  private parseOptionSymbol(
    symbol: string,
    premium: number,
    price: number,
    size: number,
    conditions: number[],
    timestamp: number
  ): SweepAlert | null {
    try {
      // Remove "O:" prefix
      const cleanSymbol = symbol.replace('O:', '');
      
      // Extract ticker (everything before the date)
      const match = cleanSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
      
      if (!match) {
        return null;
      }

      const [, ticker, dateStr, typeChar, strikeStr] = match;
      
      // Parse expiry date (YYMMDD format)
      const year = 2000 + parseInt(dateStr.slice(0, 2));
      const month = dateStr.slice(2, 4);
      const day = dateStr.slice(4, 6);
      const expiry = `${year}-${month}-${day}`;
      
      // Parse strike price (divide by 1000)
      const strike = parseInt(strikeStr) / 1000;
      
      // Parse option type
      const side = typeChar === 'C' ? 'CALL' : 'PUT';

      return {
        ticker,
        optionSymbol: symbol,
        side,
        premium,
        strike,
        expiry,
        sweepPrice: price,
        sweepSize: size,
        timestamp,
        tradeConditions: conditions
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Analyze sweep using Phase 4 scoring
   * Run Max Pain, IV Skew, RSI, and Ghost detection instantly
   */
  private async analyzeSweep(sweep: SweepAlert): Promise<void> {
    try {
      console.log(`🔍 Analyzing ${sweep.ticker} sweep with Phase 4 scoring...`);

      // Get stock price
      const quoteData = await polygonService.getCachedQuote(sweep.ticker);
      if (!quoteData || !quoteData.lastPrice) {
        console.warn(`⚠️ Could not fetch stock price for ${sweep.ticker}`);
        return;
      }
      const stockPrice = quoteData.lastPrice;

      // Get option chain for Phase 4 scoring
      const optionChain = await polygonService.getOptionsSnapshot(sweep.ticker);
      if (!optionChain || !optionChain.results) {
        console.warn(`⚠️ Could not fetch option chain for ${sweep.ticker}`);
        return;
      }

      // Calculate Phase 4 metrics
      const maxPain = Phase4Scoring.calculateMaxPain(optionChain.results);
      const ivSkew = Phase4Scoring.calculateIVSkew(optionChain.results);
      
      // Get historical bars for RSI (last 20 days)
      const currentTime = new Date();
      const from = new Date(currentTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      const fromStr = from.toISOString().split('T')[0];
      const toStr = currentTime.toISOString().split('T')[0];
      
      const historicalBars = await polygonService.getHistoricalBars(
        sweep.ticker,
        fromStr,
        toStr,
        'day',
        1,
        true // unlimited mode
      );

      let rsi: number | null = null;
      if (historicalBars && historicalBars.length >= 14) {
        rsi = Phase4Scoring.calculateRSI(historicalBars);
      }

      // Calculate DTE (days to expiry)
      const expiryDate = new Date(sweep.expiry);
      const dte = Math.ceil((expiryDate.getTime() - currentTime.getTime()) / (1000 * 60 * 60 * 24));

      // Build Phase 4 input
      const phase4Input: Phase4InputData = {
        symbol: sweep.ticker,
        currentPrice: stockPrice,
        volume: sweep.sweepSize,
        openInterest: 1000, // Placeholder - we don't have OI from sweep data
        dte: dte,
        optionContracts: optionChain.results,
        historicalBars: historicalBars || undefined,
        precomputedMaxPain: maxPain,
        precomputedIvSkew: ivSkew,
        precomputedRsi: rsi
      };

      // Calculate Phase 4 score
      const phase4Score = Phase4Scoring.calculateScore(phase4Input);
      
      // Update sweep with score
      sweep.phase4Score = phase4Score;

      console.log(`✅ ${sweep.ticker} Phase 4 Score: ${phase4Score.totalScore}/100`);
      
      // If score is high enough (94+), emit alert for dashboard
      if (phase4Score.totalScore >= 94) {
        console.log(`🚨 HIGH-QUALITY GHOST ALERT: ${sweep.ticker} ${sweep.side} - Score ${phase4Score.totalScore}/100`);
        this.emit('ghostAlert', sweep);
      }

    } catch (error: any) {
      console.error(`❌ Error analyzing sweep for ${sweep.ticker}:`, error.message);
    }
  }

  /**
   * Get recent sweeps for a specific ticker
   */
  private getRecentSweepsForTicker(ticker: string): SweepAlert[] {
    return this.recentSweeps.filter(s => s.ticker === ticker);
  }

  /**
   * Clean old sweeps (older than 30 minutes)
   */
  private cleanOldSweeps(): void {
    const now = Date.now();
    this.recentSweeps = this.recentSweeps.filter(
      s => now - s.timestamp < this.SWEEP_HISTORY_DURATION
    );
  }

  /**
   * Get all recent sweeps with scores
   */
  getRecentAlertsWithScores(): SweepAlert[] {
    return this.recentSweeps
      .filter(s => s.phase4Score && s.phase4Score.totalScore >= 94)
      .sort((a, b) => (b.phase4Score?.totalScore || 0) - (a.phase4Score?.totalScore || 0));
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    // Unregister callback handler from PolygonService
    polygonService.unregisterOptionTradeHandler('ghost-sweep');
    this.recentSweeps = [];
  }
}

// Export singleton instance
export const ghostSweepDetector = new GhostSweepDetector();
