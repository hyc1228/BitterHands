import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { startMonitorVoiceService } from "./lib/monitorVoiceService";
import "./styles/globals.css";
import "./styles/screens.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

startMonitorVoiceService();

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
