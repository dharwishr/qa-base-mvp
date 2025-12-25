import { BrowserRouter, Routes, Route } from "react-router-dom"
import { AuthProvider } from "./contexts/AuthContext"
import ProtectedRoute from "./components/ProtectedRoute"
import Login from "./pages/Login"
import Dashboard from "./pages/Dashboard"
import MethodSelection from "./pages/test-generation/MethodSelection"
import TypeSelection from "./pages/test-generation/TypeSelection"
import Results from "./pages/test-generation/Results"

import TestAnalysis from "./pages/TestAnalysis"
import TestCases from "./pages/TestCases"
import SessionDetail from "./pages/SessionDetail"

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
            <Route path="/test-analysis" element={<TestAnalysis />} />
            <Route path="/test-cases" element={<TestCases />} />
            <Route path="/test-cases/:sessionId" element={<SessionDetail />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
