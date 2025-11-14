/**
 * Time Utilities for Market Hours and Overnight Detection
 * 
 * Centralized CST/CDT-aware time handling for scanners.
 * Handles DST transitions correctly.
 */

export class TimeUtils {
  /**
   * Check if we're currently in overnight hours (3:01 PM - 8:29 AM CST/CDT)
   * Overnight = after market close but before market open
   */
  static isOvernightHours(): boolean {
    const now = new Date();
    
    // Get CST/CDT hour (handles DST automatically)
    const cstHour = parseInt(now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      hour12: false
    }));
    
    const cstMinute = parseInt(now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      minute: 'numeric'
    }));
    
    // After 3:01 PM CST/CDT or before 8:30 AM CST/CDT
    const isAfter3PM = (cstHour > 15) || (cstHour === 15 && cstMinute >= 1);
    const isBefore830AM = (cstHour < 8) || (cstHour === 8 && cstMinute < 30);
    return isAfter3PM || isBefore830AM;
  }
  
  /**
   * Get today's date in YYYY-MM-DD format (CST/CDT timezone)
   */
  static getTodayDateCST(): string {
    const now = new Date();
    const parts = now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).split('/'); // Returns [MM, DD, YYYY]
    return `${parts[2]}-${parts[0]}-${parts[1]}`; // YYYY-MM-DD
  }
  
  /**
   * Get overnight time window (3:00 PM - 7:00 PM CST/CDT today)
   * Returns datetime strings for Polygon API
   */
  static getOvernightWindow(): { from: string; to: string } {
    const dateStr = this.getTodayDateCST();
    return {
      from: `${dateStr} 15:00:00`,
      to: `${dateStr} 19:00:00`
    };
  }
  
  /**
   * Convert CST/CDT datetime string to milliseconds (epoch)
   * Uses Intl API for proper timezone handling
   * 
   * @param cstDateTime - Datetime string in format "YYYY-MM-DD HH:MM:SS" (CST/CDT)
   * @returns Milliseconds since epoch
   * 
   * @example
   * // Winter (CST = UTC-6): "2025-01-15 15:00:00" → 1736967600000 (21:00 UTC)
   * // Summer (CDT = UTC-5): "2025-07-15 15:00:00" → 1752685200000 (20:00 UTC)
   */
  static cstDateTimeToMs(cstDateTime: string): number {
    // Parse CST datetime components
    const [datePart, timePart] = cstDateTime.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second] = timePart.split(':').map(Number);
    
    // Create a Date object as if it were in CST/CDT
    // First, build the date string that toLocaleString in Chicago TZ would produce
    const testDate = new Date(year, month - 1, day, hour, minute, second);
    
    // Get what this date/time looks like in UTC
    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    
    // Get what time it is in Chicago for this UTC moment
    const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const chicagoParts = chicagoFormatter.formatToParts(new Date(utcMs));
    const chicagoTime = {
      year: parseInt(chicagoParts.find(p => p.type === 'year')!.value),
      month: parseInt(chicagoParts.find(p => p.type === 'month')!.value),
      day: parseInt(chicagoParts.find(p => p.type === 'day')!.value),
      hour: parseInt(chicagoParts.find(p => p.type === 'hour')!.value),
      minute: parseInt(chicagoParts.find(p => p.type === 'minute')!.value),
      second: parseInt(chicagoParts.find(p => p.type === 'second')!.value)
    };
    
    // Calculate the offset
    const chicagoMs = Date.UTC(
      chicagoTime.year,
      chicagoTime.month - 1,
      chicagoTime.day,
      chicagoTime.hour,
      chicagoTime.minute,
      chicagoTime.second
    );
    
    const offset = utcMs - chicagoMs;
    
    // Apply the offset to convert CST input to UTC
    const inputUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    return inputUtcMs + offset;
  }
  
  /**
   * Check if market is currently open (8:30 AM - 3:00 PM CST/CDT weekdays)
   */
  static isMarketOpen(): boolean {
    const now = new Date();
    
    const cstHour = parseInt(now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      hour12: false
    }));
    
    const cstMinute = parseInt(now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      minute: 'numeric'
    }));
    
    const dayOfWeek = now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short'
    });
    
    // Weekdays only
    if (dayOfWeek === 'Sat' || dayOfWeek === 'Sun') {
      return false;
    }
    
    // 8:30 AM - 3:00 PM CST/CDT
    const isAfterOpen = (cstHour === 8 && cstMinute >= 30) || cstHour > 8;
    const isBeforeClose = cstHour < 15;
    
    return isAfterOpen && isBeforeClose;
  }
}
