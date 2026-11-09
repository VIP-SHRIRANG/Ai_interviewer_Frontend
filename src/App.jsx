import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Master from "./services/Master";
import WisprLive from './services/WisprLive'

export default function App(){
  return(
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Master />} />
          <Route path="/stt" element={<WisprLive />} />
        </Routes>
      </BrowserRouter>
    </>
  );
}