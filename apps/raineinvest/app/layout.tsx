import './globals.css';
import { Toaster } from 'react-hot-toast';

export const metadata = {
  title: 'RaineBank',
  description: 'Financial Intelligence'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Toaster 
          position="bottom-right" 
          toastOptions={{
            style: { background: '#1f2937', color: '#fff', border: '1px solid #374151' },
            error: {
              style: { background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.5)', backdropFilter: 'blur(10px)' }
            }
          }}
        />
        {children}
      </body>
    </html>
  );
}
