import { BacktestingEngine } from './server/services/backtestingEngine';

async function runMinimalBacktest() {
  console.log('🎯 REALISTIC BACKTEST - Working within API limits\n');
  
  // REALISTIC: 1 week, weekly scan = ~3 API calls total
  const config = {
    startDate: '2025-11-01',  // Friday
    endDate: '2025-11-08',    // Friday (1 week)
    initialCapital: 10000,
    maxPositionSize: 1000,
    scanInterval: 'weekly' as const  // Only scan once at start
  };
  
  console.log(`📅 Period: ${config.startDate} to ${config.endDate} (1 week)`);
  console.log(`📊 Strategy: Weekly scan on AAPL, TSLA, NVDA`);
  console.log(`⚡ API calls: ~3-5 total (within free tier)\n`);
  
  const engine = new BacktestingEngine();
  const result = await engine.runBacktest(config);
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 BACKTEST RESULTS (1 WEEK)');
  console.log('='.repeat(60));
  console.log(`\n🎯 WIN RATE: ${result.winRate.toFixed(1)}%`);
  console.log(`   Target: 80%+ ${result.winRate >= 80 ? '✅' : result.winRate >= 70 ? '⚠️' : '❌'}`);
  console.log(`\n📈 TRADES: ${result.totalTrades} total (${result.winningTrades} wins, ${result.losingTrades} losses)`);
  
  if (result.totalTrades > 0) {
    console.log(`\n💰 PERFORMANCE:`);
    console.log(`   Avg ROI: ${result.avgROI.toFixed(1)}%`);
    console.log(`   Profit Factor: ${result.profitFactor.toFixed(2)}`);
    console.log(`\n💵 RETURN: ${result.summary.totalReturn >= 0 ? '+' : ''}${result.summary.totalReturn.toFixed(2)}%`);
    console.log(`   ($${result.summary.initialCapital.toLocaleString()} → $${result.summary.finalCapital.toLocaleString()})`);
    
    console.log(`\n📋 TRADES:`);
    result.trades.forEach((t, i) => {
      const icon = t.outcome === 'win' ? '✅' : '❌';
      console.log(`   ${icon} ${t.ticker} ${t.optionType.toUpperCase()} ${t.actualROI >= 0 ? '+' : ''}${t.actualROI.toFixed(1)}% (${t.exitReason})`);
    });
  } else {
    console.log(`\n⚠️ No trades generated - market may be too quiet`);
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
}

runMinimalBacktest().catch(console.error);
