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
- **Server-Side Flow**: Polygon WebSocket (primary) + Tastytrade WebSocket (fallback) → In-memory cache updates → SSE endpoint polls cache every 1 second → Streams to frontend clients
- **Client-Side Flow**: EventSource connects to `/api/quotes/stream` → `useLiveQuotes` hook consumes stream → Dashboard extracts symbols from trades → TradeCard components display live prices and Greeks
- **SSE Endpoint**: `/api/quotes/stream` dynamically fetches current top trades and streams:
  - Live stock quotes (bid/ask/price/volume)
  - **Real-time Greeks** (delta, gamma, theta, vega, rho) calculated every second using backend Black-Scholes model
  - No query parameters needed - endpoint auto-discovers active trade symbols from storage
- **Live Greeks Implementation**:
  - **Backend Calculation**: Black-Scholes model in `server/services/financialCalculations.ts` ensures single source of truth
  - **Real-Time Recalculation**: Greeks update every 1 second based on live stock prices from WebSocket feeds
  - **Race Condition Prevention**: SSE endpoint uses single `storage.getTopTrades()` call for both symbols and trade metadata
  - **Data Consistency**: Symbols array and tradeMap always synchronized (no mismatches)
  - **SSE Payload**: Each update includes `symbol`, `price`, `greeks` (delta, gamma, theta, vega, rho), `bid`, `ask`, `volume`
- **Multi-Tier Fallback System**: 
  - Primary: Polygon WebSocket real-time data (sub-second latency, 100% market coverage)
  - Secondary: Tastytrade DXLink WebSocket real-time data (sub-second latency)
  - Final: Web scraper for market indices not in WebSocket caches (30-second cached updates)
  - Ensures all trade symbols get live updates with multiple redundant sources
- **Visual Indicators**: Green pulsing dot next to stock prices and Greeks indicates live data active, falls back to stored values when disconnected
- **Connection Management**: Automatic SSE reconnection on disconnect, dynamic symbol subscription based on current active trades
- **Performance**: 1-second polling interval provides near real-time Greeks and price updates without overwhelming the frontend

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
- **Stock Universe**: Full market scanner covering 100+ stocks across all sectors:
  - **Tech Giants**: AAPL, MSFT, GOOGL, AMZN, META, NVDA, TSLA, AMD, INTC, CRM, ORCL, ADBE, NFLX
  - **Semiconductors & AI**: TSM, AVGO, QCOM, MU, AMAT, LRCX, KLAC, ARM, MRVL, ASML
  - **Finance**: JPM, BAC, WFC, GS, MS, C, BLK, SCHW, V, MA, AXP
  - **Healthcare**: JNJ, UNH, PFE, ABBV, MRK, TMO, LLY, AMGN, GILD, MRNA
  - **Energy**: XOM, CVX, COP, SLB, EOG, MPC, PSX, VLO, OXY, HAL
  - **Consumer**: WMT, HD, COST, NKE, SBUX, MCD, DIS, TGT, LOW, BKNG
  - **Industrial**: BA, CAT, GE, HON, LMT, RTX, UPS, DE, MMM, EMR
  - **EVs & Auto**: F, GM, RIVN, LCID, NIO, XPEV, LI
  - **Communication**: T, VZ, TMUS, CMCSA, CHTR
  - **Major ETFs**: SPY, QQQ, IWM, DIA, VTI, VOO, XLF, XLE, XLK, XLV
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

