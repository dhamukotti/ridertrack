// src/App.js
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import MapComponent from './Mapcomponent';

function App() {
  return (
    <Routes>
      <Route path="/Triptrack" element={<MapComponent />} />
      {/* Add other routes as needed */}
    </Routes>
  );
}

export default App;