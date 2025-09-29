import { useQuery } from "@tanstack/react-query";

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  firstName?: string | null;
  lastName?: string | null;
}

export function useAuth() {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  return {
    user: user as AuthUser | undefined,
    isLoading,
    error,
    isAuthenticated: !!user,
    isAdmin: !!user && (user as AuthUser)?.role === 'admin',
  };
}