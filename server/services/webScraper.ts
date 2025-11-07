import axios from 'axios';
import * as cheerio from 'cheerio';

export interface StockData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
}

export interface MarketIndices {
  sp500: StockData;
  nasdaq: StockData;
  vix: StockData;
}

export interface OptionContract {
  strike: number;
  bid: number;
  ask: number;
  last: number;
  iv?: number; // implied volatility
  oi?: number; // open interest
  volume?: number;
}

export interface OptionsChain {
  ticker: string;
  expirations: string[]; // ISO date strings
  byExpiration: {
    [isoDate: string]: {
      calls: OptionContract[];
      puts: OptionContract[];
    }
  };
}

export class WebScraperService {
  private static readonly HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0'
  };

  // Company name cache with TTL (7 days)
  private static companyNameCache = new Map<string, {value: {name: string, exchange?: string, type?: string} | null, timestamp: number}>();
  private static readonly CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

  /**
   * Sanitize company names to filter out generic site titles and improve quality
   */
  private static sanitizeName(name: string, symbol: string): string | null {
    if (!name || typeof name !== 'string') return null;
    
    const cleaned = name.trim();
    
    // Filter out generic site titles and unwanted content
    const blacklistedTerms = [
      'yahoo finance',
      'yahoo',
      'marketwatch', 
      'google finance',
      'google',
      'stock price',
      'quote',
      'news',
      'history',
      'stock chart',
      'real time',
      'real-time',
      'live',
      'finance',
      'investing',
      'nasdaq',
      'nyse',
      'stock market',
      'share price'
    ];
    
    const lowerName = cleaned.toLowerCase();
    
    // Reject if it contains blacklisted terms as the main content
    for (const term of blacklistedTerms) {
      if (lowerName === term || lowerName.includes(term + ' -') || lowerName.includes('- ' + term)) {
        return null;
      }
    }
    
    // Reject if it's just the ticker symbol
    if (lowerName === symbol.toLowerCase() || lowerName === symbol.toLowerCase() + '.') {
      return null;
    }
    
    // Reject if too short or doesn't contain letters
    if (cleaned.length < 3 || !/[a-zA-Z]/.test(cleaned)) {
      return null;
    }
    
    // Clean up common suffixes and prefixes from scraped titles
    let result = cleaned
      .replace(/\s*-\s*(stock price|quote|news|history|yahoo finance|marketwatch|google finance).*$/i, '')
      .replace(/^(stock price|quote|news|history|yahoo finance|marketwatch|google finance)\s*-\s*/i, '')
      .replace(/\s*\|\s*(yahoo finance|marketwatch|google finance).*$/i, '')
      .replace(/\s*[\(\[].*?[\)\]]$/, '') // Remove trailing parentheses/brackets
      .replace(/\s*stock$/, '')
      .replace(/\s*inc\.?$/i, ' Inc.')
      .replace(/\s*corp\.?$/i, ' Corp.')
      .replace(/\s*ltd\.?$/i, ' Ltd.')
      .replace(/\s*llc$/i, ' LLC')
      .trim();
    
    // Final validation
    if (result.length < 3 || result.toLowerCase() === symbol.toLowerCase()) {
      return null;
    }
    
    return result;
  }

  /**
   * Generate a reasonable fallback company name when web scraping fails
   */
  private static generateFallbackName(symbol: string): string {
    // For short symbols, generate reasonable company names
    const symbolLower = symbol.toLowerCase();
    
    // Common patterns for company names
    const commonPatterns = [
      { symbol: 'amd', name: 'Advanced Micro Devices Inc.' },
      { symbol: 'ibm', name: 'International Business Machines Corp.' },
      { symbol: 'att', name: 'AT&T Inc.' },
      { symbol: 'ge', name: 'General Electric Company' },
      { symbol: 'hp', name: 'HP Inc.' },
      { symbol: 'ups', name: 'United Parcel Service Inc.' },
      { symbol: 'ups', name: 'United Parcel Service Inc.' },
      { symbol: 'cat', name: 'Caterpillar Inc.' },
      { symbol: 'mmm', name: '3M Company' },
      { symbol: 'dd', name: 'DuPont de Nemours Inc.' }
    ];
    
    const pattern = commonPatterns.find(p => p.symbol === symbolLower);
    if (pattern) {
      return pattern.name;
    }
    
    // For single letter symbols, try to make reasonable names
    if (symbol.length === 1) {
      switch (symbol.toUpperCase()) {
        case 'F': return 'Ford Motor Company';
        case 'T': return 'AT&T Inc.';
        case 'C': return 'Citigroup Inc.';
        case 'X': return 'United States Steel Corp.';
        default: return `${symbol} Corporation`;
      }
    }
    
    // For 2-3 letter symbols, add Inc./Corp.
    if (symbol.length <= 3) {
      return `${symbol.toUpperCase()} Inc.`;
    }
    
    // For longer symbols, create a title case version
    const titleCase = symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();
    return `${titleCase} Corporation`;
  }

  /**
   * Resolve company identity using multiple web scraping sources with caching
   */
  private static async resolveCompanyIdentity(symbol: string): Promise<{name: string, exchange?: string, type?: string} | null> {
    const upperSymbol = symbol.toUpperCase();
    
    // Check cache first
    const cached = this.companyNameCache.get(upperSymbol);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      console.log(`${upperSymbol}: Using cached company data`);
      return cached.value;
    }
    
    console.log(`${upperSymbol}: Resolving company identity via web scraping`);
    
    // Try multiple web scraping sources in order of preference
    const scrapingSources = [
      () => this.scrapeGoogleFinanceCompany(upperSymbol),
      () => this.scrapeMarketWatchCompany(upperSymbol)
    ];
    
    for (const source of scrapingSources) {
      try {
        const result = await source();
        if (result) {
          console.log(`${upperSymbol}: Found company name via web scraping: ${result.name}`);
          // Cache the result
          this.companyNameCache.set(upperSymbol, { value: result, timestamp: Date.now() });
          return result;
        }
      } catch (error) {
        console.log(`${upperSymbol}: Web scraping source failed:`, (error as Error).message);
      }
    }
    
    // Cache null result to avoid repeated failed scraping
    this.companyNameCache.set(upperSymbol, { value: null, timestamp: Date.now() });
    console.log(`${upperSymbol}: No company name found via web scraping, using fallback`);
    return null;
  }


  /**
   * Scrape company name from Google Finance using web scraping
   */
  private static async scrapeGoogleFinanceCompany(symbol: string): Promise<{name: string, exchange?: string, type?: string} | null> {
    try {
      const response = await axios.get(`https://www.google.com/finance/quote/${symbol}:NASDAQ`, {
        headers: this.HEADERS,
        timeout: 5000
      });
      
      const $ = cheerio.load(response.data);
      
      // Try multiple selectors for company name
      const selectors = [
        '[data-attrid="title"]',
        '.AXNJhd',
        'h1',
        '.zzDege'
      ];
      
      for (const selector of selectors) {
        const nameElement = $(selector).first();
        if (nameElement.length > 0) {
          const rawName = nameElement.text().trim();
          const cleanName = this.sanitizeName(rawName, symbol);
          if (cleanName) {
            return { name: cleanName, exchange: 'NASDAQ', type: 'Stock' };
          }
        }
      }
      
      // Try page title as fallback
      const title = $('title').text();
      if (title) {
        const cleanName = this.sanitizeName(title, symbol);
        if (cleanName) {
          return { name: cleanName, exchange: 'NASDAQ', type: 'Stock' };
        }
      }
      
      return null;
    } catch (error) {
      console.log(`Google Finance company scraping failed for ${symbol}:`, (error as Error).message);
      return null;
    }
  }

  /**
   * Scrape company name from MarketWatch using web scraping
   */
  private static async scrapeMarketWatchCompany(symbol: string): Promise<{name: string, exchange?: string, type?: string} | null> {
    try {
      const response = await axios.get(`https://www.marketwatch.com/investing/stock/${symbol}`, {
        headers: this.HEADERS,
        timeout: 5000
      });
      
      const $ = cheerio.load(response.data);
      
      // Try multiple selectors for company name
      const selectors = [
        'h1.company__name',
        '.instrumentname h1',
        'h1.symbol__name',
        '.company-header h1',
        'h1'
      ];
      
      for (const selector of selectors) {
        const nameElement = $(selector).first();
        if (nameElement.length > 0) {
          const rawName = nameElement.text().trim();
          const cleanName = this.sanitizeName(rawName, symbol);
          if (cleanName) {
            return { name: cleanName, exchange: 'Unknown', type: 'Stock' };
          }
        }
      }
      
      // Try page title as fallback
      const title = $('title').text();
      if (title) {
        const cleanName = this.sanitizeName(title, symbol);
        if (cleanName) {
          return { name: cleanName, exchange: 'Unknown', type: 'Stock' };
        }
      }
      
      return null;
    } catch (error) {
      console.log(`MarketWatch company scraping failed for ${symbol}:`, (error as Error).message);
      return null;
    }
  }

  static async scrapeMarketIndices(): Promise<MarketIndices> {
    // Use Google Finance web scraping for all market indices (no API dependencies)
    try {
      const symbols = ['%5EGSPC', '%5EIXIC', '%5EVIX']; // S&P 500, NASDAQ, VIX
      const results = await Promise.allSettled(
        symbols.map(symbol => this.scrapeStockPrice(symbol))
      );

      const [sp500Result, nasdaqResult, vixResult] = results;

      return {
        sp500: sp500Result.status === 'fulfilled' ? sp500Result.value : this.getDefaultData('^GSPC'),
        nasdaq: nasdaqResult.status === 'fulfilled' ? nasdaqResult.value : this.getDefaultData('^IXIC'),
        vix: vixResult.status === 'fulfilled' ? vixResult.value : this.getDefaultData('^VIX'),
      };
    } catch (error) {
      console.error('Error getting market indices:', error);
      return {
        sp500: this.getDefaultData('^GSPC'),
        nasdaq: this.getDefaultData('^IXIC'),
        vix: this.getDefaultData('^VIX'),
      };
    }
  }

  static async scrapeStockPrice(symbol: string): Promise<StockData> {
    // Use Google Finance web scraping for all price data (no API dependencies)
    const sources = [
      () => this.scrapeGoogleFinance(symbol),
      () => this.scrapeMarketWatch(symbol)
    ];

    for (const scraper of sources) {
      try {
        const data = await scraper();
        if (data.price > 0) {
          console.log(`${symbol}: Got scraped price ${data.price}`);
          return data;
        }
      } catch (error) {
        console.warn(`Source ${scraper.name} failed for ${symbol}:`, error instanceof Error ? error.message : 'Unknown error');
        continue;
      }
    }
    
    console.error(`All sources failed for ${symbol}`);
    return this.getDefaultData(symbol);
  }


  private static async scrapeGoogleFinance(symbol: string): Promise<StockData> {
    // Clean symbol and map to Google Finance format
    const cleanSymbol = symbol.replace('%5E', '^');
    
    // Map market indices to Google Finance format
    let googleSymbol: string;
    if (cleanSymbol === '^GSPC') {
      googleSymbol = '.INX:INDEXSP';
    } else if (cleanSymbol === '^IXIC') {
      googleSymbol = '.IXIC:INDEXNASDAQ';
    } else if (cleanSymbol === '^VIX') {
      googleSymbol = 'VIX:INDEXCBOE';
    } else {
      // For regular stocks, try NASDAQ first
      googleSymbol = `${cleanSymbol}:NASDAQ`;
    }
    
    const url = `https://www.google.com/finance/quote/${googleSymbol}`;
    
    try {
      const response = await axios.get(url, {
        headers: {
          ...this.HEADERS,
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        timeout: 8000
      });
      
      const $ = cheerio.load(response.data);
      
      // Google Finance selectors
      let price = 0;
      const priceSelectors = [
        '[data-last-price]',
        '.YMlKec.fxKbKc', // Google Finance price class
        '[jsname="Vebqub"]',
        '.kf1m0'
      ];

      for (const selector of priceSelectors) {
        const priceElement = $(selector).first();
        let priceText = priceElement.attr('data-last-price') || priceElement.text();
        priceText = priceText.replace(/[,$]/g, '').trim();
        
        if (priceText && !isNaN(parseFloat(priceText))) {
          price = parseFloat(priceText);
          console.log(`${symbol}: Google Finance found price ${price} using ${selector}`);
          break;
        }
      }

      if (price > 0) {
        return {
          symbol: cleanSymbol,
          price,
          change: 0,
          changePercent: 0
        };
      }
      
      throw new Error('No valid price found');
    } catch (error) {
      throw new Error(`Google Finance scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private static async scrapeMarketWatch(symbol: string): Promise<StockData> {
    const url = `https://www.marketwatch.com/investing/stock/${symbol.toLowerCase()}`;
    
    try {
      const response = await axios.get(url, {
        headers: {
          ...this.HEADERS,
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        timeout: 8000
      });
      
      const $ = cheerio.load(response.data);
      
      // MarketWatch selectors
      let price = 0;
      const priceSelectors = [
        '.intraday__price .value',
        '[data-module="LastPrice"]',
        '.quotewrap .data .value',
        'bg-quote'
      ];

      for (const selector of priceSelectors) {
        const priceElement = $(selector).first();
        let priceText = priceElement.text();
        priceText = priceText.replace(/[,$]/g, '').trim();
        
        if (priceText && !isNaN(parseFloat(priceText))) {
          price = parseFloat(priceText);
          console.log(`${symbol}: MarketWatch found price ${price} using ${selector}`);
          break;
        }
      }

      if (price > 0) {
        return {
          symbol,
          price,
          change: 0,
          changePercent: 0
        };
      }
      
      throw new Error('No valid price found');
    } catch (error) {
      throw new Error(`MarketWatch scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get 52-week high and low data from web scraping (Yahoo Finance for data, not API)
   */
  static async scrape52WeekRange(symbol: string): Promise<{ fiftyTwoWeekHigh: number; fiftyTwoWeekLow: number } | null> {
    const cleanSymbol = symbol.replace('%5E', '^');
    
    // Try Yahoo Finance web scraping (HTML page, not API)
    try {
      const url = `https://finance.yahoo.com/quote/${cleanSymbol}`;
      const response = await axios.get(url, {
        headers: this.HEADERS,
        timeout: 8000
      });
      
      const $ = cheerio.load(response.data);
      
      // Yahoo Finance displays 52-week range clearly in statistics
      let high52 = 0;
      let low52 = 0;
      
      // Look for 52-week range in the page
      $('td').each((_, elem) => {
        const label = $(elem).text().trim();
        if (label === '52 Week Range' || label.includes('52-Week Range') || label.includes('52 week range')) {
          const value = $(elem).next('td').text().trim();
          // Format usually: "low - high"
          const matches = value.match(/([\d,.]+)\s*-\s*([\d,.]+)/);
          if (matches && matches.length >= 3) {
            low52 = parseFloat(matches[1].replace(/,/g, ''));
            high52 = parseFloat(matches[2].replace(/,/g, ''));
          }
        }
      });
      
      // Alternative: look in spans/divs
      if (high52 === 0 || low52 === 0) {
        $('span, div').each((_, elem) => {
          const text = $(elem).text();
          if (text.includes('52') && text.includes('Range')) {
            const parent = $(elem).parent();
            const value = parent.find('span, td').last().text();
            const matches = value.match(/([\d,.]+)\s*-\s*([\d,.]+)/);
            if (matches && matches.length >= 3) {
              low52 = parseFloat(matches[1].replace(/,/g, ''));
              high52 = parseFloat(matches[2].replace(/,/g, ''));
            }
          }
        });
      }
      
      if (high52 > 0 && low52 > 0 && high52 > low52) {
        console.log(`${symbol}: Yahoo Finance web scraping 52-week range: $${low52.toFixed(2)} - $${high52.toFixed(2)}`);
        return {
          fiftyTwoWeekHigh: high52,
          fiftyTwoWeekLow: low52
        };
      }
    } catch (error) {
      console.log(`Yahoo Finance web scraping failed for ${symbol}:`, error instanceof Error ? error.message : 'Unknown error');
    }
    
    console.warn(`Could not get 52-week range for ${symbol} from web scraping`);
    return null;
  }
  
  // Get real options chain data using web scraping
  static async scrapeOptionsChain(ticker: string): Promise<OptionsChain> {
    return this.fallbackWebScrapeOptions(ticker);
  }
  
  // Fallback to other web scraping sources
  private static async fallbackWebScrapeOptions(ticker: string): Promise<OptionsChain> {
    const sources = [
      () => this.scrapeCboeOptions(ticker),
      () => this.scrapeMarketWatchOptions(ticker)
    ];
    
    for (const scraper of sources) {
      try {
        const chain = await scraper();
        if (chain.expirations.length > 0) {
          console.log(`${ticker}: Found ${chain.expirations.length} expirations from web scraper`);
          return chain;
        }
      } catch (error) {
        console.warn(`Options source failed for ${ticker}:`, error instanceof Error ? error.message : 'Unknown error');
        continue;
      }
    }
    
    // Return empty chain if all sources fail
    return {
      ticker,
      expirations: [],
      byExpiration: {}
    };
  }
  
  // Primary: Cboe delayed quotes
  private static async scrapeCboeOptions(ticker: string): Promise<OptionsChain> {
    const url = `https://www.cboe.com/delayed_quotes/${ticker}/options`;
    
    try {
      const response = await axios.get(url, {
        headers: {
          ...this.HEADERS,
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        timeout: 10000
      });
      
      const $ = cheerio.load(response.data);
      
      // Extract expiration dates
      const expirations: string[] = [];
      $('select[name*="expiration"] option, .expiration-list a, select.expiration option').each((_, elem) => {
        const dateText = $(elem).text().trim();
        const dateValue = $(elem).attr('value');
        
        if (dateValue && dateValue !== '') {
          expirations.push(dateValue);
        } else if (dateText && this.isValidDateString(dateText)) {
          const parsedDate = this.parseExpirationDate(dateText);
          if (parsedDate) {
            expirations.push(parsedDate);
          }
        }
      });
      
      // Extract options data for current/first expiration
      const byExpiration: { [key: string]: { calls: OptionContract[], puts: OptionContract[] } } = {};
      
      if (expirations.length > 0) {
        const firstExpiration = expirations[0];
        
        const calls: OptionContract[] = [];
        const puts: OptionContract[] = [];
        
        // Parse calls table
        $('table.calls tr, table[data-testid*="calls"] tr, .calls-table tr').each((_, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 4) {
            const strike = parseFloat($(cells[2]).text().replace(/[,$]/g, ''));
            const bid = parseFloat($(cells[0]).text().replace(/[,$]/g, ''));
            const ask = parseFloat($(cells[1]).text().replace(/[,$]/g, ''));
            const last = parseFloat($(cells[3]).text().replace(/[,$]/g, ''));
            // Try to extract IV from additional columns
            const iv = cells.length > 6 ? parseFloat($(cells[6]).text().replace(/[%,$]/g, '')) : undefined;
            const oi = cells.length > 5 ? parseInt($(cells[5]).text().replace(/[,$]/g, '')) : undefined;
            
            if (!isNaN(strike) && strike > 0) {
              calls.push({ strike, bid, ask, last, iv: iv && !isNaN(iv) ? iv / 100 : undefined, oi });
            }
          }
        });
        
        // Parse puts table
        $('table.puts tr, table[data-testid*="puts"] tr, .puts-table tr').each((_, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 4) {
            const strike = parseFloat($(cells[2]).text().replace(/[,$]/g, ''));
            const bid = parseFloat($(cells[0]).text().replace(/[,$]/g, ''));
            const ask = parseFloat($(cells[1]).text().replace(/[,$]/g, ''));
            const last = parseFloat($(cells[3]).text().replace(/[,$]/g, ''));
            // Try to extract IV from additional columns
            const iv = cells.length > 6 ? parseFloat($(cells[6]).text().replace(/[%,$]/g, '')) : undefined;
            const oi = cells.length > 5 ? parseInt($(cells[5]).text().replace(/[,$]/g, '')) : undefined;
            
            if (!isNaN(strike) && strike > 0) {
              puts.push({ strike, bid, ask, last, iv: iv && !isNaN(iv) ? iv / 100 : undefined, oi });
            }
          }
        });
        
        if (calls.length > 0 || puts.length > 0) {
          byExpiration[firstExpiration] = { calls, puts };
        }
      }
      
      return {
        ticker,
        expirations,
        byExpiration
      };
      
    } catch (error) {
      throw new Error(`Cboe options scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  
  // Tertiary: MarketWatch Options
  private static async scrapeMarketWatchOptions(ticker: string): Promise<OptionsChain> {
    const url = `https://www.marketwatch.com/investing/stock/${ticker.toLowerCase()}/options`;
    
    try {
      const response = await axios.get(url, {
        headers: {
          ...this.HEADERS,
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        timeout: 10000
      });
      
      const $ = cheerio.load(response.data);
      
      // Extract expiration dates
      const expirations: string[] = [];
      $('a[data-track-code*="Options_Expirations"], .expiration-list a').each((_, elem) => {
        const dateText = $(elem).text().trim();
        const parsedDate = this.parseExpirationDate(dateText);
        if (parsedDate) {
          expirations.push(parsedDate);
        }
      });
      
      // Extract options data
      const byExpiration: { [key: string]: { calls: OptionContract[], puts: OptionContract[] } } = {};
      
      if (expirations.length > 0) {
        const firstExpiration = expirations[0];
        const calls: OptionContract[] = [];
        const puts: OptionContract[] = [];
        
        // Parse options table rows
        $('.options-table tr, table.options tr').each((_, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 4) {
            const strike = parseFloat($(cells.find('.option__strike, td:nth-child(3)')).text().replace(/[,$]/g, ''));
            const bid = parseFloat($(cells[0]).text().replace(/[,$]/g, ''));
            const ask = parseFloat($(cells[1]).text().replace(/[,$]/g, ''));
            const last = parseFloat($(cells[2]).text().replace(/[,$]/g, ''));
            
            if (!isNaN(strike) && strike > 0) {
              // Try to extract IV and other data
              const iv = cells.length > 6 ? parseFloat($(cells[6]).text().replace(/[%,$]/g, '')) : undefined;
              const volume = cells.length > 5 ? parseInt($(cells[4]).text().replace(/[,$]/g, '')) : undefined;
              const oi = cells.length > 7 ? parseInt($(cells[7]).text().replace(/[,$]/g, '')) : undefined;
              
              // Determine if it's a call or put based on table context or cell content
              const isCall = $(row).closest('.calls-table').length > 0 || $(row).find('.call-indicator').length > 0;
              const contract = { strike, bid, ask, last, iv: iv && !isNaN(iv) ? iv / 100 : undefined, oi, volume };
              
              if (isCall) {
                calls.push(contract);
              } else {
                puts.push(contract);
              }
            }
          }
        });
        
        if (calls.length > 0 || puts.length > 0) {
          byExpiration[firstExpiration] = { calls, puts };
        }
      }
      
      return {
        ticker,
        expirations,
        byExpiration
      };
      
    } catch (error) {
      throw new Error(`MarketWatch options scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // Helper methods for date parsing
  private static isValidDateString(dateStr: string): boolean {
    const datePatterns = [
      /^\d{4}-\d{2}-\d{2}$/, // 2025-01-17
      /^\w{3}\s+\d{1,2},\s+\d{4}$/, // Jan 17, 2025
      /^\d{1,2}\/\d{1,2}\/\d{4}$/, // 1/17/2025
      /^\w{3}\s+\d{1,2}\s+'\d{2}$/ // Jan 17 '25
    ];
    
    return datePatterns.some(pattern => pattern.test(dateStr));
  }
  
  private static parseExpirationDate(dateStr: string): string | null {
    try {
      // Try parsing various date formats
      const date = new Date(dateStr);
      
      if (isNaN(date.getTime())) {
        return null;
      }
      
      // Return in ISO format (YYYY-MM-DD)
      return date.toISOString().split('T')[0];
    } catch (error) {
      return null;
    }
  }



  private static getDefaultData(symbol: string): StockData {
    // Fallback data when scraping fails
    const defaults = {
      '^GSPC': { price: 4127.83, change: 30.12, changePercent: 0.74 },
      '^IXIC': { price: 12845.78, change: 156.42, changePercent: 1.23 },
      '^VIX': { price: 18.42, change: -0.41, changePercent: -2.15 }
    };

    const defaultData = defaults[symbol as keyof typeof defaults] || { price: 0, change: 0, changePercent: 0 };

    return {
      symbol,
      ...defaultData
    };
  }


  /**
   * Search for ticker symbols using web scraping
   */
  static async scrapeSymbolSuggestions(query: string): Promise<import('@shared/schema').SymbolSuggestion[]> {
    if (!query || query.length === 0) return [];
    
    // Sanitize query input
    const cleanQuery = query.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 10);
    if (!cleanQuery) return [];

    console.log(`Searching ticker symbols for: ${cleanQuery}`);

    try {
      // Use a smart fallback approach - generate suggestions from known ticker patterns
      const suggestions = await this.generateSmartSuggestions(cleanQuery);
      
      if (suggestions.length > 0) {
        console.log(`Found ${suggestions.length} ticker suggestions for ${cleanQuery}`);
        return suggestions.slice(0, 10);
      }

      // If no smart suggestions, try exact match validation
      return await this.validateExactSymbol(cleanQuery);
    } catch (error) {
      console.error(`Error scraping symbol suggestions for ${query}:`, error);
      return [];
    }
  }


  private static async scrapeGoogleFinanceSearch(query: string): Promise<import('@shared/schema').SymbolSuggestion[]> {
    try {
      const response = await axios.get(`https://www.google.com/finance/quote/${query}:NASDAQ`, {
        headers: this.HEADERS,
        timeout: 5000
      });
      
      const $ = cheerio.load(response.data);
      const suggestions: import('@shared/schema').SymbolSuggestion[] = [];
      
      // Try to find the ticker symbol from the page
      const titleText = $('title').text();
      const match = titleText.match(/^([A-Z]+)/);
      
      if (match && match[1] === query) {
        // Found exact match
        const name = $('[data-attrid="title"]').text().split(' - ')[0] || query;
        suggestions.push({
          symbol: query,
          name,
          exchange: 'NASDAQ',
          type: 'Stock'
        });
      }
      
      return suggestions;
    } catch (error) {
      console.error(`Google Finance search failed for ${query}:`, error);
      return [];
    }
  }

  /**
   * Generate smart ticker suggestions using known patterns and price validation
   */
  private static async generateSmartSuggestions(query: string): Promise<import('@shared/schema').SymbolSuggestion[]> {
    const suggestions: import('@shared/schema').SymbolSuggestion[] = [];
    
    // Common ticker patterns to try
    const candidates = [
      query, // Exact match
      ...this.getCommonTickerVariations(query)
    ];

    // Known company mappings for common searches
    const knownCompanies: Record<string, {name: string, exchange: string}> = {
      'AAPL': { name: 'Apple Inc.', exchange: 'NASDAQ' },
      'GOOGL': { name: 'Alphabet Inc.', exchange: 'NASDAQ' },
      'MSFT': { name: 'Microsoft Corporation', exchange: 'NASDAQ' },
      'AMZN': { name: 'Amazon.com Inc.', exchange: 'NASDAQ' },
      'TSLA': { name: 'Tesla Inc.', exchange: 'NASDAQ' },
      'META': { name: 'Meta Platforms Inc.', exchange: 'NASDAQ' },
      'NVDA': { name: 'NVIDIA Corporation', exchange: 'NASDAQ' },
      'NFLX': { name: 'Netflix Inc.', exchange: 'NASDAQ' },
      'INTC': { name: 'Intel Corporation', exchange: 'NASDAQ' },
      'AMD': { name: 'Advanced Micro Devices', exchange: 'NASDAQ' },
      'PLTR': { name: 'Palantir Technologies Inc.', exchange: 'NYSE' },
      'SOFI': { name: 'SoFi Technologies Inc.', exchange: 'NASDAQ' },
      'UBER': { name: 'Uber Technologies Inc.', exchange: 'NYSE' },
      'LYFT': { name: 'Lyft Inc.', exchange: 'NASDAQ' },
      'COIN': { name: 'Coinbase Global Inc.', exchange: 'NASDAQ' },
      'SQ': { name: 'Block Inc.', exchange: 'NYSE' },
      'PYPL': { name: 'PayPal Holdings Inc.', exchange: 'NASDAQ' },
      'BA': { name: 'Boeing Company', exchange: 'NYSE' },
      'JPM': { name: 'JPMorgan Chase & Co.', exchange: 'NYSE' },
      'GS': { name: 'Goldman Sachs Group Inc.', exchange: 'NYSE' },
      'V': { name: 'Visa Inc.', exchange: 'NYSE' },
      'MA': { name: 'Mastercard Inc.', exchange: 'NYSE' },
      'DIS': { name: 'Walt Disney Company', exchange: 'NYSE' },
      'KO': { name: 'Coca-Cola Company', exchange: 'NYSE' },
      'PEP': { name: 'PepsiCo Inc.', exchange: 'NASDAQ' },
      'NKE': { name: 'Nike Inc.', exchange: 'NYSE' },
      'ADBE': { name: 'Adobe Inc.', exchange: 'NASDAQ' },
      'CRM': { name: 'Salesforce Inc.', exchange: 'NYSE' },
      'ORCL': { name: 'Oracle Corporation', exchange: 'NYSE' },
      'BABA': { name: 'Alibaba Group Holding', exchange: 'NYSE' },
      'JD': { name: 'JD.com Inc.', exchange: 'NASDAQ' },
      'PDD': { name: 'PDD Holdings Inc.', exchange: 'NASDAQ' },
      'SHOP': { name: 'Shopify Inc.', exchange: 'NYSE' },
      'ZM': { name: 'Zoom Video Communications', exchange: 'NASDAQ' },
      'SPOT': { name: 'Spotify Technology S.A.', exchange: 'NYSE' },
      'RR': { name: 'Richtech Robotics Inc.', exchange: 'NASDAQ' },
      'SPCE': { name: 'Virgin Galactic Holdings Inc.', exchange: 'NYSE' },
      'F': { name: 'Ford Motor Company', exchange: 'NYSE' },
      'GM': { name: 'General Motors Company', exchange: 'NYSE' },
      'T': { name: 'AT&T Inc.', exchange: 'NYSE' },
      'VZ': { name: 'Verizon Communications Inc.', exchange: 'NYSE' },
      'WMT': { name: 'Walmart Inc.', exchange: 'NYSE' },
      'XOM': { name: 'Exxon Mobil Corporation', exchange: 'NYSE' },
      'CVX': { name: 'Chevron Corporation', exchange: 'NYSE' },
      'PFE': { name: 'Pfizer Inc.', exchange: 'NYSE' },
      'JNJ': { name: 'Johnson & Johnson', exchange: 'NYSE' },
      'UNH': { name: 'UnitedHealth Group Inc.', exchange: 'NYSE' },
      'HD': { name: 'Home Depot Inc.', exchange: 'NYSE' },
      'COST': { name: 'Costco Wholesale Corp.', exchange: 'NASDAQ' },
      'BRK.B': { name: 'Berkshire Hathaway Inc.', exchange: 'NYSE' },
      'LLY': { name: 'Eli Lilly and Company', exchange: 'NYSE' },
      'AVGO': { name: 'Broadcom Inc.', exchange: 'NASDAQ' },
      'TMO': { name: 'Thermo Fisher Scientific Inc.', exchange: 'NYSE' }
    };

    for (const candidate of candidates) {
      // Check if it's a known ticker
      if (knownCompanies[candidate]) {
        const company = knownCompanies[candidate];
        
        // Validate with price check to ensure it's still active
        try {
          const priceData = await this.scrapeStockPrice(candidate);
          if (priceData.price > 0) {
            console.log(`${candidate}: Using known company name: ${company.name}`);
            suggestions.push({
              symbol: candidate,
              name: company.name,
              exchange: company.exchange,
              type: 'Stock'
            });
          }
        } catch (error) {
          // Skip if price validation fails
          console.log(`Price validation failed for ${candidate}, skipping`);
        }
      }
    }

    // Filter suggestions to only include partial matches
    return suggestions.filter(s => s.symbol.includes(query) || query.length >= 2);
  }

  /**
   * Generate common ticker variations for search
   */
  private static getCommonTickerVariations(query: string): string[] {
    const variations = [];
    
    // If query is short, don't generate variations to avoid too many false matches
    if (query.length < 2) return [];
    
    // For companies that might have different ticker endings
    const commonEndings = ['', 'A', 'B', 'C'];
    for (const ending of commonEndings) {
      if (query.length <= 4) {
        variations.push(query + ending);
      }
    }
    
    // Remove duplicates and the original query
    return Array.from(new Set(variations)).filter(v => v !== query && v.length <= 5);
  }

  /**
   * Validate if exact symbol exists by checking price
   */
  private static async validateExactSymbol(query: string): Promise<import('@shared/schema').SymbolSuggestion[]> {
    try {
      console.log(`Validating exact symbol: ${query}`);
      const priceData = await this.scrapeStockPrice(query);
      
      if (priceData.price > 0) {
        console.log(`Exact symbol ${query} validated with price: $${priceData.price}`);
        
        // Check knownCompanies first to prevent overriding good names
        const knownCompanies: Record<string, {name: string, exchange: string}> = {
          'AAPL': { name: 'Apple Inc.', exchange: 'NASDAQ' },
          'GOOGL': { name: 'Alphabet Inc.', exchange: 'NASDAQ' },
          'MSFT': { name: 'Microsoft Corporation', exchange: 'NASDAQ' },
          'AMZN': { name: 'Amazon.com Inc.', exchange: 'NASDAQ' },
          'TSLA': { name: 'Tesla Inc.', exchange: 'NASDAQ' },
          'META': { name: 'Meta Platforms Inc.', exchange: 'NASDAQ' },
          'NVDA': { name: 'NVIDIA Corporation', exchange: 'NASDAQ' },
          'NFLX': { name: 'Netflix Inc.', exchange: 'NASDAQ' },
          'INTC': { name: 'Intel Corporation', exchange: 'NASDAQ' },
          'AMD': { name: 'Advanced Micro Devices', exchange: 'NASDAQ' },
          'PLTR': { name: 'Palantir Technologies Inc.', exchange: 'NYSE' },
          'SOFI': { name: 'SoFi Technologies Inc.', exchange: 'NASDAQ' },
          'UBER': { name: 'Uber Technologies Inc.', exchange: 'NYSE' },
          'LYFT': { name: 'Lyft Inc.', exchange: 'NASDAQ' },
          'COIN': { name: 'Coinbase Global Inc.', exchange: 'NASDAQ' },
          'SQ': { name: 'Block Inc.', exchange: 'NYSE' },
          'PYPL': { name: 'PayPal Holdings Inc.', exchange: 'NASDAQ' },
          'BA': { name: 'Boeing Company', exchange: 'NYSE' },
          'JPM': { name: 'JPMorgan Chase & Co.', exchange: 'NYSE' },
          'GS': { name: 'Goldman Sachs Group Inc.', exchange: 'NYSE' },
          'V': { name: 'Visa Inc.', exchange: 'NYSE' },
          'MA': { name: 'Mastercard Inc.', exchange: 'NYSE' },
          'DIS': { name: 'Walt Disney Company', exchange: 'NYSE' },
          'KO': { name: 'Coca-Cola Company', exchange: 'NYSE' },
          'PEP': { name: 'PepsiCo Inc.', exchange: 'NASDAQ' },
          'NKE': { name: 'Nike Inc.', exchange: 'NYSE' },
          'ADBE': { name: 'Adobe Inc.', exchange: 'NASDAQ' },
          'CRM': { name: 'Salesforce Inc.', exchange: 'NYSE' },
          'ORCL': { name: 'Oracle Corporation', exchange: 'NYSE' },
          'BABA': { name: 'Alibaba Group Holding', exchange: 'NYSE' },
          'JD': { name: 'JD.com Inc.', exchange: 'NASDAQ' },
          'PDD': { name: 'PDD Holdings Inc.', exchange: 'NASDAQ' },
          'SHOP': { name: 'Shopify Inc.', exchange: 'NYSE' },
          'ZM': { name: 'Zoom Video Communications', exchange: 'NASDAQ' },
          'SPOT': { name: 'Spotify Technology S.A.', exchange: 'NYSE' },
          'RR': { name: 'Richtech Robotics Inc.', exchange: 'NASDAQ' },
          'SPCE': { name: 'Virgin Galactic Holdings Inc.', exchange: 'NYSE' },
          'F': { name: 'Ford Motor Company', exchange: 'NYSE' },
          'GM': { name: 'General Motors Company', exchange: 'NYSE' },
          'T': { name: 'AT&T Inc.', exchange: 'NYSE' },
          'VZ': { name: 'Verizon Communications Inc.', exchange: 'NYSE' },
          'WMT': { name: 'Walmart Inc.', exchange: 'NYSE' },
          'XOM': { name: 'Exxon Mobil Corporation', exchange: 'NYSE' },
          'CVX': { name: 'Chevron Corporation', exchange: 'NYSE' },
          'PFE': { name: 'Pfizer Inc.', exchange: 'NYSE' },
          'JNJ': { name: 'Johnson & Johnson', exchange: 'NYSE' },
          'UNH': { name: 'UnitedHealth Group Inc.', exchange: 'NYSE' },
          'HD': { name: 'Home Depot Inc.', exchange: 'NYSE' },
          'COST': { name: 'Costco Wholesale Corp.', exchange: 'NASDAQ' },
          'BRK.B': { name: 'Berkshire Hathaway Inc.', exchange: 'NYSE' },
          'LLY': { name: 'Eli Lilly and Company', exchange: 'NYSE' },
          'AVGO': { name: 'Broadcom Inc.', exchange: 'NASDAQ' },
          'TMO': { name: 'Thermo Fisher Scientific Inc.', exchange: 'NYSE' }
        };
        
        if (knownCompanies[query]) {
          const company = knownCompanies[query];
          console.log(`${query}: Using known company data: ${company.name}`);
          return [{
            symbol: query,
            name: company.name,
            exchange: company.exchange,
            type: 'Stock'
          }];
        }
        
        // Use robust company name resolution for unknown tickers
        const companyData = await this.resolveCompanyIdentity(query);
        
        return [{
          symbol: query,
          name: companyData?.name || this.generateFallbackName(query), // Use resolved name or generate fallback
          exchange: companyData?.exchange,
          type: companyData?.type || 'Stock'
        }];
      }
    } catch (error) {
      console.log(`Exact symbol validation failed for ${query}:`, (error as Error).message);
    }
    
    return [];
  }

  /**
   * Scrape actual company name for a ticker symbol
   */
  private static async scrapeCompanyName(symbol: string): Promise<string | null> {
    try {
      // Try Google Finance first for company name
      const response = await axios.get(`https://www.google.com/finance/quote/${symbol}:NASDAQ`, {
        headers: this.HEADERS,
        timeout: 5000
      });
      
      const $ = cheerio.load(response.data);
      
      // Try to find company name from page title or specific selectors
      const titleText = $('title').text();
      if (titleText && titleText.includes(':')) {
        const parts = titleText.split(':')[0].trim();
        if (parts && parts !== symbol && parts.length > symbol.length) {
          return parts;
        }
      }
      
      // Try alternative selector for company name
      const companyNameElement = $('h1[data-attrid="title"]');
      if (companyNameElement.length > 0) {
        const companyName = companyNameElement.text().trim();
        if (companyName && companyName !== symbol) {
          return companyName;
        }
      }
      
    } catch (error) {
      console.log(`Failed to scrape company name for ${symbol}:`, (error as Error).message);
    }
    
    return null;
  }
}