- **Polygon/Massive.com** (PRIMARY): Real-time market data via WebSocket + REST API
  - **Plan**: Options Advanced ($199/month) - Unlimited API calls, 5+ years historical data, 100% market coverage
  - **Stock Quotes**: WebSocket streaming via wss://socket.massive.com/options for real-time bid/ask/last price/volume
  - **Options Quotes**: REST API via `/v3/snapshot/options/{underlying}/{contract}` for on-demand premiums, Greeks, and IV
  - **Architectural Decision**: Use REST API for options (not WebSocket) because:
    - Scans only need 3-5 option contracts on-demand (when user clicks refresh)
    - REST provides complete data (premiums, IV, Greeks) in single call
    - WebSocket would require complex dynamic subscriptions without providing Greeks
    - Hybrid approach: WebSocket for continuous stock quotes, REST for occasional options quotes
  - **Options Quote Reliability**: 3-attempt retry with exponential backoff (1s, 2s, 4s), 1-minute caching per contract
  - **Authentication**: API key authentication (POLYGON_API_KEY secret)
  - **Features**: Real-time stock quotes (WebSocket), options premiums/Greeks/IV (REST), ticker reference API
  - **Caching**: 
    - Stock quotes: In-memory with 10-second freshness threshold
    - Options quotes: In-memory with 1-minute TTL for scan optimization
  - **Coverage**: 100% US stocks and options
  - **Connection Stability**: WebSocket auto-reconnect (5 max attempts), REST retry with backoff
  - **Architecture**: 
    - Stock quotes: WebSocket-first → Tastytrade fallback → Web scraping final
    - Options quotes: REST API with Black-Scholes fallback when Polygon unavailable

- **Tastytrade API** (SPX OPTIONS PRIMARY SOURCE): Real-time options data via DXLink WebSocket streaming
  - **Purpose**: PRIMARY source for SPX index options ONLY - provides real market Greeks, IV, and theoretical prices
  - **Architecture Decision**: Tastytrade reserved for SPX day trading; all momentum stocks use Polygon
    - **SPX Day Trading:** Tastytrade (PRIMARY) → Polygon (FALLBACK) → Black-Scholes (FINAL)
    - **Momentum Stocks:** Polygon (PRIMARY) → Black-Scholes (FALLBACK)
  - **Rationale**: Tastytrade excels at SPX index options; Polygon already handles individual stocks well
  - **Authentication**: OAuth-based login with session tokens (stored in TASTYTRADE_USERNAME and TASTYTRADE_PASSWORD secrets)
  - **DXLink WebSocket**: Persistent WebSocket connection to wss://tasty-openapi-ws.dxfeed.com/realtime
  - **Protocol Flow**: SETUP → AUTH → CHANNEL_REQUEST → FEED_SETUP → FEED_SUBSCRIPTION
  - **Event Types**: Quote (bid/ask), Trade (last price), Greeks (delta, gamma, theta, vega, rho, IV, theoretical price)
  - **Data Format**: COMPACT format with streaming events in real-time
  - **Options Symbol Format**: 
    - **SPX Weekly Options**: `.SPXW{YYMMDD}{C/P}{STRIKE}` (non-third-Friday expirations)
      - Example: `.SPXW251114C06850000` for Friday Nov 14, 2025 (weekly)
    - **SPX Monthly Options**: `.SPX{YYMMDD}{C/P}{STRIKE}` (third Friday expirations only)
      - Example: `.SPX251121C06850000` for Friday Nov 21, 2025 (monthly - third Friday)
    - **Other Stocks**: `.{UNDERLYING}{YYMMDD}{C/P}{STRIKE}` (standard format)
    - **Symbol Auto-Detection**: `isThirdFriday()` method automatically detects weekly vs monthly expirations
  - **Pending Promises Pattern**: Stores promises in pendingGreeks Map, resolves when Greeks event arrives, 5s timeout
  - **Caching**: Separate optionsCache (Greeks+quotes) from quoteCache (stocks only) with ref-counting
  - **Connection Stability**: KEEPALIVE messages exchanged every 60 seconds to maintain connection
  - **API Endpoints**: Session login, account info, DXLink token retrieval
  - **Credentials**: Requires Tastytrade brokerage account (free sandbox available)
  - **SPX Support**: ✅ SPX index options work perfectly via Tastytrade DXLink (real-time Greeks and IV)
  - **CRITICAL FIX (Nov 10, 2025)**: Implemented SPXW vs SPX symbol formatting to support weekly options
    - DXLink silently rejects `.SPX...` symbols for non-monthly expirations → timeout after 5s
    - Solution: Detect third Friday using date math, output `.SPXW` for weekly, `.SPX` for monthly
    - Result: SPX day trading now receives live Greeks from Tastytrade DXLink instead of Black-Scholes fallback

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