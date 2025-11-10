# Overview

This project is an AI-powered options trading dashboard designed to provide market analysis, trade recommendations, and portfolio management. It leverages web scraping and AI algorithms to identify high-confidence options trading opportunities, complete with calculated Greeks and risk metrics. The system aims to empower users with data-driven insights for profitable options trading.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript, using Vite.
- **UI**: Shadcn/ui (Radix UI, Tailwind CSS).
- **State Management**: TanStack Query for server state.
- **Real-Time Data**: Server-Sent Events (SSE) with a custom React hook for live price and Greeks streaming.
- **Routing**: Wouter.
- **Styling**: Dark-themed design system with CSS variables.

## Real-Time Data Streaming Architecture
- **Server-Side**: Polygon WebSocket (primary) + Tastytrade WebSocket (fallback) feed in-memory cache, which is polled by an SSE endpoint every second to stream to clients.
- **Client-Side**: EventSource connects to `/api/quotes/stream` to consume live stock quotes (bid/ask/price/volume) and real-time Greeks (delta, gamma, theta, vega, rho) calculated every second using a backend Black-Scholes model.
- **Fallback System**: Polygon, Tastytrade, and web scraping ensure continuous live updates.
- **Visuals**: Green pulsing dot indicates live data.

## Backend Architecture
- **Runtime**: Node.js with Express.js (TypeScript, ES modules).
- **API**: RESTful endpoints for market data, AI insights, and trade management.
- **Data Processing**: Real-time market data scraping (cheerio, axios).
- **Financial Calculations**: Custom Black-Scholes options pricing model for Greeks.

## Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Normalized tables for users, market data, options trades, and AI insights.
- **Storage Strategy**: In-memory storage with an interface for database swapping.
- **Migrations**: Drizzle Kit.

## Core Business Logic

### Day Trading System (SPX Only)
- **Instruments**: SPX (S&P 500 Index) only.
- **Signals**: VIX + RSI formula for SELL (PUT) and BUY (CALL) signals.
- **Expirations**: Weekly Friday expirations (1-7 days timeframe).
- **Strike Selection**: ATM or very close OTM.
- **ROI Targets**: 50-150%.
- **Budget**: $2000 maximum per trade, ensuring at least 1 contract for SPX.
- **Priority**: Always appears as the top recommendation.

### Elite Dual-Strategy Scanner (Stocks)
- **Stock Universe**: 100+ stocks across various sectors, plus major ETFs.
- **Signals**: RSI-only momentum scanner for CALL (oversold) and PUT (overbought) strategies, influenced by VIX and SPX sentiment.
- **ROI Targets**: 100-300% projected returns for swing trades (5-10 day holds).
- **Resilience**: Functions even when market data for `changePercent` is unavailable.

### Shared Features
- **Web Scraper**: Retrieves market data including 52-week ranges, prices, and indices.
- **Financial Calculations**: Black-Scholes for options Greeks and pricing.
- **Trade Budget**: $1000 maximum per trade with smart contract allocation.
- **Pricing**: Entry prices at current market price (±1%).
- **Dynamic Values**: ROI and confidence fluctuate with market volatility.
- **Fresh Scan**: Each refresh triggers new analysis.

### Fibonacci Retracement Validation (Elite Scanner Only)
- **Technical Analysis**: Validates entry points using 0.707 (Golden) and 0.618 (Classic) Fibonacci retracement levels based on 60-day historical data from Polygon.
- **Confidence Boost**: Fibonacci bounces add +10% AI confidence.
- **Caching**: 1-hour TTL per symbol to reduce API calls.
- **Graceful Fallback**: Handles Polygon rate limits by still displaying trades without Fibonacci metadata.

### Fibonacci UI Features (TradeCard Component)
- **Color-Coded Prices**: Gold (0.707 bounce) or Green (0.618 bounce).
- **Fibonacci Badge**: Displays "FIB 0.707" or "FIB 0.618" with tooltip.
- **Estimated Profit**: Prominent display of projected dollar profit.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL.
- **Drizzle ORM**: Type-safe database toolkit.

## Financial Data Sources (Prioritized)
- **Polygon/Massive.com (PRIMARY)**: Real-time market data via WebSocket (stock quotes) and REST API (options quotes, Greeks, IV). Handles 100% US stocks and options.
- **Tastytrade API (SPX OPTIONS PRIMARY)**: Real-time options data via DXLink WebSocket, specifically for SPX index options, providing real market Greeks, IV, and theoretical prices.
- **Google Finance (FALLBACK)**: Web scraping for stock prices, ETFs, and market indices when primary sources are unavailable.
- **MarketWatch (FINAL FALLBACK)**: Secondary web scraping fallback.

## Development Tools
- **Replit Integration**: Cartographer and dev banner plugins.
- **Vite Plugins**: Runtime error overlay, HMR.

## UI Component Libraries
- **Radix UI**: Primitive components.
- **Lucide React**: Icon library.
- **React Hook Form**: Form state management.

## Utility Libraries
- **Axios**: HTTP client.
- **Cheerio**: HTML parsing.
- **Date-fns**: Date utilities.
- **Class Variance Authority**: Type-safe CSS class management.