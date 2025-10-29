import axios from 'axios';

async function testAllExpirations() {
  const apiKey = process.env.POLYGON_API_KEY;
  const ticker = 'LCID';
  
  try {
    console.log(`📊 Getting ALL options contracts for ${ticker}...\n`);
    const contractsUrl = `https://api.polygon.io/v3/reference/options/contracts?underlying_ticker=${ticker}&limit=1000&apiKey=${apiKey}`;
    
    const response = await axios.get(contractsUrl, { timeout: 15000 });
    
    if (!response.data || !response.data.results) {
      console.error('❌ No contracts found');
      return;
    }
    
    const contracts = response.data.results;
    console.log(`✅ Total contracts: ${contracts.length}\n`);
    
    // Group by expiration date
    const expirations = new Set<string>();
    const strikesByExpiration: {[key: string]: Set<number>} = {};
    
    for (const contract of contracts) {
      const exp = contract.expiration_date;
      if (exp) {
        expirations.add(exp);
        if (!strikesByExpiration[exp]) {
          strikesByExpiration[exp] = new Set();
        }
        strikesByExpiration[exp].add(contract.strike_price);
      }
    }
    
    const sortedExpirations = Array.from(expirations).sort();
    
    console.log(`📅 Available Expirations (${sortedExpirations.length} total):\n`);
    sortedExpirations.slice(0, 10).forEach(exp => {
      const strikes = Array.from(strikesByExpiration[exp]).sort((a,b) => a-b);
      console.log(`${exp}: ${strikes.length} strikes (${strikes[0]} to ${strikes[strikes.length-1]})`);
    });
    
    // Find Dec 19 specifically
    const dec19 = sortedExpirations.find(e => e === '2024-12-19');
    if (dec19) {
      console.log(`\n✅ Found 2024-12-19 expiration!`);
      const strikes = Array.from(strikesByExpiration[dec19]).sort((a,b) => a-b);
      console.log(`Strikes: ${strikes.join(', ')}`);
      
      // Find $20 strike call
      const call20 = contracts.find((c: any) => 
        c.expiration_date === '2024-12-19' && 
        c.strike_price === 20 && 
        c.contract_type === 'call'
      );
      
      if (call20) {
        console.log(`\n🎯 Found LCID Dec 19 $20 CALL: ${call20.ticker}`);
        console.log(`Getting real-time quote...`);
        
        const quoteUrl = `https://api.polygon.io/v3/quotes/${call20.ticker}?limit=1&apiKey=${apiKey}`;
        const quoteResponse = await axios.get(quoteUrl, { timeout: 5000 });
        
        if (quoteResponse.data?.results?.[0]) {
          const quote = quoteResponse.data.results[0];
          console.log(`\n💰 REAL PRICING FROM POLYGON:`);
          console.log(`   Bid: $${quote.bid_price?.toFixed(2)}`);
          console.log(`   Ask: $${quote.ask_price?.toFixed(2)}`);
          console.log(`   Last: $${quote.last_price?.toFixed(2)}`);
          console.log(`   Mid: $${((quote.bid_price + quote.ask_price) / 2).toFixed(2)}`);
          console.log(`\n📱 Robinhood shows: $1.75`);
          console.log(`✅ Polygon mid: $${((quote.bid_price + quote.ask_price) / 2).toFixed(2)}`);
        }
      }
    } else {
      console.log(`\n⚠️ 2024-12-19 not found in expirations`);
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response?.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testAllExpirations();
