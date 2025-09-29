import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LoginModal } from "./login-modal";

export function LoginModalDemo() {
  const [isOpen, setIsOpen] = useState(false);
  const [blockClose, setBlockClose] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const handleSubmit = async (email: string) => {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log("Submitted email:", email);
    setSubmittedEmail(email);
    setIsOpen(false);
  };

  return (
    <div className="p-8 space-y-6">
      <div className="text-center space-y-4">
        <h2 className="text-2xl font-bold text-gray-900">Login Modal Demo</h2>
        <p className="text-gray-600">Test the login modal component with different configurations</p>
      </div>

      <div className="flex flex-col space-y-4 max-w-md mx-auto">
        <Button 
          onClick={() => {
            setBlockClose(false);
            setIsOpen(true);
          }}
          className="bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 hover:from-blue-700 hover:via-purple-700 hover:to-blue-800 text-white"
        >
          Open Modal (Closable)
        </Button>
        
        <Button 
          onClick={() => {
            setBlockClose(true);
            setIsOpen(true);
          }}
          variant="outline"
        >
          Open Modal (Blocked Close)
        </Button>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Block close:</span>
          <input
            type="checkbox"
            checked={blockClose}
            onChange={(e) => setBlockClose(e.target.checked)}
            className="rounded border-gray-300"
          />
        </div>
      </div>

      {submittedEmail && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg text-center">
          <p className="text-green-800">
            Successfully submitted: <strong>{submittedEmail}</strong>
          </p>
          <Button 
            onClick={() => setSubmittedEmail(null)} 
            variant="ghost" 
            size="sm" 
            className="mt-2"
          >
            Clear
          </Button>
        </div>
      )}

      <LoginModal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        onSubmit={handleSubmit}
        blockClose={blockClose}
      />
    </div>
  );
}