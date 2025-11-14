import axios from 'axios';
import * as cheerio from 'cheerio';

async function inspectGoogleFinanceStructure() {
  const url = 'https://www.google.com/finance/quote/.INX:INDEXSP';
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 8000
    });
    
    const $ = cheerio.load(response.data);
    
    console.log('\n=== PRICE ELEMENT STRUCTURE ===');
    const priceElement = $('[data-last-price]').first();
    if (priceElement.length > 0) {
      const price = priceElement.attr('data-last-price');
      console.log(`Price: ${price}`);
      console.log(`Price element HTML:`);
      console.log(priceElement.toString());
      
      // Show parent containers
      console.log(`\n=== PRICE PARENT CONTAINER ===`);
      const parent1 = priceElement.parent();
      console.log(parent1.toString().substring(0, 500));
      
      console.log(`\n=== PRICE GRANDPARENT CONTAINER ===`);
      const parent2 = parent1.parent();
      console.log(parent2.toString().substring(0, 800));
    }
    
    console.log('\n\n=== CHANGE PERCENT ELEMENT STRUCTURE ===');
    const changePercSelectors = [
      '[data-last-change-perc]',
      '.JwB6zf',
      '[jsname="rfaVEf"]'
    ];
    
    for (const selector of changePercSelectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        const text = element.attr('data-last-change-perc') || element.text();
        console.log(`\nSelector: ${selector}`);
        console.log(`Text: ${text}`);
        console.log(`Element HTML:`);
        console.log(element.toString());
        
        // Show parent
        console.log(`Parent HTML:`);
        console.log(element.parent().toString().substring(0, 500));
        break;
      }
    }
    
    // Try to find ALL instances of these selectors
    console.log('\n\n=== ALL .JwB6zf INSTANCES (change percent class) ===');
    $('.JwB6zf').each((i, elem) => {
      const text = $(elem).text();
      console.log(`\nInstance ${i + 1}: "${text}"`);
      console.log($(elem).parent().toString().substring(0, 300));
    });
    
    // Look for the main quote container that has the price
    console.log('\n\n=== SEARCHING FOR CHANGE % NEAR PRICE ===');
    const mainQuoteContainer = $('[data-last-price]').first().closest('[jscontroller]');
    console.log(`Main quote container HTML (first 1500 chars):`);
    console.log(mainQuoteContainer.html()?.substring(0, 1500));
    
    // Search for percentage signs in that container
    const containerText = mainQuoteContainer.text();
    const percentMatches = containerText.match(/[+-]?\d+\.\d+%/g);
    console.log(`\nPercentage values found in container: ${percentMatches?.join(', ')}`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

inspectGoogleFinanceStructure();
