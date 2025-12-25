import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = 'http://localhost:8005';

interface AuthContextType {
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [token, setToken] = useState<string | null>(() => {
        return localStorage.getItem('auth_token');
    });
    const [isLoading, setIsLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        // Validate token on mount
        const storedToken = localStorage.getItem('auth_token');
        if (storedToken) {
            setToken(storedToken);
        }
        setIsLoading(false);
    }, []);

    const login = useCallback(async (email: string, password: string) => {
        try {
            const response = await fetch(`${API_BASE}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                return {
                    success: false,
                    error: errorData.detail || 'Invalid credentials'
                };
            }

            const data = await response.json();
            const newToken = data.access_token;

            localStorage.setItem('auth_token', newToken);
            setToken(newToken);

            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: 'Network error. Please try again.'
            };
        }
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem('auth_token');
        setToken(null);
        navigate('/');
    }, [navigate]);

    const value: AuthContextType = {
        token,
        isAuthenticated: !!token,
        isLoading,
        login,
        logout,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

/**
 * Get the current auth token for API calls.
 * Returns null if not authenticated.
 */
export function getAuthToken(): string | null {
    return localStorage.getItem('auth_token');
}

/**
 * Handle 401 responses by clearing token and redirecting to login.
 */
export function handleUnauthorized(): void {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
}
