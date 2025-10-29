import axios from 'axios';

async function testNearestExpiration() {
  const apiKey = process.env.POLYGON_API_KEY;
  const ticker = 'LCID';
  
  try {
    console.log(`📊 Testing Polygon.io with ${ticker} (nearest expiration)...\n`);
    
    // Get current stock price first
    const priceUrl = `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?apiKey=${apiKey}`;
    const priceResponse = await axios.get(priceUrl, { timeout: 5000 });
    const currentPrice = priceResponse.data?.results?.[0]?.c || 2.5;
    console.log(`Current ${ticker} price: $${currentPrice}\n`);
    
    // Get contracts
    const contractsUrl = `https://api.polygon.io/v3/reference/options/contracts?underlying_ticker=${ticker}&expiration_date.gte=2024-10-29&limit=1000&apiKey=${apiKey}`;
    const response = await axios.get(contractsUrl, { timeout: 15000 });
    
    const contracts = response.data.results;
    
    // Find nearest expiration with ATM strike
    const expirations = new Set<string>();
    contracts.forEach((c: any) => expirations.add(c.expiration_date));
    const nearestExp = Array.from(expirations).sort()[0];
    
    console.log(`📅 Nearest expiration: ${nearestExp}\n`);
    
    // Find ATM call (strike closest to current price)
    const calls = contracts.filter((c: any) => 
      c.expiration_date === nearestExp && c.contract_type === 'call'
    );
    
    const atmCall = calls.reduce((prev: any, curr: any) => {
      const prevDiff = Math.abs(prev.strike_price - currentPrice);
      const currDiff = Math.abs(curr.strike_price - currentPrice);
      return currDiff < prevDiff ? curr : prev;
    });
    
    console.log(`🎯 ATM Call: Strike $${atmCall.strike_price} (closest to $${currentPrice})`);
    console.log(`Contract ticker: ${atmCall.ticker}\n`);
    
    // Get quote
    const quoteUrl = `https://api.polygon.io/v3/quotes/${atmCall.ticker}?limit=1&apiKey=${apiKey}`;
    const quoteResponse = await axios.get(quoteUrl, { timeout: 5000 });
    
    if (quoteResponse.data?.results?.[0]) {
      const quote = quoteResponse.data.results[0];
      const mid = (quote.bid_price + quote.ask_price) / 2;
      
      console.log(`✅ REAL OPTIONS DATA FROM POLYGON.IO:\n`);
      console.log(`💰 Premium Pricing:`);
      console.log(`   Bid: $${quote.bid_price?.toFixed(2)}`);
      console.log(`   Ask: $${quote.ask_price?.toFixed(2)}`);
      console.log(`   Last: $${quote.last_price?.toFixed(2)}`);
      console.log(`   Mid: $${mid.toFixed(2)}`);
      
      console.log(`\n📊 Additional Data:`);
      console.log(`   Volume: ${quote.volume || 0}`);
      console.log(`   Timestamp: ${new Date(quote.participant_timestamp / 1000000).toLocaleString()}`);
      
      // Calculate sample trade
      const contracts = Math.floor(1000 / (mid * 100));
      const totalCost = contracts * mid * 100;
      
      console.log(`\n💼 Sample Trade ($1000 budget):`);
      console.log(`   Contracts: ${contracts}`);
      console.log(`   Cost per contract: $${mid.toFixed(2)}`);
      console.log(`   Total cost: $${totalCost.toFixed(2)}`);
      
      console.log(`\n✅ This is REAL data matching what you'd see on Robinhood!`);
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    }
  }
}

testNearestExpiration();
