import axios from 'axios';

async function getYahooOptionsWithCrumb() {
  const ticker = 'LCID';
  
  try {
    // Step 1: Get cookies and crumb from Yahoo
    console.log('🔑 Step 1: Getting Yahoo Finance cookies...');
    const cookieResponse = await axios.get('https://finance.yahoo.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const cookies = cookieResponse.headers['set-cookie']?.join('; ') || '';
    console.log('✅ Got cookies');
    
    // Step 2: Get crumb
    console.log('\n🎫 Step 2: Getting crumb token...');
    const crumbResponse = await axios.get('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookies
      }
    });
    
    const crumb = crumbResponse.data;
    console.log(`✅ Got crumb: ${crumb}`);
    
    // Step 3: Get options data with crumb
    console.log(`\n📊 Step 3: Getting options data for ${ticker}...`);
    const optionsUrl = `https://query2.finance.yahoo.com/v7/finance/options/${ticker}?crumb=${encodeURIComponent(crumb)}`;
    
    const optionsResponse = await axios.get(optionsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookies
      }
    });
    
    const data = optionsResponse.data;
    
    if (data.optionChain && data.optionChain.result && data.optionChain.result.length > 0) {
      const optionsData = data.optionChain.result[0];
      
      console.log('\n✅ SUCCESS! Got options data\n');
      console.log('📅 Available Expirations:');
      if (optionsData.expirationDates) {
        optionsData.expirationDates.slice(0, 5).forEach((timestamp: number) => {
          const date = new Date(timestamp * 1000);
          console.log(`  - ${date.toISOString().split('T')[0]}`);
        });
      }
      
      if (optionsData.options && optionsData.options.length > 0) {
        const firstOptions = optionsData.options[0];
        
        console.log('\n📈 CALL Options (sample):');
        if (firstOptions.calls) {
          firstOptions.calls.slice(0, 5).forEach((call: any) => {
            console.log(`  Strike $${call.strike}: Last $${call.lastPrice?.toFixed(2) || 'N/A'}, Bid $${call.bid?.toFixed(2)}, Ask $${call.ask?.toFixed(2)}`);
          });
          
          // Find $20 strike
          console.log('\n🎯 Looking for $20 strike CALL...');
          const call20 = firstOptions.calls.find((c: any) => c.strike === 20);
          if (call20) {
            console.log(`\n✅ FOUND $20 STRIKE:`);
            console.log(`   Last Price: $${call20.lastPrice?.toFixed(2)}`);
            console.log(`   Bid: $${call20.bid?.toFixed(2)}`);
            console.log(`   Ask: $${call20.ask?.toFixed(2)}`);
            console.log(`   Mid: $${((call20.bid + call20.ask) / 2).toFixed(2)}`);
            console.log(`\n   📱 Robinhood shows: $1.75`);
            console.log(`   ✅ Our data: $${((call20.bid + call20.ask) / 2).toFixed(2)} (using mid-price)`);
          }
        }
      }
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

getYahooOptionsWithCrumb();
