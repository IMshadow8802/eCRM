import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Home, ArrowLeft, RefreshCw } from "lucide-react";

const NotFound = () => {
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Change page title when this component mounts
    document.title = "404 - Page Not Found";

    // Trigger entrance animation
    const timer = setTimeout(() => setIsVisible(true), 100);

    return () => {
      // Reset title when component unmounts
      document.title = "eCRM";
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-white flex items-center justify-center p-4">
      <div className="text-center max-w-2xl mx-auto">
        {/* Animated 404 Number */}
        <div
          className={`transform transition-all duration-1000 ease-out ${
            isVisible
              ? "translate-y-0 opacity-100 scale-100"
              : "translate-y-8 opacity-0 scale-95"
          }`}
        >
          <div className="relative mb-8">
            <h1 className="text-9xl md:text-[12rem] font-black text-blue-600 mb-6 animate-float">
              404
            </h1>
            {/* Subtle shadow effect */}
            <div className="absolute inset-0 text-9xl md:text-[12rem] font-black text-blue-200 opacity-30 blur-xs -z-10 animate-pulse">
              404
            </div>
          </div>

          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4 animate-fade-in-up">
            Page Not Found
          </h2>
          <p className="text-xl text-gray-600 mb-8 animate-fade-in-up animation-delay-200">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>

        {/* Action Buttons */}
        <div
          className={`flex flex-col sm:flex-row gap-4 items-center justify-center transform transition-all duration-1000 ease-out ${
            isVisible
              ? "translate-y-0 opacity-100"
              : "translate-y-8 opacity-0"
          }`}
          style={{ transitionDelay: '0.3s' }}
        >
          <Link
            to="/dashboard"
            className="group flex items-center gap-3 px-8 py-4 bg-blue-600 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl hover:bg-blue-700 transform hover:scale-105 hover:-translate-y-1 transition-all duration-300"
          >
            <Home className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
            Go to Dashboard
          </Link>

          <button
            onClick={() => navigate(-1)}
            className="group flex items-center gap-3 px-8 py-4 bg-white text-gray-700 font-semibold rounded-lg shadow-lg hover:shadow-xl border-2 border-gray-200 hover:border-gray-300 transform hover:scale-105 hover:-translate-y-1 transition-all duration-300"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform duration-300" />
            Go Back
          </button>

          <button
            onClick={() => window.location.reload()}
            className="group flex items-center gap-3 px-6 py-4 bg-gray-100 text-gray-700 font-semibold rounded-lg shadow-lg hover:shadow-xl hover:bg-gray-200 transform hover:scale-105 hover:-translate-y-1 transition-all duration-300"
          >
            <RefreshCw className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" />
            Refresh
          </button>
        </div>
      </div>

      {/* Custom CSS for animations */}
      <style jsx>{`
        @keyframes float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-10px);
          }
        }

        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-float {
          animation: float 3s ease-in-out infinite;
        }

        .animate-fade-in-up {
          animation: fade-in-up 0.8s ease-out forwards;
          opacity: 0;
        }

        .animation-delay-200 {
          animation-delay: 0.2s;
        }
      `}</style>
    </div>
  );
};

export default NotFound;
