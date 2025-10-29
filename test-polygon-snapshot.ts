import axios from 'axios';

async function testSnapshot() {
  const apiKey = process.env.POLYGON_API_KEY;
  const ticker = 'AAPL'; // Use a more liquid stock
  
  try {
    console.log(`📊 Testing Polygon.io snapshot endpoint for ${ticker}...\n`);
    
    // Try the snapshot endpoint which should be included in free tier
    const snapshotUrl = `https://api.polygon.io/v3/snapshot/options/${ticker}?apiKey=${apiKey}`;
    
    const response = await axios.get(snapshotUrl, { timeout: 10000 });
    
    console.log('✅ Response received');
    console.log('Status:', response.status);
    console.log('\nResponse structure:');
    console.log(JSON.stringify(response.data, null, 2).substring(0, 1000));
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response?.data) {
      console.error('\n Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testSnapshot();
