/**
 * Types for module discovery feature.
 */

export interface DiscoveredModule {
    id: string;
    name: string;
    url: string;
    summary: string;
    created_at: string;
}

export interface DiscoverySession {
    id: string;
    url: string;
    username?: string;
    max_steps: number;
    status: 'pending' | 'queued' | 'running' | 'completed' | 'failed';
    total_steps: number;
    duration_seconds: number;
    error?: string;
    created_at: string;
    updated_at: string;
    modules: DiscoveredModule[];
}

export interface DiscoverySessionListItem {
    id: string;
    url: string;
    status: 'pending' | 'queued' | 'running' | 'completed' | 'failed';
    total_steps: number;
    duration_seconds: number;
    module_count: number;
    created_at: string;
}

export interface CreateDiscoveryRequest {
    url: string;
    username?: string;
    password?: string;
    max_steps?: number;
}

export interface CreateDiscoveryResponse {
    session_id: string;
    status: string;
    message: string;
}
