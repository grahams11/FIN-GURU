import { historicalDataService } from './historicalDataService';
import { BlackScholesCalculator } from './financialCalculations';
import { db } from '../db';
import { backtestRuns, backtestTrades, type InsertBacktestRun, type InsertBacktestTrade } from '@shared/schema';
import { eq } from 'drizzle-orm';

interface BacktestConfig {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  symbols?: string[]; // If null, uses all market
  budget: number; // Max per trade
  stopLoss: number; // e.g., 0.45 for 45%
  profitTarget: number; // e.g., 1.0 for 100%
  rsiOversold: number; // e.g., 30
  rsiOverbought: number; // e.g., 70
  minVIX: number; // e.g., 15
  maxHoldDays: number; // e.g., 10
}

interface TradeSignal {
  date: string;
  ticker: string;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  entryPremium: number;
  contracts: number;
  rsi: number;
  vix: number;
  stockPrice: number;
  iv: number; // Implied volatility
}

interface TradeResult {
  signal: TradeSignal;
  exitDate: string;
  exitPremium: number;
  exitReason: 'target' | 'stop' | 'expiry';
  pnl: number;
  roi: number;
  maxDrawdown: number;
}

export class BacktestEngine {
  private config: BacktestConfig;
  private runId: string | null = null;

  constructor(config: BacktestConfig) {
    this.config = config;
  }

  /**
   * Run the backtest and return results
   */
  async run(): Promise<{
    runId: string;
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgROI: number;
    profitFactor: number;
  }> {
    console.log('🎯 Starting backtest...');
    console.log(`📅 Period: ${this.config.startDate} to ${this.config.endDate}`);
    console.log(`💰 Budget: $${this.config.budget} per trade`);

    // Create backtest run record
    const [run] = await db.insert(backtestRuns).values({
      startDate: new Date(this.config.startDate),
      endDate: new Date(this.config.endDate),
      symbolUniverse: this.config.symbols || null,
      timeframe: '1d',
      warmupLookback: 14,
      config: this.config as any,
      status: 'running'
    }).returning();

    this.runId = run.id;

    try {
      // Generate trade signals
      const signals = await this.generateSignals();
      console.log(`📊 Generated ${signals.length} trade signals`);

      // Simulate each trade
      const results: TradeResult[] = [];
      for (const signal of signals) {
        const result = await this.simulateTrade(signal);
        if (result) {
          results.push(result);
          await this.saveTradeResult(result);
        }
      }

      // Calculate metrics
      const metrics = this.calculateMetrics(results);

      // Update run with results
      await db.update(backtestRuns)
        .set({
          totalTrades: results.length,
          wins: metrics.wins,
          losses: metrics.losses,
          winRate: metrics.winRate,
          avgROI: metrics.avgROI,
          profitFactor: metrics.profitFactor,
          maxDrawdown: metrics.maxDrawdown,
          status: 'completed',
          completedAt: new Date()
        })
        .where(eq(backtestRuns.id, this.runId));

      console.log('✅ Backtest completed!');
      console.log(`📈 Win Rate: ${metrics.winRate.toFixed(2)}%`);
      console.log(`📈 Avg ROI: ${metrics.avgROI.toFixed(2)}%`);

      return {
        runId: this.runId,
        ...metrics
      };
    } catch (error) {
      // Mark run as failed
      await db.update(backtestRuns)
        .set({
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date()
        })
        .where(eq(backtestRuns.id, this.runId));

      throw error;
    }
  }

