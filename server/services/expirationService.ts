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

  // Circuit breaker for rate limiting (429 responses)
  private rateLimitBackoff: Map<string, { count: number; backoffUntil: number }> = new Map();
  private maxRetries = 3;
  private baseBackoffMs = 5000; // 5 seconds

  constructor() {
    this.polygonApiKey = process.env.POLYGON_API_KEY || '';
  }

  /**
   * Check if service is in backoff for a given API provider
   */
  private isInBackoff(provider: 'polygon' | 'tastytrade'): boolean {
    const backoffData = this.rateLimitBackoff.get(provider);
    if (!backoffData) return false;

    if (Date.now() < backoffData.backoffUntil) {
      console.warn(`⏳ [ExpirationService] ${provider} in backoff until ${new Date(backoffData.backoffUntil).toISOString()}`);
      return true;
    }

    // Backoff expired, reset
    this.rateLimitBackoff.delete(provider);
    return false;
  }

  /**
   * Record rate limit hit and apply exponential backoff
   */
  private recordRateLimit(provider: 'polygon' | 'tastytrade'): void {
    const backoffData = this.rateLimitBackoff.get(provider) || { count: 0, backoffUntil: 0 };
    backoffData.count++;
    
    // Exponential backoff: 5s, 10s, 20s, 40s...
    const backoffMs = this.baseBackoffMs * Math.pow(2, backoffData.count - 1);
    backoffData.backoffUntil = Date.now() + backoffMs;
    
    this.rateLimitBackoff.set(provider, backoffData);
    console.warn(`⚠️ [ExpirationService] ${provider} rate limit hit ${backoffData.count} times, backing off for ${backoffMs}ms`);
  }

  /**
   * Clear rate limit backoff (on success)
   */
  private clearRateLimit(provider: 'polygon' | 'tastytrade'): void {
    if (this.rateLimitBackoff.has(provider)) {
      this.rateLimitBackoff.delete(provider);
      console.log(`✅ [ExpirationService] ${provider} rate limit backoff cleared`);
    }
  }

  /**
   * Get available expiration dates for a symbol
   * Unions multiple API sources, dedupes, and falls back to calculation if APIs fail
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
      console.log(`💾 [ExpirationService] Cache hit for ${symbol}`);
      this.logMetrics('cache_hit', symbol);
      return cached.expirations;
    }

    this.logMetrics('cache_miss', symbol);

    try {
      const allExpirations: ExpirationDate[] = [];

      // Try Tastytrade for SPX (better for index options)
      if (symbol === 'SPX' && options.sessionToken && !this.isInBackoff('tastytrade')) {
        const tastyExpirations = await this.fetchFromTastytrade(symbol, options.sessionToken, minDays, maxDays);
        if (tastyExpirations.length > 0) {
          allExpirations.push(...tastyExpirations);
          this.clearRateLimit('tastytrade'); // Success, clear any backoff
          this.logMetrics('tastytrade_success', symbol, tastyExpirations.length);
          console.log(`✅ [ExpirationService] Tastytrade: ${tastyExpirations.length} expirations for ${symbol}`);
        } else {
          this.logMetrics('tastytrade_empty', symbol);
        }
      }

      // Try Polygon for all symbols (union with Tastytrade for SPX)
      if (this.polygonApiKey && !this.isInBackoff('polygon')) {
        const polygonExpirations = await this.fetchFromPolygon(symbol, minDays, maxDays);
        if (polygonExpirations.length > 0) {
          allExpirations.push(...polygonExpirations);
          this.clearRateLimit('polygon'); // Success, clear any backoff
          this.logMetrics('polygon_success', symbol, polygonExpirations.length);
          console.log(`✅ [ExpirationService] Polygon: ${polygonExpirations.length} expirations for ${symbol}`);
        } else {
          this.logMetrics('polygon_empty', symbol);
        }
      }

      // Union and dedupe API results
      if (allExpirations.length > 0) {
        const dedupedExpirations = this.dedupeExpirations(allExpirations);
        const filteredExpirations = this.filterByType(dedupedExpirations, filterType);
        
        // Cache the FILTERED results (cache key includes filterType)
        this.cache.set(cacheKey, { expirations: filteredExpirations, timestamp: Date.now() });
        console.log(`✅ [ExpirationService] Combined ${allExpirations.length} → ${dedupedExpirations.length} unique → ${filteredExpirations.length} filtered (${filterType})`);
        return filteredExpirations;
      }

      // Fallback to calculated expirations (already filtered by filterType)
      console.warn(`⚠️ [ExpirationService] API calls failed for ${symbol}, using calculated expirations`);
      this.logMetrics('fallback_triggered', symbol);
      const expirations = this.calculateExpirations(minDays, maxDays, filterType);
      
      // Cache the filtered fallback results
      this.cache.set(cacheKey, { expirations, timestamp: Date.now() });
      return expirations;

    } catch (error: any) {
      console.error(`❌ [ExpirationService] Error for ${symbol}:`, error.message);
      this.logMetrics('error', symbol);
      // Always provide fallback
      const expirations = this.calculateExpirations(minDays, maxDays, filterType);
      return expirations;
    }
  }

  /**
   * Fetch expiration dates from Polygon API (with pagination support)
   */
  private async fetchFromPolygon(symbol: string, minDays: number, maxDays: number): Promise<ExpirationDate[]> {
    try {
      const today = new Date();
      const minDate = new Date(today);
      minDate.setDate(today.getDate() + minDays);
      const maxDate = new Date(today);
      maxDate.setDate(today.getDate() + maxDays);

      const expirationSet = new Set<string>();
      let nextUrl: string | null = `https://api.polygon.io/v3/reference/options/contracts`;
      let pageCount = 0;
      const maxPages = 10; // Safety limit to prevent infinite loops

      // Paginate through all results
      while (nextUrl && pageCount < maxPages) {
        const response: any = await axios.get(nextUrl, {
          params: pageCount === 0 ? {
            underlying_ticker: symbol,
            'expiration_date.gte': this.formatDate(minDate),
            'expiration_date.lte': this.formatDate(maxDate),
            order: 'asc',
            sort: 'expiration_date',
            limit: 1000,
            apiKey: this.polygonApiKey
          } : { apiKey: this.polygonApiKey }, // next_url already has params
          timeout: 10000
        });

        if (!response.data?.results || response.data.results.length === 0) {
          break;
        }

        // Extract unique expiration dates from this page
        response.data.results.forEach((contract: any) => {
          if (contract.expiration_date) {
            expirationSet.add(contract.expiration_date);
          }
        });

        // Check for next page
        nextUrl = response.data.next_url || null;
        pageCount++;
        
        if (nextUrl) {
          console.log(`📄 [ExpirationService] Polygon pagination: page ${pageCount} fetched, continuing...`);
        }
      }

      if (expirationSet.size === 0) {
        console.warn(`⚠️ No Polygon option contracts found for ${symbol}`);
        return [];
      }

      console.log(`✅ [ExpirationService] Polygon: ${expirationSet.size} unique expirations from ${pageCount} pages`);

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
        this.recordRateLimit('polygon');
        this.logMetrics('polygon_rate_limit', symbol);
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
      // Check for rate limiting
      if (error.response?.status === 429) {
        this.recordRateLimit('tastytrade');
        this.logMetrics('tastytrade_rate_limit', symbol);
      } else {
        console.error(`❌ Tastytrade API error for ${symbol}:`, error.message);
      }
      return [];
    }
  }

  /**
   * Calculate expiration dates using Friday logic (fallback)
   * Includes BOTH weeklies (next 8 weeks) AND monthlies (next 12 months)
   */
  private calculateExpirations(minDays: number, maxDays: number, filterType: 'weekly' | 'monthly' | 'all'): ExpirationDate[] {
    const expirations: ExpirationDate[] = [];
    const today = new Date();

    // Generate weekly Fridays for next 8 weeks (for day trading)
    if (filterType === 'all' || filterType === 'weekly') {
      for (let i = 0; i < 8; i++) {
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + (i * 7));
        
        // Find next Friday from target date
        const daysUntilFriday = (5 - targetDate.getDay() + 7) % 7;
        const friday = new Date(targetDate);
        friday.setDate(targetDate.getDate() + daysUntilFriday);
        
        const daysToExpiration = Math.ceil((friday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        // Filter by days range
        if (daysToExpiration >= minDays && daysToExpiration <= maxDays && daysToExpiration > 0) {
          expirations.push({
            date: this.formatDate(friday),
            daysToExpiration,
            expiryType: 'weekly',
            source: 'calculated'
          });
        }
      }
    }

    // Generate monthly third Friday expirations for next 12 months (for swing trading)
    if (filterType === 'all' || filterType === 'monthly') {
      for (let i = 0; i < 12; i++) {
        const targetDate = new Date(today);
        targetDate.setMonth(today.getMonth() + i);
        
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth();
        
        const thirdFriday = this.calculateThirdFriday(year, month);
        const daysToExpiration = Math.ceil((thirdFriday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        // Filter by days range
        if (daysToExpiration >= minDays && daysToExpiration <= maxDays && daysToExpiration > 0) {
          expirations.push({
            date: this.formatDate(thirdFriday),
            daysToExpiration,
            expiryType: 'monthly',
            source: 'calculated'
          });
        }
      }
    }

    // Dedupe and sort
    return this.dedupeExpirations(expirations);
  }

  /**
   * Deduplicate expirations by date, preferring API sources over calculated
   */
  private dedupeExpirations(expirations: ExpirationDate[]): ExpirationDate[] {
    const dateMap = new Map<string, ExpirationDate>();

    // Sort by source priority: tastytrade > polygon > calculated
    const sourcePriority = { tastytrade: 3, polygon: 2, calculated: 1 };
    
    for (const exp of expirations) {
      const existing = dateMap.get(exp.date);
      if (!existing || sourcePriority[exp.source] > sourcePriority[existing.source]) {
        dateMap.set(exp.date, exp);
      }
    }

    // Convert back to array and sort by days to expiration
    return Array.from(dateMap.values()).sort((a, b) => a.daysToExpiration - b.daysToExpiration);
  }

  /**
   * Log metrics for monitoring API usage, cache hits, and fallback triggers
   */
  private logMetrics(event: string, symbol: string, count?: number): void {
    const timestamp = new Date().toISOString();
    const logMessage = count !== undefined 
      ? `[ExpirationService] ${timestamp} - ${event}: ${symbol} (${count} items)`
      : `[ExpirationService] ${timestamp} - ${event}: ${symbol}`;
    
    // Console logging for now - can be replaced with proper metrics system
    console.log(logMessage);
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
   * Handles mid-week weeklies (common on SPX), Friday weeklies, and monthly/quarterly expirations
   */
  private detectExpirationType(date: Date): 'weekly' | 'monthly' | 'quarterly' | 'leap' {
    // LEAPS: More than 1 year out
    const daysAway = (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysAway > 365) {
      return 'leap';
    }
    
    // Check if this is the third Friday of the month
    const thirdFriday = this.calculateThirdFriday(date.getFullYear(), date.getMonth());
    const isThirdFriday = date.getFullYear() === thirdFriday.getFullYear() &&
                          date.getMonth() === thirdFriday.getMonth() &&
                          date.getDate() === thirdFriday.getDate();
    
    // Quarterly: Third Friday in March, June, September, December
    if (isThirdFriday && [2, 5, 8, 11].includes(date.getMonth())) {
      return 'quarterly';
    }
    
    // Monthly: Third Friday of any month
    if (isThirdFriday) {
      return 'monthly';
    }
    
    // Weekly: Any other day (includes mid-week expirations Mon-Thu and non-monthly Fridays)
    // SPX commonly has Monday/Wednesday/Friday weeklies
    return 'weekly';
  }

  /**
   * Filter expirations by type (strictly based on expiryType classification)
   */
  private filterByType(expirations: ExpirationDate[], filterType: 'weekly' | 'monthly' | 'all'): ExpirationDate[] {
    if (filterType === 'all') {
      return expirations;
    }
    
    if (filterType === 'weekly') {
      // Strictly weeklies only (not monthlies/quarterlies within 7 days)
      return expirations.filter(exp => exp.expiryType === 'weekly');
    }
    
    if (filterType === 'monthly') {
      // Monthlies, quarterlies, and LEAPs (not weeklies)
      return expirations.filter(exp => 
        exp.expiryType === 'monthly' || 
        exp.expiryType === 'quarterly' || 
        exp.expiryType === 'leap'
      );
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
