import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { TrendingUp, TrendingDown, AlertTriangle, DollarSign, Activity, Clock, Target } from "lucide-react";
import type { PortfolioPosition, PositionAnalysis, PortfolioAnalysis } from "@shared/schema";
import { getContractMultiplier } from "@shared/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLiveQuotes } from "@/hooks/use-live-quotes";
import { Navigation } from "@/components/Navigation";

export default function Portfolio() {
  const [selectedTab, setSelectedTab] = useState("positions");

  // Fetch open positions
  const { data: positions, isLoading: loadingPositions } = useQuery<PortfolioPosition[]>({
    queryKey: ["/api/portfolio/positions"],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Fetch full portfolio analysis
  const { data: portfolioAnalysis, isLoading: loadingAnalysis } = useQuery<PortfolioAnalysis>({
    queryKey: ["/api/portfolio/analysis"],
    refetchInterval: 10000, // Refresh every 10 seconds
  });
  
  // Fetch account balance
  const { data: accountBalance } = useQuery<{ netLiquidatingValue: number; cashBalance: number; totalValue: number }>({
    queryKey: ["/api/portfolio/balance"],
    refetchInterval: 5000, // Refresh every 5 seconds
  });
  
  // Fetch lifetime realized P/L
  const { data: lifetimePnL } = useQuery<{ lifetimeRealized: number }>({
    queryKey: ["/api/portfolio/pnl-lifetime"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });
  
  // Fetch today's P/L
  const { data: pnlDay } = useQuery<{ realized: number; unrealized: number; total: number }>({
    queryKey: ["/api/portfolio/pnl-day"],
    refetchInterval: 10000, // Refresh every 10 seconds
  });
  
  // Extract tickers from positions for live quotes
  const portfolioTickers = useMemo(() => {
    if (!positions || positions.length === 0) return [];
    return positions.map(p => p.ticker);
  }, [positions]);

  // Close position mutation
  const closePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      return await apiRequest("DELETE", `/api/portfolio/positions/${positionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/analysis"] });
    },
  });

  // Subscribe to live quotes for portfolio tickers
  const { quotes, isConnected } = useLiveQuotes(portfolioTickers);

  if (loadingPositions || loadingAnalysis) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <Activity className="h-12 w-12 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading portfolio...</p>
        </div>
      </div>
    );
  }

  const openPositions = positions || [];
  const analysis = portfolioAnalysis;

  return (
    <>
      <Navigation />
      <div className="container mx-auto p-6 space-y-6">
        {/* Portfolio Header */}
        <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold">Portfolio Analysis</h1>
          <p className="text-muted-foreground mt-2">
            Track positions and exit recommendations
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <Badge variant="outline" className="gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              Live Updates
            </Badge>
          )}
        </div>
      </div>

      {/* Portfolio Summary Cards */}
      {(analysis || accountBalance || pnlDay) && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Account Net Liq</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${(accountBalance?.netLiquidatingValue ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Cash: ${(accountBalance?.cashBalance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Today's Change</CardTitle>
              {(pnlDay?.total ?? 0) >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${(pnlDay?.total ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {(pnlDay?.total ?? 0) >= 0 ? '+' : ''}${(pnlDay?.total ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              {pnlDay && accountBalance && (
                <p className={`text-xs mt-1 ${(pnlDay.total / accountBalance.netLiquidatingValue * 100) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {((pnlDay.total / accountBalance.netLiquidatingValue) * 100).toFixed(1)}% today
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Open Positions</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analysis?.positions.length ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Portfolio Risk: <span className={`font-medium ${
                  analysis?.riskLevel === 'HIGH' ? 'text-red-500' :
                  analysis?.riskLevel === 'MEDIUM' ? 'text-yellow-500' : 'text-green-500'
                }`}>{analysis?.riskLevel ?? 'N/A'}</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total P&L</CardTitle>
              {(lifetimePnL?.lifetimeRealized ?? 0) >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${(lifetimePnL?.lifetimeRealized ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {(lifetimePnL?.lifetimeRealized ?? 0) >= 0 ? '+' : ''}${(lifetimePnL?.lifetimeRealized ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Lifetime realized
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Portfolio Recommendations */}
      {analysis && analysis.recommendations.length > 0 && (
        <Alert className="border-yellow-500/50 bg-yellow-500/10">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              {analysis.recommendations.map((rec, idx) => (
                <p key={idx} className="text-sm">{rec}</p>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Positions Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="positions" data-testid="tab-positions">
            Positions ({openPositions.length})
          </TabsTrigger>
          <TabsTrigger value="analysis" data-testid="tab-analysis">
            Exit Analysis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="positions" className="space-y-4">
          {openPositions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Activity className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No open positions</p>
                <p className="text-sm text-muted-foreground mt-2">Execute trades from the Dashboard to see them here</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {openPositions.map((position) => {
                const liveQuote = quotes[position.ticker];
                const currentPrice = liveQuote?.price || position.currentPrice || position.avgCost;
                // Apply contract multiplier (100x for options, 1x for stocks)
                const contractMultiplier = getContractMultiplier(position.positionType);
                const totalCost = position.avgCost * position.quantity * contractMultiplier;
                const currentValue = currentPrice * position.quantity * contractMultiplier;
                const pnl = currentValue - totalCost;
                const pnlPercent = (pnl / totalCost) * 100;

                return (
                  <Card key={position.id} className="overflow-hidden" data-testid={`position-card-${position.ticker}`}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <CardTitle className="text-2xl font-bold">{position.ticker}</CardTitle>
                            <Badge variant={position.positionType === 'options' ? 'default' : 'secondary'}>
                              {position.positionType.toUpperCase()}
                            </Badge>
                            {liveQuote && (
                              <Badge variant="outline" className="gap-2">
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                </span>
                                Live
                              </Badge>
                            )}
                          </div>
                          <CardDescription className="mt-2">
                            {position.quantity} {position.positionType === 'options' ? 'contracts' : 'shares'} @ ${position.avgCost.toFixed(2)}
                          </CardDescription>
                        </div>
                        <div className="text-right">
                          <div className={`text-2xl font-bold ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <div className={`text-sm ${pnlPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Position Metrics */}
                      <div className="grid grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Current Price</p>
                          <p className="font-medium">${currentPrice.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Total Cost</p>
                          <p className="font-medium">${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Current Value</p>
                          <p className="font-medium">${currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Entry Date</p>
                          <p className="font-medium">{position.openDate ? new Date(position.openDate).toLocaleDateString() : 'N/A'}</p>
                        </div>
                      </div>

                      <Separator />

                      {/* Action Buttons */}
                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => closePositionMutation.mutate(position.id)}
                          disabled={closePositionMutation.isPending}
                          data-testid={`button-close-${position.ticker}`}
                        >
                          Close Position
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analysis" className="space-y-4">
          {analysis && analysis.positions.length > 0 ? (
            <div className="grid gap-4">
              {analysis.positions.map((positionAnalysis) => (
                <PositionAnalysisCard
                  key={positionAnalysis.id}
                  analysis={positionAnalysis}
                  livePrice={quotes[positionAnalysis.ticker]?.price}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Target className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No positions to analyze</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
      </div>
    </>
  );
}

function PositionAnalysisCard({ analysis, livePrice }: { analysis: PositionAnalysis; livePrice?: number }) {
  const currentPrice = livePrice || analysis.currentPrice;
  const { exitStrategy, riskLevel, greeks, timeToExpiry } = analysis;

  // Determine recommendation color
  const getRecommendationColor = (rec: typeof exitStrategy.recommendation) => {
    switch (rec) {
      case 'TAKE_PROFIT':
        return 'bg-green-500/10 border-green-500/50 text-green-500';
      case 'CUT_LOSS':
        return 'bg-red-500/10 border-red-500/50 text-red-500';
      case 'MONITOR':
        return 'bg-yellow-500/10 border-yellow-500/50 text-yellow-500';
      default:
        return 'bg-blue-500/10 border-blue-500/50 text-blue-500';
    }
  };

  const getRecommendationIcon = (rec: typeof exitStrategy.recommendation) => {
    switch (rec) {
      case 'TAKE_PROFIT':
        return <TrendingUp className="h-5 w-5" />;
      case 'CUT_LOSS':
        return <AlertTriangle className="h-5 w-5" />;
      default:
        return <Activity className="h-5 w-5" />;
    }
  };

  return (
    <Card className="overflow-hidden" data-testid={`analysis-card-${analysis.ticker}`}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <CardTitle className="text-2xl font-bold">{analysis.ticker}</CardTitle>
              <Badge variant={analysis.positionType === 'options' ? 'default' : 'secondary'}>
                {analysis.positionType.toUpperCase()}
              </Badge>
              <Badge className={`${
                riskLevel === 'HIGH' ? 'bg-red-500' :
                riskLevel === 'MEDIUM' ? 'bg-yellow-500' : 'bg-green-500'
              }`}>
                {riskLevel} RISK
              </Badge>
            </div>
            <CardDescription className="mt-2">
              {analysis.quantity} {analysis.positionType === 'options' ? 'contracts' : 'shares'}
            </CardDescription>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold ${analysis.unrealizedPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {analysis.unrealizedPnL >= 0 ? '+' : ''}${Math.abs(analysis.unrealizedPnL).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={`text-sm ${analysis.unrealizedPnLPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {analysis.unrealizedPnLPercent >= 0 ? '+' : ''}{analysis.unrealizedPnLPercent.toFixed(2)}%
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Exit Strategy Recommendation */}
        <Alert className={getRecommendationColor(exitStrategy.recommendation)}>
          <div className="flex items-start gap-3">
            {getRecommendationIcon(exitStrategy.recommendation)}
            <div className="flex-1 space-y-2">
              <div className="font-semibold text-lg">{exitStrategy.recommendation.replace('_', ' ')}</div>
              <div className="space-y-1">
                {exitStrategy.reasoning.map((reason, idx) => (
                  <p key={idx} className="text-sm">{reason}</p>
                ))}
              </div>
            </div>
          </div>
        </Alert>

        {/* Exit Targets */}
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Target className="h-4 w-4" />
              <span>Profit Target</span>
            </div>
            <p className="font-medium text-green-500">${exitStrategy.profitTarget.toFixed(2)}</p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <AlertTriangle className="h-4 w-4" />
              <span>Stop Loss</span>
            </div>
            <p className="font-medium text-red-500">${exitStrategy.stopLoss.toFixed(2)}</p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              <span>Time Exit</span>
            </div>
            <p className="font-medium">{exitStrategy.timeBasedExit}</p>
          </div>
        </div>

        {/* Greeks for Options */}
        {greeks && analysis.positionType === 'options' && (
          <>
            <Separator />
            <div>
              <p className="text-sm font-medium mb-3">Options Greeks</p>
              <div className="grid grid-cols-5 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Delta</p>
                  <p className="font-medium">{greeks.delta.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Gamma</p>
                  <p className="font-medium">{greeks.gamma.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Theta</p>
                  <p className="font-medium text-red-500">{greeks.theta.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Vega</p>
                  <p className="font-medium">{greeks.vega.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Days to Expiry</p>
                  <p className="font-medium">{timeToExpiry?.toFixed(0) || 'N/A'}</p>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
