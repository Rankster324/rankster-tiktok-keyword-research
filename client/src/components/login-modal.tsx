import { useState } from "react";
import { Lock, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (email: string) => void;
  blockClose?: boolean;
}

export function LoginModal({ open, onClose, onSubmit, blockClose = false }: LoginModalProps) {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim()) {
      setEmailError("Email is required");
      return;
    }

    if (!validateEmail(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }

    setEmailError("");
    setIsSubmitting(true);
    
    try {
      await onSubmit(email);
      setEmail("");
    } catch (error) {
      console.error("Submission error:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (emailError) {
      setEmailError("");
    }
  };

  const handleClose = () => {
    if (!blockClose) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent 
        className="max-w-md"
        onPointerDownOutside={(e) => blockClose && e.preventDefault()}
        onEscapeKeyDown={(e) => blockClose && e.preventDefault()}
      >
        {!blockClose && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        )}

        <DialogHeader className="text-center space-y-3">
          <div className="mx-auto w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
            <Lock className="w-6 h-6 text-blue-600" />
          </div>
          <DialogTitle className="text-3xl font-bold text-gray-900 text-center">
            🔒 Unlock Exclusive TikTok Shop Keyword Data
          </DialogTitle>
          <DialogDescription className="text-gray-600 space-y-4 text-center">
            <div className="text-xl font-semibold text-gray-900">
              Discover profitable keywords before your competitors even know they exist
            </div>
            <div className="space-y-2 text-center">
              <div className="flex items-center justify-center text-sm">
                ✅ <span className="ml-2">Real TikTok Shop search volumes</span>
              </div>
              <div className="flex items-center justify-center text-sm">
                ✅ <span className="ml-2">High-potential keyword opportunities</span>
              </div>
              <div className="flex items-center justify-center text-sm">
                ✅ <span className="ml-2">Rising trend insights before they peak</span>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium text-gray-700">
              Email
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="email"
                type="email"
                value={email}
                onChange={handleEmailChange}
                placeholder="Enter your best email to unlock free data"
                className="pl-10 h-11"
                data-testid="input-login-email"
                required
              />
            </div>
            {emailError && (
              <p className="text-sm text-red-600" role="alert">
                {emailError}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 hover:from-blue-700 hover:via-purple-700 hover:to-blue-800 text-white h-11 font-medium"
              data-testid="button-continue-email"
            >
              {isSubmitting ? "Creating account..." : "👉 Show Me the Keywords Now"}
            </Button>
            
            {!blockClose && (
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                className="w-full h-11 text-gray-500 underline"
                data-testid="button-skip-now"
              >
                I'll miss the insights — skip for now
              </Button>
            )}
          </div>

          <p className="text-xs text-gray-500 text-center leading-relaxed">
            Includes access to Rankster — TikTok Shop newsletter read by thousands of sellers. One-click unsubscribe.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}