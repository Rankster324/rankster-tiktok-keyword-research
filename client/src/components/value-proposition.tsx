import { Zap, TrendingUp, ShoppingBag } from "lucide-react";

export default function ValueProposition() {
  const benefits = [
    {
      icon: Zap,
      title: "First-to-Market Advantage",
      description: "Be the only seller with access to this exclusive TikTok Shop data while your competition remains in the dark",
      gradient: "from-blue-600 to-purple-600",
      bgGradient: "from-blue-50 to-purple-50"
    },
    {
      icon: TrendingUp,
      title: "Real TikTok Shop Traffic",
      description: "See actual search volumes, demand patterns, and trending keywords directly from TikTok Shop's massive user base",
      gradient: "from-teal-600 to-blue-600",
      bgGradient: "from-teal-50 to-blue-50"
    },
    {
      icon: ShoppingBag,
      title: "E-commerce Focused",
      description: "Built specifically for e-commerce professionals who want to expand into the TikTok ecosystem",
      gradient: "from-purple-600 to-pink-600",
      bgGradient: "from-purple-50 to-pink-50"
    }
  ];

  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            The Only TikTok Shop Keyword Tool You Need
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            While everyone else is stuck with old data, you'll have exclusive access to the fastest-growing commerce platform
          </p>
        </div>
        
        <div className="grid md:grid-cols-3 gap-8">
          {benefits.map((benefit, index) => (
            <div 
              key={index}
              className={`text-center p-8 rounded-2xl bg-gradient-to-br ${benefit.bgGradient} hover:shadow-lg transition-all duration-300 transform hover:-translate-y-2`}
            >
              <div className={`w-16 h-16 bg-gradient-to-r ${benefit.gradient} rounded-2xl mx-auto mb-6 flex items-center justify-center`}>
                <benefit.icon className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">{benefit.title}</h3>
              <p className="text-gray-600">{benefit.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
