import { Ghost1DTEService } from './ghost1DTE';

/**
 * Ghost 1DTE Market Timing Scheduler
 * Auto-triggers scan in 3:00-4:00pm EST window for overnight setups
 * Tracks 9:32am exit window next day
 * Skips weekends and US market holidays
 */

export class GhostScheduler {
  private static scanInterval: NodeJS.Timeout | null = null;
  private static isMarketHours = false;
  private static lastScanResult: any = null;
  private static scanHistory: Array<{ timestamp: string; result: any }> = [];
  
  /**
   * Get nth weekday of month (e.g., 3rd Monday)
   */
  private static getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
    const firstDay = new Date(year, month, 1);
    const firstWeekday = firstDay.getDay();
    const offset = (weekday - firstWeekday + 7) % 7;
    const day = 1 + offset + (n - 1) * 7;
    return new Date(year, month, day);
  }
  
  /**
   * Get last weekday of month
   */
  private static getLastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
    const lastDay = new Date(year, month + 1, 0);
    const lastDayOfWeek = lastDay.getDay();
    const offset = (lastDayOfWeek - weekday + 7) % 7;
    return new Date(year, month, lastDay.getDate() - offset);
  }
  
  /**
   * Calculate Easter Sunday using Meeus/Jones/Butcher algorithm
   */
  private static getEaster(year: number): Date {
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
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
  }
  
  /**
   * Adjust holiday to nearest weekday if it falls on weekend
   * NYSE Rules: Saturday → Friday, Sunday → Monday
   */
  private static adjustForWeekend(date: Date): Date {
    const day = date.getDay();
    if (day === 0) { // Sunday → observe on Monday
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    } else if (day === 6) { // Saturday → observe on Friday
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
    }
    return date;
  }
  
  /**
   * Calculate all US market holidays for a given year
   * Works for any year - no hard-coded dates
   */
  private static getMarketHolidaysForYear(year: number): Date[] {
    const holidays: Date[] = [];
    
    // New Year's Day (Jan 1, adjusted for weekends)
    holidays.push(this.adjustForWeekend(new Date(year, 0, 1)));
    
    // MLK Day (3rd Monday in January)
    holidays.push(this.getNthWeekdayOfMonth(year, 0, 1, 3));
    
    // Presidents' Day (3rd Monday in February)
    holidays.push(this.getNthWeekdayOfMonth(year, 1, 1, 3));
    
    // Good Friday (Friday before Easter)
    const easter = this.getEaster(year);
    const goodFriday = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2);
    holidays.push(goodFriday);
    
    // Memorial Day (Last Monday in May)
    holidays.push(this.getLastWeekdayOfMonth(year, 4, 1));
    
    // Juneteenth (June 19, adjusted for weekends)
    holidays.push(this.adjustForWeekend(new Date(year, 5, 19)));
    
    // Independence Day (July 4, adjusted for weekends)
    holidays.push(this.adjustForWeekend(new Date(year, 6, 4)));
    
    // Labor Day (1st Monday in September)
    holidays.push(this.getNthWeekdayOfMonth(year, 8, 1, 1));
    
    // Thanksgiving (4th Thursday in November)
    holidays.push(this.getNthWeekdayOfMonth(year, 10, 4, 4));
    
    // Christmas (Dec 25, adjusted for weekends)
    holidays.push(this.adjustForWeekend(new Date(year, 11, 25)));
    
    return holidays;
  }
  
  /**
   * Start the Ghost scheduler
   * Checks every minute if we're in the 3:00-4:00pm EST window
   */
  static start(): void {
    console.log('👻 Starting Ghost 1DTE scheduler...');
    
    // Check immediately on startup
    this.checkMarketTiming();
    
    // Check every 30 seconds
    this.scanInterval = setInterval(() => {
      this.checkMarketTiming();
    }, 30000); // 30 seconds
    
    console.log('✅ Ghost scheduler active - monitoring 3:00-4:00pm EST window');
  }
  
  /**
   * Stop the scheduler
   */
  static stop(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
      console.log('🛑 Ghost scheduler stopped');
    }
  }
  
  /**
   * Check if today is a US market holiday (works for any year)
   * Checks current year + adjacent years for cross-year observances
   * (e.g., New Year's Day on Saturday → observed Friday Dec 31 prior year)
   */
  private static isMarketHoliday(date: Date): boolean {
    const year = date.getFullYear();
    
    // Check holidays for current year + adjacent years to catch cross-year observances
    const allHolidays = [
      ...this.getMarketHolidaysForYear(year - 1),
      ...this.getMarketHolidaysForYear(year),
      ...this.getMarketHolidaysForYear(year + 1),
    ];
    
    const dateString = date.toISOString().split('T')[0];
    return allHolidays.some(holiday => {
      const holidayString = holiday.toISOString().split('T')[0];
      return holidayString === dateString;
    });
  }
  
  /**
   * Check if we're in the scan window and trigger if needed
   */
  private static async checkMarketTiming(): Promise<void> {
    try {
      const now = new Date();
      const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hour = estTime.getHours();
      const minute = estTime.getMinutes();
      const dayOfWeek = estTime.getDay(); // 0 = Sunday, 6 = Saturday
      
      // Skip weekends
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        return;
      }
      
      // Skip market holidays
      if (this.isMarketHoliday(estTime)) {
        console.log(`📅 Skipping scan - Market holiday: ${estTime.toISOString().split('T')[0]}`);
        return;
      }
      
      // Market close window: 3:00pm - 4:00pm EST
      const inScanWindow = hour === 15 || (hour === 16 && minute === 0);
      
      // Only trigger scan once when entering window
      if (inScanWindow && !this.isMarketHours) {
        this.isMarketHours = true;
        console.log(`\n🔔 Ghost scan window OPEN (${estTime.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} EST)`);
        await this.runAutomatedScan();
      } else if (!inScanWindow && this.isMarketHours) {
        this.isMarketHours = false;
        console.log(`\n🔕 Ghost scan window CLOSED (${estTime.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} EST)`);
      }
      
    } catch (error) {
      console.error('❌ Error in Ghost scheduler:', error);
    }
  }
  
  /**
   * Run automated scan with API call tracking and timing
   */
  private static async runAutomatedScan(): Promise<void> {
    try {
      console.log('👻 ========== AUTOMATED GHOST 1DTE SCAN ==========');
      const scanStartTime = Date.now();
      
      // Initialize scanner if not already done
      await Ghost1DTEService.initialize();
      
      // Run scan
      const result = await Ghost1DTEService.scan();
      
      const scanTime = Date.now() - scanStartTime;
      
      // Store result
      this.lastScanResult = {
        ...result,
        scanTime,
        timestamp: new Date().toISOString(),
        automated: true
      };
      
      // Add to history (keep last 10)
      this.scanHistory.push({
        timestamp: new Date().toISOString(),
        result: this.lastScanResult
      });
      if (this.scanHistory.length > 10) {
        this.scanHistory.shift();
      }
      
      // Log performance
      console.log(`\n👻 ========== AUTOMATED SCAN COMPLETE ==========`);
      console.log(`⚡ Scan time: ${scanTime}ms (${(scanTime / 1000).toFixed(2)}s)`);
      console.log(`📡 API calls: ${result.apiCalls}/4`);
      console.log(`🎯 Top plays found: ${result.topPlays.length}`);
      
      // Performance warnings
      if (scanTime > 700) {
        console.warn(`⚠️ Scan time ${scanTime}ms exceeds 0.7s target`);
      }
      if (result.apiCalls > 4) {
        console.warn(`⚠️ API calls ${result.apiCalls} exceeds limit of 4`);
      }
      
      // Display top plays
      if (result.topPlays.length > 0) {
        console.log(`\n📊 TOP ${result.topPlays.length} OVERNIGHT PLAYS:`);
        result.topPlays.forEach((play: any, index: number) => {
          console.log(`\n#${index + 1} - ${play.symbol} ${play.strike}${play.optionType === 'call' ? 'C' : 'P'} @ $${play.premium.toFixed(2)}`);
          console.log(`   Score: ${play.scores.compositeScore.toFixed(1)}/100 | VRP: ${play.scores.vrpScore.toFixed(1)} | Theta: ${play.scores.thetaCrush.toFixed(1)}%`);
          console.log(`   Target: $${play.targetPremium.toFixed(2)} (+78%) | Stop: $${play.stopPremium.toFixed(2)} (-22%)`);
          console.log(`   Win Rate: ${play.historicalWinRate.toFixed(1)}%`);
        });
      } else {
        console.log('📊 No plays found matching criteria');
      }
      
      console.log('============================================\n');
      
    } catch (error) {
      console.error('❌ Automated Ghost scan failed:', error);
    }
  }
  
  /**
   * Get last scan result (for API endpoint)
   */
  static getLastScanResult(): any {
    return this.lastScanResult;
  }
  
  /**
   * Get scan history
   */
  static getScanHistory(): Array<{ timestamp: string; result: any }> {
    return this.scanHistory;
  }
  
  /**
   * Get scheduler status
   */
  static getStatus(): {
    isActive: boolean;
    isMarketHours: boolean;
    lastScan: string | null;
    scanCount: number;
  } {
    return {
      isActive: this.scanInterval !== null,
      isMarketHours: this.isMarketHours,
      lastScan: this.lastScanResult?.timestamp || null,
      scanCount: this.scanHistory.length
    };
  }
}
