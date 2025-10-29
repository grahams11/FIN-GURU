import axios from 'axios';

async function testYahooSimple() {
  const ticker = 'LCID';
  
  try {
    console.log(`Testing Yahoo Finance JSON API for ${ticker}...\n`);
    
    // Yahoo's API sometimes works without crumb for options data
    const url = `https://query1.finance.yahoo.com/v7/finance/options/${ticker}`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    const data = response.data;
    
    if (data.optionChain?.result?.[0]) {
      const options = data.optionChain.result[0];
      
      console.log(`✅ SUCCESS! Got options data for ${ticker}\n`);
      console.log(`📅 Expirations: ${options.expirationDates?.length || 0}`);
      
      if (options.expirationDates && options.expirationDates.length > 0) {
        const firstExp = new Date(options.expirationDates[0] * 1000).toISOString().split('T')[0];
        console.log(`   First: ${firstExp}\n`);
      }
      
      if (options.options?.[0]?.calls) {
        console.log(`📈 Sample CALL options:`);
        options.options[0].calls.slice(0, 5).forEach((call: any) => {
          const mid = (call.bid + call.ask) / 2;
          console.log(`   Strike $${call.strike}: Bid $${call.bid?.toFixed(2)}, Ask $${call.ask?.toFixed(2)}, Mid $${mid.toFixed(2)}`);
        });
      }
      
      if (options.options?.[0]?.puts) {
        console.log(`\n📉 Sample PUT options:`);
        options.options[0].puts.slice(0, 5).forEach((put: any) => {
          const mid = (put.bid + put.ask) / 2;
          console.log(`   Strike $${put.strike}: Bid $${put.bid?.toFixed(2)}, Ask $${put.ask?.toFixed(2)}, Mid $${mid.toFixed(2)}`);
        });
      }
      
      console.log(`\n✅ Yahoo Finance JSON API is working!`);
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data).substring(0, 200));
    }
  }
}

testYahooSimple();
