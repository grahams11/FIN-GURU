# Overview

This is an options trading AI dashboard application that provides market analysis, trade recommendations, and portfolio management features. The system analyzes financial data using web scraping and AI-powered algorithms to generate high-confidence options trading opportunities with calculated Greeks and risk metrics.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **UI Library**: Shadcn/ui components built on Radix UI primitives with Tailwind CSS for styling
- **State Management**: TanStack Query (React Query) for server state management and caching
- **Real-Time Data**: Server-Sent Events (SSE) with custom React hook for live price streaming
- **Routing**: Wouter for lightweight client-side routing
- **Styling**: Dark-themed design system with CSS variables and custom color scheme optimized for financial data visualization

## Real-Time Data Streaming Architecture
- **Server-Side Flow**: Tastytrade WebSocket → In-memory cache updates → SSE endpoint polls cache every 1 second → Streams to frontend clients
- **Client-Side Flow**: EventSource connects to `/api/quotes/stream` → `useLiveQuotes` hook consumes stream → Dashboard extracts symbols from trades → TradeCard components display live prices
- **SSE Endpoint**: `/api/quotes/stream?symbols=AAPL,TSLA,NVDA` streams JSON quote updates with bid/ask/price/volume data
- **Smart Fallback System**: 
  - Primary: Tastytrade WebSocket real-time data (sub-second latency)
  - Fallback: Web scraper for symbols not in Tastytrade cache (30-second cached updates)
  - Ensures all trade symbols get live updates regardless of Tastytrade support
- **Visual Indicators**: Green pulsing dot next to stock prices indicates live data active, falls back to stored prices when disconnected
- **Connection Management**: Automatic SSE reconnection on disconnect, dynamic symbol subscription based on current trades
- **Performance**: 1-second polling interval provides near real-time updates without overwhelming the frontend

## Backend Architecture
- **Runtime**: Node.js with Express.js server
- **Language**: TypeScript with ES modules
- **API Design**: RESTful endpoints for market data, AI insights, and trade management
- **Data Processing**: Real-time market data scraping with cheerio and axios
- **Financial Calculations**: Custom Black-Scholes options pricing model for Greeks calculation (delta, gamma, theta, vega, rho)

## Data Storage Solutions
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Schema**: Normalized tables for users, market data, options trades, and AI insights
- **Storage Strategy**: In-memory storage implementation with interface for easy database swapping
- **Migrations**: Drizzle Kit for database schema migrations and version control

## Authentication and Authorization
- **Current State**: Basic user schema prepared but not fully implemented
- **Planned**: User authentication with session management using connect-pg-simple for PostgreSQL session storage

## Core Business Logic

### Day Trading System (Always Top 1 Play)
- **Instruments**: SPX (S&P 500 Index) only - MNQ removed due to lack of reliable live data
- **VIX + RSI Formula**: 
  - **SELL Signal (PUT)**: VIX > 18 AND RSI > 70 (overbought) → Bearish day trade
  - **BUY Signal (CALL)**: VIX ≤ 18 OR RSI < 30 (oversold) → Bullish day trade
  - **Moderate Signals**: VIX > 18 but RSI < 70 → Elevated volatility bearish bias
- **Expiration Dates**: Weekly Friday expirations only (SPX has weekly options that expire every Friday at 4:00 PM ET)
  - Monday-Thursday trades → Expire this Friday
  - Friday-Sunday trades → Expire next Friday
- **Timeframe**: 1-7 days until Friday expiration (dynamic based on current day of week)
- **Strike Selection**: ATM or very close (0.5% OTM) for maximum delta exposure
- **ROI Targets**: 50-150% returns based on VIX+RSI signal strength
- **Confidence Scoring**: Higher confidence for strong VIX+RSI alignment (extreme readings)
- **Trade Budget**: $2000 maximum per day trade (higher budget for expensive SPX options)
- **Contract Multipliers**: SPX=100 (affects total cost and ROI calculations)
- **Budget Enforcement**: SPX always receives at least 1 contract even if cost exceeds $2000 (ensures inclusion despite ~$16.5k per contract)
- **Priority**: SPX day trading play ALWAYS appears in position #1

### Elite Dual-Strategy Scanner (Positions 3-5)
- **Stock Universe**: Only scans Tastytrade-supported symbols for real-time data accuracy:
  - **Tech Stocks**: AAPL, TSLA, NVDA, MSFT, GOOGL, META, AMZN
  - **Major ETFs**: QQQ, SPY
  - All symbols have continuous WebSocket price updates from Tastytrade DXLink
