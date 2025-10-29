import axios from 'axios';
import * as cheerio from 'cheerio';

async function testHTMLScraper() {
  const ticker = 'LCID';
  const url = `https://finance.yahoo.com/quote/${ticker}/options`;
  
  try {
    console.log(`Testing Yahoo Finance HTML scraping for ${ticker}...`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache'
      },
      timeout: 15000
    });
    
    console.log('✅ Got response, parsing HTML...');
    const $ = cheerio.load(response.data);
    
    // Find all tables on the page
    const tables = $('table');
    console.log(`Found ${tables.length} tables`);
    
    // Look for calls and puts tables
    let callsFound = false;
    let putsFound = false;
    
    tables.each((i, table) => {
      const $table = $(table);
      const rows = $table.find('tbody tr');
      
      if (rows.length > 0) {
        console.log(`\n📊 Table ${i + 1} has ${rows.length} rows:`);
        
        // Sample first 3 rows
        rows.slice(0, 3).each((j, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 3) {
            const cellValues = cells.map((_, cell) => $(cell).text().trim()).get().slice(0, 8);
            console.log(`  Row ${j + 1}: ${cellValues.join(' | ')}`);
          }
        });
      }
    });
    
    // Try to find specific patterns
    console.log('\n🔍 Looking for strike prices...');
    $('td, span, div').each((_, elem) => {
      const text = $(elem).text().trim();
      if (text === '20.00' || text === '20' || text === '$20') {
        const row = $(elem).closest('tr');
        if (row.length > 0) {
          const cells = row.find('td');
          if (cells.length >= 3) {
            console.log('\n✅ Found row with strike 20:');
            cells.each((i, cell) => {
              console.log(`  Cell ${i}: ${$(cell).text().trim()}`);
            });
            callsFound = true;
          }
        }
      }
    });
    
    if (!callsFound) {
      console.log('\n⚠️ Could not find options data in HTML - site may require JavaScript rendering');
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

testHTMLScraper();
