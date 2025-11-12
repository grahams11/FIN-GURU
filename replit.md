# Overview

This project is an AI-powered options trading dashboard providing institutional-grade tools for market analysis, trade recommendations, and portfolio management. It features multiple trading systems, including a high-win-rate Ghost 1DTE overnight scanner, and leverages real-time data, AI analysis, and advanced quantitative strategies to deliver insights and support investment decisions.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript and Vite.
- **UI**: Shadcn/ui (Radix UI, Tailwind CSS) with a dark-themed design system.
- **State Management**: TanStack Query for server state.
- **Real-Time Data**: Server-Sent Events (SSE) via a custom React hook.
- **Routing**: Wouter.

## Real-Time Data Streaming Architecture
- **Server-Side**: Polygon and Tastytrade WebSockets feed an in-memory cache, streamed via an SSE endpoint.
- **Client-Side**: EventSource connects to `/api/quotes/stream` for live stock quotes and real-time Greeks.
- **Fallback System**: Polygon, Tastytrade, and web scraping ensure continuous updates.

## Backend Architecture
- **Runtime**: Node.js with Express.js (TypeScript, ES modules).
- **API**: RESTful endpoints for market data, AI insights, and trade management.
- **Data Processing**: Real-time market data scraping.
- **Financial Calculations**: Custom Black-Scholes options pricing model.

## Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Normalized tables for users, market data, options trades, and AI insights.
- **AI Learning Schema**: Includes `marketInsights` for AI-discovered patterns, `performanceMetrics` for strategy aggregates, and `learningSessions` for audit trails of AI learning runs.

## Core Business Logic

### Market Scanning
- **BatchDataService**: Fetches and caches ~11,600 stocks from Polygon Bulk Snapshot, shared across all scanners for efficiency.
- **Dual Scanner Architecture**:
    - **UOA Scanner**: Fast background scanner for Unusual Options Activity using a hybrid scoring system (70% traditional UOA + 30% Ghost Phase 4 intelligence).
    - **Elite Scanner**: Institutional-grade scanner with strict filtering criteria.
- **Market Data Pipeline**: Efficiently fetches and filters market data, eliminating redundant API calls.
- **ExpirationService**: Queries live option chains for accurate expiration dates.

### Trading Systems
- **Ghost 1DTE Overnight Scanner (GROK PHASE 4 ENHANCED)**: High-win-rate strategy for SPY, QQQ, IWM using a 4-layer AI scoring system for entry signals and robust technical optimizations. Includes a manual pre-trade checklist for execution.
- **Day Trading System (SPX Only)**: Uses VIX + RSI for BUY/SELL signals on SPX weekly expirations.
- **Elite Dual-Strategy Scanner (Stocks)**: RSI-only momentum scanner for CALL/PUT strategies on 100+ stocks and ETFs.

### Shared Features
- **Financial Calculations**: Black-Scholes for options Greeks and pricing.
- **Trade Budget**: $1000 maximum per trade with smart contract allocation.
- **Fibonacci Retracement Validation**: Validates entry points using Fibonacci levels with fractal swing detection.
- **Dashboard Market Overview**: Displays real-time S&P 500, NASDAQ, and VIX metrics.

### Self-Learning System (AI Education Engine)
- **Architecture**: Five core services orchestrate autonomous learning using Grok AI reasoning.
- **Learning Loop**: Automated daily outcome analysis, weekly pattern discovery via Grok, and bi-weekly parameter optimization.
- **Grok AI Integration**: Sends trade summaries to Grok for deep pattern analysis and structured recommendations.
- **Strategy Evolution**: Tracks recommendations, analyzes outcomes, and dynamically adjusts strategy parameters.

### Portfolio Management (Hybrid AI)
- **Data Source**: Fetches positions from Tastytrade API.
- **Risk Management**: Automated stop loss and aggressive partial profit-taking.
- **Hybrid AI Analysis**: Combines an internal `PortfolioAnalysisEngine` with `GrokAIService` for complex scenarios and strategic recommendations.
- **Goal Tracking**: Monitors progress towards a $1M target.
- **Real-Time P&L & Greeks Monitoring**: Live tracking with SSE-powered updates.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL.
- **Drizzle ORM**: Type-safe database toolkit.

## Financial Data Sources
- **Polygon/Massive.com**: Primary real-time market data (WebSocket and REST API) for US stocks and options.
- **Tastytrade API**: Primary real-time options data (DXLink WebSocket) for SPX index options.
- **Google Finance**: Fallback web scraping for stock prices and indices.
- **MarketWatch**: Secondary web scraping fallback.

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