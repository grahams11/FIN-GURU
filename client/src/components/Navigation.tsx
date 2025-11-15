import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Briefcase, Zap } from "lucide-react";

export function Navigation() {
  const [location] = useLocation();

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">The 1 App</h1>
          </div>
          <div className="flex gap-2">
            <Link href="/">
              <Button 
                variant={location === "/" ? "default" : "ghost"}
                className="gap-2"
                data-testid="nav-dashboard"
              >
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Button>
            </Link>
            <Link href="/portfolio">
              <Button 
                variant={location === "/portfolio" ? "default" : "ghost"}
                className="gap-2"
                data-testid="nav-portfolio"
              >
                <Briefcase className="h-4 w-4" />
                Portfolio
              </Button>
            </Link>
            <Link href="/strategy">
              <Button 
                variant={location === "/strategy" ? "default" : "ghost"}
                className="gap-2"
                data-testid="nav-strategy"
              >
                <Zap className="h-4 w-4" />
                Strategy
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
