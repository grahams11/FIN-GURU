import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MarketOverview } from "@/components/MarketOverview";
import { OptionsTraderAI } from "@/components/OptionsTraderAI";
import { PortfolioTracker } from "@/components/PortfolioTracker";
import { Card, CardContent } from "@/components/ui/card";
import { 
  PieChart, 
  Thermometer, 
  Activity, 
  Settings, 
  TrendingUp 
} from "lucide-react";
import type { MarketOverviewData, AiInsights, OptionsTrade, PortfolioSummary, SectorData } from "@shared/schema";

export default function Dashboard() {
  const [activeView, setActiveView] = useState<'dashboard' | 'portfolio' | 'analytics'>('dashboard');

  const { data: marketData, isLoading: marketLoading } = useQuery<MarketOverviewData>({
    queryKey: ["/api/market-overview"],
    refetchInterval: 30000, // Refresh every 30 seconds
    enabled: activeView === 'dashboard',
  });

  const { data: aiInsights, isLoading: aiLoading } = useQuery<AiInsights>({
    queryKey: ["/api/ai-insights"],
    refetchInterval: 60000, // Refresh every minute
    enabled: activeView === 'dashboard',
  });

  const { data: topTrades, isLoading: tradesLoading } = useQuery<OptionsTrade[]>({
    queryKey: ["/api/top-trades"],
    refetchInterval: 180000, // Refresh every 3 minutes
    enabled: activeView === 'dashboard',
  });

  const { data: portfolioData } = useQuery<PortfolioSummary>({
    queryKey: ["/api/portfolio-summary"],
    refetchInterval: 30000,
    enabled: activeView === 'dashboard',
  });

  const { data: sectorData } = useQuery<SectorData[]>({
    queryKey: ["/api/sector-performance"],
    refetchInterval: 60000,
    enabled: activeView === 'dashboard',
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
                  <span className="text-primary-foreground font-bold text-lg">1</span>
                </div>
                <h1 className="text-xl font-bold text-foreground">The 1 App</h1>
              </div>
              <div className="hidden md:block">
                <nav className="flex space-x-8">
                  <button 
                    onClick={() => setActiveView('dashboard')}
                    className={`${
                      activeView === 'dashboard' 
                        ? 'text-primary font-medium border-b-2 border-primary pb-2' 
                        : 'text-muted-foreground hover:text-foreground transition-colors'
                    }`}
                    data-testid="nav-dashboard"
                  >
                    Dashboard
                  </button>
                  <button 
                    onClick={() => setActiveView('portfolio')}
                    className={`${
                      activeView === 'portfolio' 
                        ? 'text-primary font-medium border-b-2 border-primary pb-2' 
                        : 'text-muted-foreground hover:text-foreground transition-colors'
                    }`}
                    data-testid="nav-portfolio"
                  >
                    Portfolio
                  </button>
                  <button 
                    onClick={() => setActiveView('analytics')}
                    className={`${
                      activeView === 'analytics' 
                        ? 'text-primary font-medium border-b-2 border-primary pb-2' 
                        : 'text-muted-foreground hover:text-foreground transition-colors'
                    }`}
                    data-testid="nav-analytics"
                  >
                    Analytics
                  </button>
                  <a 
                    href="#" 
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="nav-settings"
                  >
                    Settings
                  </a>
                </nav>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 text-sm">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                <span className="text-muted-foreground" data-testid="status-live-data">Live Data</span>
              </div>
              <button 
                className="text-muted-foreground hover:text-foreground"
                data-testid="button-settings"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeView === 'dashboard' && (
          <>
            {/* Market Overview */}
            <MarketOverview data={marketData} isLoading={marketLoading} />

            {/* Options Trader AI */}
            <OptionsTraderAI 
              insights={aiInsights} 
              trades={topTrades} 
              isLoading={aiLoading || tradesLoading}
            />

            {/* Additional Dashboard Widgets */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Portfolio Summary */}
          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold" data-testid="text-portfolio-title">Portfolio Summary</h3>
                <PieChart className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total Value</span>
                  <span 
                    className="font-semibold" 
                    data-testid="text-total-value"
                  >
                    {portfolioData?.totalValue !== undefined ? `$${portfolioData.totalValue.toLocaleString()}` : 'Loading...'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Daily P&L</span>
                  <span 
                    className={`font-semibold ${(portfolioData?.dailyPnL ?? 0) >= 0 ? 'text-primary' : 'text-destructive'}`}
                    data-testid="text-daily-pnl"
                  >
                    {portfolioData?.dailyPnL !== undefined ? 
                      `${portfolioData.dailyPnL >= 0 ? '+' : ''}$${portfolioData.dailyPnL.toLocaleString()}` : 
                      'Loading...'
                    }
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Options Positions</span>
                  <span 
                    className="font-semibold" 
                    data-testid="text-options-count"
                  >
                    {portfolioData?.optionsCount ?? 'Loading...'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Buying Power</span>
                  <span 
                    className="font-semibold" 
                    data-testid="text-buying-power"
                  >
                    {portfolioData?.buyingPower !== undefined ? `$${portfolioData.buyingPower.toLocaleString()}` : 'Loading...'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Market Heat Map */}
          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold" data-testid="text-heatmap-title">Market Heat Map</h3>
                <Thermometer className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {sectorData?.map((sector: any, index: number) => (
                  <div 
                    key={sector.name}
                    className={`${
                      sector.change >= 0 
                        ? 'bg-primary/20 border-primary/40' 
                        : 'bg-destructive/20 border-destructive/40'
                    } border rounded p-2 text-center`}
                    data-testid={`sector-${sector.name.toLowerCase()}`}
                  >
                    <p className="text-xs text-muted-foreground">{sector.name}</p>
                    <p className={`text-sm font-semibold ${
                      sector.change >= 0 ? 'text-primary' : 'text-destructive'
                    }`}>
                      {sector.change >= 0 ? '+' : ''}{sector.change}%
                    </p>
                  </div>
                )) || (
                  // Fallback loading state
                  Array.from({ length: 6 }).map((_, index) => (
                    <div 
                      key={index}
                      className="bg-muted border border-border rounded p-2 text-center animate-pulse"
                    >
                      <div className="h-3 bg-muted-foreground/20 rounded mb-1"></div>
                      <div className="h-4 bg-muted-foreground/20 rounded"></div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* AI System Status */}
          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold" data-testid="text-ai-status-title">AI System Status</h3>
                <Activity className="w-5 h-5 text-primary" />
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Data Scraping</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                    <span className="text-sm text-primary" data-testid="status-data-scraping">Active</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Sentiment Analysis</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                    <span className="text-sm text-primary" data-testid="status-sentiment-analysis">Running</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Options Scanner</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                    <span className="text-sm text-primary" data-testid="status-options-scanner">Live</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Risk Management</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-primary rounded-full"></div>
                    <span className="text-sm text-primary" data-testid="status-risk-management">Enabled</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
          </>
        )}
        
        {activeView === 'portfolio' && (
          <PortfolioTracker />
        )}
        
        {activeView === 'analytics' && (
          <div className="text-center py-12">
            <h2 className="text-2xl font-bold text-muted-foreground">Analytics Coming Soon</h2>
            <p className="text-muted-foreground mt-2">Advanced analytics and reporting features will be available in future updates.</p>
          </div>
        )}
      </main>
    </div>
  );
}
