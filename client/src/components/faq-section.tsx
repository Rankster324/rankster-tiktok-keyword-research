import { useState } from "react";
import { ChevronDown } from "lucide-react";

export default function FAQSection() {
  const [openFAQ, setOpenFAQ] = useState<number | null>(null);

  const faqs = [
    {
      question: "How is this different from Amazon keyword tools?",
      answer: "Amazon keyword tools only show Amazon search data. This reveals TikTok Shop keyword data - an entirely different platform with different user behavior, trending products, and search patterns. This gives you insights into what's popular on social commerce that hasn't yet saturated Amazon."
    },
    {
      question: "Why does TikTok Shop data matter for Amazon sellers?",
      answer: "TikTok Shop shows you trending products and keywords before they become saturated on Amazon. Products that go viral on TikTok often see massive demand spikes on Amazon 2-4 weeks later. By seeing TikTok trends early, you can source products and optimize listings before the competition catches on."
    },
    {
      question: "Is the data really exclusive?",
      answer: "Yes. We're the first and currently only tool that provides TikTok Shop keyword and traffic data. While other tools focus on traditional platforms like Amazon, Google, or general TikTok content, we specifically track TikTok Shop commerce data that's not available anywhere else."
    },
    {
      question: "How accurate is the search volume data?",
      answer: "Our data is sourced directly from TikTok Shop's platform through proprietary methods, providing real-time insights into actual search volumes and trends. We update our database continuously to ensure you're getting the most current information available."
    },
    {
      question: "What happens after I subscribe?",
      answer: "After subscribing to our newsletter, you'll get immediate access to unlimited keyword searches, weekly TikTok Shop trend reports, and exclusive insights. You'll be among the first to know about emerging opportunities and trending products before they hit mainstream Amazon."
    }
  ];

  const toggleFAQ = (index: number) => {
    setOpenFAQ(openFAQ === index ? null : index);
  };

  return (
    <section id="faq" className="py-20 bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-xl text-gray-600">
            Everything you need to know about Rankster
          </p>
        </div>
        
        <div className="space-y-6">
          {faqs.map((faq, index) => (
            <div key={index} className="bg-white rounded-2xl p-8 border border-gray-200">
              <button 
                className="w-full text-left flex justify-between items-center"
                onClick={() => toggleFAQ(index)}
              >
                <h3 className="text-xl font-semibold text-gray-900 pr-4">{faq.question}</h3>
                <ChevronDown 
                  className={`w-6 h-6 text-gray-500 flex-shrink-0 transform transition-transform ${
                    openFAQ === index ? 'rotate-180' : ''
                  }`} 
                />
              </button>
              {openFAQ === index && (
                <div className="mt-4 text-gray-600">
                  <p>{faq.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
