import { EliteStrategyEngine } from './eliteStrategyEngine';
import { historicalDataService } from './historicalDataService';
import type { OptionsTrade } from '@shared/schema';

interface BacktestConfig {
  startDate: string;
  endDate: string;
  initialCapital: number;
  maxPositionSize: number;
  scanInterval: 'daily' | 'weekly';
}

interface BacktestResult {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalROI: number;
  avgROI: number;
  avgWinROI: number;
  avgLossROI: number;
  maxDrawdown: number;
  profitFactor: number;
  trades: BacktestTrade[];
  summary: {
    startDate: string;
    endDate: string;
    daysSimulated: number;
    initialCapital: number;
    finalCapital: number;
    totalReturn: number;
  };
}

interface BacktestTrade extends OptionsTrade {
  entryDate: string;
  exitDate: string;
  actualROI: number;
  outcome: 'win' | 'loss';
  exitReason: 'profit_target' | 'stop_loss' | 'expiry';
  peakROI?: number;
  troughROI?: number;
}

export class BacktestingEngine {
  private strategyEngine: EliteStrategyEngine;

  constructor() {
    this.strategyEngine = EliteStrategyEngine.getInstance();
  }

  /**
   * Run comprehensive backtest over historical date range
   */
  async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
    console.log(`\n🧪 Starting backtest: ${config.startDate} to ${config.endDate}`);
    
    const trades: BacktestTrade[] = [];
    let capital = config.initialCapital;
    let peakCapital = capital;
    let maxDrawdown = 0;

    // Generate trading days in the range
    const tradingDays = this.generateTradingDays(config.startDate, config.endDate, config.scanInterval);
    console.log(`📅 Simulating ${tradingDays.length} trading days`);

