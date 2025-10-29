import axios from 'axios';

async function testPolygonAPI() {
  const apiKey = process.env.POLYGON_API_KEY;
  
  if (!apiKey) {
    console.error('❌ POLYGON_API_KEY not found in environment');
    return;
  }
  
  console.log('✅ API Key found, testing Polygon.io...\n');
  
  const ticker = 'LCID';
  
  try {
    // Step 1: Get options contracts
    console.log(`📊 Step 1: Getting options contracts for ${ticker}...`);
    const contractsUrl = `https://api.polygon.io/v3/reference/options/contracts?underlying_ticker=${ticker}&limit=50&apiKey=${apiKey}`;
    
    const contractsResponse = await axios.get(contractsUrl, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });
    
    if (!contractsResponse.data || !contractsResponse.data.results) {
      console.error('❌ No contracts found');
      return;
    }
    
    const contracts = contractsResponse.data.results;
    console.log(`✅ Found ${contracts.length} contracts\n`);
    
    // Find December expiration near $20 strike
    console.log('🎯 Looking for December 2024 expiration, $20 strike CALL...\n');
    
    const decContracts = contracts.filter((c: any) => 
      c.expiration_date && c.expiration_date.startsWith('2024-12') &&
      c.contract_type === 'call' &&
      c.strike_price >= 19.5 && c.strike_price <= 20.5
    );
    
    console.log(`Found ${decContracts.length} December calls near $20 strike:`);
    decContracts.slice(0, 3).forEach((c: any) => {
      console.log(`  - ${c.ticker}: Strike $${c.strike_price}, Exp ${c.expiration_date}`);
    });
    
    if (decContracts.length > 0) {
      const targetContract = decContracts[0];
      console.log(`\n📈 Getting quote for ${targetContract.ticker}...`);
      
      // Step 2: Get quote for this specific contract
      const quoteUrl = `https://api.polygon.io/v3/quotes/${targetContract.ticker}?limit=1&apiKey=${apiKey}`;
      const quoteResponse = await axios.get(quoteUrl, { timeout: 5000 });
      
      if (quoteResponse.data && quoteResponse.data.results && quoteResponse.data.results.length > 0) {
        const quote = quoteResponse.data.results[0];
        
        console.log(`\n✅ SUCCESS! Real options data from Polygon.io:\n`);
        console.log(`Contract: ${targetContract.ticker}`);
        console.log(`Strike: $${targetContract.strike_price}`);
        console.log(`Expiration: ${targetContract.expiration_date}`);
        console.log(`Type: ${targetContract.contract_type.toUpperCase()}\n`);
        console.log(`💰 PRICING:`);
        console.log(`   Bid: $${quote.bid_price?.toFixed(2) || 'N/A'}`);
        console.log(`   Ask: $${quote.ask_price?.toFixed(2) || 'N/A'}`);
        console.log(`   Last: $${quote.last_price?.toFixed(2) || 'N/A'}`);
        console.log(`   Mid: $${((quote.bid_price + quote.ask_price) / 2).toFixed(2)}`);
        console.log(`\n📱 Robinhood comparison: $1.75`);
        console.log(`✅ Polygon mid-price: $${((quote.bid_price + quote.ask_price) / 2).toFixed(2)}`);
      }
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testPolygonAPI();
