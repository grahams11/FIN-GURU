import axios from 'axios';
import * as cheerio from 'cheerio';

async function testNASDAQ() {
  const ticker = 'LCID';
  const url = `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/option-chain`;
  
  try {
    console.log(`Testing NASDAQ for ${ticker} options...`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 15000
    });
    
    console.log('✅ Got response from NASDAQ');
    const $ = cheerio.load(response.data);
    
    // NASDAQ often uses JSON embedded in scripts
    console.log('\n🔍 Looking for embedded JSON data...');
    
    $('script').each((i, script) => {
      const content = $(script).html() || '';
      if (content.includes('optionChain') || content.includes('"calls"') || content.includes('"puts"')) {
        console.log(`\n✅ Found potential options data in script ${i}:`);
        const preview = content.substring(0, 500);
        console.log(preview + '...');
      }
    });
    
    // Also check for tables
    const tables = $('table');
    console.log(`\nFound ${tables.length} tables`);
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

testNASDAQ();
