import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { ReceivePage } from './pages/ReceivePage';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="p2p-theme">
      <div className="theme-mono">
        <div className="theme-container min-h-screen bg-background text-foreground">
          <div className="fixed top-4 right-4 z-50">
            <ThemeToggle />
          </div>
          <Router>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/receive/:roomId" element={<ReceivePage />} />
            </Routes>
          </Router>
          <Toaster />
        </div>
      </div>
    </ThemeProvider>
  );
}

export default App;
