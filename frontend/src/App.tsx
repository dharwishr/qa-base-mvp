import { BrowserRouter, Routes, Route } from "react-router-dom"
import { ThemeProvider } from "./contexts/ThemeContext"
import { AuthProvider } from "./contexts/AuthContext"
import ProtectedRoute from "./components/ProtectedRoute"
import Login from "./pages/Login"
import Signup from "./pages/Signup"
import Dashboard from "./pages/Dashboard"
import MethodSelection from "./pages/test-generation/MethodSelection"
import TypeSelection from "./pages/test-generation/TypeSelection"
import Results from "./pages/test-generation/Results"

import TestAnalysisChatPage from "./pages/TestAnalysisChatPage"
import TestCases from "./pages/TestCases"
import SessionDetail from "./pages/SessionDetail"
// ExistingSessionPage is now unified into TestAnalysisChatPage
import Scripts from "./pages/Scripts"
import ScriptDetail from "./pages/ScriptDetail"
import RunDetail from "./pages/RunDetail"
import ModuleDiscovery from "./pages/ModuleDiscovery"
import BenchmarkPage from "./pages/BenchmarkPage"
import BenchmarkHistoryPage from "./pages/BenchmarkHistoryPage"
import BenchmarkDetailPage from "./pages/BenchmarkDetailPage"
import SettingsPage from "./pages/SettingsPage"
import OrganizationSettings from "./pages/OrganizationSettings"
import TestPlans from "./pages/TestPlans"
import TestPlanRunDetail from "./pages/TestPlanRunDetail"

import DashboardLayout from "./components/layout/DashboardLayout"

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* Protected Dashboard Routes */}
          <Route element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/test-generation" element={<MethodSelection />} />
            <Route path="/test-generation/type/:method" element={<TypeSelection />} />
            <Route path="/test-generation/results" element={<Results />} />
            <Route path="/test-analysis" element={<TestAnalysisChatPage />} />
            <Route path="/test-analysis/:sessionId" element={<TestAnalysisChatPage />} />
            <Route path="/test-cases" element={<TestCases />} />
            <Route path="/test-cases/:sessionId" element={<SessionDetail />} />
            <Route path="/scripts" element={<Scripts />} />
            <Route path="/scripts/:scriptId" element={<ScriptDetail />} />
            <Route path="/scripts/:scriptId/runs/:runId" element={<RunDetail />} />
            <Route path="/test-plans" element={<TestPlans />} />
            <Route path="/test-plans/:planId" element={<TestPlans />} />
            <Route path="/test-plan-runs/:runId" element={<TestPlanRunDetail />} />
            <Route path="/discovery" element={<ModuleDiscovery />} />
            <Route path="/benchmark" element={<BenchmarkPage />} />
            <Route path="/benchmarks" element={<BenchmarkHistoryPage />} />
            <Route path="/benchmarks/:benchmarkId" element={<BenchmarkDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/organization" element={<OrganizationSettings />} />
          </Route>
        </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
