import React, { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { PlusCircle, Calculator, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { SymbolSuggestion, PriceQuote } from "@shared/schema";

const positionSchema = z.object({
  ticker: z.string().min(1, "Ticker is required").max(10, "Ticker too long"),
  positionType: z.enum(["options", "stock"]),
  quantity: z.number().min(1, "Quantity must be positive"),
  avgCost: z.number().min(0.01, "Average cost must be positive"),
  
  // Options specific fields
  strike: z.number().optional(),
  expiry: z.string().optional(),
  optionType: z.enum(["call", "put"]).optional(),
  contracts: z.number().optional(),
}).refine((data) => {
  if (data.positionType === "options") {
    return data.strike && data.expiry && data.optionType && data.contracts;
  }
  return true;
}, {
  message: "Options positions require strike, expiry, option type, and contracts"
});

type PositionFormData = z.infer<typeof positionSchema>;

interface PositionInputFormProps {
  onSuccess?: () => void;
}

export function PositionInputForm({ onSuccess }: PositionInputFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tickerInput, setTickerInput] = useState("");
  const [tickerPopoverOpen, setTickerPopoverOpen] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<PositionFormData>({
    resolver: zodResolver(positionSchema),
    defaultValues: {
      ticker: "",
      positionType: "stock",
      quantity: 1,
      avgCost: 0,
      strike: undefined,
      expiry: "",
      optionType: "call",
      contracts: 1,
    },
  });

  const positionType = form.watch("positionType");

  // Ticker symbol search query with debouncing
  const tickerSearchQuery = useQuery({
    queryKey: ["/api/symbols", tickerInput],
    queryFn: async (): Promise<SymbolSuggestion[]> => {
      if (!tickerInput || tickerInput.length < 1) return [];
      const response = await fetch(`/api/symbols?q=${encodeURIComponent(tickerInput)}`);
      if (!response.ok) throw new Error('Failed to search symbols');
      return response.json();
    },
    enabled: tickerInput.length >= 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Price quote query for selected ticker
  const selectedTickerValue = form.watch("ticker");
  const priceQuery = useQuery({
    queryKey: ["/api/price", selectedTickerValue],
    queryFn: async (): Promise<PriceQuote> => {
      const response = await fetch(`/api/price/${selectedTickerValue.toUpperCase()}`);
      if (!response.ok) throw new Error('Failed to fetch price');
      return response.json();
    },
    enabled: !!selectedTickerValue && selectedTickerValue.length > 0,
    staleTime: 30 * 1000, // 30 seconds
  });

  // Update current price when price query succeeds
  React.useEffect(() => {
    if (priceQuery.data?.price) {
      setCurrentPrice(priceQuery.data.price);
    }
  }, [priceQuery.data]);

  const createPositionMutation = useMutation({
    mutationFn: async (data: PositionFormData) => {
      let positionData: any = {
        ticker: data.ticker.toUpperCase(),
        positionType: data.positionType,
        quantity: data.positionType === "options" ? data.contracts! : data.quantity,
        avgCost: data.avgCost,
      };

      // Add options metadata if it's an options position
      if (data.positionType === "options") {
        positionData.metadata = {
          strike: data.strike!,
          expiry: data.expiry!,
          optionType: data.optionType!,
          entryPrice: data.avgCost,
          contracts: data.contracts!,
        };
      }

      return await apiRequest("POST", "/api/positions", positionData);
    },
    onSuccess: () => {
      toast({
        title: "Position Added",
        description: "Your position has been successfully added to the portfolio.",
      });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/positions/analysis"] });
      onSuccess?.();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add position. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: PositionFormData) => {
    setIsSubmitting(true);
    try {
      await createPositionMutation.mutateAsync(data);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Generate next Friday options expiry dates
  const getOptionsExpiryDates = () => {
    const dates = [];
    const today = new Date();
    
    for (let i = 0; i < 8; i++) {
      const nextFriday = new Date(today);
      nextFriday.setDate(today.getDate() + (5 - today.getDay() + 7 * i) % 7 + 7 * Math.floor(i / 1));
      
      // Third Friday of the month (standard monthly expiry)
      const year = nextFriday.getFullYear();
      const month = nextFriday.getMonth();
      const firstDay = new Date(year, month, 1);
      const firstFriday = new Date(firstDay.setDate(1 + (5 - firstDay.getDay() + 7) % 7));
      const thirdFriday = new Date(firstFriday.setDate(firstFriday.getDate() + 14));
      
      dates.push({
        date: thirdFriday.toISOString().split('T')[0],
        label: thirdFriday.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric' 
        })
      });
    }
    
    return dates;
  };

  const expiryDates = getOptionsExpiryDates();

  return (
    <Card data-testid="position-input-form">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlusCircle className="h-5 w-5" />
          Add New Position
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="ticker"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ticker Symbol</FormLabel>
                    <Popover open={tickerPopoverOpen} onOpenChange={setTickerPopoverOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                              "w-full justify-between",
                              !field.value && "text-muted-foreground"
                            )}
                            data-testid="input-ticker"
                          >
                            {field.value ? field.value.toUpperCase() : "Select ticker..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0" data-testid="ticker-dropdown">
                        <Command>
                          <CommandInput 
                            placeholder="Search ticker symbols..."
                            value={tickerInput}
                            onValueChange={(value) => {
                              setTickerInput(value);
                            }}
                            data-testid="ticker-search-input"
                          />
                          <CommandList>
                            {tickerSearchQuery.isLoading && (
                              <div className="flex items-center justify-center p-4">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="ml-2 text-sm text-muted-foreground">Searching...</span>
                              </div>
                            )}
                            {tickerSearchQuery.data && tickerSearchQuery.data.length === 0 && tickerInput.length > 0 && (
                              <CommandEmpty>No ticker symbols found.</CommandEmpty>
                            )}
                            {tickerSearchQuery.data && tickerSearchQuery.data.length > 0 && (
                              <CommandGroup>
                                {tickerSearchQuery.data.map((suggestion) => (
                                  <CommandItem
                                    key={suggestion.symbol}
                                    value={suggestion.symbol}
                                    onSelect={(currentValue) => {
                                      field.onChange(currentValue.toUpperCase());
                                      setTickerPopoverOpen(false);
                                      setTickerInput("");
                                    }}
                                    data-testid={`ticker-option-${suggestion.symbol}`}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        field.value === suggestion.symbol ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    <div className="flex flex-col">
                                      <span className="font-medium">{suggestion.symbol}</span>
                                      <span className="text-sm text-muted-foreground truncate">
                                        {suggestion.name}
                                        {suggestion.exchange && ` • ${suggestion.exchange}`}
                                      </span>
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            )}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                    {currentPrice && (
                      <div className="text-sm text-muted-foreground mt-1">
                        Current Price: ${currentPrice.toFixed(2)}
                        {priceQuery.isLoading && <Loader2 className="ml-2 h-3 w-3 animate-spin inline" />}
                      </div>
                    )}
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="positionType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Position Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-position-type">
                          <SelectValue placeholder="Select position type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="stock">Stock</SelectItem>
                        <SelectItem value="options">Options</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name={positionType === "options" ? "contracts" : "quantity"}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {positionType === "options" ? "Contracts" : "Quantity"}
                    </FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        min="1"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        data-testid="input-quantity"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="avgCost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {positionType === "options" ? "Entry Price" : "Average Cost"}
                    </FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        step="0.01"
                        min="0.01"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        data-testid="input-avg-cost"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {positionType === "options" && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="strike"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Strike Price</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            step="0.01"
                            min="0.01"
                            placeholder="0.00"
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            data-testid="input-strike"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="expiry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Expiry Date</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-expiry">
                              <SelectValue placeholder="Select expiry" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {expiryDates.map((expiry) => (
                              <SelectItem key={expiry.date} value={expiry.date}>
                                {expiry.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="optionType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Option Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-option-type">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="call">Call</SelectItem>
                            <SelectItem value="put">Put</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </>
            )}

            <div className="flex gap-4 pt-4">
              <Button 
                type="submit" 
                disabled={isSubmitting}
                className="flex-1"
                data-testid="button-add-position"
              >
                {isSubmitting ? (
                  <>
                    <Calculator className="mr-2 h-4 w-4 animate-spin" />
                    Adding Position...
                  </>
                ) : (
                  <>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add Position
                  </>
                )}
              </Button>
              
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => form.reset()}
                data-testid="button-reset-form"
              >
                Reset
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}