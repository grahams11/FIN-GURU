import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

export class HistoricalDataCache {
  private cacheDir = path.join(process.cwd(), 'server', 'cache', 'backtest');
  private memoryCache = new Map<string, CacheEntry>();
  private readonly DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.ensureCacheDir();
  }

  private async ensureCacheDir() {
    try {
      if (!existsSync(this.cacheDir)) {
        await fs.mkdir(this.cacheDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create cache directory:', error);
    }
  }

  private getCacheKey(symbol: string, dataType: string, startDate: string, endDate: string): string {
    return `${symbol}_${dataType}_${startDate}_${endDate}`;
  }

  private getCacheFilePath(key: string): string {
    return path.join(this.cacheDir, `${key}.json`);
  }

  async get(symbol: string, dataType: string, startDate: string, endDate: string): Promise<any | null> {
    const key = this.getCacheKey(symbol, dataType, startDate, endDate);

    // Check memory cache first
    const memEntry = this.memoryCache.get(key);
    if (memEntry && Date.now() < memEntry.timestamp + memEntry.ttl) {
      console.log(`✅ Memory cache HIT: ${key}`);
      return memEntry.data;
    }

    // Check disk cache
    const filePath = this.getCacheFilePath(key);
    try {
      if (existsSync(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        const entry: CacheEntry = JSON.parse(content);

        // Check TTL
        if (Date.now() < entry.timestamp + entry.ttl) {
          console.log(`✅ Disk cache HIT: ${key}`);
          // Load into memory cache
          this.memoryCache.set(key, entry);
          return entry.data;
        } else {
          // Expired - delete file
          console.log(`⏰ Cache EXPIRED: ${key}`);
          await fs.unlink(filePath);
        }
      }
    } catch (error) {
      console.error(`Failed to read cache file ${key}:`, error);
    }

    console.log(`❌ Cache MISS: ${key}`);
    return null;
  }

  async set(symbol: string, dataType: string, startDate: string, endDate: string, data: any, ttl: number = this.DEFAULT_TTL): Promise<void> {
    const key = this.getCacheKey(symbol, dataType, startDate, endDate);
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      ttl
    };

    // Store in memory
    this.memoryCache.set(key, entry);

    // Store on disk
    const filePath = this.getCacheFilePath(key);
    try {
      await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
      console.log(`💾 Cached: ${key}`);
    } catch (error) {
      console.error(`Failed to write cache file ${key}:`, error);
    }
  }

  async clear(symbol?: string): Promise<void> {
    if (symbol) {
      // Clear specific symbol
      const keysToDelete = Array.from(this.memoryCache.keys()).filter(k => k.startsWith(symbol));
      for (const key of keysToDelete) {
        this.memoryCache.delete(key);
        const filePath = this.getCacheFilePath(key);
        if (existsSync(filePath)) {
          await fs.unlink(filePath);
        }
      }
      console.log(`🗑️ Cleared cache for ${symbol}`);
    } else {
      // Clear all
      this.memoryCache.clear();
      try {
        const files = await fs.readdir(this.cacheDir);
        for (const file of files) {
          await fs.unlink(path.join(this.cacheDir, file));
        }
        console.log('🗑️ Cleared all cache');
      } catch (error) {
        console.error('Failed to clear cache directory:', error);
      }
    }
  }

  getStats(): { memoryEntries: number; diskPath: string } {
    return {
      memoryEntries: this.memoryCache.size,
      diskPath: this.cacheDir
    };
  }
}

export const historicalDataCache = new HistoricalDataCache();
