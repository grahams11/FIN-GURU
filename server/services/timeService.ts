/**
 * Time Service - Accurate time synchronization using NTP
 * 
 * Industry-standard time synchronization using @hapi/sntp library.
 * Syncs with Google's NTP servers for accurate time regardless of system clock.
 * 
 * Usage:
 *   const now = await timeService.getCurrentTime(); // Accurate Date object
 *   const cstTime = await timeService.getCurrentCST(); // CST-formatted time
 */

import Sntp from '@hapi/sntp';

interface SntpTimeResult {
  t: number; // Time offset in milliseconds
}

export class TimeService {
  private ntpOffset: number = 0;
  private manualOffset: number = 0; // Manual offset for environments with blocked external access
  private manualOffsetSource: string = 'none'; // Track where manual offset came from
  private lastSyncTime: number = 0;
  private syncInterval: number = 60 * 60 * 1000; // Sync every 60 minutes
  private isSyncing: boolean = false;
  private externalSyncFailed: boolean = false; // Stop retrying after multiple failures

  /**
   * NTP servers to use (in priority order)
   */
  private ntpServers = [
    'time.google.com',    // Google's NTP (most reliable)
    'pool.ntp.org',       // Global NTP pool
    'time.cloudflare.com' // Cloudflare's NTP
  ];

  constructor() {
    // Initial sync on startup
    this.syncTime();
  }