    for (let i = 0; i < tradingDays.length; i++) {
      const day = tradingDays[i];
      console.log(`\n📊 Day ${i + 1}/${tradingDays.length}: ${day}`);

      // Simulate market scan and generate recommendations
      const recommendations = await this.simulateMarketScan(day);
      
      if (recommendations.length === 0) {
        console.log(`  No recommendations generated for ${day}`);
        continue;
      }

      console.log(`  Generated ${recommendations.length} recommendations`);

      // Process each recommendation as a trade
      for (const rec of recommendations.slice(0, 3)) { // Limit to top 3 per day
        // Check if we have enough capital for this trade
        const positionSize = Math.min(config.maxPositionSize, capital * 0.1); // Max 10% per position
        if (positionSize < 100) continue; // Skip if insufficient capital
        
        const trade = await this.simulateTrade(rec, day, tradingDays);
        
        if (trade) {
          // Update trade with actual position sizing
          trade.totalCost = positionSize;
          trades.push(trade);
          
          // Update capital with P&L
          const pnl = positionSize * (trade.actualROI / 100);
          capital += pnl;

          // Track drawdown
          if (capital > peakCapital) {
            peakCapital = capital;
          }
          const drawdown = ((peakCapital - capital) / peakCapital) * 100;
          if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
          }

          console.log(`  ${trade.ticker} ${(trade.optionType || 'call').toUpperCase()}: ${trade.outcome} (${trade.actualROI.toFixed(1)}% ROI)`);
        }
      }
    }

    // Calculate performance metrics
    const winningTrades = trades.filter(t => t.outcome === 'win');
    const losingTrades = trades.filter(t => t.outcome === 'loss');
    
    const totalWinROI = winningTrades.reduce((sum, t) => sum + t.actualROI, 0);
    const totalLossROI = losingTrades.reduce((sum, t) => sum + Math.abs(t.actualROI), 0);
    
    const profitFactor = totalLossROI > 0 ? totalWinROI / totalLossROI : totalWinROI;

    const result: BacktestResult = {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
      totalROI: trades.reduce((sum, t) => sum + t.actualROI, 0),
      avgROI: trades.length > 0 ? trades.reduce((sum, t) => sum + t.actualROI, 0) / trades.length : 0,
      avgWinROI: winningTrades.length > 0 ? totalWinROI / winningTrades.length : 0,
      avgLossROI: losingTrades.length > 0 ? totalLossROI / losingTrades.length : 0,
      maxDrawdown,
      profitFactor,
      trades,
      summary: {
        startDate: config.startDate,
        endDate: config.endDate,
        daysSimulated: tradingDays.length,
        initialCapital: config.initialCapital,
        finalCapital: capital,
        totalReturn: ((capital - config.initialCapital) / config.initialCapital) * 100
      }
    };

    this.printResults(result);
    return result;
  }

  /**
   * Simulate market scan for a historical day
   */
  private async simulateMarketScan(date: string): Promise<OptionsTrade[]> {
    // REALISTIC API LIMITS: Process 3 stocks per week (Mon/Fri only) to stay under 5 calls/min
    // Free tier = 5 calls/min = ~1 stock every 20s
    const symbols = ['AAPL', 'TSLA', 'NVDA'];
    const recommendations: OptionsTrade[] = [];

    // Process stocks sequentially (one at a time) to avoid rate limits
    for (const symbol of symbols) {
      console.log(`  Analyzing ${symbol}...`);
      
      // Fetch historical data for this symbol around this date
      const startDate = this.subtractDays(date, 30);
      const bars = await historicalDataService.getDailyBars(symbol, startDate, date);
      
      if (bars.length < 10) continue; // Need enough data for analysis

      // Calculate basic metrics from historical bars
      const lastBar = bars[bars.length - 1];
      const rsi = this.calculateRSI(bars.map(b => b.close));
      const ema50 = this.calculateEMA(bars.map(b => b.close), 50);
      
      // Simple CALL/PUT determination based on RSI
      if (rsi < 30) {
        // Oversold - potential CALL
        recommendations.push(this.createMockRecommendation(symbol, 'call', lastBar.close, date, rsi));
      } else if (rsi > 70) {
        // Overbought - potential PUT
        recommendations.push(this.createMockRecommendation(symbol, 'put', lastBar.close, date, rsi));
      }
    }

    return recommendations;
  }

  /**
   * Simulate a trade from entry to exit
   */
  private async simulateTrade(
    recommendation: OptionsTrade,
    entryDate: string,
    tradingDays: string[]
  ): Promise<BacktestTrade | null> {
    // Find entry day index
    const entryIndex = tradingDays.indexOf(entryDate);
    if (entryIndex === -1) return null;

    // Calculate expiry (5-7 days out)
    const holdDays = recommendation.holdDays || 5;
    const maxHoldDays = Math.min(holdDays, tradingDays.length - entryIndex - 1);
    
    if (maxHoldDays < 1) return null;

    // Fetch price data for the holding period
    const exitDate = tradingDays[entryIndex + maxHoldDays];
    const bars = await historicalDataService.getDailyBars(
      recommendation.ticker,
      entryDate,
      exitDate
    );

    if (bars.length < 2) return null;

    const entryPrice = recommendation.stockEntryPrice || bars[0].close;
    const isCall = (recommendation.optionType || 'call') === 'call';
    
    // Calculate profit targets and stop losses based on option type
    // For CALLS: profit when stock goes UP, stop loss when stock goes DOWN
    // For PUTS: profit when stock goes DOWN, stop loss when stock goes UP
    let profitTarget: number;
    let stopLoss: number;
    
    if (isCall) {
      // Call: +35% stock move = +175% option ROI (5x multiplier)
      profitTarget = recommendation.stockExitPrice || entryPrice * 1.07; // 7% stock move
      // Call: -9% stock move = -45% option loss
      stopLoss = entryPrice * 0.91; // 9% stock drop triggers stop
    } else {
      // Put: -7% stock move = +35% option profit
      profitTarget = recommendation.stockExitPrice || entryPrice * 0.93; // 7% stock drop
      // Put: +9% stock move = -45% option loss
      stopLoss = entryPrice * 1.09; // 9% stock rise triggers stop
    }
    
    let exitPrice = 0;
    let exitReason: 'profit_target' | 'stop_loss' | 'expiry' = 'expiry';
    let peakPrice = entryPrice;
    let troughPrice = entryPrice;

    // Simulate each day of the trade
    for (let i = 1; i < bars.length; i++) {
      const dayHigh = bars[i].high;
      const dayLow = bars[i].low;
      const dayClose = bars[i].close;

      peakPrice = Math.max(peakPrice || 0, dayHigh);
      troughPrice = Math.min(troughPrice || Number.MAX_VALUE, dayLow);

      // Check for exits
      if (isCall) {
        // For calls, profit when stock goes UP, stop when stock goes DOWN
        if (dayHigh >= profitTarget) {
          exitPrice = profitTarget;
          exitReason = 'profit_target';
          break;
        } else if (dayLow <= stopLoss) {
          exitPrice = stopLoss;
          exitReason = 'stop_loss';
          break;
        }
      } else {
        // For puts, profit when stock goes DOWN, stop when stock goes UP
        if (dayLow <= profitTarget) {
          exitPrice = profitTarget;
          exitReason = 'profit_target';
          break;
        } else if (dayHigh >= stopLoss) {
          exitPrice = stopLoss;
          exitReason = 'stop_loss';
          break;
        }
      }

      // Last day - exit at close
      if (i === bars.length - 1) {
        exitPrice = dayClose;
        exitReason = 'expiry';
      }
    }

    // Calculate actual ROI based on stock movement and option type
    const stockMove = ((exitPrice - entryPrice) / entryPrice) * 100;
    
    // Options amplify stock moves (simplified 5x multiplier)
    // CALL: positive stock move = positive option ROI
    // PUT: negative stock move = positive option ROI
    const optionMultiplier = 5;
    let actualROI = isCall 
      ? stockMove * optionMultiplier
      : -stockMove * optionMultiplier;

    // Cap losses at -100% (can't lose more than premium paid)
    actualROI = Math.max(actualROI, -100);

    const outcome: 'win' | 'loss' = actualROI >= 0 ? 'win' : 'loss';

    const safePeakPrice = peakPrice || entryPrice;
    const safeTroughPrice = troughPrice || entryPrice;

    const peakROI = (recommendation.optionType || 'call') === 'call'
      ? ((safePeakPrice - entryPrice) / entryPrice) * 100 * optionMultiplier
      : ((entryPrice - safeTroughPrice) / entryPrice) * 100 * optionMultiplier;

    const troughROI = (recommendation.optionType || 'call') === 'call'
      ? ((safeTroughPrice - entryPrice) / entryPrice) * 100 * optionMultiplier
      : ((entryPrice - safePeakPrice) / entryPrice) * 100 * optionMultiplier;

    return {
      ...recommendation,
      entryDate,
      exitDate,
      actualROI,
      outcome,
      exitReason,
      peakROI,
      troughROI
    };
  }

  /**
   * Generate list of trading days (skip weekends)
   */
  private generateTradingDays(startDate: string, endDate: string, interval: 'daily' | 'weekly'): string[] {
    const days: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const step = interval === 'weekly' ? 7 : 1;

    let current = new Date(start);
    while (current <= end) {
      const dayOfWeek = current.getDay();
      // Skip weekends (0 = Sunday, 6 = Saturday)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        days.push(current.toISOString().split('T')[0]);
      }
      current.setDate(current.getDate() + step);
    }

    return days;
  }

  /**
   * Helper: Subtract days from a date
   */
  private subtractDays(dateStr: string, days: number): string {
    const date = new Date(dateStr);
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Calculate RSI from price array
   */
  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50;

    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    const recentChanges = changes.slice(-period);
    const gains = recentChanges.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
    const losses = Math.abs(recentChanges.filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;

    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Calculate EMA from price array
   */
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    if (prices.length < period) {
      return prices.reduce((a, b) => a + b, 0) / prices.length;
    }

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Create mock recommendation for backtesting
   */
  private createMockRecommendation(
    symbol: string,
    type: 'call' | 'put',
    price: number,
    date: string,
    rsi: number
  ): OptionsTrade {
    const strike = type === 'call' ? price * 1.02 : price * 0.98;
    const premium = price * 0.02; // 2% of stock price
    
    return {
      id: `backtest-${symbol}-${date}-${type}`,
      ticker: symbol,
      optionType: type,
      currentPrice: price,
      strikePrice: strike,
      expiry: this.addDays(date, 7), // 7 days expiry
      stockEntryPrice: price,
      stockExitPrice: type === 'call' ? price * 1.05 : price * 0.95, // 5% move target
      premium,
      entryPrice: premium,
      exitPrice: premium * 1.5, // Projected 50% premium gain
      holdDays: 5,
      totalCost: premium * 100, // 1 contract
      contracts: 1,
      projectedROI: 50,
      aiConfidence: 0.75,
      greeks: { delta: 0.4, gamma: 0.003, theta: -2, vega: 3, rho: 0.1 },
      sentiment: (rsi - 50) / 50,
      score: 500 + (rsi - 50) * 10,
      fibonacciLevel: null,
      fibonacciColor: null,
      estimatedProfit: premium * 50,
      isExecuted: false,
      createdAt: new Date(date)
    };
  }

  /**
   * Helper: Add days to a date
   */
  private addDays(dateStr: string, days: number): string {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Print backtest results
   */
  private printResults(result: BacktestResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 BACKTEST RESULTS');
    console.log('='.repeat(60));
    console.log(`\n📅 Period: ${result.summary.startDate} to ${result.summary.endDate}`);
    console.log(`📈 Days Simulated: ${result.summary.daysSimulated}`);
    console.log(`\n💰 Capital:`);
    console.log(`   Initial: $${result.summary.initialCapital.toLocaleString()}`);
    console.log(`   Final:   $${result.summary.finalCapital.toLocaleString()}`);
    console.log(`   Return:  ${result.summary.totalReturn.toFixed(2)}%`);
    console.log(`\n🎯 Performance:`);
    console.log(`   Total Trades:    ${result.totalTrades}`);
    console.log(`   Winning Trades:  ${result.winningTrades} (${result.winRate.toFixed(1)}% win rate) ${result.winRate >= 80 ? '✅' : '⚠️'}`);
    console.log(`   Losing Trades:   ${result.losingTrades}`);
    console.log(`   Avg ROI:         ${result.avgROI.toFixed(2)}%`);
    console.log(`   Avg Win ROI:     ${result.avgWinROI.toFixed(2)}%`);
    console.log(`   Avg Loss ROI:    ${result.avgLossROI.toFixed(2)}%`);
    console.log(`   Profit Factor:   ${result.profitFactor.toFixed(2)}`);
    console.log(`   Max Drawdown:    ${result.maxDrawdown.toFixed(2)}%`);
    
    if (result.winRate >= 80) {
      console.log(`\n✅ TARGET ACHIEVED: ${result.winRate.toFixed(1)}% win rate exceeds 80% target!`);
    } else {
      console.log(`\n⚠️ TARGET MISSED: ${result.winRate.toFixed(1)}% win rate below 80% target`);
      console.log(`   Need to improve by ${(80 - result.winRate).toFixed(1)} percentage points`);
    }
    console.log('='.repeat(60) + '\n');
  }
}

export const backtestingEngine = new BacktestingEngine();
