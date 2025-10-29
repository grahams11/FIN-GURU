import axios from 'axios';
import * as cheerio from 'cheerio';

async function testMarketWatch() {
  const ticker = 'LCID';
  const url = `https://www.marketwatch.com/investing/stock/${ticker.toLowerCase()}/options`;
  
  try {
    console.log(`Testing MarketWatch for ${ticker} options...`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      },
      timeout: 15000,
      maxRedirects: 5
    });
    
    console.log('✅ Got response from MarketWatch');
    console.log('Status:', response.status);
    
    const $ = cheerio.load(response.data);
    
    console.log('\n🔍 Searching for options tables...');
    const tables = $('table');
    console.log(`Found ${tables.length} tables`);
    
    tables.each((i, table) => {
      const $table = $(table);
      const className = $table.attr('class') || '';
      const headers = $table.find('th').map((_, th) => $(th).text().trim()).get();
      
      if (headers.length > 0 && (headers.some(h => h.toLowerCase().includes('strike')) || 
                                 headers.some(h => h.toLowerCase().includes('last')) ||
                                 headers.some(h => h.toLowerCase().includes('bid')))) {
        console.log(`\n📊 Table ${i + 1} (${className}):`);
        console.log('Headers:', headers.join(' | '));
        
        const rows = $table.find('tbody tr');
        console.log(`Rows: ${rows.length}`);
        
        rows.slice(0, 3).each((j, row) => {
          const cells = $(row).find('td').map((_, td) => $(td).text().trim()).get();
          if (cells.length > 0) {
            console.log(`  Row ${j + 1}:`, cells.join(' | '));
          }
        });
      }
    });
    
    // Also check for JSON data in scripts
    console.log('\n🔍 Looking for embedded JSON...');
    let foundData = false;
    $('script').each((i, script) => {
      const content = $(script).html() || '';
      if (content.includes('optionsData') || content.includes('"calls"') || content.includes('"strike"')) {
        if (!foundData) {
          console.log('\n✅ Found potential options data in JavaScript!');
          const preview = content.substring(0, 300).replace(/\s+/g, ' ');
          console.log(preview + '...');
          foundData = true;
        }
      }
    });
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

testMarketWatch();
