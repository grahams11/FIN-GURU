import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { UoaTrade } from "@shared/schema";
import { TrendingUp, TrendingDown, Check, X, Zap } from "lucide-react";

interface UoaTradeCardProps {
  trade: UoaTrade;
  rank: number;
}

export function UoaTradeCard({ trade, rank }: UoaTradeCardProps) {
  const isCall = trade.optionType === 'call';
  
  // Phase 4 gate status
  const phase4Passed = (trade.phase4Score ?? 0) >= 70 && (trade.phase4ActiveLayers ?? 0) >= 2;
  
  // Layer badge colors based on score
  const getLayerBadgeVariant = (score: number | null) => {
    if (!score) return "outline";
    if (score >= 25) return "default";
    if (score >= 15) return "secondary";
    return "outline";
  };
  
  const getRankBadgeVariant = () => {
    if (rank === 1) return "default";
    if (rank <= 3) return "secondary";
    return "outline";
  };

  return (
    <Card className="border-l-4" style={{ borderLeftColor: phase4Passed ? 'hsl(var(--primary))' : 'hsl(var(--muted))' }} data-testid={`card-uoa-${trade.ticker}`}>
      <CardContent className="p-4">
        {/* Header Row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Badge variant={getRankBadgeVariant()} data-testid={`badge-rank-${rank}`}>
              #{rank}
            </Badge>
            <h3 className="text-lg font-bold" data-testid={`text-ticker-${trade.ticker}`}>{trade.ticker}</h3>
            <Badge variant={isCall ? "default" : "destructive"} data-testid={`badge-type-${trade.optionType}`}>
              {trade.optionType.toUpperCase()}
            </Badge>
            <Badge variant="outline" className="gap-1" data-testid="badge-scanner-uoa">
              <Zap className="w-3 h-3" />
              UOA
            </Badge>
          </div>
          
          {/* Phase 4 Gate Status */}
          <div className="flex items-center gap-2">
            {phase4Passed ? (
              <Badge variant="default" className="gap-1" data-testid="badge-phase4-pass">
                <Check className="w-3 h-3" />
                Phase 4 ✓
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1" data-testid="badge-phase4-fail">
                <X className="w-3 h-3" />
                Phase 4
              </Badge>
            )}
          </div>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-4 gap-3 mb-3">
          <div>
            <p className="text-xs text-muted-foreground">Strike</p>
            <p className="font-semibold" data-testid={`text-strike-${trade.strike}`}>${trade.strike}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Premium</p>
            <p className="font-semibold text-primary" data-testid={`text-premium-${trade.premium}`}>${trade.premium.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">UOA Ratio</p>
            <p className="font-semibold" data-testid={`text-uoa-ratio-${trade.uoaRatio}`}>{trade.uoaRatio.toFixed(1)}x</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Composite</p>
            <p className="font-semibold" data-testid={`text-composite-${trade.compositeScore}`}>{trade.compositeScore.toFixed(0)}</p>
          </div>
        </div>

        {/* Phase 4 Breakdown */}
        {trade.phase4Score !== null && trade.phase4Score !== undefined && (
          <div className="bg-secondary/50 rounded-lg p-3" data-testid="section-phase4-breakdown">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold">Phase 4 Intelligence</p>
              <p className="text-sm font-bold" data-testid={`text-phase4-total-${trade.phase4Score}`}>
                {trade.phase4Score.toFixed(0)}/100
              </p>
            </div>
            
            {/* Layer Badges */}
            <div className="grid grid-cols-4 gap-2">
              {trade.phase4Layer1 !== null && trade.phase4Layer1 !== undefined && (
                <div>
                  <Badge variant={getLayerBadgeVariant(trade.phase4Layer1)} className="w-full justify-center text-xs" data-testid="badge-layer1">
                    L1: {trade.phase4Layer1.toFixed(0)}
                  </Badge>
                  <p className="text-[10px] text-muted-foreground text-center mt-1">Max Pain</p>
                </div>
              )}
              {trade.phase4Layer2 !== null && trade.phase4Layer2 !== undefined && (
                <div>
                  <Badge variant={getLayerBadgeVariant(trade.phase4Layer2)} className="w-full justify-center text-xs" data-testid="badge-layer2">
                    L2: {trade.phase4Layer2.toFixed(0)}
                  </Badge>
                  <p className="text-[10px] text-muted-foreground text-center mt-1">IV Skew</p>
                </div>
              )}
              {trade.phase4Layer3 !== null && trade.phase4Layer3 !== undefined && (
                <div>
                  <Badge variant={getLayerBadgeVariant(trade.phase4Layer3)} className="w-full justify-center text-xs" data-testid="badge-layer3">
                    L3: {trade.phase4Layer3.toFixed(0)}
                  </Badge>
                  <p className="text-[10px] text-muted-foreground text-center mt-1">Sweep</p>
                </div>
              )}
              {trade.phase4Layer4 !== null && trade.phase4Layer4 !== undefined && (
                <div>
                  <Badge variant={getLayerBadgeVariant(trade.phase4Layer4)} className="w-full justify-center text-xs" data-testid="badge-layer4">
                    L4: {trade.phase4Layer4.toFixed(0)}
                  </Badge>
                  <p className="text-[10px] text-muted-foreground text-center mt-1">RSI+DTE</p>
                </div>
              )}
            </div>
            
            <div className="flex items-center justify-between mt-2 text-xs">
              <p className="text-muted-foreground">Active Layers: {trade.phase4ActiveLayers ?? 0}/4</p>
              <p className="text-muted-foreground">Expiry: {trade.expiry}</p>
            </div>
          </div>
        )}

        {/* Greeks Row */}
        <div className="grid grid-cols-4 gap-2 mt-3 text-xs">
          <div>
            <p className="text-muted-foreground">Delta</p>
            <p className="font-medium" data-testid={`text-delta-${trade.delta}`}>{trade.delta.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">IV</p>
            <p className="font-medium" data-testid={`text-iv-${trade.iv}`}>{(trade.iv * 100).toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-muted-foreground">Volume</p>
            <p className="font-medium" data-testid={`text-volume-${trade.volume}`}>{trade.volume.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground">OI</p>
            <p className="font-medium" data-testid={`text-oi-${trade.openInterest}`}>{trade.openInterest.toLocaleString()}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
