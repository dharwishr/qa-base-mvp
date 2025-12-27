import { BrowserRouter, Routes, Route } from "react-router-dom"
import { AuthProvider } from "./contexts/AuthContext"
import ProtectedRoute from "./components/ProtectedRoute"
import Login from "./pages/Login"
import Dashboard from "./pages/Dashboard"
import MethodSelection from "./pages/test-generation/MethodSelection"
import TypeSelection from "./pages/test-generation/TypeSelection"
import Results from "./pages/test-generation/Results"

import TestAnalysisChatPage from "./pages/TestAnalysisChatPage"
import TestCases from "./pages/TestCases"
import SessionDetail from "./pages/SessionDetail"
import Scripts from "./pages/Scripts"
import ScriptDetail from "./pages/ScriptDetail"
import RunDetail from "./pages/RunDetail"
import ModuleDiscovery from "./pages/ModuleDiscovery"
import BenchmarkPage from "./pages/BenchmarkPage"
import BenchmarkHistoryPage from "./pages/BenchmarkHistoryPage"
import BenchmarkDetailPage from "./pages/BenchmarkDetailPage"

import DashboardLayout from "./components/layout/DashboardLayout"

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Login />} />

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
            <Route path="/test-cases" element={<TestCases />} />
            <Route path="/test-cases/:sessionId" element={<SessionDetail />} />
            <Route path="/scripts" element={<Scripts />} />
            <Route path="/scripts/:scriptId" element={<ScriptDetail />} />
            <Route path="/scripts/:scriptId/runs/:runId" element={<RunDetail />} />
            <Route path="/discovery" element={<ModuleDiscovery />} />
            <Route path="/benchmark" element={<BenchmarkPage />} />
            <Route path="/benchmarks" element={<BenchmarkHistoryPage />} />
            <Route path="/benchmarks/:benchmarkId" element={<BenchmarkDetailPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
