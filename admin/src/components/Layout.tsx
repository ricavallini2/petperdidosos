import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { UiHost } from './UiHost';
import { PendingProvider } from '../contexts/PendingContext';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <PendingProvider>
      <div className="layout">
        <Sidebar />
        <div className="main-col">
          <Topbar />
          <main className="content">{children}</main>
        </div>
      </div>
      <UiHost />
    </PendingProvider>
  );
}
