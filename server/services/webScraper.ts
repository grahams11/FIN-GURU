import axios from 'axios';
import * as cheerio from 'cheerio';

export interface StockData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
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
  private static readonly YAHOO_FINANCE_BASE = 'https://finance.yahoo.com';
  private static readonly HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  };

  static async scrapeMarketIndices(): Promise<MarketIndices> {
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
      console.error('Error scraping market indices:', error);
      return {
        sp500: this.getDefaultData('^GSPC'),
        nasdaq: this.getDefaultData('^IXIC'),
        vix: this.getDefaultData('^VIX'),
      };
    }
  }

  static async scrapeStockPrice(symbol: string): Promise<StockData> {
    // Try multiple sources for freshest data
    const sources = [
      () => this.scrapeGoogleFinance(symbol),
      () => this.scrapeMarketWatch(symbol), 
      () => this.scrapeYahooFinance(symbol)
    ];

    for (const scraper of sources) {
      try {
        const data = await scraper();
        if (data.price > 0) {
          console.log(`${symbol}: Got fresh price ${data.price}`);
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

  private static async scrapeYahooFinance(symbol: string): Promise<StockData> {
    // Try multiple Yahoo Finance URLs with cache-busting
    const urls = [
      `${this.YAHOO_FINANCE_BASE}/quote/${symbol}?t=${Date.now()}`,
      `${this.YAHOO_FINANCE_BASE}/quote/${symbol}`,
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`
    ];
    
    for (const url of urls) {
      try {
        if (url.includes('query1.finance.yahoo.com')) {
          // Try Yahoo Finance API directly
          const response = await axios.get(url, {
            headers: {
              ...this.HEADERS,
              'Accept': 'application/json'
            },
            timeout: 8000
          });
          
          if (response.data?.chart?.result?.[0]?.meta) {
            const meta = response.data.chart.result[0].meta;
            const currentPrice = meta.regularMarketPrice || meta.previousClose;
            const previousClose = meta.previousClose;
            const change = currentPrice - previousClose;
            const changePercent = (change / previousClose) * 100;
            
            console.log(`${symbol}: Got live price ${currentPrice} from Yahoo API`);
            
            return {
              symbol: symbol.replace('%5E', '^'),
              price: currentPrice,
              change: change,
              changePercent: changePercent,
              volume: meta.regularMarketVolume
            };
          }
        } else {
          // Try HTML scraping with improved selectors
          const response = await axios.get(url, {
            headers: {
              ...this.HEADERS,
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            },
            timeout: 8000
          });
          
          const $ = cheerio.load(response.data);
          
          // Enhanced price selectors for 2024/2025 Yahoo Finance
          let price = 0;
          const priceSelectors = [
            `[data-symbol="${symbol}"] [data-field="regularMarketPrice"]`,
            '[data-testid="qsp-price"] span',
            '[data-testid="qsp-price"]',
            'fin-streamer[data-field="regularMarketPrice"]',
            '.Fw\\(b\\).Fz\\(36px\\)',
            '.yf-1tejb6',
            '[class*="price"]'
          ];

          for (const selector of priceSelectors) {
            const priceElement = $(selector).first();
            let priceText = priceElement.attr('value') || priceElement.text();
            priceText = priceText.replace(/[,$]/g, '').trim();
            
            if (priceText && !isNaN(parseFloat(priceText))) {
              price = parseFloat(priceText);
              console.log(`${symbol}: Found price ${price} using selector: ${selector}`);
              break;
            }
          }

          if (price > 0) {
            // Try to get change data
            let change = 0;
            let changePercent = 0;
            const changeSelectors = [
              `[data-symbol="${symbol}"] [data-field="regularMarketChange"]`,
              '[data-testid="qsp-price-change"]',
              'fin-streamer[data-field="regularMarketChange"]',
              '.Fw\\(500\\).Pstart\\(8px\\)'
            ];

            for (const selector of changeSelectors) {
              const changeElement = $(selector).first();
              const changeText = changeElement.attr('value') || changeElement.text();
              const match = changeText.match(/([+-]?\d+\.?\d*)\s*\(([+-]?\d+\.?\d*)%\)/);
              if (match) {
                change = parseFloat(match[1]);
                changePercent = parseFloat(match[2]);
                break;
              }
            }

            return {
              symbol: symbol.replace('%5E', '^'),
              price,
              change,
              changePercent,
              volume: undefined
            };
          }
        }
      } catch (error) {
        console.warn(`Failed to scrape ${url} for ${symbol}:`, error instanceof Error ? error.message : 'Unknown error');
        continue;
      }
    }
    
    throw new Error(`All data sources failed for ${symbol}`);
  }

  private static async scrapeGoogleFinance(symbol: string): Promise<StockData> {
    const url = `https://www.google.com/finance/quote/${symbol}:NASDAQ`;
    
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
          symbol,
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
  
  // Web scrape actual options chains from multiple sources
  static async scrapeOptionsChain(ticker: string): Promise<OptionsChain> {
    const sources = [
      () => this.scrapeCboeOptions(ticker),
      () => this.scrapeYahooFinanceOptions(ticker),
      () => this.scrapeMarketWatchOptions(ticker)
    ];
    
    for (const scraper of sources) {
      try {
        const chain = await scraper();
        if (chain.expirations.length > 0) {
          console.log(`${ticker}: Found ${chain.expirations.length} expirations from options scraper`);
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
            
            if (!isNaN(strike) && strike > 0) {
              calls.push({ strike, bid, ask, last });
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
            
            if (!isNaN(strike) && strike > 0) {
              puts.push({ strike, bid, ask, last });
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
  
  // Secondary: Yahoo Finance Options
  private static async scrapeYahooFinanceOptions(ticker: string): Promise<OptionsChain> {
    const url = `https://finance.yahoo.com/quote/${ticker}/options`;
    
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
      
      // Extract expiration dates from dropdown/links
      const expirations: string[] = [];
      $('a[href*="/options?date="], select.expiration option').each((_, elem) => {
        const href = $(elem).attr('href');
        const dateParam = href?.match(/date=(\d+)/);
        
        if (dateParam) {
          const timestamp = parseInt(dateParam[1]);
          const date = new Date(timestamp * 1000);
          expirations.push(date.toISOString().split('T')[0]);
        }
      });
      
      // Extract options data
      const byExpiration: { [key: string]: { calls: OptionContract[], puts: OptionContract[] } } = {};
      
      if (expirations.length > 0) {
        const firstExpiration = expirations[0];
        const calls: OptionContract[] = [];
        const puts: OptionContract[] = [];
        
        // Parse calls table
        $('table[data-testid*="calls"] tbody tr').each((_, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 5) {
            const strike = parseFloat($(cells[2]).text().replace(/[,$]/g, ''));
            const last = parseFloat($(cells[3]).text().replace(/[,$]/g, ''));
            const bid = parseFloat($(cells[4]).text().replace(/[,$]/g, ''));
            const ask = parseFloat($(cells[5]).text().replace(/[,$]/g, ''));
            
            if (!isNaN(strike) && strike > 0) {
              calls.push({ strike, bid, ask, last });
            }
          }
        });
        
        // Parse puts table
        $('table[data-testid*="puts"] tbody tr').each((_, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 5) {
            const strike = parseFloat($(cells[2]).text().replace(/[,$]/g, ''));
            const last = parseFloat($(cells[3]).text().replace(/[,$]/g, ''));
            const bid = parseFloat($(cells[4]).text().replace(/[,$]/g, ''));
            const ask = parseFloat($(cells[5]).text().replace(/[,$]/g, ''));
            
            if (!isNaN(strike) && strike > 0) {
              puts.push({ strike, bid, ask, last });
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
      throw new Error(`Yahoo Finance options scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
              // Determine if it's a call or put based on table context or cell content
              const isCall = $(row).closest('.calls-table').length > 0 || $(row).find('.call-indicator').length > 0;
              const contract = { strike, bid, ask, last };
              
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

  static async scrapeStockNews(symbol: string): Promise<string[]> {
    try {
      const url = `${this.YAHOO_FINANCE_BASE}/quote/${symbol}/news`;
      const response = await axios.get(url, { 
        headers: this.HEADERS,
        timeout: 10000
      });
      
      const $ = cheerio.load(response.data);
      const headlines: string[] = [];
      
      // Extract news headlines
      $('h3 a, .Fw\\(b\\) a, [data-testid*="headline"]').each((i, element) => {
        const headline = $(element).text().trim();
        if (headline && headline.length > 10) {
          headlines.push(headline);
        }
      });

      return headlines.slice(0, 10); // Return top 10 headlines
    } catch (error) {
      console.error(`Error scraping news for ${symbol}:`, error);
      return [];
    }
  }

  static async scrapeSectorPerformance(): Promise<Array<{name: string, change: number}>> {
    try {
      const url = 'https://finance.yahoo.com/sectors';
      const response = await axios.get(url, { 
        headers: this.HEADERS,
        timeout: 10000
      });
      
      const $ = cheerio.load(response.data);
      const sectors: Array<{name: string, change: number}> = [];
      
      // Extract sector performance data
      $('tr').each((i, element) => {
        const name = $(element).find('td:first-child a').text().trim();
        const changeText = $(element).find('td:nth-child(3)').text().trim();
        
        if (name && changeText) {
          const change = parseFloat(changeText.replace('%', ''));
          if (!isNaN(change)) {
            sectors.push({ name, change });
          }
        }
      });

      // Return default sectors if scraping fails
      if (sectors.length === 0) {
        return [
          { name: 'Tech', change: 2.1 },
          { name: 'Energy', change: -0.8 },
          { name: 'Finance', change: 0.4 },
          { name: 'Health', change: 1.2 },
          { name: 'Retail', change: -0.3 },
          { name: 'AI/ML', change: 3.4 }
        ];
      }

      return sectors.slice(0, 6);
    } catch (error) {
      console.error('Error scraping sector performance:', error);
      return [
        { name: 'Tech', change: 2.1 },
        { name: 'Energy', change: -0.8 },
        { name: 'Finance', change: 0.4 },
        { name: 'Health', change: 1.2 },
        { name: 'Retail', change: -0.3 },
        { name: 'AI/ML', change: 3.4 }
      ];
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

  static async scrapeOptionsData(symbol: string): Promise<any> {
    try {
      const url = `${this.YAHOO_FINANCE_BASE}/quote/${symbol}/options`;
      const response = await axios.get(url, { 
        headers: this.HEADERS,
        timeout: 10000
      });
      
      const $ = cheerio.load(response.data);
      
      // Extract options chain data
      const options: any[] = [];
      
      $('table tr').each((i, element) => {
        if (i === 0) return; // Skip header
        
        const strike = $(element).find('td:nth-child(1)').text().trim();
        const lastPrice = $(element).find('td:nth-child(2)').text().trim();
        const bid = $(element).find('td:nth-child(3)').text().trim();
        const ask = $(element).find('td:nth-child(4)').text().trim();
        const volume = $(element).find('td:nth-child(5)').text().trim();
        const openInterest = $(element).find('td:nth-child(6)').text().trim();
        const impliedVolatility = $(element).find('td:nth-child(7)').text().trim();
        
        if (strike && lastPrice) {
          options.push({
            strike: parseFloat(strike),
            lastPrice: parseFloat(lastPrice),
            bid: parseFloat(bid) || 0,
            ask: parseFloat(ask) || 0,
            volume: parseInt(volume) || 0,
            openInterest: parseInt(openInterest) || 0,
            impliedVolatility: parseFloat(impliedVolatility.replace('%', '')) || 0
          });
        }
      });

      return options;
    } catch (error) {
      console.error(`Error scraping options data for ${symbol}:`, error);
      return [];
    }
  }
}
