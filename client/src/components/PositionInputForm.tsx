import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { PlusCircle, Calculator } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

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
                    <FormControl>
                      <Input 
                        placeholder="AAPL" 
                        {...field} 
                        className="uppercase"
                        data-testid="input-ticker"
                      />
                    </FormControl>
                    <FormMessage />
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