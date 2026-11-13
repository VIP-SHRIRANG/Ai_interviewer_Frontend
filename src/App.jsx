import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Master from "./services/Master";
import Dashboard from './Dashboard' 

export default function App(){
  return(
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Master />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </BrowserRouter>
    </>
  );
}