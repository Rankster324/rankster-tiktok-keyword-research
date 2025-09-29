import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, X, Settings, LogIn, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { queryClient } from "@/lib/queryClient";
import logoImage from "@assets/xx Logo copy_1754316878226.png";

interface HeaderProps {
  onOpenSearchModal: () => void;
  onLoginRequired?: () => void;
}

export default function Header({ onOpenSearchModal, onLoginRequired }: HeaderProps) {
  const { user, isAuthenticated, isAdmin, isLoading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
    setMobileMenuOpen(false);
  };

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        // Invalidate auth cache to refresh user state
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        // Refresh the page to reset state
        window.location.reload();
      }
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleLogin = () => {
    if (onLoginRequired) {
      onLoginRequired();
    }
  };

  return (
    <header className="fixed top-0 w-full bg-white/90 backdrop-blur-md border-b border-gray-200/50 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex-shrink-0">
            <img 
              src={logoImage} 
              alt="Rankster Logo" 
              className="h-10 w-auto"
            />
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex space-x-8">
            <button 
              onClick={() => scrollToSection('features')}
              className="text-gray-700 hover:text-blue-600 font-medium transition-colors"
            >
              Features
            </button>
            <button 
              onClick={() => scrollToSection('pricing')}
              className="text-gray-700 hover:text-blue-600 font-medium transition-colors"
            >
              Pricing
            </button>
            <button 
              onClick={() => scrollToSection('faq')}
              className="text-gray-700 hover:text-blue-600 font-medium transition-colors"
            >
              FAQ
            </button>
            {isAuthenticated && isAdmin && (
              <>
                <a 
                  href="/admin"
                  className="text-gray-700 hover:text-blue-600 font-medium transition-colors flex items-center gap-1"
                  data-testid="link-admin-desktop"
                >
                  <Settings className="h-4 w-4" />
                  Admin
                </a>
              </>
            )}
          </nav>

          {/* Auth & CTA Buttons */}
          <div className="flex items-center space-x-4">
            {/* Authentication Status */}
            {!isLoading && (
              <>
                {isAuthenticated ? (
                  <div className="hidden md:flex items-center space-x-3">
                    <Button 
                      onClick={handleLogout}
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-2"
                      data-testid="button-logout"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </Button>
                  </div>
                ) : (
                  <Button 
                    onClick={handleLogin}
                    variant="outline"
                    size="sm"
                    className="hidden md:flex items-center gap-2"
                    data-testid="button-login"
                  >
                    <LogIn className="h-4 w-4" />
                    Login
                  </Button>
                )}
              </>
            )}
            
            <Button 
              onClick={onOpenSearchModal}
              className="hidden md:inline-flex gradient-button text-white px-6 py-2.5 rounded-lg font-semibold"
              data-testid="button-unlock-data-header"
            >
              Unlock TikTok Shop Data
            </Button>
            
            {/* Mobile Menu Button */}
            <Button 
              variant="ghost"
              size="sm"
              className="md:hidden p-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-white border-t border-gray-200">
          <div className="px-4 py-4 space-y-4">
            <button 
              onClick={() => scrollToSection('features')}
              className="block w-full text-left text-gray-700 font-medium py-2"
            >
              Features
            </button>
            <button 
              onClick={() => scrollToSection('pricing')}
              className="block w-full text-left text-gray-700 font-medium py-2"
            >
              Pricing
            </button>
            <button 
              onClick={() => scrollToSection('faq')}
              className="block w-full text-left text-gray-700 font-medium py-2"
            >
              FAQ
            </button>
            {isAuthenticated && isAdmin && (
              <>
                <a 
                  href="/admin"
                  className="block w-full text-left text-gray-700 font-medium py-2 flex items-center gap-2"
                  data-testid="link-admin-mobile"
                >
                  <Settings className="h-4 w-4" />
                  Admin Panel
                </a>
              </>
            )}
            
            {/* Mobile Authentication */}
            <div className="border-t pt-4">
              {isAuthenticated ? (
                <div className="space-y-3">
                  <div className="text-sm text-gray-600">
                    Welcome, {user?.email}
                  </div>
                  <Button 
                    onClick={handleLogout}
                    variant="outline"
                    size="sm"
                    className="w-full flex items-center gap-2"
                    data-testid="button-logout-mobile"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </Button>
                </div>
              ) : (
                <Button 
                  onClick={handleLogin}
                  variant="outline"
                  size="sm"
                  className="w-full flex items-center gap-2 mb-3"
                  data-testid="button-login-mobile"
                >
                  <LogIn className="h-4 w-4" />
                  Login
                </Button>
              )}
            </div>
            
            <Button 
              onClick={onOpenSearchModal}
              className="w-full gradient-button text-white px-6 py-3 rounded-lg font-semibold"
              data-testid="button-unlock-data-mobile"
            >
              Unlock TikTok Shop Data
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
