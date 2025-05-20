// LoginPage.jsx
import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { loginUser } from '../features/authSlice';

const LoginPage = () => {
  const { register, handleSubmit, formState: { errors: formErrors } } = useForm();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user, loading, error: authApiError } = useSelector((state) => state.auth);

  const onSubmit = (data) => {
    console.log("LOGIN SUBMITTED WITH:", data); // Log submitted data
    dispatch(loginUser(data));
  };

  useEffect(() => {
    console.log(
      "LOGIN PAGE EFFECT:",
      "User:", user,
      "Loading:", loading,
      "API Error:", authApiError,
      "User is truthy:", !!user,
      "!loading:", !loading,
      "!authApiError:", !authApiError
    );

    if (user && !loading && !authApiError) {
      console.log("REDIRECT CONDITION MET. Navigating to /editor...");
      navigate('/editor');
    } else {
      console.log("REDIRECT CONDITION NOT MET.");
      if (!user) console.log("--> Reason: User is falsy/null.");
      if (loading) console.log("--> Reason: Still loading.");
      if (authApiError) console.log("--> Reason: API Error exists:", authApiError);
    }
  }, [user, loading, authApiError, navigate]);

  // ... rest of your JSX from the previous version ...
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-md">
        <h2 className="text-3xl font-bold text-center text-white mb-8">Login</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div>
            <label htmlFor="email_login_page" className="block text-sm font-medium text-gray-300 mb-1">
              Email
            </label>
            <input
              id="email_login_page" // Ensure unique ID if multiple email fields in app
              {...register('email', { 
                required: 'Email is required', 
                pattern: {
                  value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                  message: 'Invalid email address'
                }
              })}
              type="email"
              placeholder="you@example.com"
              className={`w-full p-3 border rounded-md bg-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 ${
                formErrors.email ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-blue-500'
              }`}
              aria-invalid={formErrors.email ? "true" : "false"}
            />
            {formErrors.email && (
              <p className="mt-1 text-xs text-red-400">{formErrors.email.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="password_login_page" className="block text-sm font-medium text-gray-300 mb-1">
              Password
            </label>
            <input
              id="password_login_page" // Ensure unique ID
              {...register('password', { required: 'Password is required' })}
              type="password"
              placeholder="••••••••"
              className={`w-full p-3 border rounded-md bg-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 ${
                formErrors.password ? 'border-red-500 focus:ring-red-500' : 'border-gray-600 focus:ring-blue-500'
              }`}
              aria-invalid={formErrors.password ? "true" : "false"}
            />
            {formErrors.password && (
              <p className="mt-1 text-xs text-red-400">{formErrors.password.message}</p>
            )}
          </div>

          {authApiError && (
            <div className="text-red-400 text-sm text-center p-2 bg-red-900 bg-opacity-30 rounded-md">
              {typeof authApiError === 'string' ? authApiError : (authApiError.message || 'Login failed. Please try again.')}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={loading}
              className={`w-full p-3 rounded-md text-white font-semibold transition-colors duration-150 ${
                loading ? 'bg-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
              } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500`}
            >
              {loading ? (
                <div className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Logging in...
                </div>
              ) : 'Login'}
            </button>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-400">
              Don't have an account?{' '}
              <a href="/register" onClick={(e) => { e.preventDefault(); navigate('/register');}} className="font-medium text-blue-500 hover:text-blue-400">
                Sign up
              </a>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;