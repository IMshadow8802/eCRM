import { Navigate } from "react-router-dom";

const ProtectedRoute = ({ element }) => {
  // Check if userData exists in local storage
  const userData = localStorage.getItem("userData");

  if (!userData) {
    // Redirect to the login page if userData doesn't exist
    return <Navigate to="/login" replace />;
  }

  // Render the original element if userData exists
  return element;
};

export default ProtectedRoute;