- **RSI-Only Momentum Scanner**: No longer reliant on 52-week data or changePercent (Google Finance limitation)
- **CALL Strategy**: RSI < 48 (oversold/pullback) + market not bearish → Bullish reversal plays
- **PUT Strategy**: RSI > 62 (overbought/reversal) + market not bullish → Bearish reversal plays
- **Market Sentiment Integration**: VIX + SPX data influences confidence levels
  - VIX > 20 + SPX down = Bearish market (boosts PUT confidence)
  - VIX < 18 + SPX up = Bullish market (boosts CALL confidence)
  - Otherwise = Neutral market (base confidence)
- **Elite ROI Targeting**: Swing trade recommendations target minimum 100% ROI with most achieving 200-300% projected returns
- **Timeframe**: 5-10 day holds for swing trading
- **Works Offline**: Scanner functions even when Google Finance returns 0% for all changePercent values (markets closed/after hours)

### Shared Features
- **Web Scraper Service**: Retrieves real-time market data including 52-week ranges, current prices, and market indices (S&P 500, NASDAQ, VIX)
- **Financial Calculations**: Black-Scholes implementation for options Greeks and pricing models (delta, gamma, theta, vega, rho)
- **Trade Budget**: $1000 maximum per trade with smart contract allocation (cheaper premiums get more contracts)
- **Stock Entry Pricing**: Entry prices set at current market price (±1%) for immediate actionable trades
- **Premium Display**: Separate display of stock entry price (market execution) and actual option premium cost
- **Real-Time Variation**: ROI and confidence values dynamically fluctuate based on market volatility and timestamp-based factors
- **Fresh Market Scan**: Every refresh button click triggers complete new analysis of all instruments and stocks

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL database with connection pooling via @neondatabase/serverless
- **Drizzle ORM**: Type-safe database toolkit with PostgreSQL dialect support

## Financial Data Sources (Data Source Hierarchy)

**Priority Order**: Polygon → Tastytrade → Google Finance → MarketWatch

- **Polygon/Massive.com** (PRIMARY): Real-time market data via WebSocket and REST API
  - **Plan**: Options Advanced ($199/month) - Unlimited API calls, 5+ years historical data, 100% market coverage
  - **WebSocket**: Real-time streaming via wss://socket.massive.com/options
  - **REST API**: NBBO (National Best Bid and Offer) quotes for stocks via /v2/last/nbbo/{ticker}
  - **Authentication**: API key authentication (POLYGON_API_KEY secret)
  - **Features**: Bid/ask prices, last trade price, volume, real-time options data
  - **Caching**: In-memory quote cache with 10-second freshness threshold
  - **Coverage**: All US stocks and options with 100% market coverage
  - **Connection Stability**: Automatic reconnection with 5 max retry attempts

- **Tastytrade API** (FALLBACK): Real-time market data via DXLink WebSocket streaming
  - **Authentication**: OAuth-based login with session tokens (stored in TASTYTRADE_USERNAME and TASTYTRADE_PASSWORD secrets)
  - **DXLink WebSocket**: Persistent WebSocket connection to wss://tasty-openapi-ws.dxfeed.com/realtime
  - **Protocol Flow**: SETUP → AUTH → CHANNEL_REQUEST → FEED_SETUP → FEED_SUBSCRIPTION
  - **Data Format**: COMPACT format with Quote and Trade events streamed in real-time
  - **Features**: Bid/ask prices, last trade price, volume, exchange codes
  - **Caching**: In-memory quote cache updated on every Quote/Trade event
  - **Connection Stability**: KEEPALIVE messages exchanged every 60 seconds to maintain connection
  - **API Endpoints**: Session login, account info, DXLink token retrieval
  - **Credentials**: Requires Tastytrade brokerage account (free sandbox available)
  - **SPX Support**: ✅ SPX index quotes work perfectly via Tastytrade (real-time data)

- **Google Finance** (FINAL FALLBACK): Web scraping for market data when both Polygon and Tastytrade unavailable
  - Web scraping for stock prices, ETFs, and market indices
  - Source for VIX (^VIX), S&P 500 (^GSPC), stocks, ETFs
  - Limitation: changePercent often returns 0% (markets closed/after hours) → Scanner uses RSI-only signals
  
- **MarketWatch** (FINAL FALLBACK): Secondary fallback for web scraping when all other sources fail

## Development Tools
- **Replit Integration**: Development environment plugins for cartographer and dev banner
- **Vite Plugins**: Runtime error overlay and hot module replacement for development workflow

## UI Component Libraries
- **Radix UI**: Comprehensive primitive components for accessibility and interactions
- **Lucide React**: Icon library for consistent visual elements
- **React Hook Form**: Form state management with validation resolvers

## Utility Libraries
- **Axios**: HTTP client for external API requests and web scraping
- **Cheerio**: Server-side HTML parsing for market data extraction
- **Date-fns**: Date manipulation and formatting utilities
- **Class Variance Authority**: Type-safe CSS class management for component variants