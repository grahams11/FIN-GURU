import axios from 'axios';

async function testYahooScraper() {
  const ticker = 'LCID';
  const url = `https://query2.finance.yahoo.com/v7/finance/options/${ticker}`;
  
  try {
    console.log(`Testing Yahoo Finance API for ${ticker}...`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    const data = response.data;
    
    if (data.optionChain && data.optionChain.result && data.optionChain.result.length > 0) {
      const optionsData = data.optionChain.result[0];
      
      console.log('\n📅 Available Expirations:');
      if (optionsData.expirationDates) {
        optionsData.expirationDates.slice(0, 5).forEach((timestamp: number) => {
          const date = new Date(timestamp * 1000);
          console.log(`  - ${date.toISOString().split('T')[0]}`);
        });
      }
      
      if (optionsData.options && optionsData.options.length > 0) {
        const firstOptions = optionsData.options[0];
        
        console.log('\n📈 CALL Options (first 5):');
        if (firstOptions.calls) {
          firstOptions.calls.slice(0, 5).forEach((call: any) => {
            console.log(`  Strike $${call.strike}: Last $${call.lastPrice || 'N/A'}, Bid $${call.bid}, Ask $${call.ask}`);
          });
        }
        
        console.log('\n📉 PUT Options (first 5):');
        if (firstOptions.puts) {
          firstOptions.puts.slice(0, 5).forEach((put: any) => {
            console.log(`  Strike $${put.strike}: Last $${put.lastPrice || 'N/A'}, Bid $${put.bid}, Ask $${put.ask}`);
          });
        }
        
        // Find Dec 19 $20 strike call
        console.log('\n🎯 Looking for Dec 19 $20 strike CALL...');
        if (firstOptions.calls) {
          const lcidCall = firstOptions.calls.find((c: any) => c.strike === 20 || (c.strike >= 19.5 && c.strike <= 20.5));
          if (lcidCall) {
            console.log(`✅ Found $${lcidCall.strike} strike:`);
            console.log(`   Last Price: $${lcidCall.lastPrice}`);
            console.log(`   Bid: $${lcidCall.bid}`);
            console.log(`   Ask: $${lcidCall.ask}`);
            console.log(`   (Robinhood shows $1.75 for comparison)`);
          }
        }
      }
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testYahooScraper();
