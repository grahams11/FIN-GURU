import axios from 'axios';

async function testPolygonAuth() {
  const apiKey = (process.env.POLYGON_API_KEY || '').trim();
  
  console.log('🔑 Testing Polygon API authentication...');
  console.log(`API Key length: ${apiKey.length} chars (after trim)`);
  console.log(`First 10 chars: ${apiKey.substring(0, 10)}...`);
  
  const testUrl = 'https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/2025-11-13/2025-11-13';
  
  // Test 1: Bearer token auth (current method)
  console.log('\n📡 Test 1: Bearer Token Authentication');
  try {
    const response1 = await axios.get(testUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 10000
    });
    console.log('✅ Bearer auth SUCCESS');
    console.log(`Response status: ${response1.status}`);
    console.log(`AAPL close: $${response1.data?.results?.[0]?.c}`);
  } catch (error: any) {
    console.log('❌ Bearer auth FAILED');
    console.log(`Error: ${error.response?.status} ${error.response?.statusText}`);
    console.log(`Message: ${error.message}`);
  }
  
  // Test 2: Query param auth (fallback method)
  console.log('\n📡 Test 2: Query Parameter Authentication');
  try {
    const response2 = await axios.get(`${testUrl}?apiKey=${apiKey}`, {
      timeout: 10000
    });
    console.log('✅ Query param auth SUCCESS');
    console.log(`Response status: ${response2.status}`);
    console.log(`AAPL close: $${response2.data?.results?.[0]?.c}`);
  } catch (error: any) {
    console.log('❌ Query param auth FAILED');
    console.log(`Error: ${error.response?.status} ${error.response?.statusText}`);
    console.log(`Message: ${error.message}`);
  }
}

testPolygonAuth().catch(console.error);
