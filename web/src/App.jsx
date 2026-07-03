import { SnackbarProvider } from "notistack";
import { lazy, Suspense } from "react";
import { HelmetProvider } from "react-helmet-async";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { HashLoader } from "react-spinners";
import { AnimatePresence, motion } from "framer-motion";

import ProtectedRoute from "./components/ProtectedRoutes";
import RootLayout from "./components/RootLayout";
import SessionMonitor from "./components/SessionMonitor";

// Lazy-loaded components
const Login = lazy(() => import("./pages/auth/Login"));
const Dashboard = lazy(() => import("./components/Dashboard"));
const Projects = lazy(() => import("./pages/Master/Projects"));
const Teams = lazy(() => import("./pages/Master/Teams"));
const Task = lazy(() => import("./pages/Task/TaskBoard"));
const Users = lazy(() => import("./pages/Master/Users"));
const LeadSource = lazy(() => import("./pages/Master/LeadSource"));
const Status = lazy(() => import("./pages/Master/Status"));
const Leads = lazy(() => import("./pages/Master/Leads"));
const FollowUps = lazy(() => import("./pages/Master/FollowUps"));
const UserFollowups = lazy(() => import("./pages/Reports/UserFollowups"));
const BranchLeadSummary = lazy(() => import("./pages/Reports/BranchLeadSummary"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Sales module (config-driven pipeline, leads, calls)
const Pipeline = lazy(() => import("./pages/Sales/Pipeline"));
const SalesLeads = lazy(() => import("./pages/Sales/Leads"));
const LeadDetail = lazy(() => import("./pages/Sales/LeadDetail"));
const CustomFields = lazy(() => import("./pages/Settings/CustomFields"));
const PipelineSettings = lazy(() => import("./pages/Settings/Pipelines"));
const Lookups = lazy(() => import("./pages/Settings/Lookups"));
const PipelineFunnel = lazy(() => import("./pages/Reports/PipelineFunnel"));
const CallsPerUser = lazy(() => import("./pages/Reports/CallsPerUser"));
const ConversionBySource = lazy(() => import("./pages/Reports/ConversionBySource"));

const routesConfig = [
  { path: "/", element: <Navigate to="/dashboard" replace /> },
  { path: "/login", element: <Login /> },
  { path: "/dashboard/*", element: <ProtectedRoute element={<Dashboard />} /> },
  { path: "/tasks/*", element: <ProtectedRoute element={<Task />} /> },
  { path: "/projects/*", element: <ProtectedRoute element={<Projects />} /> },
  { path: "/teams/*", element: <ProtectedRoute element={<Teams />} /> },
  { path: "/users/*", element: <ProtectedRoute element={<Users />} /> },
  { path: "/lead_source/*", element: <ProtectedRoute element={<LeadSource />} /> },
  { path: "/status/*", element: <ProtectedRoute element={<Status />} /> },
  { path: "/leads/*", element: <ProtectedRoute element={<Leads />} /> },
  { path: "/follow-up/*", element: <ProtectedRoute element={<FollowUps />} /> },
  {
    path: "/followups_user-wise/*",
    element: <ProtectedRoute element={<UserFollowups />} />,
  },
  {
    path: "/lead_summary_branch-wise/*",
    element: <ProtectedRoute element={<BranchLeadSummary />} />,
  },
  // Sales module — config-driven pipeline, leads, calls, reports.
  { path: "/sales/pipeline", element: <ProtectedRoute element={<Pipeline />} /> },
  { path: "/sales/leads", element: <ProtectedRoute element={<SalesLeads />} /> },
  { path: "/sales/leads/:leadId", element: <ProtectedRoute element={<LeadDetail />} /> },
  { path: "/settings/custom-fields", element: <ProtectedRoute element={<CustomFields />} /> },
  { path: "/settings/pipelines", element: <ProtectedRoute element={<PipelineSettings />} /> },
  { path: "/settings/lookups", element: <ProtectedRoute element={<Lookups />} /> },
  { path: "/reports/pipeline-funnel", element: <ProtectedRoute element={<PipelineFunnel />} /> },
  { path: "/reports/calls-per-user", element: <ProtectedRoute element={<CallsPerUser />} /> },
  { path: "/reports/conversion-by-source", element: <ProtectedRoute element={<ConversionBySource />} /> },
];

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
        style={{ height: "100%" }}
      >
        <Routes location={location}>
          {routesConfig.map(({ path, element }, index) => (
            <Route key={index} path={path} element={element} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

const App = () => {
  return (
    <HelmetProvider>
      <BrowserRouter basename="/eStockCRM/">
        <SnackbarProvider
          maxSnack={3}
          style={{ maxWidth: "400px", zIndex: 1800 }}
          anchorOrigin={{ vertical: "top", horizontal: "center" }}
          dense
          preventDuplicate
          autoHideDuration={3500}
        >
          <SessionMonitor
            options={{
              tokenWarningMinutes: 5,
              autoLogout: true,
              showNetworkNotifications: true,
              debug: false, // flip to true to log token/network state each tick
            }}
          >
            <RootLayout>
              <Suspense
                fallback={
                  <div className="flex justify-center items-center h-screen">
                    <HashLoader color={"#4F46E5"} loading={true} size={80} />
                  </div>
                }
              >
                <AnimatedRoutes />
              </Suspense>
            </RootLayout>
          </SessionMonitor>
        </SnackbarProvider>
      </BrowserRouter>
    </HelmetProvider>
  );
};

export default App;
