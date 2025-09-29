import { Search, BarChart3, Zap, Lightbulb, Monitor, Lock } from "lucide-react";

export default function FeaturesSection() {
  const features = [
    {
      icon: Search,
      title: "Exclusive Search Volume Data",
      description: "Access real-time TikTok Shop search volumes that no other tool can provide",
      gradient: "from-blue-600 to-purple-600"
    },
    {
      icon: BarChart3,
      title: "Category Breakdown",
      description: "Detailed keyword analysis organized by product categories and niches",
      gradient: "from-teal-600 to-blue-600"
    },
    {
      icon: Zap,
      title: "Real-Time Insights",
      description: "Live traffic data and trending keyword updates as they happen",
      gradient: "from-purple-600 to-pink-600"
    },
    {
      icon: Lightbulb,
      title: "Competitor Gap Analysis",
      description: "Identify opportunities your competitors haven't discovered yet",
      gradient: "from-amber-500 to-orange-600"
    },
    {
      icon: Monitor,
      title: "Easy Dashboard",
      description: "Intuitive interface designed for busy Amazon sellers who need quick insights",
      gradient: "from-green-600 to-teal-600"
    },
    {
      icon: Lock,
      title: "Exclusive Access",
      description: "First-mover advantage with data that's simply not available anywhere else",
      gradient: "from-indigo-600 to-purple-600"
    }
  ];

  return (
    <section id="features" className="py-20 bg-gradient-to-br from-gray-50 to-blue-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Why Sellers Love Keyword Research
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Everything you need to dominate TikTok Shop keywords and stay ahead of the competition
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <div 
              key={index}
              className="glass-morphism rounded-2xl p-8 hover:shadow-xl transition-all duration-300"
            >
              <div className={`w-12 h-12 bg-gradient-to-r ${feature.gradient} rounded-xl mb-6 flex items-center justify-center`}>
                <feature.icon className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">{feature.title}</h3>
              <p className="text-gray-600">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
