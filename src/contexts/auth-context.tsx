"use client";

import React, { createContext, useContext, useEffect, ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { User } from "@/lib/auth-service";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const auth = useAuth();

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
};

export const useAuthContext = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
};

// Higher-order component untuk memprotect routes
export const withAuth = <P extends object>(
  Component: React.ComponentType<P>
): React.FC<P & { requireAuth?: boolean }> => {
  const WrappedComponent = (props: P & { requireAuth?: boolean }) => {
    const { isAuthenticated, loading } = useAuthContext();
    const { requireAuth = true } = props;

    if (loading) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
        </div>
      );
    }

    if (requireAuth && !isAuthenticated) {
      // Redirect logic bisa ditambahkan di sini
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Authentication Required</h1>
            <p className="text-gray-600">Please login to access this page.</p>
          </div>
        </div>
      );
    }

    return <Component {...props} />;
  };

  WrappedComponent.displayName = `withAuth(${
    Component.displayName || Component.name
  })`;

  return WrappedComponent;
};

// Hook untuk memastikan user sudah authenticated
export const useRequireAuth = (): AuthContextType => {
  const auth = useAuthContext();

  useEffect(() => {
    if (!auth.loading && !auth.isAuthenticated) {
      // Redirect logic bisa ditambahkan di sini
      console.warn("User is not authenticated");
    }
  }, [auth.loading, auth.isAuthenticated]);

  return auth;
};
