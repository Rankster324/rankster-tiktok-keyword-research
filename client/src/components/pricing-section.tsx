import { Check, Star } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PricingSectionProps {
  onOpenSearchModal: () => void;
}

export default function PricingSection({ onOpenSearchModal }: PricingSectionProps) {
  const features = [
    "Unlimited keyword searches",
    "Real-time TikTok Shop search volumes",
    "Category breakdown analysis",
    "High-potential keyword (HPK) data",
    "Rising keyword (RK) insights", 
    "3-level category taxonomy",
    "Export search results",
    "Weekly trend reports",
    "Competitor gap analysis",
    "Live traffic data updates",
    "Exclusive TikTok Shop metrics",
    "Priority email support"
  ];

  return (
    <section id="pricing" className="py-20 bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Simple Pricing
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Get complete access to TikTok Shop keyword intelligence while we're in beta
          </p>
        </div>

        <div className="max-w-md mx-auto">
          <div className="relative">
            {/* Beta Badge */}
            <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-10">
              <div className="bg-gradient-to-r from-green-500 to-emerald-500 text-white px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1">
                <Star className="w-4 h-4" />
                BETA ACCESS
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-200 rounded-3xl p-8 pt-12">
              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Full Access</h3>
                <div className="flex items-center justify-center gap-3 mb-4">
                  <span className="text-5xl font-bold text-gray-900">FREE</span>
                  <div className="text-left">
                    <div className="text-gray-600 text-sm">during beta</div>
                    <div className="text-gray-400 text-sm line-through">$47/month</div>
                  </div>
                </div>
                <p className="text-gray-600">
                  Complete TikTok Shop keyword intelligence platform
                </p>
              </div>

              <div className="space-y-4 mb-8">
                {features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <span className="text-gray-700">{feature}</span>
                  </div>
                ))}
              </div>

              <Button 
                onClick={onOpenSearchModal}
                className="w-full gradient-button text-white py-4 rounded-xl font-bold text-lg hover:shadow-2xl hover:scale-105 transition-all duration-300"
                data-testid="button-start-beta-access"
              >
                Start Free Beta Access
              </Button>

              <p className="text-center text-sm text-gray-500 mt-4">
                No credit card required • Cancel anytime • Full access included
              </p>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}