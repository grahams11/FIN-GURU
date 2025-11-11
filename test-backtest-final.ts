import { BacktestingEngine } from './server/services/backtestingEngine';

async function runBacktest() {
  console.log('🚀 Running 2-month historical backtest...\n');
  
  // Use dates with known historical data: Sept 1 - Nov 1, 2025
  const config = {
    startDate: '2025-09-01',
    endDate: '2025-11-01',
    initialCapital: 10000,
    maxPositionSize: 1000,
    scanInterval: 'weekly' as const
  };
  
  console.log(`📅 Date Range: ${config.startDate} to ${config.endDate}`);
  console.log(`💰 Initial Capital: $${config.initialCapital.toLocaleString()}`);
  console.log(`📊 Testing 10 liquid stocks\n`);
  
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
    
    // Show trade breakdown by exit reason
    if (result.trades.length > 0) {
      const profitTargets = result.trades.filter(t => t.exitReason === 'profit_target').length;
      const stopLosses = result.trades.filter(t => t.exitReason === 'stop_loss').length;
      const expiries = result.trades.filter(t => t.exitReason === 'expiry').length;
      
      console.log(`\n📊 EXIT BREAKDOWN:`);
      console.log(`   Profit Targets Hit: ${profitTargets}`);
      console.log(`   Stop Losses Hit: ${stopLosses}`);
      console.log(`   Expired: ${expiries}`);
      
      console.log(`\n📋 SAMPLE TRADES (first 10):`);
      result.trades.slice(0, 10).forEach((trade, i) => {
        const roi = trade.actualROI.toFixed(1);
        const symbol = trade.outcome === 'win' ? '✅' : '❌';
        console.log(`   ${symbol} ${trade.ticker} ${trade.optionType?.toUpperCase()} ${roi}% (${trade.exitReason}) - Entry: ${trade.entryDate}`);
      });
    }
    
    console.log('\n' + '='.repeat(60));
    
    // Win rate analysis
    if (result.winRate >= 80) {
      console.log('\n✅ SUCCESS: Strategy achieved 80%+ win rate target!');
      console.log('   The elite strategy filters are working effectively.');
    } else if (result.winRate >= 70) {
      console.log('\n⚠️  CLOSE: 70-80% win rate - minor tuning needed.');
      console.log(`   Improvement needed: +${(80 - result.winRate).toFixed(1)}%`);
    } else if (result.winRate >= 60) {
      console.log('\n⚠️  MODERATE: 60-70% win rate - requires optimization.');
      console.log(`   Improvement needed: +${(80 - result.winRate).toFixed(1)}%`);
    } else {
      console.log('\n❌ BELOW 60%: Significant strategy refinement required.');
      console.log(`   Gap to target: ${(80 - result.winRate).toFixed(1)}%`);
    }
    console.log();
    
  } catch (error: any) {
    console.error('❌ Backtest failed:', error.message);
    process.exit(1);
  }
}

runBacktest();
