import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError } from '@/api/client';
import { Button } from '@/components/Button';
import { Field, Input } from '@/components/Field';
import { Banner } from '@/components/States';
import { FullPageSpinner } from '@/components/Spinner';
import { USE_MOCKS } from '@/lib/config';
import { applyServerErrors } from '@/lib/serverErrors';
import { homeFor, useAuth } from './AuthContext';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
type FormValues = z.infer<typeof schema>;

const DEMO_ACCOUNTS = [
  { label: 'Author: Priya Sharma', email: 'priya.sharma@email.com' },
  { label: 'Author: Kavita Deshmukh (book in production)', email: 'kavita.deshmukh@email.com' },
  { label: 'Admin 1', email: 'admin1@bookleaf.com' },
];
// Never in production builds: the demo password must not ship.
const showDemoAccounts = USE_MOCKS || import.meta.env.DEV;

export function LoginPage() {
  const { user, initializing, login, logoutReason } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  if (initializing) return <FullPageSpinner />;
  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const onSubmit = async (values: FormValues) => {
    try {
      const u = await login(values.email, values.password);
      const home = homeFor(u.role);
      // Only honour the "from" location if it belongs to this role's area.
      const target = from && (u.role === 'ADMIN') === from.startsWith('/admin') ? from : home;
      navigate(target, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError('root.server', { message: 'That email and password combination is incorrect.' });
      } else {
        // Covers validation details and 429 ("Too many requests, try again shortly.").
        applyServerErrors(e, setError, ['email', 'password']);
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold text-brand-700">BookLeaf</p>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Sign in to your portal</h1>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          {logoutReason === 'expired' && <Banner tone="warning">Your session has expired. Please sign in again.</Banner>}
          {logoutReason === 'elsewhere' && <Banner tone="info">You were signed out in another tab.</Banner>}
          {errors.root?.server?.message && <Banner tone="error">{errors.root.server.message}</Banner>}
          <Field label="Email" error={errors.email?.message}>
            {(p) => <Input {...p} type="email" autoComplete="email" autoFocus {...register('email')} />}
          </Field>
          <Field label="Password" error={errors.password?.message}>
            {(p) => <Input {...p} type="password" autoComplete="current-password" {...register('password')} />}
          </Field>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Sign in
          </Button>
        </form>
        {showDemoAccounts && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <p className="font-medium text-slate-700">Demo accounts (password: Passw0rd!)</p>
            <ul className="mt-2 space-y-1">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <button
                    type="button"
                    className="text-left text-brand-700 underline-offset-2 hover:underline"
                    onClick={() => {
                      setValue('email', a.email, { shouldValidate: true });
                      setValue('password', 'Passw0rd!', { shouldValidate: true });
                    }}
                  >
                    {a.label}
                  </button>
                  <span className="ml-1 text-slate-500">{a.email}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
