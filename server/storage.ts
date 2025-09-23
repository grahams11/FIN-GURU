import type { 
  User, 
  InsertUser, 
  MarketData, 
  InsertMarketData, 
  OptionsTrade, 
  InsertOptionsTrade,
  AiInsights,
  InsertAiInsights
} from "@shared/schema";
import { randomUUID } from "crypto";

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
  getPortfolioSummary(): Promise<any>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private marketData: Map<string, MarketData>;
  private optionsTrades: Map<string, OptionsTrade>;
  private aiInsights: Map<string, AiInsights>;

  constructor() {
    this.users = new Map();
    this.marketData = new Map();
    this.optionsTrades = new Map();
    this.aiInsights = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async createMarketData(data: InsertMarketData): Promise<MarketData> {
    const id = randomUUID();
    const marketDataEntry: MarketData = {
      ...data,
      id,
      timestamp: new Date(),
      volume: data.volume ?? null
    };
    this.marketData.set(data.symbol, marketDataEntry);
    return marketDataEntry;
  }

  async getMarketData(symbol: string): Promise<MarketData | undefined> {
    return this.marketData.get(symbol);
  }

  async createOptionsTrade(trade: InsertOptionsTrade): Promise<OptionsTrade> {
    const id = randomUUID();
    const optionsTrade: OptionsTrade = {
      ...trade,
      id,
      createdAt: new Date(),
      exitPrice: trade.exitPrice ?? null,
      isExecuted: trade.isExecuted ?? false,
      sentiment: trade.sentiment ?? null
    };
    this.optionsTrades.set(id, optionsTrade);
    return optionsTrade;
  }

  async getTopTrades(): Promise<OptionsTrade[]> {
    const trades = Array.from(this.optionsTrades.values());
    return trades
      .filter(trade => !trade.isExecuted)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  async executeTrade(tradeId: string): Promise<boolean> {
    const trade = this.optionsTrades.get(tradeId);
    if (trade) {
      trade.isExecuted = true;
      this.optionsTrades.set(tradeId, trade);
      return true;
    }
    return false;
  }

  async clearTrades(): Promise<void> {
    this.optionsTrades.clear();
  }

  async createAiInsight(insight: InsertAiInsights): Promise<AiInsights> {
    const id = randomUUID();
    const aiInsight: AiInsights = {
      ...insight,
      id,
      timestamp: new Date()
    };
    this.aiInsights.set(id, aiInsight);
    return aiInsight;
  }

  async getLatestAiInsights(): Promise<AiInsights | undefined> {
    const insights = Array.from(this.aiInsights.values());
    if (insights.length === 0) return undefined;
    
    return insights.sort((a, b) => b.timestamp!.getTime() - a.timestamp!.getTime())[0];
  }

  async getPortfolioSummary(): Promise<any> {
    const executedTrades = Array.from(this.optionsTrades.values())
      .filter(trade => trade.isExecuted);
    
    const totalValue = 47892.34; // Base portfolio value
    const totalCost = executedTrades.reduce((sum, trade) => 
      sum + (trade.entryPrice * trade.contracts * 100), 0);
    const dailyPnL = Math.random() * 2000 + 500; // Random daily P&L between $500-$2500
    
    return {
      totalValue: totalValue + totalCost,
      dailyPnL,
      optionsCount: executedTrades.length,
      buyingPower: 15678.90 - totalCost
    };
  }
}

export const storage = new MemStorage();
