import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

interface HeroSectionProps {
  onOpenSearchModal: () => void;
}

export default function HeroSection({ onOpenSearchModal }: HeroSectionProps) {
  return (
    <section className="pt-24 pb-16 bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-8 animate-fade-in-up">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight">
              <span className="gradient-text">
                Discover Untapped TikTok Shop Keywords
              </span>
              <span className="block text-gray-900">Before Your Competition</span>
            </h1>
            
            <p className="text-xl text-gray-600 leading-relaxed">
              One of the only tools that reveals actual TikTok Shop traffic data. Get exclusive keyword insights that sellers have never had access to before.
            </p>
            
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  onClick={onOpenSearchModal}
                  className="gradient-button text-white px-12 py-6 rounded-2xl font-bold text-xl shadow-xl hover:shadow-2xl transform hover:scale-105 transition-all duration-300"
                  data-testid="button-unlock-data-hero"
                >
                  Unlock TikTok Shop Data
                </Button>
              </div>
              
              <div className="flex items-center space-x-6 text-sm text-gray-500">
                <div className="flex items-center space-x-2">
                  <Check className="w-5 h-5 text-green-500" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Check className="w-5 h-5 text-green-500" />
                  <span>Instant access</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="relative animate-fade-in-up">
            <img 
              src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1000&h=600" 
              alt="Rankster dashboard interface showing TikTok Shop keyword analytics" 
              className="rounded-2xl shadow-2xl w-full h-auto" 
            />
            
            {/* Floating Elements */}
            <div className="absolute -top-4 -right-4 glass-morphism rounded-xl p-4 shadow-lg">
              <div className="text-sm font-semibold text-gray-700">Live Data</div>
              <div className="text-2xl font-bold text-green-600">+247%</div>
            </div>
            
            <div className="absolute -bottom-4 -left-4 glass-morphism rounded-xl p-4 shadow-lg">
              <div className="text-sm font-semibold text-gray-700">Keywords Found</div>
              <div className="text-2xl font-bold text-blue-600">1,247</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
