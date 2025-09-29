import { Button } from "@/components/ui/button";

interface HowItWorksProps {
  onOpenSearchModal: () => void;
  onLoginRequired?: () => void;
}

export default function HowItWorks({ onOpenSearchModal, onLoginRequired }: HowItWorksProps) {
  const steps = [
    {
      number: "1",
      title: "Enter Your Keyword",
      description: "Search any product, brand, or niche you're interested in exploring",
      gradient: "from-blue-600 to-purple-600",
      lineGradient: "from-blue-600 to-purple-600"
    },
    {
      number: "2",
      title: "Get Exclusive Data",
      description: "See TikTok Shop traffic data that no one else has access to",
      gradient: "from-purple-600 to-pink-600",
      lineGradient: "from-purple-600 to-pink-600"
    },
    {
      number: "3",
      title: "Dominate Your Market",
      description: "Use insights to outrank competitors and capture new customers",
      gradient: "from-pink-600 to-orange-600"
    }
  ];

  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            How It Works
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Get TikTok Shop keyword insights in three simple steps
          </p>
        </div>
        
        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((step, index) => (
            <div key={index} className="text-center relative">
              <div className={`w-20 h-20 bg-gradient-to-r ${step.gradient} rounded-full mx-auto mb-8 flex items-center justify-center`}>
                <span className="text-2xl font-bold text-white">{step.number}</span>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">{step.title}</h3>
              <p className="text-gray-600 text-lg">{step.description}</p>
              
              {/* Connecting line */}
              {index < steps.length - 1 && (
                <div className={`hidden md:block absolute top-10 left-1/2 transform translate-x-8 w-full h-0.5 bg-gradient-to-r ${step.lineGradient} opacity-30`}></div>
              )}
            </div>
          ))}
        </div>
        
        <div className="text-center mt-12 space-y-4">
          <Button 
            onClick={onLoginRequired || onOpenSearchModal}
            className="gradient-button text-white px-12 py-6 rounded-2xl font-bold text-xl shadow-xl hover:shadow-2xl transform hover:scale-105 transition-all duration-300"
            data-testid="button-browse-keywords"
          >
            Browse all keywords
          </Button>

        </div>
      </div>
    </section>
  );
}
