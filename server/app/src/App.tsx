import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Join from "./routes/Join";
import Onboard from "./routes/Onboard";
import Game from "./routes/Game";
import Ob from "./routes/Ob";

export default function App() {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Join />} />
          <Route path="/onboard" element={<Onboard />} />
          <Route path="/game" element={<Game />} />
          <Route path="/ob" element={<Ob />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}
