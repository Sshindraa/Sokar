import { ReactNode } from 'react';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="dark"
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(circle at top, #2a3036 0%, #1a1e22 45%, #15181c 100%)',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        color: '#f3f3f3',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          minHeight: 'calc(100vh - 32px)',
          background: 'linear-gradient(180deg, #212121 0%, #1b1b1b 100%)',
          border: '1px solid rgba(255,255,255,.05)',
          borderRadius: 28,
          padding: 16,
          boxShadow: '0 18px 40px rgba(0,0,0,.25)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
