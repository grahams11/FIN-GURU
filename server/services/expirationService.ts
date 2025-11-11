import axios from 'axios';

/**
 * ExpirationService - Provides option expiration dates with API-first, calculation-fallback strategy
 * 
 * Primary: Queries live option chains from Polygon (stocks) and Tastytrade (SPX)
 * Fallback: Uses calculated third Friday logic when APIs fail
 * Caching: 1-hour TTL to minimize API rate limit impact
 */

export interface ExpirationDate {
  date: string; // YYYY-MM-DD format
  daysToExpiration: number;
  expiryType: 'weekly' | 'monthly' | 'quarterly' | 'leap';
  source: 'polygon' | 'tastytrade' | 'calculated';
}

class ExpirationService {
  private cache: Map<string, { expirations: ExpirationDate[]; timestamp: number }> = new Map();
  private cacheTTL = 3600000; // 1 hour cache
  private polygonApiKey: string;
  private tastytradeBaseUrl = 'https://api.tastyworks.com';

  constructor() {
    this.polygonApiKey = process.env.POLYGON_API_KEY || '';
  }

  /**
   * Get available expiration dates for a symbol
   * Tries API first, falls back to calculation if API fails
   */
  async getExpirations(
    symbol: string,
    options: {
      minDays?: number;
      maxDays?: number;
      filterType?: 'weekly' | 'monthly' | 'all';
      sessionToken?: string; // For Tastytrade auth
    } = {}
  ): Promise<ExpirationDate[]> {
    const { minDays = 0, maxDays = 365, filterType = 'all' } = options;
    const cacheKey = `${symbol}_${minDays}_${maxDays}_${filterType}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log(`💾 Using cached expirations for ${symbol}`);
      return cached.expirations;
    }

    try {
      // Try Tastytrade for SPX (better for index options)
      if (symbol === 'SPX' && options.sessionToken) {
        const expirations = await this.fetchFromTastytrade(symbol, options.sessionToken, minDays, maxDays);
        if (expirations.length > 0) {
          this.cache.set(cacheKey, { expirations, timestamp: Date.now() });
          console.log(`✅ Fetched ${expirations.length} expirations for ${symbol} from Tastytrade API`);
          return this.filterByType(expirations, filterType);
        }
      }

      // Try Polygon for all symbols (fallback for SPX, primary for stocks)
      if (this.polygonApiKey) {
        const expirations = await this.fetchFromPolygon(symbol, minDays, maxDays);
        if (expirations.length > 0) {
          this.cache.set(cacheKey, { expirations, timestamp: Date.now() });
          console.log(`✅ Fetched ${expirations.length} expirations for ${symbol} from Polygon API`);
          return this.filterByType(expirations, filterType);
        }
      }

      // Fallback to calculated expirations
      console.warn(`⚠️ API calls failed for ${symbol}, using calculated expirations`);
      const expirations = this.calculateExpirations(minDays, maxDays);
      this.cache.set(cacheKey, { expirations, timestamp: Date.now() });
      return this.filterByType(expirations, filterType);

    } catch (error: any) {
      console.error(`❌ Error fetching expirations for ${symbol}:`, error.message);
      // Always provide fallback
      const expirations = this.calculateExpirations(minDays, maxDays);
      return this.filterByType(expirations, filterType);
    }
  }

  /**
   * Fetch expiration dates from Polygon API
   */
  private async fetchFromPolygon(symbol: string, minDays: number, maxDays: number): Promise<ExpirationDate[]> {
    try {
      const today = new Date();
      const minDate = new Date(today);
      minDate.setDate(today.getDate() + minDays);
      const maxDate = new Date(today);
      maxDate.setDate(today.getDate() + maxDays);

      const response = await axios.get(
        'https://api.polygon.io/v3/reference/options/contracts',
        {
          params: {
            underlying_ticker: symbol,
            'expiration_date.gte': this.formatDate(minDate),
            'expiration_date.lte': this.formatDate(maxDate),
            order: 'asc',
            sort: 'expiration_date',
            limit: 1000,
            apiKey: this.polygonApiKey
          },
          timeout: 10000
        }
      );

      if (!response.data?.results || response.data.results.length === 0) {
        console.warn(`⚠️ No Polygon option contracts found for ${symbol}`);
        return [];
      }

      // Extract unique expiration dates
      const expirationSet = new Set<string>();
      response.data.results.forEach((contract: any) => {
        if (contract.expiration_date) {
          expirationSet.add(contract.expiration_date);
        }
      });

      // Convert to ExpirationDate objects
      const expirations: ExpirationDate[] = Array.from(expirationSet)
        .sort()
        .map(dateStr => {
          const expiryDate = new Date(dateStr);
          const daysToExpiration = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          return {
            date: dateStr,
            daysToExpiration,
            expiryType: this.detectExpirationType(expiryDate),
            source: 'polygon' as const
          };
        });

      return expirations;

    } catch (error: any) {
      // Check for rate limiting
      if (error.response?.status === 429) {
        console.warn(`⚠️ Polygon API rate limit hit for ${symbol}`);
      } else {
        console.error(`❌ Polygon API error for ${symbol}:`, error.message);
      }
      return [];
    }
  }

  /**
   * Fetch expiration dates from Tastytrade API
   */
  private async fetchFromTastytrade(
    symbol: string,
    sessionToken: string,
    minDays: number,
    maxDays: number
  ): Promise<ExpirationDate[]> {
    try {
      const response = await axios.get(
        `${this.tastytradeBaseUrl}/option-chains/${symbol}/nested`,
        {
          headers: {
            'Authorization': sessionToken
          },
          timeout: 10000
        }
      );

      if (!response.data?.data?.items?.[0]?.expirations) {
        console.warn(`⚠️ No Tastytrade expirations found for ${symbol}`);
        return [];
      }

      const today = new Date();
      const expirations: ExpirationDate[] = response.data.data.items[0].expirations
        .map((exp: any) => {
          const expiryDate = new Date(exp['expiration-date']);
          const daysToExpiration = exp['days-to-expiration'] || 
            Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          return {
            date: exp['expiration-date'],
            daysToExpiration,
            expiryType: this.detectExpirationType(expiryDate),
            source: 'tastytrade' as const
          };
        })
        .filter((exp: ExpirationDate) => 
          exp.daysToExpiration >= minDays && exp.daysToExpiration <= maxDays
        )
        .sort((a: ExpirationDate, b: ExpirationDate) => a.daysToExpiration - b.daysToExpiration);

      return expirations;

    } catch (error: any) {
      console.error(`❌ Tastytrade API error for ${symbol}:`, error.message);
      return [];
    }
  }

  /**
   * Calculate expiration dates using third Friday logic (fallback)
   */
  private calculateExpirations(minDays: number, maxDays: number): ExpirationDate[] {
    const expirations: ExpirationDate[] = [];
    const today = new Date();

    // Generate next 12 months of third Friday expirations
    for (let i = 0; i < 12; i++) {
      const targetDate = new Date(today);
      targetDate.setMonth(today.getMonth() + i);
      
      const year = targetDate.getFullYear();
      const month = targetDate.getMonth();
      
      const thirdFriday = this.calculateThirdFriday(year, month);
      const daysToExpiration = Math.ceil((thirdFriday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Filter by days range
      if (daysToExpiration >= minDays && daysToExpiration <= maxDays) {
        expirations.push({
          date: this.formatDate(thirdFriday),
          daysToExpiration,
          expiryType: 'monthly',
          source: 'calculated'
        });
      }
    }

    return expirations.sort((a, b) => a.daysToExpiration - b.daysToExpiration);
  }

  /**
   * Calculate third Friday of a given month (with holiday handling)
   */
  private calculateThirdFriday(year: number, month: number): Date {
    // Start with the first day of the month
    const firstDay = new Date(year, month, 1);
    
    // Find the first Friday (day 5 is Friday, 0 is Sunday)
    const firstDayOfWeek = firstDay.getDay();
    let daysUntilFirstFriday = (5 - firstDayOfWeek + 7) % 7;
    if (daysUntilFirstFriday === 0) daysUntilFirstFriday = 0; // Already Friday
    
    // Third Friday = first Friday + 14 days
    const thirdFridayDate = 1 + daysUntilFirstFriday + 14;
    const thirdFriday = new Date(year, month, thirdFridayDate);
    
    // Check if third Friday is a market holiday (mainly Good Friday)
    if (this.isMarketHoliday(thirdFriday)) {
      // Move expiration to Thursday (day before)
      const thursday = new Date(thirdFriday);
      thursday.setDate(thursday.getDate() - 1);
      return thursday;
    }
    
    return thirdFriday;
  }

  /**
   * Check if a date is a known market holiday
   */
  private isMarketHoliday(date: Date): boolean {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    
    // Good Friday (most common third-Friday holiday)
    const easterDate = this.calculateEasterSunday(year);
    const goodFriday = new Date(easterDate);
    goodFriday.setDate(easterDate.getDate() - 2); // Friday before Easter Sunday
    
    if (year === goodFriday.getFullYear() && 
        month === goodFriday.getMonth() && 
        day === goodFriday.getDate()) {
      return true;
    }
    
    return false;
  }

  /**
   * Calculate Easter Sunday using Meeus/Jones/Butcher algorithm
   */
  private calculateEasterSunday(year: number): Date {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    
    return new Date(year, month, day);
  }

  /**
   * Detect expiration type based on date
   */
  private detectExpirationType(date: Date): 'weekly' | 'monthly' | 'quarterly' | 'leap' {
    const thirdFriday = this.calculateThirdFriday(date.getFullYear(), date.getMonth());
    const isThirdFriday = date.getDate() === thirdFriday.getDate();
    
    // LEAPS: More than 1 year out
    const daysAway = (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysAway > 365) {
      return 'leap';
    }
    
    // Quarterly: Third Friday in March, June, September, December
    if (isThirdFriday && [2, 5, 8, 11].includes(date.getMonth())) {
      return 'quarterly';
    }
    
    // Monthly: Third Friday of any month
    if (isThirdFriday) {
      return 'monthly';
    }
    
    // Weekly: Any other Friday
    return 'weekly';
  }

  /**
   * Filter expirations by type
   */
  private filterByType(expirations: ExpirationDate[], filterType: 'weekly' | 'monthly' | 'all'): ExpirationDate[] {
    if (filterType === 'all') {
      return expirations;
    }
    
    if (filterType === 'weekly') {
      // For day trading, prefer weeklies (1-7 days out)
      return expirations.filter(exp => exp.daysToExpiration <= 7);
    }
    
    if (filterType === 'monthly') {
      // For swing trading, prefer monthlies (>7 days out)
      return expirations.filter(exp => exp.expiryType === 'monthly' || exp.daysToExpiration > 7);
    }
    
    return expirations;
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.cache.clear();
    console.log('🗑️ ExpirationService cache cleared');
  }
}

export const expirationService = new ExpirationService();
