import { BacktestingEngine } from './server/services/backtestingEngine';

async function runQuickBacktest() {
  console.log('🚀 Running quick 2-week backtest on 3 stocks...\n');
  
  // Test recent 2 weeks (Oct 25 - Nov 8, 2025)
  const config = {
    startDate: '2025-10-28',  // Monday
    endDate: '2025-11-08',    // Friday
    initialCapital: 10000,
    maxPositionSize: 1000,
    scanInterval: 'daily' as const  // Scan every day instead of weekly
  };
  
  console.log(`📅 Testing: ${config.startDate} to ${config.endDate}`);
  console.log(`📊 Stocks: AAPL, NVDA, TSLA (one at a time)\n`);
  
  const engine = new BacktestingEngine();
  const result = await engine.runBacktest(config);
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 BACKTEST RESULTS');
  console.log('='.repeat(60));
  console.log(`\n🎯 WIN RATE: ${result.winRate.toFixed(2)}%`);
  console.log(`   Target: 80%+ (${result.winRate >= 80 ? '✅ ACHIEVED' : result.winRate >= 70 ? '⚠️ CLOSE' : '❌ BELOW'})`);
  console.log(`\n📈 TRADES:`);
  console.log(`   Total: ${result.totalTrades}`);
  console.log(`   Wins: ${result.winningTrades}`);
  console.log(`   Losses: ${result.losingTrades}`);
  console.log(`\n💰 PERFORMANCE:`);
  console.log(`   Average ROI: ${result.avgROI.toFixed(1)}%`);
  console.log(`   Average Win: +${result.avgWinROI.toFixed(1)}%`);
  console.log(`   Average Loss: -${result.avgLossROI.toFixed(1)}%`);
  console.log(`   Profit Factor: ${result.profitFactor.toFixed(2)}`);
  console.log(`\n💵 CAPITAL:`);
  console.log(`   Started: $${result.summary.initialCapital.toLocaleString()}`);
  console.log(`   Ended: $${result.summary.finalCapital.toLocaleString()}`);
  console.log(`   Return: ${result.summary.totalReturn >= 0 ? '+' : ''}${result.summary.totalReturn.toFixed(2)}%`);
  
  if (result.trades.length > 0) {
    console.log(`\n📋 ALL TRADES:`);
    result.trades.forEach((trade, i) => {
      const symbol = trade.outcome === 'win' ? '✅' : '❌';
      console.log(`   ${i+1}. ${symbol} ${trade.ticker} ${trade.optionType?.toUpperCase()} ${trade.actualROI.toFixed(1)}% (${trade.exitReason})`);
    });
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
}

runQuickBacktest().catch(console.error);
