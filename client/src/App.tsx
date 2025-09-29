import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { trackPageView } from "@/lib/tracking";
import { useEffect } from "react";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import SearchPage from "@/pages/search";
import LoginDemoPage from "@/pages/login-demo";
import AdminPage from "@/pages/admin";
import AdminLoginPage from "@/pages/admin-login";

function Router() {
  const [location] = useLocation();
  
  // Track page views on route changes
  useEffect(() => {
    trackPageView(location);
  }, [location]);

  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/search" component={SearchPage} />
      <Route path="/login-demo" component={LoginDemoPage} />
      <Route path="/admin-login" component={AdminLoginPage} />
      <Route path="/admin" component={AdminPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
