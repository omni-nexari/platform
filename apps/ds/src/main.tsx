import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { Toaster } from 'sonner';
import { ThemeProvider } from './contexts/ThemeContext.js';
import App from './App.js';
import { queryClient } from './lib/query-client.js';
import { initRemoteLogger } from './lib/remote-logger.js';
import './styles/globals.css';
import './styles/cyberpunk.css';

// Must be called before any component renders so all console.error / warn
// calls and unhandled rejections are captured from the very start.
initRemoteLogger();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster richColors position="top-right" />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
