import { BacktestingEngine } from './server/services/backtestingEngine';

async function runBacktest() {
  console.log('🚀 Starting 3-month backtest on 20 stocks...\n');
  
  // Calculate date range (3 months back from today)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 3);
  
  const config = {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    initialCapital: 10000, // $10k starting capital
    maxPositionSize: 1000, // Max $1k per trade
    scanInterval: 'weekly' as const // Scan weekly to get ~12 trading days
  };
  
  console.log(`📅 Date Range: ${config.startDate} to ${config.endDate}`);
  console.log(`💰 Initial Capital: $${config.initialCapital.toLocaleString()}`);
  console.log(`📊 Max Position Size: $${config.maxPositionSize.toLocaleString()}`);
  console.log(`⏱️  Scan Interval: ${config.scanInterval}\n`);
  
  try {
    const engine = new BacktestingEngine();
    const result = await engine.runBacktest(config);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 BACKTEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.log(`\n🎯 WIN RATE: ${result.winRate.toFixed(2)}%`);
    console.log(`   Target: 80%+ (${result.winRate >= 80 ? '✅ ACHIEVED' : '❌ BELOW TARGET'})`);
    console.log(`\n📈 PERFORMANCE:`);
    console.log(`   Total Trades: ${result.totalTrades}`);
    console.log(`   Winning Trades: ${result.winningTrades}`);
    console.log(`   Losing Trades: ${result.losingTrades}`);
    console.log(`   Average ROI: ${result.avgROI.toFixed(2)}%`);
    console.log(`   Average Win: ${result.avgWinROI.toFixed(2)}%`);
    console.log(`   Average Loss: ${result.avgLossROI.toFixed(2)}%`);
    console.log(`   Profit Factor: ${result.profitFactor.toFixed(2)}`);
    console.log(`\n💰 CAPITAL:`);
    console.log(`   Starting: $${result.summary.initialCapital.toLocaleString()}`);
    console.log(`   Ending: $${result.summary.finalCapital.toLocaleString()}`);
    console.log(`   Total Return: ${result.summary.totalReturn.toFixed(2)}%`);
    console.log(`   Max Drawdown: ${result.maxDrawdown.toFixed(2)}%`);
    console.log('\n' + '='.repeat(60) + '\n');
    
  } catch (error: any) {
    console.error('❌ Backtest failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runBacktest();
