import { config } from '../config';

const API_BASE = config.API_URL;

export interface User {
  id: string;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export type UserRole = 'owner' | 'member';

export interface OrganizationWithRole extends Organization {
  role: UserRole;
}

export interface UserInOrganization {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  joined_at: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
  organization: Organization;
  role: UserRole;
}

export interface SignupResponse {
  user: User;
  message: string;
}

export interface CurrentUserResponse {
  user: User;
  organization: Organization;
  role: UserRole;
}

class AuthApiError extends Error {
  public status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'AuthApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new AuthApiError(
      response.status,
      errorData.detail || `HTTP error ${response.status}`
    );
  }
  return response.json();
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export const authApi = {
  async signup(name: string, email: string, password: string): Promise<SignupResponse> {
    const response = await fetch(`${API_BASE}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    return handleResponse<SignupResponse>(response);
  },

  async login(email: string, password: string, organizationId?: string): Promise<LoginResponse> {
    const response = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, organization_id: organizationId }),
    });
    return handleResponse<LoginResponse>(response);
  },

  async getCurrentUser(): Promise<CurrentUserResponse> {
    const response = await fetch(`${API_BASE}/api/v1/auth/me`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<CurrentUserResponse>(response);
  },

  async getUserOrganizations(): Promise<OrganizationWithRole[]> {
    const response = await fetch(`${API_BASE}/api/v1/auth/organizations`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<OrganizationWithRole[]>(response);
  },

  async switchOrganization(organizationId: string): Promise<LoginResponse> {
    const response = await fetch(`${API_BASE}/api/v1/auth/switch-organization?organization_id=${organizationId}`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse<LoginResponse>(response);
  },
};

export const organizationApi = {
  async getCurrentOrganization(): Promise<Organization> {
    const response = await fetch(`${API_BASE}/api/v1/organizations`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<Organization>(response);
  },

  async updateOrganization(data: { name?: string; description?: string }): Promise<Organization> {
    const response = await fetch(`${API_BASE}/api/v1/organizations`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<Organization>(response);
  },

  async listUsers(): Promise<UserInOrganization[]> {
    const response = await fetch(`${API_BASE}/api/v1/organizations/users`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<UserInOrganization[]>(response);
  },

  async addUser(email: string, role: UserRole = 'member'): Promise<UserInOrganization> {
    const response = await fetch(`${API_BASE}/api/v1/organizations/users`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ email, role }),
    });
    return handleResponse<UserInOrganization>(response);
  },

  async updateUserRole(userId: string, role: UserRole): Promise<UserInOrganization> {
    const response = await fetch(`${API_BASE}/api/v1/organizations/users/${userId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ role }),
    });
    return handleResponse<UserInOrganization>(response);
  },

  async removeUser(userId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/v1/organizations/users/${userId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok && response.status !== 204) {
      const errorData = await response.json().catch(() => ({}));
      throw new AuthApiError(response.status, errorData.detail || `HTTP error ${response.status}`);
    }
  },
};

export { AuthApiError };
