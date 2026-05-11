import { useState, useEffect } from 'react';
import { Dashboard } from './components/Dashboard';
import { SubtitlePopup } from './components/SubtitlePopup';
import { FloatingWidget } from './components/FloatingWidget';

function App() {
  const [mode, setMode] = useState<'dashboard' | 'popup' | 'widget'>('dashboard');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlMode = params.get('mode');
    if (urlMode === 'popup') {
      setMode('popup');
    } else if (urlMode === 'widget') {
      setMode('widget');
    }
  }, []);

  if (mode === 'popup') return <SubtitlePopup />;
  if (mode === 'widget') return <FloatingWidget />;
  return <Dashboard />;
}

export default App;
