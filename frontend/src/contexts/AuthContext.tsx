import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, type User, type Organization, type UserRole, type LoginResponse } from '../services/authApi';

interface AuthContextType {
    token: string | null;
    user: User | null;
    organization: Organization | null;
    role: UserRole | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    isOwner: boolean;
    login: (email: string, password: string, organizationId?: string) => Promise<{ success: boolean; error?: string; needsOrgSelection?: boolean }>;
    logout: () => void;
    switchOrganization: (organizationId: string) => Promise<{ success: boolean; error?: string }>;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [token, setToken] = useState<string | null>(() => {
        return localStorage.getItem('auth_token');
    });
    const [user, setUser] = useState<User | null>(null);
    const [organization, setOrganization] = useState<Organization | null>(null);
    const [role, setRole] = useState<UserRole | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const navigate = useNavigate();

    const clearAuth = useCallback(() => {
        localStorage.removeItem('auth_token');
        setToken(null);
        setUser(null);
        setOrganization(null);
        setRole(null);
    }, []);

    const refreshUser = useCallback(async () => {
        const storedToken = localStorage.getItem('auth_token');
        if (!storedToken) {
            clearAuth();
            return;
        }

        try {
            const response = await authApi.getCurrentUser();
            setUser(response.user);
            setOrganization(response.organization);
            setRole(response.role);
        } catch {
            clearAuth();
        }
    }, [clearAuth]);

    useEffect(() => {
        const initAuth = async () => {
            const storedToken = localStorage.getItem('auth_token');
            if (storedToken) {
                setToken(storedToken);
                try {
                    const response = await authApi.getCurrentUser();
                    setUser(response.user);
                    setOrganization(response.organization);
                    setRole(response.role);
                } catch {
                    clearAuth();
                }
            }
            setIsLoading(false);
        };

        initAuth();
    }, [clearAuth]);

    const login = useCallback(async (email: string, password: string, organizationId?: string) => {
        try {
            const response: LoginResponse = await authApi.login(email, password, organizationId);
            
            localStorage.setItem('auth_token', response.access_token);
            setToken(response.access_token);
            setUser(response.user);
            setOrganization(response.organization);
            setRole(response.role);

            return { success: true };
        } catch (error: unknown) {
            const err = error as { status?: number; message?: string };
            if (err.status === 403 && err.message?.includes('not a member')) {
                return {
                    success: false,
                    error: 'You are not a member of any organization. Please contact an admin to add you.'
                };
            }
            return {
                success: false,
                error: err.message || 'Login failed'
            };
        }
    }, []);

    const logout = useCallback(() => {
        clearAuth();
        navigate('/');
    }, [navigate, clearAuth]);

    const switchOrganization = useCallback(async (organizationId: string) => {
        try {
            const response = await authApi.switchOrganization(organizationId);
            
            localStorage.setItem('auth_token', response.access_token);
            setToken(response.access_token);
            setUser(response.user);
            setOrganization(response.organization);
            setRole(response.role);

            return { success: true };
        } catch (error: unknown) {
            const err = error as { message?: string };
            return {
                success: false,
                error: err.message || 'Failed to switch organization'
            };
        }
    }, []);

    const value: AuthContextType = {
        token,
        user,
        organization,
        role,
        isAuthenticated: !!token && !!user,
        isLoading,
        isOwner: role === 'owner',
        login,
        logout,
        switchOrganization,
        refreshUser,
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

export function getAuthToken(): string | null {
    return localStorage.getItem('auth_token');
}

export function handleUnauthorized(): void {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
}
