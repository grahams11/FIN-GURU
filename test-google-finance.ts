import axios from 'axios';
import * as cheerio from 'cheerio';

async function testGoogleFinance() {
  const ticker = 'LCID';
  const url = `https://www.google.com/finance/quote/${ticker}:NASDAQ`;
  
  try {
    console.log(`Testing Google Finance for ${ticker}...`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000
    });
    
    console.log('✅ Got response from Google Finance');
    console.log('Status:', response.status);
    console.log('Content length:', response.data.length);
    
    const $ = cheerio.load(response.data);
    
    // Look for options-related links or sections
    console.log('\n🔍 Looking for options data...');
    
    const links = $('a[href*="option"]');
    console.log(`Found ${links.length} links with "option" in href`);
    
    links.slice(0, 5).each((i, link) => {
      const href = $(link).attr('href');
      const text = $(link).text().trim();
      console.log(`  ${i + 1}. ${text} -> ${href}`);
    });
    
    // Look for any structured data
    const scripts = $('script[type="application/ld+json"]');
    console.log(`\nFound ${scripts.length} JSON-LD scripts`);
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

testGoogleFinance();
