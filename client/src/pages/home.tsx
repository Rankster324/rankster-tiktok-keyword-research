import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { queryClient } from "@/lib/queryClient";
import Header from "@/components/header";
import HeroSection from "@/components/hero-section";
import ValueProposition from "@/components/value-proposition";
import FeaturesSection from "@/components/features-section";
import HowItWorks from "@/components/how-it-works";


import PricingSection from "@/components/pricing-section";
import FAQSection from "@/components/faq-section";

import Footer from "@/components/footer";
import EmailModal from "@/components/email-modal";
import { LoginModal } from "@/components/login-modal";

export default function Home() {
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();

  const openEmailModal = () => setEmailModalOpen(true);
  const closeEmailModal = () => setEmailModalOpen(false);
  
  // Handler for general "Unlock TikTok Shop Data" buttons - just navigate to search page
  const openSearchModal = () => {
    navigate("/search");
  };

  // Handler for specific "Browse all keywords" and "Search keywords" buttons - trigger login
  const handleLoginRequired = () => {
    if (isAuthenticated) {
      navigate("/search");
    } else {
      setLoginModalOpen(true);
    }
  };
  
  const closeLoginModal = () => setLoginModalOpen(false);
  
  const handleLoginSubmit = async (email: string) => {
    try {
      // Submit email and create account
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          // Invalidate auth cache to refresh user state
          await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          setLoginModalOpen(false);
          navigate("/search");
        } else {
          console.error('Signup failed:', result);
        }
      } else {
        const errorData = await response.json();
        console.error('Signup failed:', errorData);
      }
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header onOpenSearchModal={openSearchModal} onLoginRequired={handleLoginRequired} />
      <HeroSection onOpenSearchModal={openSearchModal} />
      <ValueProposition />
      <FeaturesSection />
      <HowItWorks onOpenSearchModal={openSearchModal} onLoginRequired={handleLoginRequired} />
      <PricingSection onOpenSearchModal={openSearchModal} />
      <FAQSection />

      <Footer />
      <EmailModal isOpen={emailModalOpen} onClose={closeEmailModal} />
      <LoginModal 
        open={loginModalOpen}
        onClose={closeLoginModal}
        onSubmit={handleLoginSubmit}
        blockClose={false}
      />
    </div>
  );
}
