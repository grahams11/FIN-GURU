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

export class WebScraperService {
  private static readonly YAHOO_FINANCE_BASE = 'https://finance.yahoo.com';
  private static readonly HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  };

  static async scrapeMarketIndices(): Promise<MarketIndices> {
    try {
      const symbols = ['%5EGSPC', '%5EIXIC', '%5EVIX']; // S&P 500, NASDAQ, VIX
      const results = await Promise.allSettled(
        symbols.map(symbol => this.scrapeYahooFinance(symbol))
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
    try {
      return await this.scrapeYahooFinance(symbol);
    } catch (error) {
      console.error(`Error scraping ${symbol}:`, error);
      return this.getDefaultData(symbol);
    }
  }

  private static async scrapeYahooFinance(symbol: string): Promise<StockData> {
    const url = `${this.YAHOO_FINANCE_BASE}/quote/${symbol}`;
    
    try {
      const response = await axios.get(url, { 
        headers: this.HEADERS,
        timeout: 10000
      });
      
      const $ = cheerio.load(response.data);
      
      // Try multiple selectors for price
      let price = 0;
      const priceSelectors = [
        '[data-symbol="' + symbol.replace('%5E', '^') + '"] [data-field="regularMarketPrice"]',
        '[data-testid="qsp-price"]',
        '.Fw\\(b\\).Fz\\(36px\\)',
        '.Trsdu\\(0\\.3s\\).Fw\\(b\\).Fz\\(36px\\)'
      ];

      for (const selector of priceSelectors) {
        const priceText = $(selector).first().text().replace(/,/g, '');
        if (priceText && !isNaN(parseFloat(priceText))) {
          price = parseFloat(priceText);
          break;
        }
      }

      // Try multiple selectors for change
      let change = 0;
      let changePercent = 0;
      const changeSelectors = [
        '[data-symbol="' + symbol.replace('%5E', '^') + '"] [data-field="regularMarketChange"]',
        '[data-testid="qsp-price-change"]',
        '.Fw\\(500\\).Pstart\\(8px\\)'
      ];

      for (const selector of changeSelectors) {
        const changeText = $(selector).first().text();
        const match = changeText.match(/([+-]?\d+\.?\d*)\s*\(([+-]?\d+\.?\d*)%\)/);
        if (match) {
          change = parseFloat(match[1]);
          changePercent = parseFloat(match[2]);
          break;
        }
      }

      // Fallback: try to get volume
      let volume = undefined;
      const volumeSelectors = [
        '[data-symbol="' + symbol.replace('%5E', '^') + '"] [data-field="regularMarketVolume"]',
        '[data-testid="VOLUME-value"]'
      ];

      for (const selector of volumeSelectors) {
        const volumeText = $(selector).first().text().replace(/,/g, '');
        if (volumeText && !isNaN(parseInt(volumeText))) {
          volume = parseInt(volumeText);
          break;
        }
      }

      return {
        symbol: symbol.replace('%5E', '^'),
        price,
        change,
        changePercent,
        volume
      };
    } catch (error) {
      throw new Error(`Failed to scrape Yahoo Finance for ${symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
