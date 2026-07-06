import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../api/authApi';
import toast from 'react-hot-toast';
import { Dumbbell, ArrowLeft, Mail } from 'lucide-react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authService.forgotPassword(email);
      setSent(true);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen bg-dark-200 flex items-center justify-center p-4">
        <div className="card max-w-md w-full text-center animate-fade-in">
          <div className="w-16 h-16 bg-primary-500/20 rounded-full flex items-center 
                          justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-primary-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Check your inbox</h2>
          <p className="text-gray-400 mb-6">
            If an account exists for <strong className="text-white">{email}</strong>,
            you'll receive a password reset link shortly.
          </p>
          <Link to="/login" className="btn-primary w-full inline-block text-center">
            Back to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-200 flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 
                          bg-primary-600 rounded-2xl mb-4">
            <Dumbbell className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Reset Password</h1>
          <p className="text-gray-400 mt-2">Enter your email to receive a reset link</p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Email address
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                className="input-field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>

          <div className="text-center mt-6">
            <Link to="/login"
              className="inline-flex items-center gap-2 text-gray-400 
                         hover:text-white transition-colors text-sm">
              <ArrowLeft size={16} /> Back to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}