import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TrendingUp, TrendingDown, DollarSign, BarChart3, Clock, Target, Brain, AlertTriangle, CheckCircle, Plus } from "lucide-react";
import type { 
  PortfolioPosition, 
  PositionPerformance, 
  TradeHistory, 
  PerformanceMetrics,
  PositionAnalysis,
  PortfolioAnalysis 
} from "@shared/schema";
import { PositionInputForm } from "./PositionInputForm";

export function PortfolioTracker() {
  const [activeTab, setActiveTab] = useState("input");

  const { data: positions, isLoading: positionsLoading } = useQuery<PortfolioPosition[]>({
    queryKey: ['/api/portfolio/positions'],
    refetchInterval: 5000 // Refresh every 5 seconds for real-time Tastytrade data
  });

  const { data: portfolioAnalysis, isLoading: portfolioAnalysisLoading } = useQuery<PortfolioAnalysis>({
    queryKey: ['/api/portfolio/analysis'],
    refetchInterval: 10000, // Refresh every 10 seconds
    enabled: positions && positions.length > 0
  });

  const { data: performance, isLoading: performanceLoading } = useQuery<PositionPerformance[]>({
    queryKey: ['/api/positions/performance'],
    refetchInterval: 30000
  });

  const { data: tradeHistory, isLoading: tradesLoading } = useQuery<TradeHistory[]>({
    queryKey: ['/api/trade-history'],
    refetchInterval: 60000 // Refresh every minute
  });

  const { data: metrics, isLoading: metricsLoading } = useQuery<PerformanceMetrics>({
    queryKey: ['/api/performance-metrics'],
    refetchInterval: 300000 // Refresh every 5 minutes
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const formatPercent = (value: number | null | undefined) => {
    if (value == null) return '0.00%';
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const formatDate = (dateString: string | Date | null) => {
    if (!dateString) return 'N/A';
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getPositionTypeColor = (type: string) => {
    return type === 'options' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' :
           'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
  };

  const getTradeTypeColor = (type: string) => {
    return type === 'buy' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' :
           type === 'sell' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' :
           'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
  };

  return (
    <div className="space-y-6" data-testid="portfolio-tracker">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-portfolio-title">Portfolio Tracker</h2>
          <p className="text-muted-foreground">Manage your positions and track performance</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="input" data-testid="tab-input">
            <Plus className="h-4 w-4 mr-2" />
            Add Position
          </TabsTrigger>
          <TabsTrigger value="positions" data-testid="tab-positions">Positions</TabsTrigger>
          <TabsTrigger value="analysis" data-testid="tab-analysis">Live Analysis</TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-performance">Performance</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="input" className="space-y-4">
          <PositionInputForm 
            onSuccess={() => {
              // Switch to positions tab after successful input
              setActiveTab("positions");
            }} 
          />
        </TabsContent>

        <TabsContent value="analysis" className="space-y-4">
          {portfolioAnalysisLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <div className="animate-pulse space-y-3">
                      <div className="bg-muted h-4 w-24 rounded" />
                      <div className="bg-muted h-8 w-32 rounded" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : portfolioAnalysis ? (
            <>
              {/* Portfolio Overview Cards */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between space-y-0 pb-2">
                      <div className="text-sm font-medium">Portfolio Health</div>
                      <Brain className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold" data-testid="text-portfolio-health">
                        {portfolioAnalysis?.overallSentiment?.toFixed(1) || '0.0'}/5.0
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Overall strength
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between space-y-0 pb-2">
                      <div className="text-sm font-medium">Risk Level</div>
                      <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold" data-testid="text-risk-level">
                        {portfolioAnalysis?.riskLevel || 'N/A'}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Current exposure
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between space-y-0 pb-2">
                      <div className="text-sm font-medium">Total Positions</div>
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold" data-testid="text-total-positions">
                        {portfolioAnalysis?.positions?.length || 0}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Active trades
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between space-y-0 pb-2">
                      <div className="text-sm font-medium">Recommendations</div>
                      <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-primary" data-testid="text-recommendations-count">
                        {portfolioAnalysis?.recommendations?.length || 0}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        AI suggestions
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Key Recommendations */}
              {portfolioAnalysis?.recommendations && portfolioAnalysis.recommendations.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="h-5 w-5" />
                      AI Recommendations
                    </CardTitle>
                    <CardDescription>
                      Live analysis and suggestions based on current market conditions
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {portfolioAnalysis.recommendations.map((rec, index) => (
                      <Alert key={index} className={rec.priority === 'high' ? 'border-destructive' : rec.priority === 'medium' ? 'border-yellow-500' : 'border-primary'}>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle className="capitalize">{rec.priority} Priority</AlertTitle>
                        <AlertDescription>
                          <div className="space-y-2">
                            <p><strong>{rec.action}:</strong> {rec.description}</p>
                            <p className="text-sm text-muted-foreground">
                              <strong>Reasoning:</strong> {rec.reasoning}
                            </p>
                          </div>
                        </AlertDescription>
                      </Alert>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Individual Position Analysis */}
              {portfolioAnalysis?.positions && portfolioAnalysis.positions.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      Position Analysis
                    </CardTitle>
                    <CardDescription>
                      Detailed analysis for each position with exit strategies
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Position</TableHead>
                            <TableHead>Current Price</TableHead>
                            <TableHead>Sentiment</TableHead>
                            <TableHead>P&L</TableHead>
                            <TableHead>Exit Strategy</TableHead>
                            <TableHead>Risk</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {portfolioAnalysis.positions.map((analysis: PositionAnalysis) => {
                            const pnl = analysis.unrealizedPnL;
                            const pnlPercent = analysis.unrealizedPnLPercent;
                            
                            return (
                              <TableRow key={analysis.ticker} data-testid={`row-analysis-${analysis.ticker}`}>
                                <TableCell>
                                  <div>
                                    <div className="font-medium">{analysis.ticker}</div>
                                    <div className="text-sm text-muted-foreground">
                                      {analysis.positionType} • {Math.abs(analysis.quantity)} shares
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell data-testid={`text-current-price-${analysis.ticker}`}>
                                  {formatCurrency(analysis.currentPrice)}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${
                                      analysis.sentiment >= 4 ? 'bg-green-500' :
                                      analysis.sentiment >= 3 ? 'bg-yellow-500' : 'bg-red-500'
                                    }`}></div>
                                    <span className="text-sm font-medium" data-testid={`text-sentiment-${analysis.ticker}`}>
                                      {analysis.sentiment?.toFixed(1) || '0.0'}/5.0
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell data-testid={`text-pnl-${analysis.ticker}`}>
                                  <div className={`flex items-center gap-1 ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {pnl >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                                    <span>{formatCurrency(pnl)}</span>
                                    <span className="text-sm">({formatPercent(pnlPercent)})</span>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="max-w-xs">
                                    <p className="text-sm font-medium text-primary">{analysis.exitStrategy.action}</p>
                                    <p className="text-xs text-muted-foreground truncate">{analysis.exitStrategy.reasoning}</p>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={
                                    analysis.riskLevel === 'high' ? 'destructive' :
                                    analysis.riskLevel === 'medium' ? 'secondary' : 'default'
                                  }>
                                    {analysis.riskLevel}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-muted-foreground" data-testid="text-no-analysis">
                  Add some positions to see live analysis and AI recommendations.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="positions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Current Positions
              </CardTitle>
              <CardDescription>
                Your open positions and their current performance
              </CardDescription>
            </CardHeader>
            <CardContent>
              {positionsLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse bg-muted h-16 rounded" />
                  ))}
                </div>
              ) : positions && positions.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Avg Cost</TableHead>
                        <TableHead>Current Price</TableHead>
                        <TableHead>P&L</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {positions.map((position: PortfolioPosition) => {
                        const currentValue = (position.currentPrice || position.avgCost) * Math.abs(position.quantity);
                        const totalCost = position.avgCost * Math.abs(position.quantity);
                        const unrealizedPnL = currentValue - totalCost;
                        const unrealizedPnLPercent = (unrealizedPnL / totalCost) * 100;

                        return (
                          <TableRow key={position.id} data-testid={`row-position-${position.id}`}>
                            <TableCell className="font-medium" data-testid={`text-ticker-${position.ticker}`}>
                              {position.ticker}
                            </TableCell>
                            <TableCell>
                              <Badge className={getPositionTypeColor(position.positionType)}>
                                {position.positionType}
                              </Badge>
                            </TableCell>
                            <TableCell data-testid={`text-quantity-${position.id}`}>
                              {position.quantity}
                            </TableCell>
                            <TableCell data-testid={`text-avg-cost-${position.id}`}>
                              {formatCurrency(position.avgCost)}
                            </TableCell>
                            <TableCell data-testid={`text-current-price-${position.id}`}>
                              {formatCurrency(position.currentPrice || position.avgCost)}
                            </TableCell>
                            <TableCell data-testid={`text-pnl-${position.id}`}>
                              <div className={`flex items-center gap-1 ${unrealizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {unrealizedPnL >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                                <span>{formatCurrency(unrealizedPnL)}</span>
                                <span className="text-sm">({formatPercent(unrealizedPnLPercent)})</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={position.status === 'open' ? 'default' : 'secondary'}>
                                {position.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {position.status === 'open' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  data-testid={`button-close-position-${position.id}`}
                                >
                                  Close
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground" data-testid="text-no-positions">
                  No open positions. Execute some trades to see them here.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {performanceLoading ? (
              [...Array(4)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <div className="animate-pulse space-y-3">
                      <div className="bg-muted h-4 w-24 rounded" />
                      <div className="bg-muted h-8 w-32 rounded" />
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : performance && performance.length > 0 ? (
              performance.slice(0, 4).map((perf: PositionPerformance) => (
                <Card key={perf.position.id}>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between space-y-0 pb-2">
                      <div className="text-sm font-medium" data-testid={`text-perf-ticker-${perf.position.ticker}`}>
                        {perf.position.ticker}
                      </div>
                      <Badge className={getPositionTypeColor(perf.position.positionType)}>
                        {perf.position.positionType}
                      </Badge>
                    </div>
                    <div>
                      <div className="text-2xl font-bold" data-testid={`text-perf-value-${perf.position.id}`}>
                        {formatCurrency(perf.currentValue)}
                      </div>
                      <p className={`text-xs ${perf.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`} data-testid={`text-perf-return-${perf.position.id}`}>
                        {formatPercent(perf.totalReturnPercent)} total return
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card className="col-span-full">
                <CardContent className="p-6 text-center text-muted-foreground">
                  No performance data available
                </CardContent>
              </Card>
            )}
          </div>

          {performance && performance.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Position Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Position</TableHead>
                        <TableHead>Current Value</TableHead>
                        <TableHead>Day Change</TableHead>
                        <TableHead>Total Return</TableHead>
                        <TableHead>Performance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {performance.map((perf: PositionPerformance) => (
                        <TableRow key={perf.position.id} data-testid={`row-performance-${perf.position.id}`}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{perf.position.ticker}</div>
                              <div className="text-sm text-muted-foreground">
                                {perf.position.quantity} {perf.position.positionType}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell data-testid={`text-current-value-${perf.position.id}`}>
                            {formatCurrency(perf.currentValue)}
                          </TableCell>
                          <TableCell data-testid={`text-day-change-${perf.position.id}`}>
                            <div className={perf.dayChange >= 0 ? 'text-green-600' : 'text-red-600'}>
                              {formatCurrency(perf.dayChange)} ({formatPercent(perf.dayChangePercent)})
                            </div>
                          </TableCell>
                          <TableCell data-testid={`text-total-return-${perf.position.id}`}>
                            <div className={perf.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}>
                              {formatCurrency(perf.totalReturn)} ({formatPercent(perf.totalReturnPercent)})
                            </div>
                          </TableCell>
                          <TableCell>
                            <Progress 
                              value={Math.min(Math.max(perf.totalReturnPercent + 50, 0), 100)} 
                              className="w-20"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Trade History
              </CardTitle>
              <CardDescription>
                Recent trading activity and transaction records
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tradesLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="animate-pulse bg-muted h-12 rounded" />
                  ))}
                </div>
              ) : tradeHistory && tradeHistory.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Total Value</TableHead>
                        <TableHead>Fees</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tradeHistory.map((trade: TradeHistory) => (
                        <TableRow key={trade.id} data-testid={`row-trade-${trade.id}`}>
                          <TableCell data-testid={`text-trade-date-${trade.id}`}>
                            {formatDate(trade.tradeDate)}
                          </TableCell>
                          <TableCell className="font-medium" data-testid={`text-trade-ticker-${trade.id}`}>
                            {trade.ticker}
                          </TableCell>
                          <TableCell>
                            <Badge className={getTradeTypeColor(trade.tradeType)}>
                              {trade.tradeType}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`text-trade-quantity-${trade.id}`}>
                            {trade.quantity}
                          </TableCell>
                          <TableCell data-testid={`text-trade-price-${trade.id}`}>
                            {formatCurrency(trade.price)}
                          </TableCell>
                          <TableCell data-testid={`text-trade-total-${trade.id}`}>
                            {formatCurrency(trade.totalValue)}
                          </TableCell>
                          <TableCell data-testid={`text-trade-fees-${trade.id}`}>
                            {formatCurrency(trade.fees || 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground" data-testid="text-no-trades">
                  No trade history available. Execute some trades to see them here.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {metricsLoading ? (
              [...Array(4)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <div className="animate-pulse space-y-3">
                      <div className="bg-muted h-4 w-24 rounded" />
                      <div className="bg-muted h-8 w-32 rounded" />
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : metrics ? (
              <>
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between space-y-0 pb-2">
                      <div className="text-sm font-medium">Total Return</div>
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold" data-testid="text-total-return">
                        {formatCurrency(metrics.totalReturn)}
                      </div>
                      <p className="text-xs text-muted-foreground" data-testid="text-total-return-percent">
                        {formatPercent(metrics.totalReturnPercent)}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between space-y-0 pb-2">
                      <div className="text-sm font-medium">Win Rate</div>
                      <Target className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold" data-testid="text-win-rate">
                        {formatPercent(metrics.winRate)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Success rate
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between space-y-0 pb-2">
                      <div className="text-sm font-medium">Avg Win</div>
                      <TrendingUp className="h-4 w-4 text-green-600" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-green-600" data-testid="text-avg-win">
                        {formatCurrency(metrics.avgWin)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Per winning trade
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between space-y-0 pb-2">
                      <div className="text-sm font-medium">Avg Loss</div>
                      <TrendingDown className="h-4 w-4 text-red-600" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-red-600" data-testid="text-avg-loss">
                        -{formatCurrency(metrics.avgLoss)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Per losing trade
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="col-span-full">
                <CardContent className="p-6 text-center text-muted-foreground">
                  No analytics data available
                </CardContent>
              </Card>
            )}
          </div>

          {metrics && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Key Metrics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <span>Profit Factor</span>
                    <span className="font-medium" data-testid="text-profit-factor">
                      {metrics.profitFactor?.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sharpe Ratio</span>
                    <span className="font-medium" data-testid="text-sharpe-ratio">
                      {metrics.sharpeRatio?.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Max Drawdown</span>
                    <span className="font-medium text-red-600" data-testid="text-max-drawdown">
                      {formatPercent(metrics.maxDrawdown)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Largest Win</span>
                    <span className="font-medium text-green-600" data-testid="text-largest-win">
                      {formatCurrency(metrics.largestWin)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Largest Loss</span>
                    <span className="font-medium text-red-600" data-testid="text-largest-loss">
                      -{formatCurrency(metrics.largestLoss)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Trade Distribution</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {metrics.tradeDistribution.map((dist, index) => (
                    <div key={index} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{dist.range}</span>
                        <span data-testid={`text-trade-dist-${index}`}>{dist.count} trades</span>
                      </div>
                      <Progress 
                        value={(dist.count / Math.max(...metrics.tradeDistribution.map(d => d.count))) * 100} 
                        className="h-2"
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}