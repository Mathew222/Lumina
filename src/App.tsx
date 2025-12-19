import { useState, useEffect } from 'react';
import { Dashboard } from './components/Dashboard';
import { SubtitlePopup } from './components/SubtitlePopup';

function App() {
  const [isPopup, setIsPopup] = useState(false);

  useEffect(() => {
    // specific check for popup mode
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'popup') {
      setIsPopup(true);
    }
  }, []);

  return isPopup ? <SubtitlePopup /> : <Dashboard />;
}

export default App;
