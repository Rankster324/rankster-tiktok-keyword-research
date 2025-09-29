import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { LoginModalDemo } from "@/components/login-modal-demo";
import logoImage from "@assets/xx Logo copy_1754316878226.png";

export default function LoginDemoPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Link href="/">
                <Button variant="ghost" size="sm" data-testid="button-back-home">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Home
                </Button>
              </Link>
              <img 
                src={logoImage} 
                alt="Rankster Logo" 
                className="h-8 w-auto"
              />
            </div>
            <div className="text-sm text-gray-600">
              Login Modal Demo
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <LoginModalDemo />
      </div>
    </div>
  );
}