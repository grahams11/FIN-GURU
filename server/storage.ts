import { db } from "./db";
import { users, marketData, optionsTrade, aiInsights, portfolioPositions, tradeHistory, watchlists, watchlistItems, priceAlerts } from "@shared/schema";
import { eq, desc, and, sum, count } from "drizzle-orm";
import type { 
  User, 
  InsertUser, 
  MarketData, 
  InsertMarketData, 
  OptionsTrade, 
  InsertOptionsTrade,
  AiInsights,
  InsertAiInsights,
  PortfolioPosition,
  InsertPortfolioPosition,
  TradeHistory,
  InsertTradeHistory,
  Watchlist,
  InsertWatchlist,
  WatchlistItem,
  InsertWatchlistItem,
  PriceAlert,
  InsertPriceAlert,
  PositionPerformance,
  PerformanceMetrics
} from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createMarketData(data: InsertMarketData): Promise<MarketData>;
  getMarketData(symbol: string): Promise<MarketData | undefined>;
  createOptionsTrade(trade: InsertOptionsTrade): Promise<OptionsTrade>;
  getTopTrades(): Promise<OptionsTrade[]>;
  executeTrade(tradeId: string): Promise<boolean>;
  clearTrades(): Promise<void>;
  createAiInsight(insight: InsertAiInsights): Promise<AiInsights>;
  getLatestAiInsights(): Promise<AiInsights | undefined>;
  getPortfolioSummary(userId?: string): Promise<any>;
  
  // Portfolio Position Management
  createPosition(position: InsertPortfolioPosition): Promise<PortfolioPosition>;
  getPositions(userId?: string): Promise<PortfolioPosition[]>;
  updatePosition(positionId: string, updates: Partial<PortfolioPosition>): Promise<PortfolioPosition | undefined>;
  closePosition(positionId: string): Promise<boolean>;
  getPositionPerformance(userId?: string): Promise<PositionPerformance[]>;
  
  // Trade History
  createTradeRecord(trade: InsertTradeHistory): Promise<TradeHistory>;
  getTradeHistory(userId?: string, limit?: number): Promise<TradeHistory[]>;
  getPerformanceMetrics(userId?: string): Promise<PerformanceMetrics>;
  
  // Watchlists
  createWatchlist(watchlist: InsertWatchlist): Promise<Watchlist>;
  getWatchlists(userId?: string): Promise<Watchlist[]>;
  addToWatchlist(item: InsertWatchlistItem): Promise<WatchlistItem>;
  removeFromWatchlist(watchlistId: string, ticker: string): Promise<boolean>;
  getWatchlistItems(watchlistId: string): Promise<WatchlistItem[]>;
  
  // Price Alerts
  createPriceAlert(alert: InsertPriceAlert): Promise<PriceAlert>;
  getPriceAlerts(userId?: string): Promise<PriceAlert[]>;
  updatePriceAlert(alertId: string, updates: Partial<PriceAlert>): Promise<PriceAlert | undefined>;
  checkAndTriggerAlerts(): Promise<PriceAlert[]>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    // Database-backed storage, no need for in-memory maps
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async createMarketData(data: InsertMarketData): Promise<MarketData> {
    const [marketDataEntry] = await db
      .insert(marketData)
      .values(data)
      .returning();
    return marketDataEntry;
  }

  async getMarketData(symbol: string): Promise<MarketData | undefined> {
    const [data] = await db.select().from(marketData).where(eq(marketData.symbol, symbol));
    return data || undefined;
  }

  async createOptionsTrade(trade: InsertOptionsTrade): Promise<OptionsTrade> {
    const [optionsTradeEntry] = await db
      .insert(optionsTrade)
      .values(trade)
      .returning();
    return optionsTradeEntry;
  }

  async getTopTrades(): Promise<OptionsTrade[]> {
    return await db
      .select()
      .from(optionsTrade)
      .orderBy(desc(optionsTrade.score))
      .limit(20);
  }

  async executeTrade(tradeId: string): Promise<boolean> {
    const result = await db
      .update(optionsTrade)
      .set({ isExecuted: true })
      .where(eq(optionsTrade.id, tradeId))
      .returning();
    return result.length > 0;
  }

  async clearTrades(): Promise<void> {
    await db.delete(optionsTrade);
  }

  async createAiInsight(insight: InsertAiInsights): Promise<AiInsights> {
    const [aiInsight] = await db
      .insert(aiInsights)
      .values(insight)
      .returning();
    return aiInsight;
  }

  async getLatestAiInsights(): Promise<AiInsights | undefined> {
    const [insight] = await db
      .select()
      .from(aiInsights)
      .orderBy(desc(aiInsights.timestamp))
      .limit(1);
    return insight || undefined;
  }

  async getPortfolioSummary(userId?: string): Promise<any> {
    // Get all open positions
    const positions = await this.getPositions(userId);
    const optionsPositions = positions.filter(p => p.positionType === 'options');
    const stockPositions = positions.filter(p => p.positionType === 'stock');
    
    const totalCost = positions.reduce((sum, position) => 
      sum + (position.avgCost * Math.abs(position.quantity)), 0);
    
    const currentValue = positions.reduce((sum, position) => {
      const currentPrice = position.currentPrice || position.avgCost;
      return sum + (currentPrice * Math.abs(position.quantity));
    }, 0);
    
    const unrealizedPnL = currentValue - totalCost;
    const realizedPnL = positions.reduce((sum, position) => sum + (position.realizedPnL || 0), 0);
    const totalPnL = unrealizedPnL + realizedPnL;
    
    // Calculate daily P&L (simplified - would need historical data for accurate calculation)
    const dailyPnL = unrealizedPnL * 0.02;
    
    const basePortfolioValue = 50000;
    const totalValue = basePortfolioValue + currentValue;
    
    // Get top 5 positions by value
    const topPositions = positions
      .sort((a, b) => {
        const aValue = (a.currentPrice || a.avgCost) * Math.abs(a.quantity);
        const bValue = (b.currentPrice || b.avgCost) * Math.abs(b.quantity);
        return bValue - aValue;
      })
      .slice(0, 5);
    
    return {
      totalValue,
      dailyPnL,
      totalPnL,
      totalCost,
      optionsCount: optionsPositions.length,
      stockCount: stockPositions.length,
      buyingPower: basePortfolioValue - totalCost,
      topPositions
    };
  }
  
  // Portfolio Position Management
  async createPosition(position: InsertPortfolioPosition): Promise<PortfolioPosition> {
    const [newPosition] = await db
      .insert(portfolioPositions)
      .values(position)
      .returning();
    return newPosition;
  }
  
  async getPositions(userId?: string): Promise<PortfolioPosition[]> {
    const query = db.select().from(portfolioPositions);
    
    if (userId) {
      return await query.where(eq(portfolioPositions.userId, userId));
    }
    return await query;
  }
  
  async updatePosition(positionId: string, updates: Partial<PortfolioPosition>): Promise<PortfolioPosition | undefined> {
    const [updated] = await db
      .update(portfolioPositions)
      .set(updates)
      .where(eq(portfolioPositions.id, positionId))
      .returning();
    return updated || undefined;
  }
  
  async closePosition(positionId: string): Promise<boolean> {
    const result = await db
      .update(portfolioPositions)
      .set({ 
        status: 'closed',
        closeDate: new Date()
      })
      .where(eq(portfolioPositions.id, positionId))
      .returning();
    return result.length > 0;
  }
  
  async getPositionPerformance(userId?: string): Promise<PositionPerformance[]> {
    const positions = await this.getPositions(userId);
    
    return positions
      .filter(p => p.status === 'open')
      .map(position => {
        const currentPrice = position.currentPrice || position.avgCost;
        const currentValue = currentPrice * Math.abs(position.quantity);
        const totalCost = position.avgCost * Math.abs(position.quantity);
        const totalReturn = currentValue - totalCost;
        const totalReturnPercent = (totalReturn / totalCost) * 100;
        
        // Simplified daily change calculation
        const dayChange = totalReturn * 0.1; // Assume 10% of total return is today's change
        const dayChangePercent = (dayChange / totalCost) * 100;
        
        return {
          position,
          currentValue,
          dayChange,
          dayChangePercent,
          totalReturn,
          totalReturnPercent
        };
      });
  }
  
  // Trade History
  async createTradeRecord(trade: InsertTradeHistory): Promise<TradeHistory> {
    const [newTrade] = await db
      .insert(tradeHistory)
      .values(trade)
      .returning();
    return newTrade;
  }
  
  async getTradeHistory(userId?: string, limit: number = 50): Promise<TradeHistory[]> {
    let query = db
      .select()
      .from(tradeHistory)
      .orderBy(desc(tradeHistory.tradeDate))
      .limit(limit);
    
    if (userId) {
      query = query.where(eq(tradeHistory.userId, userId)) as any;
    }
    
    return await query;
  }
  
  async getPerformanceMetrics(userId?: string): Promise<PerformanceMetrics> {
    const trades = await this.getTradeHistory(userId, 1000);
    const positions = await this.getPositions(userId);
    
    const completedTrades = trades.filter(t => t.tradeType === 'sell');
    const winningTrades = completedTrades.filter(t => (t.totalValue - t.price * t.quantity) > 0);
    const losingTrades = completedTrades.filter(t => (t.totalValue - t.price * t.quantity) <= 0);
    
    const totalReturn = positions.reduce((sum, p) => sum + (p.realizedPnL || 0), 0);
    const totalCost = positions.reduce((sum, p) => sum + (p.avgCost * Math.abs(p.quantity)), 0);
    const totalReturnPercent = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0;
    
    const winRate = completedTrades.length > 0 ? (winningTrades.length / completedTrades.length) * 100 : 0;
    
    const avgWin = winningTrades.length > 0 
      ? winningTrades.reduce((sum, t) => sum + (t.totalValue - t.price * t.quantity), 0) / winningTrades.length 
      : 0;
    
    const avgLoss = losingTrades.length > 0 
      ? Math.abs(losingTrades.reduce((sum, t) => sum + (t.totalValue - t.price * t.quantity), 0) / losingTrades.length)
      : 0;
    
    const largestWin = winningTrades.length > 0 
      ? Math.max(...winningTrades.map(t => t.totalValue - t.price * t.quantity))
      : 0;
    
    const largestLoss = losingTrades.length > 0 
      ? Math.abs(Math.min(...losingTrades.map(t => t.totalValue - t.price * t.quantity)))
      : 0;
    
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;
    
    // Generate mock monthly returns for the last 12 months
    const monthlyReturns = Array.from({ length: 12 }, (_, i) => {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      return {
        month: date.toLocaleString('default', { month: 'short', year: 'numeric' }),
        return: (Math.random() - 0.4) * 20 // Random return between -8% and 12%
      };
    }).reverse();
    
    // Generate trade distribution
    const tradeDistribution = [
      { range: '+20% or more', count: winningTrades.filter(t => ((t.totalValue - t.price * t.quantity) / (t.price * t.quantity)) > 0.2).length },
      { range: '+10% to +20%', count: winningTrades.filter(t => { const pct = (t.totalValue - t.price * t.quantity) / (t.price * t.quantity); return pct > 0.1 && pct <= 0.2; }).length },
      { range: '0% to +10%', count: winningTrades.filter(t => { const pct = (t.totalValue - t.price * t.quantity) / (t.price * t.quantity); return pct > 0 && pct <= 0.1; }).length },
      { range: '0% to -10%', count: losingTrades.filter(t => { const pct = (t.totalValue - t.price * t.quantity) / (t.price * t.quantity); return pct >= -0.1 && pct < 0; }).length },
      { range: '-10% to -20%', count: losingTrades.filter(t => { const pct = (t.totalValue - t.price * t.quantity) / (t.price * t.quantity); return pct >= -0.2 && pct < -0.1; }).length },
      { range: '-20% or less', count: losingTrades.filter(t => ((t.totalValue - t.price * t.quantity) / (t.price * t.quantity)) < -0.2).length },
    ];
    
    return {
      totalReturn,
      totalReturnPercent,
      winRate,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      profitFactor,
      sharpeRatio: 1.2, // Mock value
      maxDrawdown: -15.5, // Mock value
      monthlyReturns,
      tradeDistribution
    };
  }
  
  // Watchlists
  async createWatchlist(watchlist: InsertWatchlist): Promise<Watchlist> {
    const [newWatchlist] = await db
      .insert(watchlists)
      .values(watchlist)
      .returning();
    return newWatchlist;
  }
  
  async getWatchlists(userId?: string): Promise<Watchlist[]> {
    const query = db.select().from(watchlists);
    
    if (userId) {
      return await query.where(eq(watchlists.userId, userId));
    }
    return await query;
  }
  
  async addToWatchlist(item: InsertWatchlistItem): Promise<WatchlistItem> {
    const [newItem] = await db
      .insert(watchlistItems)
      .values(item)
      .returning();
    return newItem;
  }
  
  async removeFromWatchlist(watchlistId: string, ticker: string): Promise<boolean> {
    const result = await db
      .delete(watchlistItems)
      .where(
        and(
          eq(watchlistItems.watchlistId, watchlistId),
          eq(watchlistItems.ticker, ticker)
        )
      )
      .returning();
    return result.length > 0;
  }
  
  async getWatchlistItems(watchlistId: string): Promise<WatchlistItem[]> {
    return await db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.watchlistId, watchlistId));
  }
  
  // Price Alerts
  async createPriceAlert(alert: InsertPriceAlert): Promise<PriceAlert> {
    const [newAlert] = await db
      .insert(priceAlerts)
      .values(alert)
      .returning();
    return newAlert;
  }
  
  async getPriceAlerts(userId?: string): Promise<PriceAlert[]> {
    const query = db.select().from(priceAlerts);
    
    if (userId) {
      return await query.where(eq(priceAlerts.userId, userId));
    }
    return await query;
  }
  
  async updatePriceAlert(alertId: string, updates: Partial<PriceAlert>): Promise<PriceAlert | undefined> {
    const [updated] = await db
      .update(priceAlerts)
      .set(updates)
      .where(eq(priceAlerts.id, alertId))
      .returning();
    return updated || undefined;
  }
  
  async checkAndTriggerAlerts(): Promise<PriceAlert[]> {
    const activeAlerts = await db
      .select()
      .from(priceAlerts)
      .where(
        and(
          eq(priceAlerts.isActive, true),
          eq(priceAlerts.isTriggered, false)
        )
      );
    
    const triggeredAlerts: PriceAlert[] = [];
    
    for (const alert of activeAlerts) {
      // In a real implementation, you'd fetch current price from market data
      // For now, we'll simulate by checking if mock current price meets criteria
      const shouldTrigger = alert.alertType === 'above' 
        ? (alert.currentPrice || 0) >= alert.targetPrice
        : (alert.currentPrice || 0) <= alert.targetPrice;
      
      if (shouldTrigger) {
        const [triggered] = await db
          .update(priceAlerts)
          .set({ 
            isTriggered: true, 
            triggeredAt: new Date() 
          })
          .where(eq(priceAlerts.id, alert.id))
          .returning();
        
        if (triggered) {
          triggeredAlerts.push(triggered);
        }
      }
    }
    
    return triggeredAlerts;
  }
}

export const storage = new DatabaseStorage();