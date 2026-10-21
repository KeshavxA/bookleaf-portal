import { createBrowserRouter, Link, type RouteObject } from 'react-router';
import { AppShell, type NavItem } from '@/components/AppShell';
import { EmptyState } from '@/components/States';
import { AdminTicketPage } from '@/features/admin/AdminTicketPage';
import { QueuePage } from '@/features/admin/QueuePage';
import { LoginPage } from '@/features/auth/LoginPage';
import { HomeRedirect, RequireRole } from '@/features/auth/RequireRole';
import { SessionWatcher } from '@/features/auth/SessionWatcher';
import { BooksPage } from '@/features/books/BooksPage';
import { NewTicketPage } from '@/features/tickets/NewTicketPage';
import { TicketDetailPage } from '@/features/tickets/TicketDetailPage';
import { TicketsPage } from '@/features/tickets/TicketsPage';

const authorNav: NavItem[] = [
  { to: '/books', label: 'My Books' },
  { to: '/tickets', label: 'My Tickets', end: true },
  { to: '/tickets/new', label: 'Submit Query' },
];

const adminNav: NavItem[] = [{ to: '/admin', label: 'Ticket Queue', end: true }];

function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <EmptyState title="Page not found" action={<Link to="/" className="text-brand-700 hover:underline">Go to your dashboard</Link>}>
        The page you're looking for doesn't exist.
      </EmptyState>
    </div>
  );
}

/** Route tree, exported so tests can mount it in a memory router. */
export const routes: RouteObject[] = [
  {
    // Root layout: follows sign-ins and sign-outs from other tabs.
    element: <SessionWatcher />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/', element: <HomeRedirect /> },
      {
        element: <RequireRole role="AUTHOR" />,
        children: [
          {
            element: <AppShell nav={authorNav} area="Author Portal" />,
            children: [
              { path: '/books', element: <BooksPage /> },
              { path: '/tickets', element: <TicketsPage /> },
              { path: '/tickets/new', element: <NewTicketPage /> },
              { path: '/tickets/:id', element: <TicketDetailPage /> },
            ],
          },
        ],
      },
      {
        element: <RequireRole role="ADMIN" />,
        children: [
          {
            element: <AppShell nav={adminNav} area="Support Admin" />,
            children: [
              { path: '/admin', element: <QueuePage /> },
              { path: '/admin/tickets/:id', element: <AdminTicketPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
