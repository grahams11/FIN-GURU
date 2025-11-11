import { BacktestingEngine } from './server/services/backtestingEngine';

async function runBacktest() {
  console.log('🚀 Running optimized 1-month backtest...\n');
  
  // 1 month back from today for faster results
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 1);
  
  const config = {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    initialCapital: 10000,
    maxPositionSize: 1000,
    scanInterval: 'weekly' as const // 4-5 trading days
  };
  
  console.log(`📅 Date Range: ${config.startDate} to ${config.endDate}`);
  console.log(`💰 Initial Capital: $${config.initialCapital.toLocaleString()}`);
  console.log(`📊 Scanning 10 liquid stocks (SPY, QQQ, AAPL, NVDA, META, MSFT, AMZN, GOOGL, AMD, TSLA)\n`);
  
  try {
    const engine = new BacktestingEngine();
    const result = await engine.runBacktest(config);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 BACKTEST RESULTS');
    console.log('='.repeat(60));
    console.log(`\n🎯 WIN RATE: ${result.winRate.toFixed(2)}%`);
    console.log(`   Target: 80%+ (${result.winRate >= 80 ? '✅ ACHIEVED' : '❌ BELOW TARGET'})`);
    console.log(`\n📈 TRADE STATISTICS:`);
    console.log(`   Total Trades: ${result.totalTrades}`);
    console.log(`   Winning Trades: ${result.winningTrades} (${result.winRate.toFixed(1)}%)`);
    console.log(`   Losing Trades: ${result.losingTrades} (${(100 - result.winRate).toFixed(1)}%)`);
    console.log(`\n💰 RETURNS:`);
    console.log(`   Average ROI: ${result.avgROI.toFixed(2)}%`);
    console.log(`   Average Win: +${result.avgWinROI.toFixed(2)}%`);
    console.log(`   Average Loss: -${result.avgLossROI.toFixed(2)}%`);
    console.log(`   Profit Factor: ${result.profitFactor.toFixed(2)}`);
    console.log(`\n💵 CAPITAL PERFORMANCE:`);
    console.log(`   Starting Capital: $${result.summary.initialCapital.toLocaleString()}`);
    console.log(`   Final Capital: $${result.summary.finalCapital.toLocaleString()}`);
    console.log(`   Total Return: ${result.summary.totalReturn >= 0 ? '+' : ''}${result.summary.totalReturn.toFixed(2)}%`);
    console.log(`   Max Drawdown: ${result.maxDrawdown.toFixed(2)}%`);
    
    // Show sample trades
    if (result.trades.length > 0) {
      console.log(`\n📋 SAMPLE TRADES (first 5):`);
      result.trades.slice(0, 5).forEach((trade, i) => {
        const roi = trade.actualROI.toFixed(1);
        const symbol = trade.outcome === 'win' ? '✅' : '❌';
        console.log(`   ${symbol} ${trade.ticker} ${trade.optionType?.toUpperCase()}: ${roi}% (${trade.exitReason})`);
      });
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    // Analysis
    if (result.winRate >= 80) {
      console.log('✅ SUCCESS: Strategy achieved 80%+ win rate target!');
    } else if (result.winRate >= 70) {
      console.log('⚠️  CLOSE: Strategy at 70-80% win rate - needs minor tuning.');
    } else if (result.winRate >= 60) {
      console.log('⚠️  MODERATE: Strategy at 60-70% win rate - requires optimization.');
    } else {
      console.log('❌ BELOW TARGET: Strategy needs significant improvement.');
    }
    
  } catch (error: any) {
    console.error('❌ Backtest failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runBacktest();
