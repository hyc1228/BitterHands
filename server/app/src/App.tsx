import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Join from "./routes/Join";
import Onboard from "./routes/Onboard";
import Lobby from "./routes/Lobby";
import MainScene from "./routes/MainScene";
import Ob from "./routes/Ob";
import Test from "./routes/Test";

export default function App() {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Join />} />
          <Route path="/onboard" element={<Onboard />} />
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/main-scene" element={<MainScene />} />
          <Route path="/ob" element={<Ob />} />
          <Route path="/test" element={<Test />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}