  /**
   * Sync time with WorldTimeAPI (HTTP-based time service)
   * Fallback to NTP if available, but Replit blocks UDP port 123
   */
  private async syncTime(): Promise<void> {
    if (this.isSyncing) {
      return;
    }

    this.isSyncing = true;

    try {
      // Primary: WorldTimeAPI (HTTP-based, works in Replit)
      try {
        const response = await fetch('http://worldtimeapi.org/api/timezone/America/Chicago');
        if (response.ok) {
          const data = await response.json();
          const serverTime = new Date(data.utc_datetime).getTime();
          const localTime = Date.now();
          this.ntpOffset = serverTime - localTime;
          this.lastSyncTime = localTime;

          // Clear manual offset when external sync succeeds
          if (this.manualOffset !== 0) {
            console.log(`⚠️ External sync successful - clearing manual offset (was ${this.manualOffset}ms)`);
            this.manualOffset = 0;
            this.manualOffsetSource = 'none';
          }

          console.log(`⏰ Time synced with WorldTimeAPI`);
          console.log(`   System time: ${new Date(localTime).toISOString()}`);
          console.log(`   Accurate time: ${new Date(serverTime).toISOString()}`);
          console.log(`   Offset: ${this.ntpOffset}ms (${(this.ntpOffset / 1000 / 60).toFixed(2)} minutes)`);
          console.log(`   CST Time: ${data.datetime}`);
          
          return; // Success
        }
      } catch (error: any) {
        console.warn(`⚠️ WorldTimeAPI sync failed: ${error.message}`);
      }

      // Fallback: Try NTP servers (may not work in Replit due to UDP port 123 blocking)
      for (const host of this.ntpServers) {
        try {
          const time = await (Sntp as any).time({
            host,
            port: 123,
            timeout: 5000
          }) as SntpTimeResult;

          this.ntpOffset = time.t; // Time offset in milliseconds
          this.lastSyncTime = Date.now();

          console.log(`⏰ Time synced with ${host} (NTP)`);
          console.log(`   System time: ${new Date(Date.now()).toISOString()}`);
          console.log(`   Accurate time: ${new Date(Date.now() + this.ntpOffset).toISOString()}`);
          console.log(`   Offset: ${this.ntpOffset}ms (${(this.ntpOffset / 1000 / 60).toFixed(2)} minutes)`);

          return; // Success, exit
        } catch (error: any) {
          console.warn(`⚠️ Failed to sync with ${host}: ${error.message}`);
          // Try next server
        }
      }
      
      console.error('❌ Time sync failed with all sources (WorldTimeAPI + NTP)');
      this.externalSyncFailed = true;
      console.log('💡 Use POST /api/time-offset to set manual time offset');
    } catch (error: any) {
      console.error('❌ Time sync error:', error.message);
      this.externalSyncFailed = true;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Get current accurate time (Date object)
   */
  async getCurrentTime(): Promise<Date> {
    // Re-sync if needed
    const timeSinceLastSync = Date.now() - this.lastSyncTime;
    if (timeSinceLastSync > this.syncInterval) {
      await this.syncTime();
    }

    // Return accurate time with stacked offsets applied (NTP + manual)
    return new Date(Date.now() + this.ntpOffset + this.manualOffset);
  }

  /**
   * Get current time in milliseconds
   */
  async getCurrentTimestamp(): Promise<number> {
    const time = await this.getCurrentTime();
    return time.getTime();
  }

  /**
   * Get current time in CST timezone
   * Returns formatted string: "2025-11-13 6:45:32 AM CST"
   */
  async getCurrentCST(): Promise<string> {
    const now = await this.getCurrentTime();
    
    // Convert to CST (UTC-6)
    const cstTime = new Date(now.toLocaleString('en-US', { 
      timeZone: 'America/Chicago' 
    }));

    const hours = cstTime.getHours();
    const minutes = cstTime.getMinutes().toString().padStart(2, '0');
    const seconds = cstTime.getSeconds().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;

    const year = cstTime.getFullYear();
    const month = (cstTime.getMonth() + 1).toString().padStart(2, '0');
    const day = cstTime.getDate().toString().padStart(2, '0');

    return `${year}-${month}-${day} ${displayHours}:${minutes}:${seconds} ${ampm} CST`;
  }

  /**
   * Get CST hour (0-23) for time window detection
   */
  async getCSTHour(): Promise<number> {
    const now = await this.getCurrentTime();
    const cstTime = new Date(now.toLocaleString('en-US', { 
      timeZone: 'America/Chicago' 
    }));
    return cstTime.getHours();
  }

  /**
   * Get CST minute (0-59)
   */
  async getCSTMinute(): Promise<number> {
    const now = await this.getCurrentTime();
    const cstTime = new Date(now.toLocaleString('en-US', { 
      timeZone: 'America/Chicago' 
    }));
    return cstTime.getMinutes();
  }

  /**
   * Check if current time is within Ghost scan window (2-3 PM CST)
   */
  async isInScanWindow(): Promise<boolean> {
    const hour = await this.getCSTHour();
    return hour >= 14 && hour < 15; // 14:00-14:59 (2-3 PM CST)
  }

  /**
   * Get time until next scan window (in milliseconds)
   */
  async getTimeUntilNextScan(): Promise<number> {
    const hour = await this.getCSTHour();
    const minute = await this.getCSTMinute();
    
    let hoursUntilScan: number;
    
    if (hour < 14) {
      // Before scan window today
      hoursUntilScan = 14 - hour;
    } else {
      // After scan window, wait until tomorrow
      hoursUntilScan = (24 - hour) + 14;
    }
    
    const minutesUntilScan = (hoursUntilScan * 60) - minute;
    return minutesUntilScan * 60 * 1000;
  }

  /**
   * Force immediate time sync
   */
  async forceSync(): Promise<void> {
    await this.syncTime();
  }

  /**
   * Get sync status
   */
  getSyncStatus(): {
    isHealthy: boolean;
    lastSyncTime: number;
    offset: number;
    timeSinceSync: number;
  } {
    const timeSinceSync = Date.now() - this.lastSyncTime;
    return {
      isHealthy: timeSinceSync < this.syncInterval * 2, // Healthy if synced within 2x interval
      lastSyncTime: this.lastSyncTime,
      offset: this.ntpOffset,
      timeSinceSync
    };
  }

  /**
   * Set manual time offset (for environments with blocked external time sources)
   * @param referenceTimestampUtc - The actual current time in UTC (from browser or manual entry)
   * @param source - Source of the offset ('browser' or 'manual')
   */
  setManualOffset(referenceTimestampUtc: number, source: string = 'manual'): void {
    const systemTime = Date.now();
    this.manualOffset = referenceTimestampUtc - systemTime - this.ntpOffset;
    this.manualOffsetSource = source;
    
    console.log(`⏰ Manual time offset set from ${source}`);
    console.log(`   System time: ${new Date(systemTime).toISOString()}`);
    console.log(`   Reference time: ${new Date(referenceTimestampUtc).toISOString()}`);
    console.log(`   Manual offset: ${this.manualOffset}ms (${(this.manualOffset / 1000 / 60).toFixed(2)} minutes)`);
    console.log(`   Effective time: ${new Date(systemTime + this.ntpOffset + this.manualOffset).toISOString()}`);
  }

  /**
   * Get diagnostic status of time synchronization
   */
  async getTimeStatus(): Promise<{
    systemTime: string;
    effectiveTime: string;
    cstTime: string;
    ntpOffset: number;
    manualOffset: number;
    totalOffset: number;
    manualOffsetSource: string;
    lastSyncTime: number;
    externalSyncFailed: boolean;
  }> {
    const systemTime = new Date(Date.now());
    const effectiveTime = await this.getCurrentTime();
    const cstTimeStr = await this.getCurrentCST();
    
    return {
      systemTime: systemTime.toISOString(),
      effectiveTime: effectiveTime.toISOString(),
      cstTime: cstTimeStr,
      ntpOffset: this.ntpOffset,
      manualOffset: this.manualOffset,
      totalOffset: this.ntpOffset + this.manualOffset,
      manualOffsetSource: this.manualOffsetSource,
      lastSyncTime: this.lastSyncTime,
      externalSyncFailed: this.externalSyncFailed
    };
  }
}

// Singleton instance
export const timeService = new TimeService();
