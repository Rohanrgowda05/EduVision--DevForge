import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppProvider } from "@/context/AppContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Quiz from "@/pages/Quiz";
import Profile from "@/pages/Profile";
import Browse from "@/pages/Browse";
import SignInPage from "@/pages/SignInPage";
import SignUpPage from "@/pages/SignUpPage";

import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/clerk-react";

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  if (!CLERK_PUBLISHABLE_KEY) {
    // If Clerk key is not configured, allow access in local dev mode
    return <Component />;
  }

  return (
    <>
      <SignedIn>
        <Component />
      </SignedIn>
      <SignedOut>
        <Redirect to="/sign-in" />
      </SignedOut>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/sign-up" component={SignUpPage} />
      <Route path="/">
        {() => <ProtectedRoute component={Home} />}
      </Route>
      <Route path="/quiz">
        {() => <ProtectedRoute component={Quiz} />}
      </Route>
      <Route path="/profile">
        {() => <ProtectedRoute component={Profile} />}
      </Route>
      <Route path="/browse">
        {() => <ProtectedRoute component={Browse} />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between gap-4 p-3 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-3">
              {CLERK_PUBLISHABLE_KEY && (
                <SignedIn>
                  <UserButton afterSignOutUrl="/sign-in" />
                </SignedIn>
              )}
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto bg-background">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  const content = (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppProvider>
          <AppContent />
          <Toaster />
        </AppProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );

  if (CLERK_PUBLISHABLE_KEY) {
    return (
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
        {content}
      </ClerkProvider>
    );
  }

  return content;
}

export default App;