  /**
   * Generate trade signals from historical data
   */
  private async generateSignals(): Promise<TradeSignal[]> {
    const signals: TradeSignal[] = [];
    const symbols = this.config.symbols || ['AAPL', 'TSLA', 'NVDA', 'SPY', 'QQQ']; // MVP: small set

    // Fetch VIX data for sentiment
    const vixBars = await historicalDataService.getVIXHistory(this.config.startDate, this.config.endDate);
    const vixMap = new Map(vixBars.map(bar => [new Date(bar.timestamp).toISOString().split('T')[0], bar.close]));

    for (const symbol of symbols) {
      console.log(`📊 Analyzing ${symbol}...`);
      
      // Fetch historical bars
      const bars = await historicalDataService.getDailyBars(symbol, this.config.startDate, this.config.endDate);
      if (bars.length < 15) continue; // Need enough data for RSI

      // Calculate RSI
      const rsiValues = historicalDataService.calculateRSI(bars, 14);

      // Scan for signals
      for (let i = 14; i < bars.length - 1; i++) {
        const bar = bars[i];
        const rsi = rsiValues[i - 14];
        const date = new Date(bar.timestamp).toISOString().split('T')[0];
        const vix = vixMap.get(date) || 20; // Default VIX if missing

        // Skip if VIX too low (no volatility opportunities)
        if (vix < this.config.minVIX) continue;

        // CALL signal: RSI oversold
        if (rsi < this.config.rsiOversold) {
          const strike = Math.round(bar.close * 1.02); // Slightly OTM
          const expiry = this.getExpiry(date, 7); // 1 week out
          const iv = 0.35; // Estimate IV (could improve with historical IV data)
          
          const premium = BlackScholesCalculator.calculateOptionPrice(bar.close, strike, 7/365, 0.05, iv, 'call');
          const contracts = Math.floor(this.config.budget / (premium * 100));

          if (contracts > 0 && premium > 0.05) {
            signals.push({
              date,
              ticker: symbol,
              optionType: 'call',
              strike,
              expiry,
              entryPremium: premium,
              contracts,
              rsi,
              vix,
              stockPrice: bar.close,
              iv
            });
          }
        }

        // PUT signal: RSI overbought
        if (rsi > this.config.rsiOverbought) {
          const strike = Math.round(bar.close * 0.98); // Slightly OTM
          const expiry = this.getExpiry(date, 7); // 1 week out
          const iv = 0.35;
          
          const premium = BlackScholesCalculator.calculateOptionPrice(bar.close, strike, 7/365, 0.05, iv, 'put');
          const contracts = Math.floor(this.config.budget / (premium * 100));

          if (contracts > 0 && premium > 0.05) {
            signals.push({
              date,
              ticker: symbol,
              optionType: 'put',
              strike,
              expiry,
              entryPremium: premium,
              contracts,
              rsi,
              vix,
              stockPrice: bar.close,
              iv
            });
          }
        }
      }
    }

    return signals;
  }

