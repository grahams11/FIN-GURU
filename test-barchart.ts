import axios from 'axios';
import * as cheerio from 'cheerio';

async function testBarchart() {
  const ticker = 'LCID';
  const url = `https://www.barchart.com/stocks/quotes/${ticker}/options`;
  
  try {
    console.log(`Testing Barchart for ${ticker} options...`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 15000
    });
    
    console.log('✅ Got response from Barchart');
    const $ = cheerio.load(response.data);
    
    console.log('\n🔍 Looking for options tables...');
    const tables = $('table');
    console.log(`Found ${tables.length} tables`);
    
    tables.slice(0, 3).each((i, table) => {
      const $table = $(table);
      const headers = $table.find('th').map((_, th) => $(th).text().trim()).get();
      const rows = $table.find('tbody tr');
      
      if (headers.length > 0) {
        console.log(`\nTable ${i + 1}:`);
        console.log('Headers:', headers.join(' | '));
        
        rows.slice(0, 2).each((j, row) => {
          const cells = $(row).find('td').map((_, td) => $(td).text().trim()).get();
          if (cells.length > 0) {
            console.log(`Row ${j + 1}:`, cells.join(' | '));
          }
        });
      }
    });
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

testBarchart();
