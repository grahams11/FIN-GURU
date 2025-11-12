import { useQuery } from "@tanstack/react-query";
import { UoaTradeCard } from "./UoaTradeCard";
import type { UoaTrade } from "@shared/schema";
import { Loader2, Zap, Check, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface UoaResponse {
  success: boolean;
  trades: UoaTrade[];
  lastUpdated: string | null;
  isStale: boolean;
  count: number;
}

export function UoaPhase4Panel() {
  const { data, isLoading, error } = useQuery<UoaResponse>({
    queryKey: ["/api/uoa-top-trades"],
    refetchInterval: 120000, // Refresh every 2 minutes (matches UOA scanner interval)
  });

  const trades = data?.trades ?? [];
  const phase4PassedCount = trades.filter(t => 
    (t.phase4Score ?? 0) >= 70 && (t.phase4ActiveLayers ?? 0) >= 2
  ).length;
  
  const avgPhase4Score = trades.length > 0
    ? trades.reduce((sum, t) => sum + (t.phase4Score ?? 0), 0) / trades.length
    : 0;

  return (
    <Card className="border-primary/30" data-testid="panel-uoa-phase4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            <CardTitle data-testid="text-uoa-title">UOA Scanner - Phase 4 Intelligence</CardTitle>
            <Badge variant="outline" className="gap-1" data-testid="badge-enhanced">
              Enhanced
            </Badge>
          </div>
          
          {!isLoading && trades.length > 0 && (
            <div className="flex gap-4 text-sm">
              <div className="text-center" data-testid="metric-passed">
                <p className="text-xs text-muted-foreground">Passed Gate</p>
                <p className="font-bold text-primary">{phase4PassedCount}/{trades.length}</p>
              </div>
              <div className="text-center" data-testid="metric-avg-score">
                <p className="text-xs text-muted-foreground">Avg Score</p>
                <p className="font-bold">{avgPhase4Score.toFixed(0)}</p>
              </div>
            </div>
          )}
        </div>
        
        {/* Description */}
        <p className="text-sm text-muted-foreground mt-2" data-testid="text-description">
          Institutional-grade unusual options activity enhanced with Ghost 1DTE Phase 4 scoring: 
          Max Pain detection, IV skew analysis, sweep identification, and RSI momentum.
        </p>
        
        {/* Status Badge */}
        {data && (
          <div className="flex items-center gap-2 mt-2">
            {data.isStale ? (
              <Badge variant="outline" className="gap-1" data-testid="badge-status-stale">
                <Loader2 className="w-3 h-3 animate-spin" />
                Scanning...
              </Badge>
            ) : (
              <Badge variant="default" className="gap-1" data-testid="badge-status-fresh">
                <Check className="w-3 h-3" />
                Live - {data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString() : 'Pending first scan'}
              </Badge>
            )}
            <Badge variant="secondary" className="gap-1" data-testid="badge-hybrid-scoring">
              <TrendingUp className="w-3 h-3" />
              70% UOA + 30% Phase 4 Hybrid
            </Badge>
          </div>
        )}
      </CardHeader>
      
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-12" data-testid="loading-spinner">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="text-center py-12" data-testid="error-message">
            <p className="text-destructive">Failed to load UOA trades</p>
            <p className="text-sm text-muted-foreground mt-2">Please try refreshing the page</p>
          </div>
        ) : trades.length === 0 ? (
          <div className="text-center py-12" data-testid="empty-state">
            <p className="text-muted-foreground text-lg">No UOA plays available</p>
            <p className="text-sm text-muted-foreground mt-2">
              Waiting for institutional-grade opportunities that pass Phase 4 quality gates
            </p>
          </div>
        ) : (
          trades.map((trade, index) => (
            <UoaTradeCard key={trade.id} trade={trade} rank={index + 1} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