  /**
   * Simulate a single trade's lifecycle
   */
  private async simulateTrade(signal: TradeSignal): Promise<TradeResult | null> {
    // Fetch bars from entry to expiry
    const entryDate = new Date(signal.date);
    const expiryDate = new Date(signal.expiry);
    const endDate = new Date(Math.min(expiryDate.getTime(), new Date(this.config.endDate).getTime()));

    const bars = await historicalDataService.getDailyBars(
      signal.ticker,
      entryDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );

    if (bars.length === 0) return null;

    let exitDate = '';
    let exitPremium = 0;
    let exitReason: 'target' | 'stop' | 'expiry' = 'expiry';
    let maxDrawdown = 0;

    // Simulate each day
    for (let i = 1; i < bars.length; i++) {
      const bar = bars[i];
      const currentDate = new Date(bar.timestamp).toISOString().split('T')[0];
      const daysToExpiry = (expiryDate.getTime() - bar.timestamp) / (1000 * 60 * 60 * 24);

      // Calculate current option price
      const timeValue = Math.max(daysToExpiry / 365, 0);
      const currentPremium = BlackScholesCalculator.calculateOptionPrice(
        bar.close, 
        signal.strike, 
        timeValue, 
        0.05, 
        signal.iv, 
        signal.optionType
      );

      // Track drawdown
      const currentROI = (currentPremium - signal.entryPremium) / signal.entryPremium;
      if (currentROI < maxDrawdown) {
        maxDrawdown = currentROI;
      }

      // Check stop loss
      if (currentROI <= -this.config.stopLoss) {
        exitDate = currentDate;
        exitPremium = currentPremium;
        exitReason = 'stop';
        break;
      }

      // Check profit target
      if (currentROI >= this.config.profitTarget) {
        exitDate = currentDate;
        exitPremium = currentPremium;
        exitReason = 'target';
        break;
      }

      // Check expiry
      if (daysToExpiry <= 0) {
        exitDate = currentDate;
        exitPremium = Math.max(0, signal.optionType === 'call' 
          ? bar.close - signal.strike 
          : signal.strike - bar.close);
        exitReason = 'expiry';
        break;
      }
    }

    // If no exit triggered, exit at last bar
    if (!exitDate) {
      const lastBar = bars[bars.length - 1];
      exitDate = new Date(lastBar.timestamp).toISOString().split('T')[0];
      exitPremium = Math.max(0, signal.optionType === 'call'
        ? lastBar.close - signal.strike
        : signal.strike - lastBar.close);
      exitReason = 'expiry';
    }

    const pnl = (exitPremium - signal.entryPremium) * signal.contracts * 100;
    const roi = (exitPremium - signal.entryPremium) / signal.entryPremium;

    return {
      signal,
      exitDate,
      exitPremium,
      exitReason,
      pnl,
      roi,
      maxDrawdown
    };
  }

  /**
   * Save trade result to database
   */
  private async saveTradeResult(result: TradeResult): Promise<void> {
    if (!this.runId) return;

    await db.insert(backtestTrades).values({
      runId: this.runId,
      ticker: result.signal.ticker,
      optionType: result.signal.optionType,
      strike: result.signal.strike,
      expiry: new Date(result.signal.expiry),
      entryDate: new Date(result.signal.date),
      exitDate: new Date(result.exitDate),
      entryPremium: result.signal.entryPremium,
      exitPremium: result.exitPremium,
      exitReason: result.exitReason,
      contracts: result.signal.contracts,
      pnl: result.pnl,
      roi: result.roi * 100, // Convert to percentage
      maxDrawdown: result.maxDrawdown * 100,
      signals: {
        rsi: result.signal.rsi,
        vix: result.signal.vix,
        iv: result.signal.iv
      },
      marketContext: {
        stockPrice: result.signal.stockPrice
      }
    });
  }

  /**
   * Calculate performance metrics
   */
  private calculateMetrics(results: TradeResult[]): {
    wins: number;
    losses: number;
    winRate: number;
    avgROI: number;
    profitFactor: number;
    maxDrawdown: number;
    totalTrades: number;
  } {
    const wins = results.filter(r => r.pnl > 0).length;
    const losses = results.filter(r => r.pnl <= 0).length;
    const winRate = results.length > 0 ? (wins / results.length) * 100 : 0;

    const totalROI = results.reduce((sum, r) => sum + r.roi, 0);
    const avgROI = results.length > 0 ? (totalROI / results.length) * 100 : 0;

    const grossProfit = results.filter(r => r.pnl > 0).reduce((sum, r) => sum + r.pnl, 0);
    const grossLoss = Math.abs(results.filter(r => r.pnl < 0).reduce((sum, r) => sum + r.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const maxDrawdown = Math.min(...results.map(r => r.maxDrawdown)) * 100;

    return {
      wins,
      losses,
      winRate,
      avgROI,
      profitFactor,
      maxDrawdown,
      totalTrades: results.length
    };
  }

  /**
   * Calculate expiry date (days from start)
   */
  private getExpiry(startDate: string, daysOut: number): string {
    const date = new Date(startDate);
    date.setDate(date.getDate() + daysOut);
    return date.toISOString().split('T')[0];
  }
}

export const createBacktest = async (config: BacktestConfig) => {
  const engine = new BacktestEngine(config);
  return await engine.run();
};
