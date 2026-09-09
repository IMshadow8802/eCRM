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
import HomeRedirect from "./components/HomeRedirect";
import SectionRedirect from "./components/SectionRedirect";
import RootLayout from "./components/RootLayout";
import SessionMonitor from "./components/SessionMonitor";
import ErrorBoundary from "./components/ErrorBoundary";

// Lazy-loaded components
const Login = lazy(() => import("./pages/auth/Login"));
const Dashboard = lazy(() => import("./components/Dashboard"));
const Task = lazy(() => import("./pages/Task/TaskBoard"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Admin — people/access provisioning that the task workspaces depend on
// (shared invites need Users; project workspaces need Projects + Teams).
const Users = lazy(() => import("./pages/Master/Users"));
const Teams = lazy(() => import("./pages/Master/Teams"));
const Projects = lazy(() => import("./pages/Master/Projects"));
const Groups = lazy(() => import("./pages/Master/Groups"));

// Sales module (leads, calls, follow-ups, products)
const SalesLeads = lazy(() => import("./pages/Sales/Leads"));
const LeadDetail = lazy(() => import("./pages/Sales/LeadDetail"));
const SalesFollowUps = lazy(() => import("./pages/Sales/FollowUps"));
const CustomFields = lazy(() => import("./pages/Settings/CustomFields"));
const PipelineSettings = lazy(() => import("./pages/Settings/Pipelines"));
const Lookups = lazy(() => import("./pages/Settings/Lookups"));
const Products = lazy(() => import("./pages/Settings/Products"));
const LeadsByStatus = lazy(() => import("./pages/Reports/LeadsByStatus"));
const CallsPerUser = lazy(() => import("./pages/Reports/CallsPerUser"));
const ConversionBySource = lazy(() => import("./pages/Reports/ConversionBySource"));

// Support / ticketing module (Spec 2)
const TicketBoard = lazy(() => import("./pages/Support/TicketBoard"));
const Tickets = lazy(() => import("./pages/Support/Tickets"));
const TicketDetail = lazy(() => import("./pages/Support/TicketDetail"));
const TicketCategories = lazy(() => import("./pages/Settings/TicketCategories"));
const Priorities = lazy(() => import("./pages/Settings/Priorities"));
const TicketsByCategory = lazy(() => import("./pages/Reports/TicketsByCategory"));
const ResolutionSummary = lazy(() => import("./pages/Reports/ResolutionSummary"));

export const routesConfig = [
  // Land on the first page the user's menu rights actually grant. This used to
  // be a hardcoded /dashboard, which dumped every user on a page they might
  // have no grant for.
  { path: "/", element: <HomeRedirect /> },
  { path: "/login", element: <Login /> },
  // Section landing redirects — the sidebar parent items (and rail-mode
  // flyout headers) navigate to the bare section path, which would otherwise
  // hit the 404 catch-all. Each goes to its first *granted* child, so a user
  // with Follow-ups but not Leads isn't bounced onto a page they can't see.
  { path: "/sales", element: <SectionRedirect prefix="/sales" fallback="/sales/leads" /> },
  { path: "/support", element: <SectionRedirect prefix="/support" fallback="/support/board" /> },
  { path: "/settings", element: <SectionRedirect prefix="/settings" fallback="/settings/custom-fields" /> },
  { path: "/reports", element: <SectionRedirect prefix="/reports" fallback="/reports/leads-by-status" /> },
  { path: "/admin", element: <SectionRedirect prefix="/admin" fallback="/users" /> },
  { path: "/dashboard/*", element: <ProtectedRoute element={<Dashboard />} /> },
  { path: "/tasks/*", element: <ProtectedRoute element={<Task />} /> },
  // Admin — user/team/project provisioning (backend was always live).
  { path: "/users/*", element: <ProtectedRoute element={<Users />} /> },
  { path: "/teams/*", element: <ProtectedRoute element={<Teams />} /> },
  { path: "/projects/*", element: <ProtectedRoute element={<Projects />} /> },
  { path: "/groups/*", element: <ProtectedRoute element={<Groups />} /> },
  // Sales module — leads, calls, follow-ups, products, reports.
  // The pipeline board is gone (spec 1). Bookmarks land on the list.
  { path: "/sales/pipeline", element: <Navigate to="/sales/leads" replace /> },
  { path: "/sales/leads", element: <ProtectedRoute element={<SalesLeads />} /> },
  { path: "/sales/leads/:leadId", element: <ProtectedRoute element={<LeadDetail />} /> },
  { path: "/sales/follow-ups", element: <ProtectedRoute element={<SalesFollowUps />} /> },
  { path: "/settings/custom-fields", element: <ProtectedRoute element={<CustomFields />} /> },
  { path: "/settings/pipelines", element: <ProtectedRoute element={<PipelineSettings />} /> },
  { path: "/settings/lookups", element: <ProtectedRoute element={<Lookups />} /> },
  { path: "/settings/products", element: <ProtectedRoute element={<Products />} /> },
  { path: "/reports/pipeline-funnel", element: <Navigate to="/reports/leads-by-status" replace /> },
  { path: "/reports/leads-by-status", element: <ProtectedRoute element={<LeadsByStatus />} /> },
  { path: "/reports/calls-per-user", element: <ProtectedRoute element={<CallsPerUser />} /> },
  { path: "/reports/conversion-by-source", element: <ProtectedRoute element={<ConversionBySource />} /> },
  // Support / ticketing module.
  { path: "/support/board", element: <ProtectedRoute element={<TicketBoard />} /> },
  { path: "/support/tickets", element: <ProtectedRoute element={<Tickets />} /> },
  { path: "/support/tickets/:ticketId", element: <ProtectedRoute element={<TicketDetail />} /> },
  { path: "/settings/ticket-categories", element: <ProtectedRoute element={<TicketCategories />} /> },
  { path: "/settings/priorities", element: <ProtectedRoute element={<Priorities />} /> },
  { path: "/reports/tickets-by-category", element: <ProtectedRoute element={<TicketsByCategory />} /> },
  { path: "/reports/resolution-summary", element: <ProtectedRoute element={<ResolutionSummary />} /> },
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
      <BrowserRouter basename="/prdcrm/">
        <SnackbarProvider
          maxSnack={3}
          style={{ maxWidth: "400px" }}
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
              <ErrorBoundary>
                <Suspense
                  fallback={
                    <div className="flex justify-center items-center h-screen">
                      <HashLoader color={"#4F46E5"} loading={true} size={80} />
                    </div>
                  }
                >
                  <AnimatedRoutes />
                </Suspense>
              </ErrorBoundary>
            </RootLayout>
          </SessionMonitor>
        </SnackbarProvider>
      </BrowserRouter>
    </HelmetProvider>
  );
};

export default App;
