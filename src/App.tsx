import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { HomePage } from '@/pages/HomePage';

const routerBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL.slice(0, -1)
  : import.meta.env.BASE_URL;

function App() {
  return (
    <BrowserRouter basename={routerBase}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
