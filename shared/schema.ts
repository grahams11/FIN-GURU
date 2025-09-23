import { sql } from "drizzle-orm";
import { pgTable, text, varchar, real, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const marketData = pgTable("market_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  price: real("price").notNull(),
  change: real("change").notNull(),
  changePercent: real("change_percent").notNull(),
  volume: integer("volume"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const optionsTrade = pgTable("options_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticker: text("ticker").notNull(),
  strikePrice: real("strike_price").notNull(),
  expiry: text("expiry").notNull(),
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  contracts: integer("contracts").notNull(),
  projectedROI: real("projected_roi").notNull(),
  aiConfidence: real("ai_confidence").notNull(),
  greeks: jsonb("greeks").notNull(),
  sentiment: real("sentiment"),
  score: real("score").notNull(),
  isExecuted: boolean("is_executed").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiInsights = pgTable("ai_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketConfidence: real("market_confidence").notNull(),
  volatilityForecast: text("volatility_forecast").notNull(),
  bestTimeFrame: text("best_time_frame").notNull(),
  sentimentScore: real("sentiment_score").notNull(),
  insights: jsonb("insights").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertMarketDataSchema = createInsertSchema(marketData).omit({
  id: true,
  timestamp: true,
});

export const insertOptionsTradeSchema = createInsertSchema(optionsTrade).omit({
  id: true,
  createdAt: true,
});

export const insertAiInsightsSchema = createInsertSchema(aiInsights).omit({
  id: true,
  timestamp: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type MarketData = typeof marketData.$inferSelect;
export type InsertMarketData = z.infer<typeof insertMarketDataSchema>;
export type OptionsTrade = typeof optionsTrade.$inferSelect;
export type InsertOptionsTrade = z.infer<typeof insertOptionsTradeSchema>;
export type AiInsights = typeof aiInsights.$inferSelect;
export type InsertAiInsights = z.infer<typeof insertAiInsightsSchema>;

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface TradeRecommendation {
  ticker: string;
  strikePrice: number;
  expiry: string;
  entryPrice: number;
  exitPrice: number;
  contracts: number;
  projectedROI: number;
  aiConfidence: number;
  greeks: Greeks;
  sentiment: number;
  score: number;
  holdDays: number;
}

export interface PortfolioSummary {
  totalValue: number;
  dailyPnL: number;
  optionsCount: number;
  buyingPower: number;
}

export interface SectorData {
  name: string;
  change: number;
}

export interface MarketOverviewData {
  sp500: { value: number; change: number; changePercent: number };
  nasdaq: { value: number; change: number; changePercent: number };
  vix: { value: number; change: number; changePercent: number };
  sentiment: { score: number; label: string };
}
